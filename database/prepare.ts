/**
 * Shared database preparation, used by `npm run db:setup` and (optionally) at server start-up
 * on hosts where commands cannot be run, such as Hostinger web hosting.
 *
 *  - applies schema.sql (idempotent: CREATE TABLE IF NOT EXISTS)
 *  - runs pending migrations
 *  - on an empty database, creates the admin account and the staff list (+ optional demo activity)
 *
 * schema.sql and seed-data.json are read from this file's folder. The production build copies
 * them next to the bundled server, so the same lookup works there.
 */
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import type { Connection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { passwordProblems } from "../shared/constants";
import { runMigrations } from "./migrations";

export type SeedMode = "demo" | "staff" | "none";

export type PrepareOptions = {
  database: string;
  /** demo = staff + roster + sample activity; staff = admin + staff + roster only; none = nothing */
  seed: SeedMode;
  adminPassword?: string;
  staffPassword?: string;
  log?: (message: string) => void;
};

type SeedData = {
  employees: { name: string; employeeId: string; team: string }[];
  roster: { employeeCode: string; dutyDate: string; shiftCode: string }[];
};

const readLocal = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

const pad = (n: number) => String(n).padStart(2, "0");
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (day: string, hour: number, minute = 0) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, hour, minute);
};

/** The connection must be opened with `multipleStatements: true` and already USE the database. */
export async function prepareDatabase(conn: Connection, options: PrepareOptions) {
  const log = options.log ?? console.log;
  await conn.query(readLocal("schema.sql"));
  const ran = await runMigrations(conn, options.database);
  for (const line of ran) log(`Migration applied: ${line}`);

  if (options.seed !== "none") {
    const [existing] = await conn.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM employees");
    if (existing[0].total > 0) log("Users already exist — no starter data added.");
    else await seed(conn, options, log);
  }
  await publishExistingMonths(conn, log);
}

async function seed(conn: Connection, options: PrepareOptions, log: (message: string) => void) {
  for (const [name, value] of [["SEED_ADMIN_PASSWORD", options.adminPassword ?? ""], ["SEED_STAFF_PASSWORD", options.staffPassword ?? ""]] as const) {
    const problems = passwordProblems(value);
    if (problems.length) throw new Error(`${name} is missing or too weak (${problems.join(", ")}). Set it to create the first accounts.`);
  }
  const data = JSON.parse(readLocal("seed-data.json")) as SeedData;
  const adminHash = await bcrypt.hash(options.adminPassword!, 12);
  const staffHash = await bcrypt.hash(options.staffPassword!, 12);

  await conn.execute(
    "INSERT INTO employees (employee_code, name, email, team, role, password_hash, must_change_password) VALUES (?, ?, ?, ?, 'admin', ?, 1)",
    ["ADMIN", "System Administrator", "admin@infinity.local", "Management", adminHash],
  );
  for (const [index, employee] of data.employees.entries()) {
    // The first person in the list becomes the team manager.
    const role = index === 0 ? "manager" : "employee";
    // Machine enrollment number guess: the number at the end of the employee ID (IS/2026/1033 → 1033, FRESHER-01 → 9001).
    const digits = employee.employeeId.match(/(\d+)$/)?.[1] ?? String(index + 1);
    const biometricId = employee.employeeId.startsWith("FRESHER") ? String(9000 + Number(digits)) : digits;
    await conn.execute(
      "INSERT INTO employees (employee_code, biometric_id, name, team, role, password_hash, must_change_password) VALUES (?, ?, ?, ?, ?, ?, 1)",
      [employee.employeeId, options.seed === "demo" ? biometricId : null, employee.name, employee.team, role, staffHash],
    );
  }

  const [rows] = await conn.query<RowDataPacket[]>("SELECT id, employee_code FROM employees WHERE employee_code <> 'ADMIN' ORDER BY id");
  const ids = new Map(rows.map((row) => [row.employee_code as string, row.id as number]));
  for (const entry of data.roster) {
    const id = ids.get(entry.employeeCode);
    if (id) await conn.execute("INSERT IGNORE INTO roster_entries (employee_id, duty_date, shift_code) VALUES (?, ?, ?)", [id, entry.dutyDate, entry.shiftCode]);
  }
  if (options.seed === "demo") await seedDemoActivity(conn, rows.map((row) => row.id as number));

  log(`Created the admin account, ${data.employees.length} staff and ${data.roster.length} roster entries${options.seed === "demo" ? " with sample activity" : ""}.`);
  log(`Sign in as ADMIN (SEED_ADMIN_PASSWORD) — manager ${data.employees[0].employeeId}, staff e.g. ${data.employees[1].employeeId} (SEED_STAFF_PASSWORD). Everyone must change the password at first sign-in.`);
}

async function seedDemoActivity(conn: Connection, staff: number[]) {
  const today = dateKey(new Date());
  const daysAgo = (n: number) => dateKey(new Date(Date.now() - n * 86400000));
  const accounts = ["GAI AIR IMPORT", "GAI AIR EXPORT", "GAI AIR OCEAN", "APEX", "LOGWIN OCEAN EXPORT", "LOGWIN AIR EXPORT", "BOLLORE AIR", "BOLLORE SEA"];
  // Two weeks of production so the dashboard trend has something to show.
  for (let day = 13; day >= 0; day -= 1) {
    for (let i = 0; i < 8; i += 1) {
      const v = (day * 7 + i * 13) % 17;
      await conn.execute(
        `INSERT IGNORE INTO daily_reports (employee_id, report_date, account, shift_code, edr_drt, edr_pmt, man_drt, man_pmt, delay_minutes, extended_minutes, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [staff[i], daysAgo(day), accounts[i], ["1", "1A", "2", "1B"][i % 4], 30 + v * 2, 15 + v, 8 + (v % 6), 4 + (v % 5), i === 3 ? 12 : 0, i % 3 === 0 ? 30 : 0, "Shift production recorded in the operations portal.", staff[i]],
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
}

/** First time roster_months exists, mark months that already have shifts as published. */
async function publishExistingMonths(conn: Connection, log: (message: string) => void) {
  const [rows] = await conn.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM roster_months");
  if (rows[0].total > 0) return;
  const [result] = await conn.query<ResultSetHeader>(
    `INSERT IGNORE INTO roster_months (month, status, published_at)
     SELECT DISTINCT DATE_FORMAT(duty_date, '%Y-%m'), 'published', NOW() FROM roster_entries`,
  );
  if (result.affectedRows) log(`Marked ${result.affectedRows} existing roster month(s) as published.`);
}
