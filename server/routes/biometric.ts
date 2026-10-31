// Fingerprint machines (eSSL / ZKTeco) — same model as the HRMS portal:
// add a machine by IP, test it, sync (pull) its users and punches, load USB log files,
// and link machine user IDs to employees.
// Mounted behind requireRole("admin", "manager"); changing machines or links is admin-only.
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { execute, query, queryOne } from "../db/pool";
import { requireRole } from "../middleware/auth";
import { audit } from "../services/audit";
import { runMatching } from "../services/attendance";
import {
  autoLinkUsers,
  convertLinkedPunches,
  isAllowedDeviceAddress,
  lanAddresses,
  linkPin,
  parsePunchFile,
  storeDeviceUsers,
  storePunches,
  syncAndProcess,
  unlinkPin,
  requestAgentSync,
  agentStatus,
} from "../services/biometric";
import { testDevice } from "../services/zkDevice";
import { eachDate, localDateKey } from "../utils/dates";
import { badRequest, conflict, HttpError, isDuplicateKey, notFound } from "../utils/errors";
import { dateString, idParam, parse } from "../utils/validation";

export const biometricRouter = Router();
const adminOnly = requireRole("admin");

const ipAddress = z
  .string()
  .trim()
  .refine((ip) => isAllowedDeviceAddress(ip), {
    message: env.BIOMETRIC_ALLOWED_IPS ? "This IP address is not in BIOMETRIC_ALLOWED_IPS" : "Enter the machine's office-network IPv4 address (e.g. 192.168.1.201)",
  });
const port = z.coerce.number().int().min(1).max(65535).default(4370);

biometricRouter.get("/setup", async (_req, res) => {
  const agentMode = env.BIOMETRIC_MODE === "agent";
  res.json({
    mode: env.BIOMETRIC_MODE,
    serverAddresses: agentMode ? [] : lanAddresses(),
    autoSyncMinutes: env.BIOMETRIC_AUTO_SYNC_MINUTES || (agentMode ? 15 : 0),
    allowList: env.BIOMETRIC_ALLOWED_IPS || "Private office networks (10.x, 172.16–31.x, 192.168.x)",
    agents: agentMode ? await agentStatus() : [],
  });
});

/** In agent mode the server cannot reach machines; the office agent does the connecting. */
function assertDirectMode() {
  if (env.BIOMETRIC_MODE === "agent") {
    throw new HttpError(409, "Machines are read by the office agent. Save the machine and click Sync; the agent connects within a minute.");
  }
}

// ── Machines ──────────────────────────────────────────────────────

const DEVICE_SELECT = `SELECT d.id, d.name, d.ip_address AS ipAddress, d.port, d.comm_key AS commKey, d.location, d.serial_number AS serialNumber,
    (d.status = 'approved') AS isActive, d.last_sync_at AS lastSyncAt, d.last_sync_status AS lastSyncStatus, d.last_sync_note AS lastSyncNote,
    d.user_count AS userCount, d.log_count AS logCount, d.log_capacity AS logCapacity, d.last_punch_at AS lastPunchAt, d.created_at AS createdAt,
    (SELECT COUNT(*) FROM biometric_logs l WHERE l.device_id = d.id) AS storedPunches,
    (SELECT COUNT(*) FROM biometric_logs l WHERE l.device_id = d.id AND l.punch_time >= ?) AS punchesToday
  FROM biometric_devices d`;

const toDevice = (row: Record<string, unknown>) => ({ ...row, isActive: Boolean(row.isActive) });

biometricRouter.get("/devices", async (_req, res) => {
  const [rows, totals] = await Promise.all([
    query<Record<string, unknown>>(`${DEVICE_SELECT} WHERE d.ip_address IS NOT NULL ORDER BY d.status = 'approved' DESC, d.name`, [localDateKey()]),
    queryOne(
      `SELECT (SELECT COUNT(*) FROM biometric_logs) AS punches,
              (SELECT COUNT(*) FROM biometric_logs WHERE punch_time >= ?) AS punchesToday,
              (SELECT COUNT(*) FROM biometric_users) AS users,
              (SELECT COUNT(*) FROM biometric_users u WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.biometric_id = u.pin)) AS unlinkedUsers`,
      [localDateKey()],
    ),
  ]);
  res.json({ items: rows.map(toDevice), totals });
});

