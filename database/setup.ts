/**
 * Creates the database, applies schema.sql and loads starter data.
 *
 *   npm run db:setup            create tables + seed (skips seeding if users already exist)
 *   npm run db:setup -- --reset DROP the database first (deletes all data!)
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import bcrypt from "bcryptjs";
import { passwordProblems } from "../shared/constants";
import { runMigrations } from "./migrations";

const DB_NAME = process.env.DB_NAME || "infinity_ops";
if (!/^[A-Za-z0-9_]+$/.test(DB_NAME)) throw new Error("DB_NAME may only contain letters, numbers and underscores");

const reset = process.argv.includes("--reset");
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "";
const staffPassword = process.env.SEED_STAFF_PASSWORD ?? "";

for (const [name, value] of [["SEED_ADMIN_PASSWORD", adminPassword], ["SEED_STAFF_PASSWORD", staffPassword]] as const) {
  const problems = passwordProblems(value);
  if (problems.length) {
    console.error(`${name} in .env is missing or too weak: ${problems.join(", ")}`);
    process.exit(1);
  }
}

const pad = (n: number) => String(n).padStart(2, "0");
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (day: string, hour: number, minute = 0) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, hour, minute);
};

type SeedData = {
  employees: { name: string; employeeId: string; team: string }[];
  roster: { employeeCode: string; dutyDate: string; shiftCode: string }[];
};

async function seed(conn: Connection) {
  const [existing] = await conn.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM employees");
  if (existing[0].total > 0) {
    console.log("Users already exist — skipping sample data.");
    return;
  }
  const data = JSON.parse(readFileSync(new URL("./seed-data.json", import.meta.url), "utf8")) as SeedData;
  const adminHash = await bcrypt.hash(adminPassword, 12);
  const staffHash = await bcrypt.hash(staffPassword, 12);

  await conn.execute(
    "INSERT INTO employees (employee_code, name, email, team, role, password_hash, must_change_password) VALUES (?, ?, ?, ?, 'admin', ?, 1)",
    ["ADMIN", "System Administrator", "admin@infinity.local", "Management", adminHash],
  );
  for (const [index, employee] of data.employees.entries()) {
    // The first person in the list becomes the team manager.
    const role = index === 0 ? "manager" : "employee";
    // Demo machine enrollment number: the number at the end of the employee ID (IS/2026/1033 → 1033, FRESHER-01 → 9001).
    const digits = employee.employeeId.match(/(\d+)$/)?.[1] ?? String(index + 1);
    const biometricId = employee.employeeId.startsWith("FRESHER") ? String(9000 + Number(digits)) : digits;
    await conn.execute(
      "INSERT INTO employees (employee_code, biometric_id, name, team, role, password_hash, must_change_password) VALUES (?, ?, ?, ?, ?, ?, 1)",
      [employee.employeeId, biometricId, employee.name, employee.team, role, staffHash],
    );
  }

  const [rows] = await conn.query<RowDataPacket[]>("SELECT id, employee_code FROM employees WHERE employee_code <> 'ADMIN' ORDER BY id");
  const ids = new Map(rows.map((row) => [row.employee_code as string, row.id as number]));
  const staff = rows.map((row) => row.id as number);

  for (const entry of data.roster) {
    const id = ids.get(entry.employeeCode);
    if (id) await conn.execute("INSERT IGNORE INTO roster_entries (employee_id, duty_date, shift_code) VALUES (?, ?, ?)", [id, entry.dutyDate, entry.shiftCode]);
  }

  const today = dateKey(new Date());
  const daysAgo = (n: number) => dateKey(new Date(Date.now() - n * 86400000));
  const accounts = ["GAI AIR IMPORT", "GAI AIR EXPORT", "GAI AIR OCEAN", "APEX", "LOGWIN OCEAN EXPORT", "LOGWIN AIR EXPORT", "BOLLORE AIR", "BOLLORE SEA"];
  // Two weeks of production so the dashboard trend has something to show.
  for (let day = 13; day >= 0; day -= 1) {
    for (let i = 0; i < 8; i += 1) {
      const seedValue = (day * 7 + i * 13) % 17;
      await conn.execute(
        `INSERT IGNORE INTO daily_reports (employee_id, report_date, account, shift_code, edr_drt, edr_pmt, man_drt, man_pmt, delay_minutes, extended_minutes, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [staff[i], daysAgo(day), accounts[i], ["1", "1A", "2", "1B"][i % 4], 30 + seedValue * 2, 15 + seedValue, 8 + (seedValue % 6), 4 + (seedValue % 5),
          i === 3 ? 12 : 0, i % 3 === 0 ? 30 : 0, "Shift production recorded in the operations portal.", staff[i]],
      );
    }
  }

  const errors = [
    [staff[0], "GAI AIR IMPORT", "Documentation", "MAWB-10482", "Consignee address did not match the supporting document.", "High", "In review", "Document sent for correction and second-level verification."],
    [staff[2], "APEX", "Data entry", "APEX-8821", "Duplicate entry identified during the shift audit.", "Medium", "Open", "Duplicate entry isolated for supervisor review."],
    [staff[4], "LOGWIN AIR EXPORT", "Process delay", "LOG-4470", "Handover was delayed pending confirmation from the carrier.", "Low", "Resolved", "Confirmation received and handover completed."],
  ];
  for (const [employeeId, account, type, ref, description, severity, status, action] of errors) {
    await conn.execute(
      `INSERT INTO error_reports (employee_id, report_date, account, error_type, reference, description, severity, status, corrective_action, reported_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [employeeId, today, account, type, ref, description, severity, status, action, staff[0]],
    );
  }

  await conn.execute("INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, reason) VALUES (?, 'Annual leave', ?, ?, ?)",
    [staff[4], dateKey(new Date(Date.now() + 86400000)), dateKey(new Date(Date.now() + 3 * 86400000)), "Planned family travel; handover notes will be shared before leave."]);
  await conn.execute("INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, reason) VALUES (?, 'Annual leave', ?, ?, ?)",
    [staff[6], dateKey(new Date(Date.now() + 7 * 86400000)), dateKey(new Date(Date.now() + 8 * 86400000)), "Personal commitment."]);

  const sessions = [
    { hour: 6, end: 14, task: "GAI import document processing", punch: 2 },
    { hour: 9, end: 17, task: "APEX entry verification", punch: 3 },
    { hour: 6, end: 14, task: "GAI ocean operations support", punch: 4 },
    { hour: 11, end: 19, task: "Logwin export coordination", punch: 22 },
    { hour: 13, end: 21, task: "Bollore air documentation", punch: 1 },
  ];
  const yesterday = daysAgo(1);
  for (const [i, s] of sessions.entries()) {
    const endMinute = i % 2 ? 30 : 0;
    await conn.execute("INSERT INTO adhoc_sessions (employee_id, task, start_time, end_time, notes) VALUES (?, ?, ?, ?, ?)",
      [staff[i], s.task, at(yesterday, s.hour), at(yesterday, s.end, endMinute), "Support work tracked in the ad-hoc system."]);
    await conn.execute("INSERT INTO punch_records (employee_id, punch_time, direction, device_id) VALUES (?, ?, 'IN', 'BIO-01')", [staff[i], at(yesterday, s.hour, s.punch)]);
    await conn.execute("INSERT INTO punch_records (employee_id, punch_time, direction, device_id) VALUES (?, ?, 'OUT', 'BIO-01')", [staff[i], at(yesterday, s.end, endMinute + Math.min(s.punch, 4))]);
  }

  console.log(`Seeded 1 admin, ${data.employees.length} staff, ${data.roster.length} roster entries and sample activity.`);
  console.log("\nSign in with:");
  console.log("  Admin   → ADMIN");
  console.log(`  Manager → ${data.employees[0].employeeId}`);
  console.log(`  Staff   → ${data.employees[1].employeeId} (and the other staff IDs)`);
  console.log("Passwords are SEED_ADMIN_PASSWORD / SEED_STAFF_PASSWORD from .env. Everyone must change it on first sign-in.");
}

/**
 * Roster publishing was added later. The first time roster_months exists,
 * mark every month that already has shifts as published so staff keep seeing them.
 */
async function publishExistingMonths(conn: Connection) {
  const [rows] = await conn.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM roster_months");
  if (rows[0].total > 0) return;
  const [result] = await conn.query<mysql.ResultSetHeader>(
    `INSERT IGNORE INTO roster_months (month, status, published_at)
     SELECT DISTINCT DATE_FORMAT(duty_date, '%Y-%m'), 'published', NOW() FROM roster_entries`,
  );
  if (result.affectedRows) console.log(`Marked ${result.affectedRows} existing roster month(s) as published.`);
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    multipleStatements: true, // only this offline setup script runs multi-statement SQL
    charset: "utf8mb4",
  });
  try {
    if (reset) {
      console.log(`Dropping database ${DB_NAME}...`);
      await conn.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
    }
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.query(`USE \`${DB_NAME}\``);
    await conn.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
    console.log(`Schema applied to ${DB_NAME}.`);
    const ran = await runMigrations(conn, DB_NAME);
    for (const line of ran) console.log(`Migration applied: ${line}`);
    await seed(conn);
    await publishExistingMonths(conn);
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error("Database setup failed:", error.message);
  if (error.code === "ECONNREFUSED") console.error("Start MySQL from the XAMPP Control Panel and try again.");
  process.exit(1);
});
