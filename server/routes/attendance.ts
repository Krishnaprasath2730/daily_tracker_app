import { Router } from "express";
import { z } from "zod";
import { PUNCH_DIRECTIONS } from "../../shared/constants";
import { execute, query, queryOne, transaction } from "../db/pool";
import { audit } from "../services/audit";
import { runMatching, scheduleMatching } from "../services/attendance";
import { addDays, localDateKey, parsePunchTime } from "../utils/dates";
import { badRequest, conflict, forbidden, isDuplicateKey, notFound } from "../utils/errors";
import { dateString, idParam, parse } from "../utils/validation";

// Mounted behind requireRole("admin", "manager").
export const attendanceRouter = Router();

attendanceRouter.get("/", async (req, res) => {
  const date = parse(z.object({ date: dateString.optional() }), req.query).date ?? localDateKey();
  const rows = await query(
    `SELECT m.id, m.employee_id AS employeeId, m.work_date AS workDate, m.roster_shift AS rosterShift,
            m.system_start AS systemStart, m.system_end AS systemEnd, m.biometric_start AS biometricStart, m.biometric_end AS biometricEnd,
            m.punch_count AS punchCount, m.worked_minutes AS workedMinutes, m.late_minutes AS lateMinutes, m.early_minutes AS earlyMinutes,
            m.variance_minutes AS varianceMinutes, m.status, m.remarks, m.matched_at AS matchedAt,
            e.name AS employeeName, e.employee_code AS employeeCode, e.biometric_id AS biometricId
       FROM attendance_matches m JOIN employees e ON e.id = m.employee_id
      WHERE m.work_date = ? ORDER BY FIELD(m.status, 'Absent', 'Missing', 'Review', 'On duty', 'Matched'), e.name`,
    [date],
  );
  res.json(rows);
});

attendanceRouter.get("/punches", async (req, res) => {
  const { date } = parse(z.object({ date: dateString.optional() }), req.query);
  const sql = `SELECT p.id, p.employee_id AS employeeId, p.punch_time AS punchTime, p.direction, p.device_id AS deviceId,
      p.source, p.note, e.name AS employeeName, e.employee_code AS employeeCode, d.name AS deviceName
    FROM punch_records p
    JOIN employees e ON e.id = p.employee_id
    LEFT JOIN biometric_devices d ON d.serial_number = p.device_id`;
  const rows = date
    ? await query(`${sql} WHERE p.punch_time >= ? AND p.punch_time < ? ORDER BY p.punch_time DESC LIMIT 1000`, [date, addDays(date, 1)])
    : await query(`${sql} ORDER BY p.punch_time DESC LIMIT 100`);
  res.json(rows);
});

const importSchema = z.object({
  records: z
    .array(
      z.object({
        employeeCode: z.string().trim().min(1).max(40),
        punchTime: z.string().trim().min(10).max(40),
        direction: z.enum(PUNCH_DIRECTIONS),
        deviceId: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9 _.-]+$/, "Device ID contains invalid characters").default("BIO-01"),
      }),
    )
    .min(1)
    .max(5000),
});

