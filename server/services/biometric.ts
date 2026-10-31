// Fingerprint machine data → punches → attendance.
//  1. storePunches:   keep every raw punch once (device sync or USB file), idempotently.
//  2. linking:        machine user ID (PIN) ↔ employees.biometric_id; auto-link when unambiguous.
//  3. punch_records:  linked raw punches become punches; attendance is re-matched for those days.
import os from "node:os";
import { env } from "../config/env";
import { execute, query, queryOne, transaction } from "../db/pool";
import { localDateKey } from "../utils/dates";
import { logger } from "../utils/logger";
import { runMatching } from "./attendance";
import { formatDeviceTime, pullDevice, type DeviceInfo, type DevicePunch, type DeviceUser } from "./zkDevice";

// ── Which machine addresses may be contacted ──────────────────────

const isIpv4 = (ip: string) => /^(\d{1,3})(\.\d{1,3}){3}$/.test(ip) && ip.split(".").every((part) => Number(part) <= 255);
const ipv4ToInt = (ip: string) => ip.split(".").reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;

function inCidr(ip: string, cidr: string): boolean {
  const [base, bitsText] = cidr.split("/");
  if (!isIpv4(ip) || !isIpv4(base)) return false;
  const bits = bitsText === undefined ? 32 : Number(bitsText);
  if (!(bits >= 0 && bits <= 32)) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

const PRIVATE_RANGES = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];

/**
 * The server only connects to machines on the office LAN (or the explicit allow-list),
 * so the device settings cannot be abused to make the server reach other hosts.
 */
export function isAllowedDeviceAddress(ip: string, allowList = env.BIOMETRIC_ALLOWED_IPS): boolean {
  if (!isIpv4(ip)) return false;
  const configured = allowList.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (configured.length) return configured.some((entry) => inCidr(ip, entry));
  return PRIVATE_RANGES.some((range) => inCidr(ip, range));
}

/** This computer's LAN addresses (the machine must be on the same network). */
export function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((item): item is os.NetworkInterfaceInfo => Boolean(item && item.family === "IPv4" && !item.internal && !item.address.startsWith("169.254.")))
    .map((item) => item.address);
}

// ── USB / exported log files ──────────────────────────────────────

const YMD = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/;
const DMY = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?/;

/** Any supported date-time text → local Date, or null. */
export function parseLogDateTime(text: string): Date | null {
  const s = String(text ?? "").trim();
  let y: number, mo: number, d: number, h: number, mi: number, se: number;
  let m = YMD.exec(s);
  if (m) [y, mo, d, h, mi, se] = [+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0)];
  else {
    m = DMY.exec(s);
    if (!m) return null;
    [d, mo, y, h, mi, se] = [+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0)];
    const ampm = (m[7] ?? "").toUpperCase();
    if (ampm === "PM" && h < 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59 || y < 2000) return null;
  return new Date(y, mo - 1, d, h, mi, se);
}

const splitCsvLine = (line: string) => line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((cell) => cell.trim().replace(/^"|"$/g, "").replace(/""/g, '"'));
const norm = (s: string) => s.toLowerCase().replace(/[\s_\-./]+/g, " ").trim();
const ID_HEADERS = ["user id", "userid", "employee id", "emp id", "enroll no", "enrollno", "enroll number", "ac no", "ac no ", "emp code", "employee code", "pin", "badgenumber", "badge number", "id", "empcode", "device user id", "biometric id", "machine id"];
const DATETIME_HEADERS = ["date time", "datetime", "punch time", "check time", "checktime", "log time", "logtime", "date time ", "punch"];

/**
 * Parse a punch log from a pen drive (eSSL/ZKTeco attlog.dat / .txt: "<user id> <date time> …")
 * or a CSV export with a header row ("User ID", "Date Time" or separate "Date" and "Time").
 */
