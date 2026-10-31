import { Router } from "express";
import { z } from "zod";
import { LEAVE_STATUSES, LEAVE_TYPES, type LeaveStatus, type LeaveType } from "../../shared/constants";
import { execute, query, queryOne, transaction } from "../db/pool";
import { isManager, requireRole } from "../middleware/auth";
import { audit } from "../services/audit";
import { addDays, eachDate, localDateKey } from "../utils/dates";
import { badRequest, conflict, forbidden, notFound } from "../utils/errors";
import { dateString, idParam, optionalText, parse } from "../utils/validation";

export const leaveRouter = Router();

leaveRouter.get("/", async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(LEAVE_STATUSES).optional() }), req.query);
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (!isManager(req)) { where.push("l.employee_id = ?"); params.push(req.user!.id); }
  if (status) { where.push("l.status = ?"); params.push(status); }
  const rows = await query(
    `SELECT l.id, l.employee_id AS employeeId, l.leave_type AS leaveType, l.start_date AS startDate, l.end_date AS endDate,
            l.reason, l.status, l.manager_note AS managerNote, l.reviewed_at AS reviewedAt, l.created_at AS createdAt,
            DATEDIFF(l.end_date, l.start_date) + 1 AS days,
            e.name AS employeeName, e.employee_code AS employeeCode, r.name AS reviewedByName
       FROM leave_requests l
       JOIN employees e ON e.id = l.employee_id
       LEFT JOIN employees r ON r.id = l.reviewed_by
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY FIELD(l.status, 'Pending') DESC, l.start_date DESC LIMIT 300`,
    params,
  );
  res.json(rows);
});

const createSchema = z.object({
  employeeId: z.number().int().positive().optional(),
  leaveType: z.enum(LEAVE_TYPES),
  startDate: dateString,
  endDate: dateString,
  reason: z.string().trim().min(5).max(2000),
});

leaveRouter.post("/", async (req, res) => {
  const input = parse(createSchema, req.body);
  const employeeId = isManager(req) ? (input.employeeId ?? req.user!.id) : req.user!.id;
  if (input.endDate < input.startDate) throw badRequest("End date must be on or after the start date");
  if (eachDate(input.startDate, input.endDate, 61).length > 60) throw badRequest("A single application cannot exceed 60 days");
  // Annual leave is planned; it cannot be back-dated by staff.
  if (!isManager(req) && input.leaveType === "Annual leave" && input.startDate < localDateKey()) {
    throw badRequest("Annual leave cannot start in the past. Use emergency leave or contact your manager.");
  }
  if (!isManager(req) && input.startDate < addDays(localDateKey(), -7)) throw badRequest("Leave older than 7 days must be recorded by a manager");

  const overlap = await queryOne(
    `SELECT id FROM leave_requests WHERE employee_id = ? AND status IN ('Pending','Approved')
       AND start_date <= ? AND end_date >= ? LIMIT 1`,
    [employeeId, input.endDate, input.startDate],
  );
  if (overlap) throw conflict("This overlaps another pending or approved leave application");

  const result = await execute(
    "INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, reason) VALUES (?, ?, ?, ?, ?)",
    [employeeId, input.leaveType, input.startDate, input.endDate, input.reason],
  );
  await audit(req, { action: "leave.create", entity: "leave_request", entityId: result.insertId });
  res.status(201).json({ id: result.insertId });
});

const decisionSchema = z.object({
  status: z.enum(["Approved", "Rejected"]),
  managerNote: optionalText(2000),
});

type LeaveRow = { id: number; employee_id: number; leave_type: LeaveType; start_date: string; end_date: string; status: LeaveStatus };

leaveRouter.patch("/:id/decision", requireRole("admin", "manager"), async (req, res) => {
  const id = parse(idParam, req.params.id);
  const input = parse(decisionSchema, req.body);

  await transaction(async (conn) => {
    // Lock the row so two managers cannot decide at the same time.
    const leave = await queryOne<LeaveRow>("SELECT * FROM leave_requests WHERE id = ? FOR UPDATE", [id], conn);
    if (!leave) throw notFound("Leave application not found");
    if (leave.status !== "Pending") throw conflict(`This application is already ${leave.status.toLowerCase()}`);
    if (leave.employee_id === req.user!.id && req.user!.role !== "admin") throw forbidden("You cannot approve your own leave");

    await execute(
      "UPDATE leave_requests SET status = ?, manager_note = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?",
      [input.status, input.managerNote ?? null, req.user!.id, id],
      conn,
    );
    // Approved leave is written to the duty roster so planning stays accurate.
    if (input.status === "Approved") {
      const code = leave.leave_type === "Annual leave" ? "AL" : "EL";
      for (const day of eachDate(leave.start_date, leave.end_date)) {
        await execute(
          `INSERT INTO roster_entries (employee_id, duty_date, shift_code, updated_by) VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE shift_code = VALUES(shift_code), updated_by = VALUES(updated_by)`,
          [leave.employee_id, day, code, req.user!.id],
          conn,
        );
      }
    }
  });
  await audit(req, { action: `leave.${input.status.toLowerCase()}`, entity: "leave_request", entityId: id });
  res.json({ ok: true });
});

leaveRouter.post("/:id/cancel", async (req, res) => {
  const id = parse(idParam, req.params.id);
  const leave = await queryOne<LeaveRow>("SELECT * FROM leave_requests WHERE id = ?", [id]);
  if (!leave) throw notFound("Leave application not found");
  if (leave.employee_id !== req.user!.id && !isManager(req)) throw forbidden();
  if (leave.status !== "Pending") throw conflict("Only pending applications can be cancelled");
  await execute("UPDATE leave_requests SET status = 'Cancelled' WHERE id = ?", [id]);
  await audit(req, { action: "leave.cancel", entity: "leave_request", entityId: id });
  res.json({ ok: true });
});
