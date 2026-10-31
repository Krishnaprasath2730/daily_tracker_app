import { Router, type Request } from "express";
import { z } from "zod";
import { ACCOUNTS, SHIFT_CODES } from "../../shared/constants";
import { execute, query, queryOne } from "../db/pool";
import { isManager } from "../middleware/auth";
import { audit } from "../services/audit";
import { addDays, localDateKey } from "../utils/dates";
import { badRequest, conflict, forbidden, isDuplicateKey, notFound } from "../utils/errors";
import { dateString, idParam, optionalText, parse } from "../utils/validation";

export const reportsRouter = Router();

const count = z.number().int().min(0).max(100000);
const minutes = z.number().int().min(0).max(1440);

const reportSchema = z.object({
  employeeId: z.number().int().positive().optional(),
  reportDate: dateString,
  account: z.enum(ACCOUNTS),
  shiftCode: z.enum(SHIFT_CODES as [string, ...string[]]),
  edrDrt: count,
  edrPmt: count,
  manDrt: count,
  manPmt: count,
  delayMinutes: minutes,
  extendedMinutes: minutes,
  notes: optionalText(2000),
});

const listSchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  account: z.enum(ACCOUNTS).optional(),
  employeeId: z.coerce.number().int().positive().optional(),
  search: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(300),
});

const SELECT = `SELECT r.id, r.employee_id AS employeeId, r.report_date AS reportDate, r.account, r.shift_code AS shiftCode,
    r.edr_drt AS edrDrt, r.edr_pmt AS edrPmt, r.man_drt AS manDrt, r.man_pmt AS manPmt,
    r.delay_minutes AS delayMinutes, r.extended_minutes AS extendedMinutes, r.notes,
    r.created_by AS createdBy, r.created_at AS createdAt, r.updated_at AS updatedAt,
    e.name AS employeeName, e.employee_code AS employeeCode
  FROM daily_reports r JOIN employees e ON e.id = r.employee_id`;

reportsRouter.get("/", async (req, res) => {
  const filters = parse(listSchema, req.query);
  const where: string[] = [];
  const params: (string | number)[] = [];
  // Employees only ever see their own reports.
  const employeeId = isManager(req) ? filters.employeeId : req.user!.id;
  if (employeeId) { where.push("r.employee_id = ?"); params.push(employeeId); }
  if (filters.from) { where.push("r.report_date >= ?"); params.push(filters.from); }
  if (filters.to) { where.push("r.report_date <= ?"); params.push(filters.to); }
  if (filters.account) { where.push("r.account = ?"); params.push(filters.account); }
  if (filters.search) {
    where.push("(e.name LIKE ? OR e.employee_code LIKE ? OR r.notes LIKE ?)");
    const term = `%${filters.search.replace(/[%_\\]/g, "\\$&")}%`;
    params.push(term, term, term);
  }
  const rows = await query(
    `${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY r.report_date DESC, r.id DESC LIMIT ${filters.limit}`,
    params,
  );
  res.json(rows);
});

/** Employees may file only for themselves and only for recent dates; managers may file for anyone. */
function resolveEmployee(req: Request, requested: number | undefined, reportDate: string) {
  if (isManager(req)) return requested ?? req.user!.id;
  if (requested && requested !== req.user!.id) throw forbidden("You can only submit reports for yourself");
  const today = localDateKey();
  if (reportDate > today) throw badRequest("Report date cannot be in the future");
  if (reportDate < addDays(today, -7)) throw badRequest("Reports older than 7 days must be filed by a manager");
  return req.user!.id;
}

reportsRouter.post("/", async (req, res) => {
  const input = parse(reportSchema, req.body);
  const employeeId = resolveEmployee(req, input.employeeId, input.reportDate);
  try {
    const result = await execute(
      `INSERT INTO daily_reports (employee_id, report_date, account, shift_code, edr_drt, edr_pmt, man_drt, man_pmt,
         delay_minutes, extended_minutes, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [employeeId, input.reportDate, input.account, input.shiftCode, input.edrDrt, input.edrPmt, input.manDrt, input.manPmt,
        input.delayMinutes, input.extendedMinutes, input.notes ?? null, req.user!.id],
    );
    await audit(req, { action: "report.create", entity: "daily_report", entityId: result.insertId });
    res.status(201).json({ id: result.insertId });
  } catch (error) {
    if (isDuplicateKey(error)) throw conflict("A report for this employee, date, account and shift already exists. Edit it instead.");
    throw error;
  }
});

type OwnedReport = { id: number; employee_id: number; created_at: Date };

/** Owners can change a report for 24 hours after filing; managers at any time. */
async function loadEditable(req: Request) {
  const id = parse(idParam, req.params.id);
  const report = await queryOne<OwnedReport>("SELECT id, employee_id, created_at FROM daily_reports WHERE id = ?", [id]);
  if (!report) throw notFound("Report not found");
  if (!isManager(req)) {
    if (report.employee_id !== req.user!.id) throw forbidden();
    if (Date.now() - report.created_at.getTime() > 24 * 3600_000) throw forbidden("Reports can only be changed within 24 hours. Ask a manager.");
  }
  return report;
}

reportsRouter.put("/:id", async (req, res) => {
  const report = await loadEditable(req);
  const input = parse(reportSchema, req.body);
  const employeeId = isManager(req) ? (input.employeeId ?? report.employee_id) : report.employee_id;
  try {
    await execute(
      `UPDATE daily_reports SET employee_id = ?, report_date = ?, account = ?, shift_code = ?, edr_drt = ?, edr_pmt = ?,
         man_drt = ?, man_pmt = ?, delay_minutes = ?, extended_minutes = ?, notes = ? WHERE id = ?`,
      [employeeId, input.reportDate, input.account, input.shiftCode, input.edrDrt, input.edrPmt, input.manDrt, input.manPmt,
        input.delayMinutes, input.extendedMinutes, input.notes ?? null, report.id],
    );
  } catch (error) {
    if (isDuplicateKey(error)) throw conflict("Another report already exists for this employee, date, account and shift");
    throw error;
  }
  await audit(req, { action: "report.update", entity: "daily_report", entityId: report.id });
  res.json({ ok: true });
});

reportsRouter.delete("/:id", async (req, res) => {
  const report = await loadEditable(req);
  await execute("DELETE FROM daily_reports WHERE id = ?", [report.id]);
  await audit(req, { action: "report.delete", entity: "daily_report", entityId: report.id });
  res.json({ ok: true });
});
