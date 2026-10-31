/**
 * Infinity Operations — office sync agent.
 *
 * Runs on one PC in the office (same network as the fingerprint machines). It reads each
 * eSSL / ZKTeco machine on TCP 4370 — read-only, exactly like the HRMS portal — and sends
 * new punches to the hosted app (e.g. Hostinger) over HTTPS with a secret key.
 *
 * Settings come from agent.env next to this file (or the current folder):
 *   AGENT_SERVER_URL=https://your-site.hostingersite.com
 *   AGENT_KEY=<same value as BIOMETRIC_AGENT_KEY on the server>
 *   AGENT_NAME=Office-PC            (optional, shown in the app)
 *
 * Run:  npm run agent        (from the project folder)
 *   or: node infinity-agent.cjs   (single-file build: npm run build:agent)
 * Add --once to sync one time and exit (useful for testing).
 */
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { formatDeviceTime, pullDevice, type DevicePunch } from "../server/services/zkDevice";

const VERSION = "1.0.0";
const CHECK_IN_SECONDS = 60;
const BATCH = 2000;
/** Re-send a little history every time; the server ignores duplicates. */
const OVERLAP_DAYS = 2;

// ── Settings ──────────────────────────────────────────────────────
const candidates = [
  process.argv.includes("--config") ? process.argv[process.argv.indexOf("--config") + 1] : "",
  path.join(path.dirname(process.argv[1] ?? "."), "agent.env"),
  path.join(process.cwd(), "agent.env"),
].filter(Boolean);
const envFile = candidates.find((file) => existsSync(file));
if (envFile) loadEnv({ path: envFile, quiet: true });

const SERVER = (process.env.AGENT_SERVER_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.AGENT_KEY ?? "";
const NAME = (process.env.AGENT_NAME || os.hostname()).replace(/[^A-Za-z0-9 ._-]/g, "-").slice(0, 80);
const ONCE = process.argv.includes("--once");

function fail(message: string): never {
  console.error(`\n[agent] ${message}\n`);
  process.exit(1);
}
if (!SERVER) fail(`AGENT_SERVER_URL is not set. Create agent.env (looked in: ${candidates.join(", ")}).`);
if (KEY.length < 32) fail("AGENT_KEY is missing or shorter than 32 characters. Copy BIOMETRIC_AGENT_KEY from the server settings.");
const url = new URL(SERVER);
const local = ["localhost", "127.0.0.1"].includes(url.hostname);
// The key and staff punches must never travel unencrypted over the internet.
if (url.protocol !== "https:" && !local) fail("AGENT_SERVER_URL must start with https:// (http is only allowed for localhost testing).");

const log = (message: string) => console.log(`${formatDeviceTime(new Date())}  ${message}`);

// ── Server calls ──────────────────────────────────────────────────
type DeviceConfig = { id: number; name: string; ipAddress: string; port: number; syncRequested: boolean; lastPunchAt: string | null };
type ServerConfig = { intervalMinutes: number; serverTime: string; timeZone: string; devices: DeviceConfig[] };

async function call<T>(endpoint: string, body: unknown): Promise<T> {
  const response = await fetch(`${SERVER}/api/agent/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(`${endpoint}: ${response.status} ${data.error ?? response.statusText}`);
  return data as T;
}

// ── Sync one machine ──────────────────────────────────────────────
const lastSyncAt = new Map<number, number>();

async function syncDevice(device: DeviceConfig) {
  const started = Date.now();
  log(`Reading ${device.name} (${device.ipAddress}:${device.port})…`);
  try {
    const { info, users, punches } = await pullDevice({ id: device.id, ipAddress: device.ipAddress, port: device.port });
    // Only send punches from shortly before the newest one the server already has.
    const since = device.lastPunchAt ? new Date(device.lastPunchAt.replace(" ", "T")).getTime() - OVERLAP_DAYS * 86_400_000 : 0;
    const fresh = punches.filter((p: DevicePunch) => p.punchTime.getTime() >= since);
    const batches: DevicePunch[][] = [];
    for (let i = 0; i < fresh.length; i += BATCH) batches.push(fresh.slice(i, i + BATCH));
    if (!batches.length) batches.push([]);

    let stored = 0;
    let linked = 0;
    for (const [index, batch] of batches.entries()) {
      const result = await call<{ newPunches: number; linked?: number }>("report", {
        name: NAME,
        version: VERSION,
        deviceId: device.id,
        ok: true,
        info,
        users: index === 0 ? users : [],
        punches: batch.map((p) => ({ pin: p.pin, time: formatDeviceTime(p.punchTime) })),
        totalOnDevice: punches.length,
        elapsedMs: Date.now() - started,
        final: index === batches.length - 1,
      });
      stored += result.newPunches;
      linked += result.linked ?? 0;
    }
    lastSyncAt.set(device.id, Date.now());
    log(`  ${device.name}: ${punches.length} on machine, ${fresh.length} sent, ${stored} new${linked ? `, ${linked} users linked` : ""} (${Math.round((Date.now() - started) / 1000)}s)`);
  } catch (error) {
    const message = (error as Error).message || "Could not read the machine";
    lastSyncAt.set(device.id, Date.now());
    log(`  ${device.name}: FAILED — ${message}`);
    await call("report", { name: NAME, version: VERSION, deviceId: device.id, ok: false, error: message.slice(0, 255) }).catch((e) =>
      log(`  could not report the failure: ${(e as Error).message}`),
    );
  }
}

// ── Main loop ─────────────────────────────────────────────────────
let busy = false;
let lastError: string | null = null;

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const config = await call<ServerConfig>("hello", { name: NAME, version: VERSION, error: lastError });
    lastError = null;
    const due = config.devices.filter((d) => {
      const last = lastSyncAt.get(d.id);
      return ONCE || d.syncRequested || !last || Date.now() - last >= config.intervalMinutes * 60_000;
    });
    if (!config.devices.length && ONCE) log("No active machines are set up in the app yet.");
    for (const device of due) await syncDevice(device);
  } catch (error) {
    lastError = (error as Error).message.slice(0, 255);
    log(`Cannot reach ${SERVER}: ${lastError}`);
  } finally {
    busy = false;
  }
}

log(`Infinity sync agent ${VERSION} "${NAME}" → ${SERVER}${envFile ? ` (settings: ${envFile})` : ""}`);
if (ONCE) {
  await tick();
  process.exit(0);
}
await tick();
setInterval(tick, CHECK_IN_SECONDS * 1000);
