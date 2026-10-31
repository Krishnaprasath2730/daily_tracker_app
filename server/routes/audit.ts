import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool";
import { parse } from "../utils/validation";

// Mounted behind requireRole("admin").
export const auditRouter = Router();

const listSchema = z.object({
  action: z.string().trim().max(80).regex(/^[a-z_.]*$/).optional(),
  actorId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

auditRouter.get("/", async (req, res) => {
  const filters = parse(listSchema, req.query);
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filters.action) { where.push("a.action LIKE ?"); params.push(`${filters.action}%`); }
  if (filters.actorId) { where.push("a.actor_id = ?"); params.push(filters.actorId); }
  const rows = await query(
    `SELECT a.id, a.action, a.entity, a.entity_id AS entityId, a.details, a.ip_address AS ipAddress, a.created_at AS createdAt,
            e.name AS actorName, e.employee_code AS actorCode
       FROM audit_logs a LEFT JOIN employees e ON e.id = a.actor_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY a.id DESC LIMIT ${filters.limit}`,
    params,
  );
  res.json(rows);
});
