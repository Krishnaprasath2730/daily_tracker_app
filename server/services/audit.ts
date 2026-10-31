import type { Request } from "express";
import { execute } from "../db/pool";
import { logger } from "../utils/logger";

type AuditEntry = {
  action: string;
  entity?: string;
  entityId?: number | null;
  details?: Record<string, unknown>;
  actorId?: number | null;
};

/** Record an action in the audit log. Failures are logged but never break the request. */
export async function audit(req: Request, entry: AuditEntry): Promise<void> {
  try {
    await execute(
      "INSERT INTO audit_logs (actor_id, action, entity, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)",
      [
        entry.actorId !== undefined ? entry.actorId : (req.user?.id ?? null),
        entry.action,
        entry.entity ?? null,
        entry.entityId ?? null,
        entry.details ? JSON.stringify(entry.details).slice(0, 4000) : null,
        req.ip ?? null,
      ],
    );
  } catch (error) {
    logger.error("audit log write failed", { action: entry.action, error: (error as Error).message });
  }
}