const deviceSchema = z.object({
  name: z.string().trim().min(2).max(80),
  ipAddress,
  port,
  commKey: z.coerce.number().int().min(0).max(999999).default(0),
  location: z.string().trim().max(120).nullable().optional().transform((v) => v || null),
  isActive: z.boolean().default(true),
});

biometricRouter.post("/devices", adminOnly, async (req, res) => {
  const input = parse(deviceSchema, req.body);
  try {
    const result = await execute(
      "INSERT INTO biometric_devices (name, ip_address, port, comm_key, location, status, approved_by, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())",
      [input.name, input.ipAddress, input.port, input.commKey, input.location ?? null, input.isActive ? "approved" : "disabled", req.user!.id],
    );
    await audit(req, { action: "device.create", entity: "biometric_device", entityId: result.insertId, details: input });
    res.status(201).json({ id: result.insertId });
  } catch (error) {
    if (isDuplicateKey(error)) throw conflict("A machine with this IP address and port already exists");
    throw error;
  }
});

biometricRouter.put("/devices/:id", adminOnly, async (req, res) => {
  const id = parse(idParam, req.params.id);
  const input = parse(deviceSchema, req.body);
  try {
    const result = await execute(
      "UPDATE biometric_devices SET name = ?, ip_address = ?, port = ?, comm_key = ?, location = ?, status = ? WHERE id = ?",
      [input.name, input.ipAddress, input.port, input.commKey, input.location ?? null, input.isActive ? "approved" : "disabled", id],
    );
    if (!result.affectedRows) throw notFound("Machine not found");
  } catch (error) {
    if (isDuplicateKey(error)) throw conflict("Another machine already uses this IP address and port");
    throw error;
  }
  await audit(req, { action: "device.update", entity: "biometric_device", entityId: id, details: input });
  res.json({ ok: true });
});

/** Punches and machine users keep their history (device becomes "removed machine"). */
biometricRouter.delete("/devices/:id", adminOnly, async (req, res) => {
  const id = parse(idParam, req.params.id);
  const result = await execute("DELETE FROM biometric_devices WHERE id = ?", [id]);
  if (!result.affectedRows) throw notFound("Machine not found");
  await audit(req, { action: "device.delete", entity: "biometric_device", entityId: id });
  res.json({ ok: true });
});

function driftMinutes(deviceTime: string | null) {
  return deviceTime ? Math.round((new Date(deviceTime.replace(" ", "T")).getTime() - Date.now()) / 60000) : null;
}

/** Test an unsaved machine (from the add/edit form). */
biometricRouter.post("/devices/test", adminOnly, async (req, res) => {
  assertDirectMode();
  const input = parse(z.object({ ipAddress, port }), req.body);
  const info = await testDevice({ ipAddress: input.ipAddress, port: input.port });
  res.json({ info, clockDriftMinutes: driftMinutes(info.deviceTime) });
});

/** Test a saved machine. */
biometricRouter.post("/devices/:id/test", async (req, res) => {
  assertDirectMode();
  const id = parse(idParam, req.params.id);
  const device = await queryOne<{ ip_address: string; port: number }>("SELECT ip_address, port FROM biometric_devices WHERE id = ?", [id]);
  if (!device) throw notFound("Machine not found");
  if (!isAllowedDeviceAddress(device.ip_address)) throw badRequest("This machine's IP address is not on the office network");
  const info = await testDevice({ id, ipAddress: device.ip_address, port: device.port });
  await execute("UPDATE biometric_devices SET user_count = ?, log_count = ?, log_capacity = ?, last_seen_at = NOW() WHERE id = ?", [info.userCount, info.logCount, info.logCapacity, id]);
  res.json({ info, clockDriftMinutes: driftMinutes(info.deviceTime) });
});