export function parsePunchFile(content: string, fileName: string): { punches: DevicePunch[]; skipped: number; format: string } {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const isCsv = fileName.toLowerCase().endsWith(".csv") && /[A-Za-z]{3,}/.test(lines[0] ?? "");
  const punches: DevicePunch[] = [];
  let skipped = 0;
  const now = Date.now();
  const valid = (pin: string, time: Date | null) =>
    /^[A-Za-z0-9]{1,20}$/.test(pin) && /\d/.test(pin) && time !== null && time.getTime() <= now + 24 * 3600_000;

  if (isCsv) {
    const headers = splitCsvLine(lines[0]).map(norm);
    const find = (names: string[]) => headers.findIndex((h) => names.includes(h));
    const idCol = find(ID_HEADERS);
    const dtCol = find(DATETIME_HEADERS);
    const dateCol = find(["date", "punch date", "log date"]);
    const timeCol = find(["time", "in time", "log time"]);
    if (idCol < 0) throw new Error('Could not find a "User ID" / "Enroll No" column in the file');
    if (dtCol < 0 && (dateCol < 0 || timeCol < 0)) throw new Error('Could not find a "Date Time" column (or separate "Date" and "Time" columns)');
    for (const line of lines.slice(1)) {
      const cells = splitCsvLine(line);
      const pin = (cells[idCol] ?? "").replace(/\.0$/, "");
      const time = dtCol >= 0 ? parseLogDateTime(cells[dtCol] ?? "") : parseLogDateTime(`${cells[dateCol] ?? ""} ${cells[timeCol] ?? ""}`);
      if (valid(pin, time)) punches.push({ pin, punchTime: time! });
      else skipped += 1;
    }
    return { punches, skipped, format: "CSV export" };
  }

  for (const line of lines) {
    const m = /^([A-Za-z0-9]+)\s*[\t,;]?\s*(.*)$/.exec(line);
    const time = m ? parseLogDateTime(m[2]) : null;
    if (m && valid(m[1], time)) punches.push({ pin: m[1], punchTime: time! });
    else skipped += 1;
  }
  return { punches, skipped, format: "machine log (attlog)" };
}

// ── Storage ───────────────────────────────────────────────────────

const CHUNK = 500;

