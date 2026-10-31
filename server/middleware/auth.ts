import type { CookieOptions, NextFunction, Request, Response } from "express";
import type { Role } from "../../shared/constants";
import { env } from "../config/env";
import { findSession, safeEqual } from "../services/auth";
import { forbidden, HttpError, unauthorized } from "../utils/errors";

export const SESSION_COOKIE = env.cookieSecure ? "__Host-ios_sid" : "ios_sid";
export const CSRF_HEADER = "x-csrf-token";

export const sessionCookieOptions = (expires?: Date): CookieOptions => ({
  httpOnly: true, // JavaScript cannot read the session cookie (blocks token theft through XSS)
  secure: env.cookieSecure,
  sameSite: "strict", // browser never sends it on cross-site requests (CSRF defence #1)
  path: "/",
  expires,
});

/** Attach req.user when a valid session cookie is present. Never throws for missing sessions. */
export async function loadSession(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === "string" && /^[a-f0-9]{64}$/.test(token)) {
    const session = await findSession(token);
    if (session) {
      req.user = session.user;
      req.sessionId = session.sessionId;
      req.csrfToken = session.csrfToken;
    } else {
      res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
    }
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw unauthorized();
  next();
}

/** Block everything except auth routes until a forced password change is done. */
export function requirePasswordCurrent(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.mustChangePassword) throw new HttpError(403, "Change your password to continue", { code: "PASSWORD_CHANGE_REQUIRED" });
  next();
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** CSRF defence #2: every state-changing request must echo the per-session token in a header. */
export function verifyCsrf(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method) || !req.user) return next();
  const header = req.get(CSRF_HEADER);
  if (!header || !req.csrfToken || !safeEqual(header, req.csrfToken)) {
    throw new HttpError(403, "Security token missing or invalid. Refresh the page and try again.");
  }
  next();
}

export const isManager = (req: Request) => req.user?.role === "admin" || req.user?.role === "manager";