// ── Sync / import / re-process ────────────────────────────────────

async function respondSync(req: Request, res: Response, ids?: number[]) {
  if (ids?.length) {
    const device = await queryOne<{ status: string }>("SELECT status FROM biometric_devices WHERE id = ?", [ids[0]]);
    if (!device) throw notFound("Machine not found");
  }
  if (env.BIOMETRIC_MODE === "agent") {
    const queued = await requestAgentSync(ids);
    if (!queued) throw notFound("No active machine is set up. Add one first.");
    await audit(req, { action: "device.sync_request", details: { devices: queued } });
    res.json({ queued, mode: "agent" });
    return;
  }
  const result = await syncAndProcess(ids);
  if (!result.devices.length) throw notFound("No active machine is set up. Add one first.");
  const okCount = result.devices.filter((d) => d.ok).length;
  const newPunches = result.devices.reduce((n, d) => n + d.newPunches, 0);
  await audit(req, { action: "device.sync", details: { devices: result.devices.length, ok: okCount, newPunches, days: result.days, autoLinked: result.autoLinked.length } });
  if (!okCount) throw new HttpError(502, result.devices.length === 1 ? `Could not reach the machine: ${result.devices[0].error}` : "Could not reach any machine", result);
  res.json(result);
}

biometricRouter.post("/sync", (req, res) => respondSync(req, res));
biometricRouter.post("/devices/:id/sync", (req, res) => respondSync(req, res, [parse(idParam, req.params.id)]));

const importSchema = z.object({
  fileName: z.string().trim().min(1).max(120).regex(/\.(dat|txt|csv|log)$/i, "Use the machine's .dat / .txt log or a .csv export (save Excel files as CSV first)"),
  content: z.string().min(1).max(8 * 1024 * 1024),
});

/** Pen-drive log (attlog.dat / .txt) or CSV export; same processing as a sync. */
biometricRouter.post("/import", async (req, res) => {
  const { fileName, content } = parse(importSchema, req.body);
  let parsed: ReturnType<typeof parsePunchFile>;
  try {
    parsed = parsePunchFile(content, fileName);
  } catch (error) {
    throw badRequest((error as Error).message);
  }
  if (!parsed.punches.length) throw badRequest('No punches could be read. Expected one line per punch: "<User ID> <date time>", or a CSV with User ID and Date Time columns.');
  const stored = await storePunches(parsed.punches, null, "file");
  await storeDeviceUsers([], null);
  const autoLinked = await autoLinkUsers();
  const processed = await convertLinkedPunches();
  await audit(req, { action: "device.import", details: { fileName, format: parsed.format, read: parsed.punches.length, newPunches: stored.inserted } });
  res.json({
    format: parsed.format,
    read: parsed.punches.length,
    unreadableLines: parsed.skipped,
    newPunches: stored.inserted,
    duplicates: stored.duplicates,
    autoLinked: autoLinked.linked,
    converted: autoLinked.converted + processed.converted,
    days: autoLinked.days + processed.days,
  });
});

/** Re-run attendance matching for a date range (after fixing links or the roster). */
biometricRouter.post("/reprocess", async (req, res) => {
  const { from, to } = parse(z.object({ from: dateString, to: dateString }), req.body);
  if (to < from) throw badRequest("End date must be on or after the start date");
  const dates = eachDate(from, to, 63).filter((d) => d <= localDateKey());
  if (dates.length > 62) throw badRequest("Re-process at most 62 days at a time");
  await convertLinkedPunches();
  let staff = 0;
  for (const date of dates) staff += await runMatching(date);
  await audit(req, { action: "attendance.reprocess", details: { from, to, days: dates.length } });
  res.json({ days: dates.length, records: staff });
});

// ── Machine users ↔ employees ─────────────────────────────────────