/** Insert raw punches, ignoring any (machine ID, time) already stored. Returns the new rows' count. */
export async function storePunches(punches: DevicePunch[], deviceId: number | null, source: "device" | "file") {
  const seen = new Set<string>();
  const unique = punches.filter((p) => {
    const key = `${p.pin}|${p.punchTime.getTime()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  let inserted = 0;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const result = await execute(
      `INSERT IGNORE INTO biometric_logs (device_id, pin, punch_time, source) VALUES ${slice.map(() => "(?, ?, ?, ?)").join(",")}`,
      slice.flatMap((p) => [deviceId, p.pin, p.punchTime, source]),
    );
    inserted += result.affectedRows;
  }
  return { inserted, duplicates: unique.length - inserted };
}

/** Mirror the machine's user list (names, card numbers) for the linking screen. */
export async function storeDeviceUsers(users: DeviceUser[], deviceId: number | null) {
  for (let i = 0; i < users.length; i += CHUNK) {
    const slice = users.slice(i, i + CHUNK);
    await execute(
      `INSERT INTO biometric_users (pin, name, card_no, device_id) VALUES ${slice.map(() => "(?, ?, ?, ?)").join(",")}
       ON DUPLICATE KEY UPDATE name = COALESCE(VALUES(name), name), card_no = COALESCE(VALUES(card_no), card_no),
         device_id = COALESCE(VALUES(device_id), device_id), last_seen_at = NOW()`,
      slice.flatMap((u) => [u.pin, u.name, u.cardNo, deviceId]),
    );
  }
  // IDs seen only in the punch log (deleted from the machine, or from a file) still need a row to link.
  await execute(
    `INSERT IGNORE INTO biometric_users (pin, device_id)
     SELECT DISTINCT l.pin, l.device_id FROM biometric_logs l LEFT JOIN biometric_users u ON u.pin = l.pin WHERE u.id IS NULL`,
  );
}

/**
 * Turn raw punches of linked machine IDs into punch records (once), then re-match the affected days.
 * Machines pulled over TCP do not report IN/OUT, so punches are AUTO: first of the day = in, last = out.
 */
export async function convertLinkedPunches(): Promise<{ converted: number; days: number }> {
  const rows = await query<{ id: number; employeeId: number; punchTime: Date; source: "device" | "file"; device: string | null }>(
    `SELECT l.id, e.id AS employeeId, l.punch_time AS punchTime, l.source, COALESCE(d.name, 'USB file') AS device
       FROM biometric_logs l
       JOIN employees e ON e.biometric_id = l.pin
       LEFT JOIN biometric_devices d ON d.id = l.device_id
      WHERE l.employee_id IS NULL OR l.employee_id <> e.id
      LIMIT 20000`,
  );
  if (!rows.length) return { converted: 0, days: 0 };
  const dates = new Set<string>();
  await transaction(async (conn) => {
    for (const row of rows) {
      await execute("UPDATE biometric_logs SET employee_id = ? WHERE id = ?", [row.employeeId, row.id], conn);
      await execute(
        `INSERT IGNORE INTO punch_records (employee_id, punch_time, direction, device_id, source, log_id)
         VALUES (?, ?, 'AUTO', ?, ?, ?)`,
        // USB files can be edited before upload, so they are treated like CSV (removable), not as machine evidence.
        [row.employeeId, row.punchTime, String(row.device).slice(0, 80), row.source === "device" ? "device" : "csv", row.id],
        conn,
      );
      dates.add(localDateKey(row.punchTime));
    }
  });
  await rematch(dates);
  return { converted: rows.length, days: dates.size };
}

async function rematch(dates: Iterable<string>) {
  const today = localDateKey();
  for (const date of [...new Set(dates)].sort()) {
    if (date > today) continue;
    await runMatching(date).catch((error) => logger.error("matching failed", { date, error: (error as Error).message }));
  }
}

/** Link a machine ID to an employee and convert their punches. */
export async function linkPin(pin: string, employeeId: number) {
  await execute("INSERT IGNORE INTO biometric_users (pin) VALUES (?)", [pin]);
  await execute("UPDATE employees SET biometric_id = ? WHERE id = ?", [pin, employeeId]);
  return convertLinkedPunches();
}

/** Remove the link; punches that came from this machine ID are taken back out of attendance. */
export async function unlinkPin(pin: string) {
  const dates = await query<{ day: string }>(
    "SELECT DISTINCT DATE_FORMAT(p.punch_time, '%Y-%m-%d') AS day FROM punch_records p JOIN biometric_logs l ON l.id = p.log_id WHERE l.pin = ?",
    [pin],
  );
  await transaction(async (conn) => {
    await execute("DELETE p FROM punch_records p JOIN biometric_logs l ON l.id = p.log_id WHERE l.pin = ?", [pin], conn);
    await execute("UPDATE biometric_logs SET employee_id = NULL WHERE pin = ?", [pin], conn);
    await execute("UPDATE employees SET biometric_id = NULL WHERE biometric_id = ?", [pin], conn);
  });
  await rematch(dates.map((d) => d.day));
}

/**
 * Link machine users to employees when exactly one employee fits:
 * the machine ID equals the employee ID, or the number at the end of the employee ID
 * (IS/2026/1033 ↔ 1033), or the machine name equals the employee name.
 */
export async function autoLinkUsers() {
  const users = await query<{ pin: string; name: string | null }>(
    "SELECT u.pin, u.name FROM biometric_users u WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.biometric_id = u.pin)",
  );
  const employees = await query<{ id: number; code: string; name: string }>(
    "SELECT id, employee_code AS code, name FROM employees WHERE biometric_id IS NULL AND is_active = 1",
  );
  const digits = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "");
  const trailing = (s: string) => (s.match(/(\d+)$/)?.[1] ?? "").replace(/^0+/, "");
  const simple = (s: string | null) => (s ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  const taken = new Set<number>();
  const linked: { pin: string; employeeCode: string; employeeName: string }[] = [];

  for (const user of users) {
    const pinDigits = digits(user.pin);
    const candidates = employees.filter(
      (e) =>
        !taken.has(e.id) &&
        (e.code.toUpperCase() === user.pin.toUpperCase() ||
          (pinDigits && trailing(e.code) === pinDigits) ||
          (simple(user.name).length >= 4 && simple(user.name) === simple(e.name))),
    );
    if (candidates.length !== 1) continue;
    const employee = candidates[0];
    const result = await execute("UPDATE employees SET biometric_id = ? WHERE id = ? AND biometric_id IS NULL", [user.pin, employee.id]);
    if (!result.affectedRows) continue;
    taken.add(employee.id);
    linked.push({ pin: user.pin, employeeCode: employee.code, employeeName: employee.name });
  }
  const converted = linked.length ? await convertLinkedPunches() : { converted: 0, days: 0 };
  return { linked, ...converted };
}

// ── Sync ──────────────────────────────────────────────────────────

export type DeviceRow = { id: number; name: string; ip_address: string; port: number; status: string };
export type SyncResult = {
  deviceId: number;
  name: string;
  ok: boolean;
  error?: string;
  info?: DeviceInfo;
  clockDriftMinutes?: number | null;
  users?: number;
  punchesOnDevice?: number;
  newPunches: number;
  seconds?: number;
};

const syncing = new Set<number>();

/** Pull one machine. Never throws: failures are recorded on the device row and returned. */
export async function syncDevice(device: DeviceRow): Promise<SyncResult> {
  if (syncing.has(device.id)) return { deviceId: device.id, name: device.name, ok: false, error: "A sync of this machine is already running", newPunches: 0 };
  if (!device.ip_address || !isAllowedDeviceAddress(device.ip_address)) {
    return { deviceId: device.id, name: device.name, ok: false, error: "IP address is not on the office network", newPunches: 0 };
  }
  syncing.add(device.id);
  const started = Date.now();
  try {
    const { info, users, punches } = await pullDevice({ id: device.id, ipAddress: device.ip_address, port: device.port });
    await storeDeviceUsers(users, device.id);
    const stored = await storePunches(punches, device.id, "device");
    const drift = info.deviceTime ? Math.round((new Date(info.deviceTime.replace(" ", "T")).getTime() - Date.now()) / 60000) : null;
    const note = `${stored.inserted} new punch${stored.inserted === 1 ? "" : "es"}, ${users.length} user${users.length === 1 ? "" : "s"}${drift !== null && Math.abs(drift) > 5 ? ` · machine clock off by ${drift} min` : ""}`;
    await execute(
      `UPDATE biometric_devices SET last_sync_at = NOW(), last_sync_status = 'OK', last_sync_note = ?, user_count = ?, log_count = ?, log_capacity = ?,
         last_seen_at = NOW(), total_punches = total_punches + ?,
         last_punch_at = GREATEST(COALESCE(last_punch_at, '2000-01-01'), COALESCE((SELECT MAX(punch_time) FROM biometric_logs WHERE device_id = ?), '2000-01-01'))
       WHERE id = ?`,
      [note, info.userCount, info.logCount, info.logCapacity, stored.inserted, device.id, device.id],
    );
    return {
      deviceId: device.id,
      name: device.name,
      ok: true,
      info,
      clockDriftMinutes: drift,
      users: users.length,
      punchesOnDevice: punches.length,
      newPunches: stored.inserted,
      seconds: Math.round((Date.now() - started) / 1000),
    };
  } catch (error) {
    const message = String((error as Error)?.message || "Sync failed").slice(0, 255);
    await execute("UPDATE biometric_devices SET last_sync_at = NOW(), last_sync_status = 'FAILED', last_sync_note = ? WHERE id = ?", [message, device.id]);
    return { deviceId: device.id, name: device.name, ok: false, error: message, newPunches: 0 };
  } finally {
    syncing.delete(device.id);
  }
}

/** Sync the given machines (or every active one), auto-link users, and update attendance. */
export async function syncAndProcess(deviceIds?: number[]) {
  const devices = deviceIds?.length
    ? await query<DeviceRow>(`SELECT id, name, ip_address, port, status FROM biometric_devices WHERE id IN (${deviceIds.map(() => "?").join(",")})`, deviceIds)
    : await query<DeviceRow>("SELECT id, name, ip_address, port, status FROM biometric_devices WHERE status = 'approved' AND ip_address IS NOT NULL ORDER BY name");
  const results: SyncResult[] = [];
  for (const device of devices) results.push(await syncDevice(device));
  const autoLinked = await autoLinkUsers();
  const processed = await convertLinkedPunches();
  const unlinked = await queryOne<{ total: number }>(
    "SELECT COUNT(*) AS total FROM biometric_users u WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.biometric_id = u.pin)",
  );
  return {
    devices: results,
    autoLinked: autoLinked.linked,
    converted: autoLinked.converted + processed.converted,
    days: autoLinked.days + processed.days,
    unlinkedUsers: Number(unlinked?.total ?? 0),
  };
}

// ── Automatic background sync ─────────────────────────────────────

let timer: NodeJS.Timeout | undefined;
let running = false;

export function startAutoSync() {
  const minutes = env.BIOMETRIC_AUTO_SYNC_MINUTES;
  if (!minutes) {
    logger.info("Automatic machine sync is off (BIOMETRIC_AUTO_SYNC_MINUTES=0)");
    return;
  }
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await syncAndProcess();
      if (result.devices.length) {
        logger.info("automatic machine sync", {
          ok: result.devices.filter((d) => d.ok).length,
          failed: result.devices.filter((d) => !d.ok).map((d) => `${d.name}: ${d.error}`),
          newPunches: result.devices.reduce((n, d) => n + d.newPunches, 0),
          days: result.days,
        });
      }
    } catch (error) {
      logger.error("automatic machine sync failed", { error: (error as Error).message });
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, minutes * 60_000);
  setTimeout(tick, 15_000).unref(); // first run shortly after start-up
  logger.info(`Automatic machine sync every ${minutes} min`);
}

export function stopAutoSync() {
  clearInterval(timer);
}

export { formatDeviceTime };
