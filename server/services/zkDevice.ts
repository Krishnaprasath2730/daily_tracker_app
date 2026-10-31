// eSSL / ZKTeco fingerprint machine access over the network (TCP 4370, UDP fallback),
// the same way the HRMS portal connects. Read-only: nothing on the machine is ever changed or cleared.
import ZKLib from "node-zklib";
import { HttpError } from "../utils/errors";

export type DeviceAddress = { id?: number; ipAddress: string; port: number };
export type DeviceUser = { pin: string; name: string | null; cardNo: string | null };
export type DevicePunch = { pin: string; punchTime: Date };
export type DeviceInfo = { userCount: number; logCount: number; logCapacity: number; deviceTime: string | null };

const CONNECT_TIMEOUT_MS = 8000;
const OVERALL_TIMEOUT_MS = 120_000; // large logs take a while to stream

const pad = (n: number) => String(n).padStart(2, "0");
export const formatDeviceTime = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

const cleanId = (value: unknown) => String(value ?? "").replace(/\0/g, "").trim();
const cleanText = (value: unknown) => String(value ?? "").replace(/\0/g, "").trim() || null;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new HttpError(504, `${what} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Turn low-level socket errors into advice an office admin can act on. */
export function describeDeviceError(error: unknown): string {
  const e = error as { code?: string; message?: string; err?: { code?: string } };
  const code = e?.code || e?.err?.code;
  const message = String(e?.message ?? "");
  if (code === "ECONNREFUSED") return "Connection refused: check the IP address and that port 4370 is enabled on the machine";
  if (code === "ETIMEDOUT" || code === "EHOSTUNREACH" || code === "ENETUNREACH" || /timed? ?out/i.test(message)) {
    return "Machine not reachable: check it is switched on and on the same network as this computer";
  }
  if (/unauthor|auth/i.test(message)) return "Machine refused the connection: set its Comm Key to 0 (Menu → Comm. → Security)";
  return message || "Could not talk to the machine";
}

/** Open a session, run `work`, always disconnect. */
async function withDevice<T>(address: DeviceAddress, work: (zk: ZKLib) => Promise<T>): Promise<T> {
  // The UDP fallback binds a local port; one per device so two syncs never collide.
  const inport = 5200 + ((address.id ?? 0) % 200);
  const zk = new ZKLib(address.ipAddress, address.port || 4370, CONNECT_TIMEOUT_MS, inport);
  try {
    await withTimeout(zk.createSocket(), CONNECT_TIMEOUT_MS + 2000, "Connecting to the machine");
  } catch (error) {
    await zk.disconnect().catch(() => undefined);
    throw error instanceof HttpError ? error : new HttpError(502, describeDeviceError(error));
  }
  try {
    return await withTimeout(work(zk), OVERALL_TIMEOUT_MS, "Reading from the machine");
  } catch (error) {
    throw error instanceof HttpError ? error : new HttpError(502, describeDeviceError(error));
  } finally {
    await zk.disconnect().catch(() => undefined);
  }
}

async function readInfo(zk: ZKLib): Promise<DeviceInfo> {
  const info = await zk.getInfo();
  let deviceTime: string | null = null;
  try {
    const time = typeof zk.getTime === "function" ? await zk.getTime() : null;
    if (time instanceof Date && !Number.isNaN(time.getTime())) deviceTime = formatDeviceTime(time);
  } catch {
    // not supported on every firmware
  }
  return {
    userCount: Number(info?.userCounts ?? 0),
    logCount: Number(info?.logCounts ?? 0),
    logCapacity: Number(info?.logCapacity ?? 0),
    deviceTime,
  };
}

/** Connection test: counts and clock. */
export const testDevice = (address: DeviceAddress) => withDevice(address, readInfo);

/** Read the enrolled users and the whole punch log. */
export function pullDevice(address: DeviceAddress): Promise<{ info: DeviceInfo; users: DeviceUser[]; punches: DevicePunch[] }> {
  return withDevice(address, async (zk) => {
    const info = await readInfo(zk);

    const userResult = await zk.getUsers();
    const users = (userResult?.data ?? [])
      .map((row) => ({
        pin: cleanId(row.userId ?? row.uid),
        name: cleanText(row.name)?.slice(0, 80) ?? null,
        cardNo: row.cardno && Number(row.cardno) > 0 ? String(row.cardno) : null,
      }))
      .filter((user) => /^[A-Za-z0-9]{1,20}$/.test(user.pin));

    const logResult = await zk.getAttendances();
    const punches = (logResult?.data ?? [])
      .map((row) => ({
        pin: cleanId(row.deviceUserId ?? row.userId),
        punchTime: row.recordTime instanceof Date ? row.recordTime : new Date(row.recordTime),
      }))
      .filter((p) => /^[A-Za-z0-9]{1,20}$/.test(p.pin) && !Number.isNaN(p.punchTime.getTime()) && p.punchTime.getFullYear() >= 2000);

    return { info, users, punches };
  });
}
