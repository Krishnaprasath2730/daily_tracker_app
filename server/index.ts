import { env } from "./config/env";
import mysql from "mysql2/promise";
import { LATEST_MIGRATION } from "../database/migrations";
import { prepareDatabase } from "../database/prepare";
import { createApp } from "./app";
import { mysqlTimeZoneOffset, pool, queryOne } from "./db/pool";
import { purgeExpiredSessions } from "./services/auth";
import { startAutoSync, stopAutoSync } from "./services/biometric";
import { logger } from "./utils/logger";

async function main() {
  try {
    await pool.query("SELECT 1");
  } catch (error) {
    logger.error("Cannot connect to MySQL. Is XAMPP MySQL running and is .env correct? Run `npm run db:setup` first.", {
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      error: (error as Error).message,
    });
    process.exit(1);
  }

  // On hosting without a terminal (Hostinger), create/upgrade tables and the first accounts here.
  if (env.dbAutoSetup) {
    const conn = await mysql.createConnection({
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
      multipleStatements: true, // setup only; request handlers use the pool, which forbids it
      charset: "utf8mb4",
    });
    try {
      await conn.query(`SET time_zone = '${mysqlTimeZoneOffset()}'`);
      await prepareDatabase(conn, {
        database: env.DB_NAME,
        seed: env.DB_SEED,
        adminPassword: env.SEED_ADMIN_PASSWORD,
        staffPassword: env.SEED_STAFF_PASSWORD,
        log: (message) => logger.info(`[db] ${message}`),
      });
    } catch (error) {
      logger.error("[db] automatic database setup failed", { error: (error as Error).message });
    } finally {
      await conn.end();
    }
  }

  // Warn when the database is older than the code.
  const migrated = await queryOne("SELECT id FROM schema_migrations WHERE id = ?", [LATEST_MIGRATION]).catch(() => undefined);
  if (!migrated) logger.warn("Database needs an upgrade. Stop the server and run: npm run db:setup");

  const app = createApp();
  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info(`API ready on http://${env.HOST}:${env.PORT} (${env.NODE_ENV})`);
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    logger.error(
      error.code === "EADDRINUSE" ? `Port ${env.PORT} is already in use. Stop the other process or change PORT in .env.` : "server error",
      { error: error.message },
    );
    process.exit(1);
  });
  // Slowloris-style protection.
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;

  // Pull new punches from fingerprint machines in the background.
  startAutoSync();

  const cleanup = setInterval(() => {
    purgeExpiredSessions().catch((error) => logger.warn("session cleanup failed", { error: (error as Error).message }));
  }, 30 * 60_000);

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    clearInterval(cleanup);
    stopAutoSync();
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

process.on("unhandledRejection", (reason) => logger.error("unhandled rejection", { error: String(reason) }));

main();