/** CSV import (fallback when a machine is offline). employee_id may be the employee code or the machine ID. */
attendanceRouter.post("/punches/import", async (req, res) => {
  const { records } = parse(importSchema, req.body);
  const employees = await query<{ id: number; code: string; bio: string | null }>("SELECT id, employee_code AS code, biometric_id AS bio FROM employees");
  const byCode = new Map<string, number>();
  for (const e of employees) {
    byCode.set(e.code.toUpperCase(), e.id);
    if (e.bio) byCode.set(e.bio.toUpperCase(), e.id);
  }

  let imported = 0;
  let duplicates = 0;
  const problems: { row: number; reason: string }[] = [];
  const dates = new Set<string>();

  await transaction(async (conn) => {
    for (const [index, record] of records.entries()) {
      const employeeId = byCode.get(record.employeeCode.toUpperCase());
      const punchTime = parsePunchTime(record.punchTime);
      if (!employeeId) {
        problems.push({ row: index + 2, reason: `Unknown employee ${record.employeeCode}` });
        continue;
      }
      if (!punchTime) {
        problems.push({ row: index + 2, reason: `Invalid time ${record.punchTime}` });
        continue;
      }
      try {
        const result = await execute(
          "INSERT IGNORE INTO punch_records (employee_id, punch_time, direction, device_id, source, imported_by) VALUES (?, ?, ?, ?, 'csv', ?)",
          [employeeId, punchTime, record.direction, record.deviceId, req.user!.id],
          conn,
        );
        if (result.affectedRows) {
          imported += 1;
          dates.add(localDateKey(punchTime));
        } else duplicates += 1;
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        duplicates += 1;
      }
    }
  });
  scheduleMatching(dates, 500);
  await audit(req, { action: "attendance.import", details: { imported, duplicates, skipped: problems.length } });
  res.json({ imported, duplicates, skipped: problems.length, problems: problems.slice(0, 50) });
});

const manualSchema = z.object({
  employeeId: z.number().int().positive(),
  punchTime: z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/, "Use date and time"),
  direction: z.enum(["IN", "OUT"]),
  note: z.string().trim().min(5, "Give a reason (at least 5 characters)").max(255),
});

/** A manager records a punch someone forgot. Always audited and shown as "manual". */
attendanceRouter.post("/punches/manual", async (req, res) => {
  const input = parse(manualSchema, req.body);
  const punchTime = parsePunchTime(input.punchTime);
  if (!punchTime) throw badRequest("Invalid date or time");
  if (punchTime.getTime() > Date.now() + 5 * 60_000) throw badRequest("A manual punch cannot be in the future");
  if (input.employeeId === req.user!.id && req.user!.role !== "admin") throw forbidden("Ask another manager to add your own punch");
  const employee = await queryOne("SELECT id FROM employees WHERE id = ?", [input.employeeId]);
  if (!employee) throw notFound("Employee not found");
  try {
    const result = await execute(
      "INSERT INTO punch_records (employee_id, punch_time, direction, device_id, source, note, imported_by) VALUES (?, ?, ?, 'MANUAL', 'manual', ?, ?)",
      [input.employeeId, punchTime, input.direction, input.note, req.user!.id],
    );
    scheduleMatching([localDateKey(punchTime)], 200);
    await audit(req, { action: "attendance.manual_punch", entity: "employee", entityId: input.employeeId, details: { time: input.punchTime, direction: input.direction, note: input.note } });
    res.status(201).json({ id: result.insertId });
  } catch (error) {
    if (isDuplicateKey(error)) throw conflict("That punch already exists");
    throw error;
  }
});

/** Manual and CSV punches can be removed; punches from a machine are kept as evidence. */
attendanceRouter.delete("/punches/:id", async (req, res) => {
  const id = parse(idParam, req.params.id);
  const punch = await queryOne<{ source: string; punch_time: Date; employee_id: number }>("SELECT source, punch_time, employee_id FROM punch_records WHERE id = ?", [id]);
  if (!punch) throw notFound("Punch not found");
  if (punch.source === "device") throw forbidden("Punches received from a biometric machine cannot be deleted");
  await execute("DELETE FROM punch_records WHERE id = ?", [id]);
  scheduleMatching([localDateKey(punch.punch_time)], 200);
  await audit(req, { action: "attendance.punch_delete", entity: "employee", entityId: punch.employee_id, details: { source: punch.source, time: punch.punch_time } });
  res.json({ ok: true });
});

attendanceRouter.post("/match", async (req, res) => {
  const { workDate } = parse(z.object({ workDate: dateString }), req.body);
  const processed = await runMatching(workDate);
  await audit(req, { action: "attendance.match", details: { workDate, processed } });
  res.json({ processed });
});
