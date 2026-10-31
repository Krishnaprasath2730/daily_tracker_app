import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Role } from "../../shared/constants";
import { env } from "../config/env";
import { execute, queryOne } from "../db/pool";

const BCRYPT_ROUNDS = 12;
// A real hash compared against when the user does not exist, so response time
// does not reveal which employee codes are valid.
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", BCRYPT_ROUNDS);

export type SessionUser = {
  id: number;
  employeeCode: string;
  name: string;
  email: string | null;
  team: string;
  role: Role;
  mustChangePassword: boolean;
};

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_ROUNDS);
export const verifyPassword = (password: string, hash: string | undefined) => bcrypt.compare(password, hash ?? DUMMY_HASH);

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("hex");

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Generate a temporary password that satisfies the password policy. */
export function temporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  const body = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `${body}#7aZ`;
}

export async function createSession(employeeId: number, ip: string | undefined, userAgent: string | undefined) {
  const token = randomToken();
  const csrfToken = randomToken();
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3600_000);
  await execute(
    "INSERT INTO sessions (token_hash, csrf_token, employee_id, ip_address, user_agent, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    [sha256(token), csrfToken, employeeId, ip ?? null, (userAgent ?? "").slice(0, 255), expiresAt],
  );
  return { token, csrfToken, expiresAt };
}

type SessionRow = {
  session_id: number;
  csrf_token: string;
  last_seen_at: Date;
  expires_at: Date;
  id: number;
  employee_code: string;
  name: string;
  email: string | null;
  team: string;
  role: Role;
  must_change_password: number;
  is_active: number;
};

/** Look up a session by its raw token. Returns null when missing, expired, idle too long or the user is inactive. */
export async function findSession(token: string) {
  const row = await queryOne<SessionRow>(
    `SELECT s.id AS session_id, s.csrf_token, s.last_seen_at, s.expires_at,
            e.id, e.employee_code, e.name, e.email, e.team, e.role, e.must_change_password, e.is_active
       FROM sessions s JOIN employees e ON e.id = s.employee_id
      WHERE s.token_hash = ? LIMIT 1`,
    [sha256(token)],
  );
  if (!row) return null;
  const now = Date.now();
  const idleLimit = env.SESSION_IDLE_MINUTES * 60_000;
  if (!row.is_active || row.expires_at.getTime() <= now || now - row.last_seen_at.getTime() > idleLimit) {
    await execute("DELETE FROM sessions WHERE id = ?", [row.session_id]);
    return null;
  }
  // Refresh the idle timer at most once a minute to keep writes low.
  if (now - row.last_seen_at.getTime() > 60_000) {
    await execute("UPDATE sessions SET last_seen_at = NOW() WHERE id = ?", [row.session_id]);
  }
  const user: SessionUser = {
    id: row.id,
    employeeCode: row.employee_code,
    name: row.name,
    email: row.email,
    team: row.team,
    role: row.role,
    mustChangePassword: Boolean(row.must_change_password),
  };
  return { sessionId: row.session_id, csrfToken: row.csrf_token, user };
}

export const deleteSession = (sessionId: number) => execute("DELETE FROM sessions WHERE id = ?", [sessionId]);

/** Sign the user out everywhere, optionally keeping one session (the current one). */
export const deleteUserSessions = (employeeId: number, keepSessionId?: number) =>
  execute("DELETE FROM sessions WHERE employee_id = ? AND id <> ?", [employeeId, keepSessionId ?? 0]);

export const purgeExpiredSessions = () => execute("DELETE FROM sessions WHERE expires_at < NOW()");
