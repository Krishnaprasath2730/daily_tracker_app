import { Router } from "express";
import { z } from "zod";
import { ACCOUNTS, ERROR_STATUSES, ERROR_TYPES, SEVERITIES } from "../../shared/constants";
import { execute, query, queryOne } from "../db/pool";
import { isManager, requireRole } from "../middleware/auth";
import { audit } from "../services/audit";
import { notFound } from "../utils/errors";
import { dateString, idParam, optionalText, parse } from "../utils/validation";

export const errorsRouter = Router();

const listSchema = z.object({
  status: z.enum(ERROR_STATUSES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  search: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(300),
});

errorsRouter.get("/", async (req, res) => {
  const filters = parse(listSchema, req.query);
  const where: string[] = [];
  const params: (string | number)[] = [];
  // Employees see cases about them and cases they reported.
  if (!isManager(req)) { where.push("(x.employee_id = ? OR x.reported_by = ?)"); params.push(req.user!.id, req.user!.id); }
  if (filters.status) { where.push("x.status = ?"); params.push(filters.status); }
  if (filters.severity) { where.push("x.severity = ?"); params.push(filters.severity); }
  if (filters.search) {
    const term = `%${filters.search.replace(/[%_\\]/g, "\\$&")}%`;
    where.push("(e.name LIKE ? OR x.account LIKE ? OR x.reference LIKE ? OR x.description LIKE ?)");
    params.push(term, term, term, term);
  }
  const rows = await query(
    `SELECT x.id, x.employee_id AS employeeId, x.report_date AS reportDate, x.account, x.error_type AS errorType,
            x.reference, x.description, x.severity, x.status, x.corrective_action AS correctiveAction,
            x.resolved_at AS resolvedAt, x.created_at AS createdAt,
            e.name AS employeeName, e.employee_code AS employeeCode, rep.name AS reportedByName
       FROM error_reports x
       JOIN employees e ON e.id = x.employee_id
       LEFT JOIN employees rep ON rep.id = x.reported_by
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY x.report_date DESC, x.id DESC LIMIT ${filters.limit}`,
    params,
  );
  res.json(rows);
});

const createSchema = z.object({
  employeeId: z.number().int().positive(),
  reportDate: dateString,
  account: z.enum(ACCOUNTS),
  errorType: z.enum(ERROR_TYPES),
  reference: optionalText(100),
  description: z.string().trim().min(5).max(3000),
  severity: z.enum(SEVERITIES),
  correctiveAction: optionalText(3000),
});

errorsRouter.post("/", async (req, res) => {
  const input = parse(createSchema, req.body);
  // Employees can only log errors against themselves (self-reporting); managers can log for anyone.
  const employeeId = isManager(req) ? input.employeeId : req.user!.id;
  const employee = await queryOne("SELECT id FROM employees WHERE id = ? AND is_active = 1", [employeeId]);
  if (!employee) throw notFound("Employee not found");
  const result = await execute(
    `INSERT INTO error_reports (employee_id, report_date, account, error_type, reference, description, severity, corrective_action, reported_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [employeeId, input.reportDate, input.account, input.errorType, input.reference ?? null, input.description, input.severity,
      input.correctiveAction ?? null, req.user!.id],
  );
  await audit(req, { action: "error.create", entity: "error_report", entityId: result.insertId, details: { severity: input.severity } });
  res.status(201).json({ id: result.insertId });
});

const updateSchema = z.object({
  status: z.enum(ERROR_STATUSES),
  correctiveAction: optionalText(3000),
});

errorsRouter.patch("/:id", requireRole("admin", "manager"), async (req, res) => {
  const id = parse(idParam, req.params.id);
  const input = parse(updateSchema, req.body);
  const resolved = input.status === "Resolved";
  const result = await execute(
    `UPDATE error_reports SET status = ?, corrective_action = COALESCE(?, corrective_action),
       resolved_by = ?, resolved_at = ? WHERE id = ?`,
    [input.status, input.correctiveAction ?? null, resolved ? req.user!.id : null, resolved ? new Date() : null, id],
  );
  if (!result.affectedRows) throw notFound("Error report not found");
  await audit(req, { action: "error.update", entity: "error_report", entityId: id, details: { status: input.status } });
  res.json({ ok: true });
});
