// Office sync agent API (BIOMETRIC_MODE=agent).
// The app runs on the internet (e.g. Hostinger) and cannot reach the fingerprint machine on the
// office LAN, so a small program on an office PC reads the machine and calls these endpoints over HTTPS.
// Auth: "Authorization: Bearer <BIOMETRIC_AGENT_KEY>". No cookies, no browser access.
import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { env } from "../config/env";
import { execute, query, queryOne } from "../db/pool";
import { autoLinkUsers, convertLinkedPunches, recordSync, recordSyncFailure } from "../services/biometric";
import { formatDeviceTime } from "../services/zkDevice";
import { HttpError, notFound } from "../utils/errors";
import { logger } from "../utils/logger";
import { parse } from "../utils/validation";

export const agentRouter = Router();

const digest = (value: string) => createHash("sha256").update(value).digest();

function requireAgentKey(req: Request, _res: Response, next: NextFunction) {
  if (env.BIOMETRIC_MODE !== "agent") throw new HttpError(404, "Not found");
  const header = req.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  // Compare fixed-length hashes so timing does not reveal the key.
  if (!token || !timingSafeEqual(digest(token), digest(env.BIOMETRIC_AGENT_KEY))) {
    logger.warn("agent request with a wrong key", { ip: req.ip });
    throw new HttpError(401, "Invalid agent key");
  }
  next();
}

agentRouter.use(
  rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: "draft-7", legacyHeaders: false, handler: (_req, res) => res.status(429).json({ error: "Too many requests" }) }),
);
agentRouter.use(requireAgentKey);

const agentName = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9 ._-]+$/);

async function heartbeat(req: Request, name: string, version: string | undefined, lastError: string | null) {
  await execute(
    `INSERT INTO biometric_agents (name, version, ip_address, last_seen_at, last_error) VALUES (?, ?, ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE version = VALUES(version), ip_address = VALUES(ip_address), last_seen_at = NOW(), last_error = VALUES(last_error)`,
    [name, version ?? null, req.ip ?? null, lastError],
  );
}

/** Check-in: returns the machines to read and which ones were asked to sync now. */
agentRouter.post("/hello", async (req, res) => {
  const { name, version, error } = parse(
    z.object({ name: agentName, version: z.string().trim().max(20).optional(), error: z.string().max(255).nullable().optional() }),
    req.body,
  );
  await heartbeat(req, name, version, error ?? null);
  const devices = await query<{ id: number; name: string; ipAddress: string; port: number; syncRequested: number; lastPunchAt: Date | null; lastSyncAt: Date | null }>(
    `SELECT id, name, ip_address AS ipAddress, port, (sync_requested_at IS NOT NULL) AS syncRequested, last_punch_at AS lastPunchAt, last_sync_at AS lastSyncAt
       FROM biometric_devices WHERE status = 'approved' AND ip_address IS NOT NULL ORDER BY name`,
  );
  res.json({
    intervalMinutes: env.BIOMETRIC_AUTO_SYNC_MINUTES || 15,
    serverTime: formatDeviceTime(new Date()),
    timeZone: env.APP_TIMEZONE,
    devices: devices.map((d) => ({
      id: d.id,
      name: d.name,
      ipAddress: d.ipAddress,
      port: d.port,
      syncRequested: Boolean(d.syncRequested),
      // The agent only needs to send punches from (a little before) this point.
      lastPunchAt: d.lastPunchAt && d.lastPunchAt.getFullYear() > 2000 ? formatDeviceTime(d.lastPunchAt) : null,
      lastSyncAt: d.lastSyncAt ? formatDeviceTime(d.lastSyncAt) : null,
    })),
  });
});

const deviceTime = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
const pin = z.string().regex(/^[A-Za-z0-9]{1,20}$/);

const reportSchema = z.object({
  name: agentName,
  version: z.string().trim().max(20).optional(),
  deviceId: z.number().int().positive(),
  ok: z.boolean(),
  error: z.string().max(255).optional(),
  info: z.object({ userCount: z.number().int().min(0), logCount: z.number().int().min(0), logCapacity: z.number().int().min(0), deviceTime: deviceTime.nullable() }).optional(),
  users: z.array(z.object({ pin, name: z.string().max(80).nullable(), cardNo: z.string().max(40).nullable() })).max(10000).default([]),
  punches: z.array(z.object({ pin, time: deviceTime })).max(5000).default([]),
  totalOnDevice: z.number().int().min(0).optional(),
  elapsedMs: z.number().int().min(0).max(3_600_000).default(0),
  /** Last batch of this sync: link users and update attendance. */
  final: z.boolean().default(true),
});

const toDate = (text: string) => {
  const [d, t] = text.split(" ");
  const [y, m, day] = d.split("-").map(Number);
  const [h, mi, s] = t.split(":").map(Number);
  return new Date(y, m - 1, day, h, mi, s);
};

/** Results of reading one machine. Large logs arrive in several batches. */
agentRouter.post("/report", async (req, res) => {
  const input = parse(reportSchema, req.body);
  const device = await queryOne<{ id: number; name: string; status: string }>("SELECT id, name, status FROM biometric_devices WHERE id = ?", [input.deviceId]);
  if (!device || device.status !== "approved") throw notFound("Machine not found or not active");

  if (!input.ok || !input.info) {
    await heartbeat(req, input.name, input.version, `${device.name}: ${input.error ?? "sync failed"}`.slice(0, 255));
    const result = await recordSyncFailure(device, input.error ?? "The office agent could not read the machine");
    res.json(result);
    return;
  }

  const now = Date.now();
  const punches = input.punches
    .map((p) => ({ pin: p.pin, punchTime: toDate(p.time) }))
    .filter((p) => !Number.isNaN(p.punchTime.getTime()) && p.punchTime.getFullYear() >= 2000 && p.punchTime.getTime() <= now + 24 * 3600_000);
  const result = await recordSync(device, { info: input.info, users: input.users, punches }, input.elapsedMs, input.totalOnDevice ?? punches.length);

  let processed = { linked: 0, converted: 0, days: 0 };
  if (input.final) {
    const linked = await autoLinkUsers();
    const converted = await convertLinkedPunches();
    processed = { linked: linked.linked.length, converted: linked.converted + converted.converted, days: linked.days + converted.days };
    await heartbeat(req, input.name, input.version, null);
  }
  res.json({ ...result, ...processed });
});
