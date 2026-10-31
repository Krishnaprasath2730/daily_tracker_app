import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import cookieParser from "cookie-parser";
import express, { Router } from "express";
import { env } from "./config/env";
import { pool } from "./db/pool";
import { loadSession, requireAuth, requirePasswordCurrent, requireRole, verifyCsrf } from "./middleware/auth";
import {
  accessLog,
  apiLimiter,
  corsPolicy,
  errorHandler,
  noStore,
  notFoundHandler,
  requestId,
  securityHeaders,
} from "./middleware/security";
import { adhocRouter } from "./routes/adhoc";
import { attendanceRouter } from "./routes/attendance";
import { auditRouter } from "./routes/audit";
import { biometricRouter } from "./routes/biometric";
import { authRouter } from "./routes/auth";
import { dashboardRouter } from "./routes/dashboard";
import { employeesRouter } from "./routes/employees";
import { errorsRouter } from "./routes/errors";
import { leaveRouter } from "./routes/leave";
import { reportsRouter } from "./routes/reports";
import { rosterRouter } from "./routes/roster";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY ? 1 : false);
  // Reject ambiguous query strings like ?a=1&a=2 turning into arrays.
  app.set("query parser", "simple");

  app.use(requestId);
  app.use(securityHeaders);
  app.use(compression());

  const api = Router();
  api.use(corsPolicy);
  api.use(noStore);
  api.use(apiLimiter);
  // 1 MB for normal requests; USB punch-log uploads may be larger.
  const smallJson = express.json({ limit: "1mb", strict: true });
  const largeJson = express.json({ limit: "10mb", strict: true });
  api.use((req, res, next) => (req.path === "/biometric/import" ? largeJson : smallJson)(req, res, next));
  api.use(cookieParser());
  api.use(accessLog);

  api.get("/health", async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ ok: true, time: new Date().toISOString() });
  });

  api.use(loadSession);
  api.use(verifyCsrf);
  api.use("/auth", authRouter);

  // Everything below needs a signed-in user who has set their own password.
  api.use(requireAuth, requirePasswordCurrent);
  api.use("/dashboard", dashboardRouter);
  api.use("/employees", employeesRouter);
  api.use("/reports", reportsRouter);
  api.use("/errors", errorsRouter);
  api.use("/leave", leaveRouter);
  api.use("/roster", rosterRouter);
  api.use("/adhoc", adhocRouter);
  api.use("/attendance", requireRole("admin", "manager"), attendanceRouter);
  api.use("/audit-logs", requireRole("admin"), auditRouter);
  api.use("/biometric", requireRole("admin", "manager"), biometricRouter);
  api.use(notFoundHandler);

  app.use("/api", api);

  // In production the same server hosts the built React app.
  if (env.isProduction) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const clientDir = path.resolve(here, "../client");
    if (existsSync(clientDir)) {
      app.use(express.static(clientDir, { index: false, maxAge: "7d", immutable: true }));
      app.get(/^(?!\/api\/).*/, (_req, res) => {
        res.setHeader("Cache-Control", "no-cache");
        res.sendFile(path.join(clientDir, "index.html"));
      });
    }
  }

  app.use(errorHandler);
  return app;
}