biometricRouter.get("/users", async (req, res) => {
  const { q, filter } = parse(
    z.object({ q: z.string().trim().max(60).optional(), filter: z.enum(["all", "linked", "unlinked"]).default("all") }),
    req.query,
  );
  const where: string[] = [];
  const params: string[] = [];
  if (q) {
    const term = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
    where.push("(u.pin LIKE ? OR u.name LIKE ? OR e.employee_code LIKE ? OR e.name LIKE ?)");
    params.push(term, term, term, term);
  }
  if (filter === "linked") where.push("e.id IS NOT NULL");
  if (filter === "unlinked") where.push("e.id IS NULL");
  const rows = await query(
    `SELECT u.pin, u.name AS machineName, u.card_no AS cardNo, u.last_seen_at AS lastSeenAt, d.name AS deviceName,
            e.id AS employeeId, e.employee_code AS employeeCode, e.name AS employeeName,
            (SELECT COUNT(*) FROM biometric_logs l WHERE l.pin = u.pin) AS punches,
            (SELECT MAX(l.punch_time) FROM biometric_logs l WHERE l.pin = u.pin) AS lastPunchAt
       FROM biometric_users u
       LEFT JOIN biometric_devices d ON d.id = u.device_id
       LEFT JOIN employees e ON e.biometric_id = u.pin
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY (e.id IS NULL) DESC, CAST(u.pin AS UNSIGNED), u.pin LIMIT 2000`,
    params,
  );
  res.json(rows);
});

const pinParam = z.string().trim().regex(/^[A-Za-z0-9]{1,20}$/, "Invalid machine user ID");

/** Link (employeeId) or unlink (null) a machine user ID. Punches are re-attached and attendance re-checked. */
biometricRouter.put("/users/:pin/link", adminOnly, async (req, res) => {
  const pin = parse(pinParam, req.params.pin);
  const { employeeId } = parse(z.object({ employeeId: z.number().int().positive().nullable() }), req.body);
  const current = await queryOne<{ id: number; employee_code: string }>("SELECT id, employee_code FROM employees WHERE biometric_id = ?", [pin]);

  if (employeeId === null) {
    if (current) await unlinkPin(pin);
    await audit(req, { action: "employee.biometric_unlink", entity: "employee", entityId: current?.id ?? null, details: { pin } });
    res.json({ ok: true });
    return;
  }
  const employee = await queryOne<{ id: number; employee_code: string; name: string; biometric_id: string | null }>(
    "SELECT id, employee_code, name, biometric_id FROM employees WHERE id = ?",
    [employeeId],
  );
  if (!employee) throw notFound("Employee not found");
  if (employee.biometric_id && employee.biometric_id !== pin) {
    throw conflict(`${employee.name} is already linked to machine ID ${employee.biometric_id}. Unlink it first.`);
  }
  if (current && current.id !== employeeId) await unlinkPin(pin);
  const result = await linkPin(pin, employeeId);
  await audit(req, { action: "employee.biometric_link", entity: "employee", entityId: employeeId, details: { pin, converted: result.converted } });
  res.json(result);
});

biometricRouter.post("/users/auto-link", adminOnly, async (req, res) => {
  const result = await autoLinkUsers();
  await audit(req, { action: "employee.biometric_autolink", details: { linked: result.linked.length } });
  res.json(result);
});

/** Latest raw punches from machines and files. */
biometricRouter.get("/logs", async (req, res) => {
  const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(50) }), req.query);
  const rows = await query(
    `SELECT l.id, l.pin, l.punch_time AS punchTime, l.source, l.received_at AS receivedAt,
            COALESCE(d.name, IF(l.source = 'file', 'USB file', 'Removed machine')) AS deviceName,
            e.id AS employeeId, e.name AS employeeName, e.employee_code AS employeeCode, u.name AS machineUserName
       FROM biometric_logs l
       LEFT JOIN biometric_devices d ON d.id = l.device_id
       LEFT JOIN employees e ON e.biometric_id = l.pin
       LEFT JOIN biometric_users u ON u.pin = l.pin
      ORDER BY l.punch_time DESC, l.id DESC LIMIT ${limit}`,
  );
  res.json(rows);
});
