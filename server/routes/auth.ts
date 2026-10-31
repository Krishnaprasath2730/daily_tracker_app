import { Router } from "express";
import { z } from "zod";
import { passwordProblems, type Role } from "../../shared/constants";
import { env } from "../config/env";
import { execute, queryOne } from "../db/pool";
import { requireAuth, SESSION_COOKIE, sessionCookieOptions } from "../middleware/auth";
import { loginLimiter } from "../middleware/security";
import { audit } from "../services/audit";
import { createSession, deleteSession, deleteUserSessions, hashPassword, verifyPassword } from "../services/auth";
import { badRequest, HttpError, unauthorized } from "../utils/errors";
import { parse } from "../utils/validation";

export const authRouter = Router();

const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your employee ID or email").max(160),
  password: z.string().min(1, "Enter your password").max(128),
});

type LoginRow = {
  id: number;
  password_hash: string;
  is_active: number;
  failed_login_attempts: number;
  locked_until: Date | null;
  role: Role;
};

const GENERIC_LOGIN_ERROR = "Employee ID or password is incorrect";

authRouter.post("/login", loginLimiter, async (req, res) => {
  const { identifier, password } = parse(loginSchema, req.body);
  const user = await queryOne<LoginRow>(
    `SELECT id, password_hash, is_active, failed_login_attempts, locked_until, role
       FROM employees WHERE employee_code = ? OR email = ? LIMIT 1`,
    [identifier, identifier.toLowerCase()],
  );

  if (user?.locked_until && user.locked_until.getTime() > Date.now()) {
    await audit(req, { action: "auth.login_locked", entity: "employee", entityId: user.id, actorId: user.id });
    const minutes = Math.ceil((user.locked_until.getTime() - Date.now()) / 60_000);
    throw new HttpError(423, `Account temporarily locked after too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  }

  // Always run bcrypt, even for unknown users, so timing does not reveal valid IDs.
  const valid = await verifyPassword(password, user?.password_hash);
  if (!user || !valid || !user.is_active) {
    if (user && !valid) {
      const attempts = user.failed_login_attempts + 1;
      const lock = attempts >= env.LOGIN_MAX_ATTEMPTS;
      await execute(
        "UPDATE employees SET failed_login_attempts = ?, locked_until = ? WHERE id = ?",
        [lock ? 0 : attempts, lock ? new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60_000) : null, user.id],
      );
      await audit(req, { action: lock ? "auth.account_locked" : "auth.login_failed", entity: "employee", entityId: user.id, actorId: user.id });
    } else {
      await audit(req, { action: "auth.login_failed", details: { identifier: identifier.slice(0, 60) }, actorId: null });
    }
    throw unauthorized(GENERIC_LOGIN_ERROR);
  }

  await execute("UPDATE employees SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?", [user.id]);
  // Session fixation defence: an old cookie is replaced by a brand new token.
  if (req.sessionId) await deleteSession(req.sessionId);
  const session = await createSession(user.id, req.ip, req.get("user-agent"));
  res.cookie(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  await audit(req, { action: "auth.login", entity: "employee", entityId: user.id, actorId: user.id });
  res.json({ ok: true });
});

authRouter.post("/logout", async (req, res) => {
  if (req.sessionId) {
    await deleteSession(req.sessionId);
    await audit(req, { action: "auth.logout" });
  }
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user, csrfToken: req.csrfToken });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password").max(128),
  newPassword: z.string().max(128),
});

authRouter.post("/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = parse(changePasswordSchema, req.body);
  const problems = passwordProblems(newPassword);
  if (problems.length) throw badRequest(problems.join(". "), problems);
  if (newPassword === currentPassword) throw badRequest("The new password must be different from the current one");

  const row = await queryOne<{ password_hash: string }>("SELECT password_hash FROM employees WHERE id = ?", [req.user!.id]);
  if (!(await verifyPassword(currentPassword, row?.password_hash))) {
    await audit(req, { action: "auth.password_change_failed" });
    throw badRequest("Current password is incorrect");
  }
  await execute(
    "UPDATE employees SET password_hash = ?, must_change_password = 0, password_changed_at = NOW() WHERE id = ?",
    [await hashPassword(newPassword), req.user!.id],
  );
  // Sign out every other device that used the old password.
  await deleteUserSessions(req.user!.id, req.sessionId);
  await audit(req, { action: "auth.password_changed" });
  res.json({ ok: true });
});
