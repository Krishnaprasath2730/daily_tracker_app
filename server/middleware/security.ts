import { randomUUID } from "node:crypto";
import type { ErrorRequestHandler, NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "../config/env";
import { HttpError } from "../utils/errors";
import { logger } from "../utils/logger";

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"], // Radix UI sets inline style attributes
      "img-src": ["'self'", "data:"],
      "font-src": ["'self'", "data:"],
      "connect-src": ["'self'"],
      "frame-ancestors": ["'none'"],
      "form-action": ["'self'"],
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
      "upgrade-insecure-requests": env.cookieSecure ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: env.cookieSecure ? { maxAge: 31536000, includeSubDomains: true } : false,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
});

export const corsPolicy = cors({
  origin(origin, callback) {
    // Same-origin requests and tools like curl send no Origin header.
    if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
    callback(new HttpError(403, "Origin not allowed"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "X-CSRF-Token"],
  maxAge: 600,
});

const limitHandler = (_req: Request, res: Response) =>
  res.status(429).json({ error: "Too many requests. Please wait a moment and try again." });

/** General API limit per IP. */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: limitHandler,
});

/** Strict limit for login attempts per IP (account lockout handles per-user guessing). */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: limitHandler,
});

export function requestId(req: Request, res: Response, next: NextFunction) {
  req.requestId = randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
}

export function accessLog(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  res.on("finish", () => {
    if (!req.originalUrl.startsWith("/api/")) return;
    logger.info("request", {
      id: req.requestId,
      method: req.method,
      path: req.originalUrl.split("?")[0],
      status: res.statusCode,
      ms: Date.now() - start,
      user: req.user?.id,
    });
  });
  next();
}

/** API responses must never be cached by the browser or proxies. */
export function noStore(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "no-store");
  next();
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "Not found" });
}

// Express needs all four arguments to recognise an error handler.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, details: error.details });
    return;
  }
  // Body-parser errors (bad JSON, payload too large) carry a status.
  const status = (error as { status?: number; type?: string }).status;
  if (status === 413) {
    res.status(413).json({ error: "Request is too large" });
    return;
  }
  if (status === 400 && (error as { type?: string }).type === "entity.parse.failed") {
    res.status(400).json({ error: "Request body is not valid JSON" });
    return;
  }
  logger.error("unhandled error", {
    id: req.requestId,
    method: req.method,
    path: req.originalUrl,
    error: error instanceof Error ? error.message : String(error),
    stack: env.isProduction ? undefined : (error as Error)?.stack,
  });
  // Never leak internal details to the client.
  res.status(500).json({ error: "Something went wrong on the server", requestId: req.requestId });
};
