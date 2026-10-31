import { Router } from "express";
import { z } from "zod";
import { passwordProblems, ROLES, type Role } from "../../shared/constants";
import { execute, query, queryOne } from "../db/pool";
import { isManager, requireRole } from "../middleware/auth";
import { audit } from "../services/audit";
import { deleteUserSessions, hashPassword, temporaryPassword } from "../services/auth";
import { convertLinkedPunches, unlinkPin } from "../services/biometric";
import { badRequest, conflict, forbidden, isDuplicateKey, notFound } from "../utils/errors";
import { idParam, parse } from "../utils/validation";

export const employeesRouter = Router();

type EmployeeRow = {
  id: number;
  employeeCode: string;
  biometricId: string | null;
  name: string;
  email: string | null;
  team: string;
  role: Role;
  isActive: number;
  mustChangePassword: number;
  lastLoginAt: Date | null;
  isLocked: number;
  createdAt: Date;
};

const FULL_COLUMNS = `id, employee_code AS employeeCode, biometric_id AS biometricId, name, email, team, role, is_active AS isActive,
  must_change_password AS mustChangePassword, last_login_at AS lastLoginAt, (locked_until IS NOT NULL AND locked_until > NOW()) AS isLocked, created_at AS createdAt`;

const toEmployee = (row: EmployeeRow) => ({ ...row, isActive: Boolean(row.isActive), mustChangePassword: Boolean(row.mustChangePassword), isLocked: Boolean(row.isLocked) });

/** Staff directory. Managers and admins see full details; employees get the basic list for name lookups. */
employeesRouter.get("/", async (req, res) => {
  const includeInactive = req.query.includeInactive === "true" && req.user!.role === "admin";
  if (isManager(req)) {
    const rows = await query<EmployeeRow>(
      `SELECT ${FULL_COLUMNS} FROM employees ${includeInactive ? "" : "WHERE is_active = 1"} ORDER BY name`,
    );
    res.json(rows.map(toEmployee));
    return;
  }
  const rows = await query("SELECT id, employee_code AS employeeCode, name, team FROM employees WHERE is_active = 1 ORDER BY name");
  res.json(rows);
});

const employeeCode = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[A-Za-z0-9/_-]+$/, "Employee ID may only use letters, numbers, /, _ and -");

const biometricId = z.string().trim().regex(/^[A-Za-z0-9]{1,20}$/, "Machine ID may only contain letters and numbers (max 20)");

const createSchema = z.object({
  employeeCode,
  biometricId: biometricId.optional().or(z.literal("").transform(() => undefined)),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(160).optional().or(z.literal("").transform(() => undefined)),
  team: z.string().trim().min(2).max(80).default("Support"),
  role: z.enum(ROLES).default("employee"),
  password: z.string().max(128).optional().or(z.literal("").transform(() => undefined)),
});

employeesRouter.post("/", requireRole("admin"), async (req, res) => {
  const input = parse(createSchema, req.body);
  if (input.password) {
    const problems = passwordProblems(input.password);
    if (problems.length) throw badRequest(problems.join(". "));
  }
  const password = input.password ?? temporaryPassword();
  try {
    const result = await execute(
      `INSERT INTO employees (employee_code, biometric_id, name, email, team, role, password_hash, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [input.employeeCode, input.biometricId ?? null, input.name, input.email ?? null, input.team, input.role, await hashPassword(password)],
    );
    if (input.biometricId) await convertLinkedPunches();
    await audit(req, { action: "employee.create", entity: "employee", entityId: result.insertId, details: { code: input.employeeCode, role: input.role } });
    // The temporary password is shown once to the admin and never stored in plain text.
    res.status(201).json({ id: result.insertId, temporaryPassword: input.password ? undefined : password });
  } catch (error) {
    if (isDuplicateKey(error)) throw conflict("An employee with this ID, machine ID or email already exists");
    throw error;
  }
});

const updateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().toLowerCase().email().max(160).nullable().optional().or(z.literal("").transform(() => null)),
  team: z.string().trim().min(2).max(80).optional(),
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
  unlock: z.boolean().optional(),
  biometricId: biometricId.nullable().optional().or(z.literal("").transform(() => null)),
});

employeesRouter.patch("/:id", requireRole("admin"), async (req, res) => {
  const id = parse(idParam, req.params.id);
  const input = parse(updateSchema, req.body);
  const existing = await queryOne<EmployeeRow>(`SELECT ${FULL_COLUMNS} FROM employees WHERE id = ?`, [id]);
  if (!existing) throw notFound("Employee not found");
  if (id === req.user!.id && (input.isActive === false || (input.role && input.role !== "admin"))) {
    throw forbidden("You cannot deactivate or demote your own account");
  }

  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.email !== undefined) { sets.push("email = ?"); params.push(input.email); }
  if (input.team !== undefined) { sets.push("team = ?"); params.push(input.team); }
  if (input.role !== undefined) { sets.push("role = ?"); params.push(input.role); }
  if (input.isActive !== undefined) { sets.push("is_active = ?"); params.push(input.isActive ? 1 : 0); }
  if (input.unlock) sets.push("failed_login_attempts = 0", "locked_until = NULL");
  const biometricChanged = input.biometricId !== undefined && input.biometricId !== existing.biometricId;
  if (biometricChanged) {
    const owner = input.biometricId ? await queryOne<{ name: string }>("SELECT name FROM employees WHERE biometric_id = ? AND id <> ?", [input.biometricId, id]) : undefined;
    if (owner) throw conflict(`Machine ID ${input.biometricId} already belongs to ${owner.name}`);
    // Take the old machine ID's punches back out of this person's attendance first.
    if (existing.biometricId) await unlinkPin(existing.biometricId);
    sets.push("biometric_id = ?");
    params.push(input.biometricId ?? null);
  }
  if (!sets.length) throw badRequest("Nothing to update");

  try {
    await execute(`UPDATE employees SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  } catch (error) {
    if (isDuplicateKey(error)) throw conflict("Another employee already uses this email or machine ID");
    throw error;
  }
  if (biometricChanged && input.biometricId) {
    await execute("INSERT IGNORE INTO biometric_users (pin) VALUES (?)", [input.biometricId]);
    await convertLinkedPunches();
  }
  // Role or status changes take effect immediately: end all of that user's sessions.
  if (input.isActive === false || (input.role && input.role !== existing.role)) await deleteUserSessions(id);
  await audit(req, { action: "employee.update", entity: "employee", entityId: id, details: input });
  res.json({ ok: true });
});

employeesRouter.post("/:id/reset-password", requireRole("admin"), async (req, res) => {
  const id = parse(idParam, req.params.id);
  const password = temporaryPassword();
  const result = await execute(
    "UPDATE employees SET password_hash = ?, must_change_password = 1, failed_login_attempts = 0, locked_until = NULL WHERE id = ?",
    [await hashPassword(password), id],
  );
  if (!result.affectedRows) throw notFound("Employee not found");
  await deleteUserSessions(id);
  await audit(req, { action: "employee.reset_password", entity: "employee", entityId: id });
  res.json({ temporaryPassword: password });
});
