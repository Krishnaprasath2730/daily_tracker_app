import { Router } from "express";
import { z } from "zod";
import { execute, query, queryOne, transaction } from "../db/pool";
import { isManager } from "../middleware/auth";
import { audit } from "../services/audit";
import { scheduleMatching } from "../services/attendance";
import { localDateKey } from "../utils/dates";
import { conflict, forbidden, notFound } from "../utils/errors";
import { idParam, optionalText, parse } from "../utils/validation";

export const adhocRouter = Router();

const SELECT = `SELECT s.id, s.employee_id AS employeeId, s.task, s.start_time AS startTime, s.end_time AS endTime, s.notes,
    e.name AS employeeName, e.employee_code AS employeeCode
  FROM adhoc_sessions s JOIN employees e ON e.id = s.employee_id`;

adhocRouter.get("/", async (req, res) => {
  const rows = isManager(req)
    ? await query(`${SELECT} ORDER BY s.start_time DESC LIMIT 300`)
    : await query(`${SELECT} WHERE s.employee_id = ? ORDER BY s.start_time DESC LIMIT 300`, [req.user!.id]);
  // Everyone can see who is currently busy, but only names and tasks.
  const active = await query(`${SELECT} WHERE s.end_time IS NULL ORDER BY s.start_time`);
  res.json({ sessions: rows, active, serverTime: new Date() });
});

const startSchema = z.object({ task: z.string().trim().min(3).max(180), notes: optionalText(2000) });

adhocRouter.post("/start", async (req, res) => {
  const input = parse(startSchema, req.body);
  const employeeId = req.user!.id;
  const id = await transaction(async (conn) => {
    // Lock this user's open sessions so a double-click cannot start two timers.
    const active = await queryOne(
      "SELECT id FROM adhoc_sessions WHERE employee_id = ? AND end_time IS NULL LIMIT 1 FOR UPDATE",
      [employeeId],
      conn,
    );
    if (active) throw conflict("End the active session before starting another");
    const result = await execute(
      "INSERT INTO adhoc_sessions (employee_id, task, start_time, notes) VALUES (?, ?, NOW(), ?)",
      [employeeId, input.task, input.notes ?? null],
      conn,
    );
    return result.insertId;
  });
  await audit(req, { action: "adhoc.start", entity: "adhoc_session", entityId: id });
  res.status(201).json({ id });
});

adhocRouter.post("/:id/end", async (req, res) => {
  const id = parse(idParam, req.params.id);
  const session = await queryOne<{ employee_id: number; end_time: Date | null }>(
    "SELECT employee_id, end_time FROM adhoc_sessions WHERE id = ?",
    [id],
  );
  if (!session) throw notFound("Session not found");
  if (session.employee_id !== req.user!.id && !isManager(req)) throw forbidden("You can only end your own sessions");
  if (session.end_time) throw conflict("This session has already ended");
  await execute("UPDATE adhoc_sessions SET end_time = NOW() WHERE id = ? AND end_time IS NULL", [id]);
  scheduleMatching([localDateKey()]);
  await audit(req, { action: "adhoc.end", entity: "adhoc_session", entityId: id });
  res.json({ ok: true });
});
