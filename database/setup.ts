/**
 * Creates the database (if allowed), applies schema + migrations and loads starter data.
 *
 *   npm run db:setup              tables + demo data on an empty database
 *   npm run db:setup -- --staff   tables + admin, staff list and roster only (no demo activity)
 *   npm run db:setup -- --reset   DROP the database first (deletes all data!)
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { prepareDatabase } from "./prepare";

const DB_NAME = process.env.DB_NAME || "infinity_ops";
if (!/^[A-Za-z0-9_]+$/.test(DB_NAME)) throw new Error("DB_NAME may only contain letters, numbers and underscores");
const reset = process.argv.includes("--reset");

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    multipleStatements: true, // only setup runs multi-statement SQL
    charset: "utf8mb4",
  });
  try {
    if (reset) {
      console.log(`Dropping database ${DB_NAME}...`);
      await conn.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
    }
    try {
      await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    } catch (error) {
      // Hosting accounts (Hostinger, cPanel) create the database in the control panel; the user may not create one.
      if ((error as { code?: string }).code !== "ER_DBACCESS_DENIED_ERROR") throw error;
    }
    await conn.query(`USE \`${DB_NAME}\``);
    console.log(`Applying schema to ${DB_NAME}...`);
    await prepareDatabase(conn, {
      database: DB_NAME,
      seed: process.argv.includes("--staff") ? "staff" : "demo",
      adminPassword: process.env.SEED_ADMIN_PASSWORD,
      staffPassword: process.env.SEED_STAFF_PASSWORD,
    });
    console.log("Database ready.");
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error("Database setup failed:", error.message);
  if (error.code === "ECONNREFUSED") console.error("Start MySQL from the XAMPP Control Panel and try again.");
  process.exit(1);
});
