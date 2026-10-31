import { Router, type Request } from "express";
import type { PoolConnection } from "mysql2/promise";
import { z } from "zod";
import { SHIFT_CODES, type SwapStatus } from "../../shared/constants";
import { DEFAULT_MIN_STAFF_WEEKDAY, DEFAULT_MIN_STAFF_WEEKEND, SHIFT_BY_CODE, addDaysKey } from "../../shared/roster";
import { execute, query, queryOne, transaction } from "../db/pool";
import { isManager, requireRole } from "../middleware/auth";
import { audit } from "../services/audit";
import { scheduleMatching } from "../services/attendance";
import { eachDate, localDateKey, nextMonthStart } from "../utils/dates";
import { badRequest, conflict, forbidden, notFound } from "../utils/errors";
import { dateString, idParam, monthString, optionalText, parse } from "../utils/validation";

export const rosterRouter = Router();
const managerOnly = requireRole("admin", "manager");
const shiftCode = z.enum(SHIFT_CODES as [string, ...string[]]);

type MonthRow = {
  month: string;
  status: "draft" | "published";
  minStaffWeekday: number;
  minStaffWeekend: number;
  publishedAt: Date | null;
  publishedByName: string | null;
};

async function monthInfo(month: string): Promise<MonthRow> {
  const row = await queryOne<MonthRow>(
    `SELECT m.month, m.status, m.min_staff_weekday AS minStaffWeekday, m.min_staff_weekend AS minStaffWeekend,
            m.published_at AS publishedAt, e.name AS publishedByName
       FROM roster_months m LEFT JOIN employees e ON e.id = m.published_by WHERE m.month = ?`,
    [month],
  );
  return row ?? { month, status: "draft", minStaffWeekday: DEFAULT_MIN_STAFF_WEEKDAY, minStaffWeekend: DEFAULT_MIN_STAFF_WEEKEND, publishedAt: null, publishedByName: null };
}

const isPublished = async (dateKey: string) => (await monthInfo(dateKey.slice(0, 7))).status === "published";

// ── Read ───────────────────────────────────────────────────────────

rosterRouter.get("/", async (req, res) => {
  const { month } = parse(z.object({ month: monthString }), req.query);
  const info = await monthInfo(month);
  const manager = isManager(req);

  // Staff only see a month once a manager has published it.
  if (!manager && info.status !== "published") {
    res.json({ ...info, entries: [], leaves: [], hidden: true });
    return;
  }
  // Include the 6 days before the month so "consecutive days" warnings are correct on the 1st.
  const from = addDaysKey(`${month}-01`, -6);
  const to = nextMonthStart(month);
  const [entries, leaves] = await Promise.all([
    query(
      `SELECT r.employee_id AS employeeId, r.duty_date AS dutyDate, r.shift_code AS shiftCode
         FROM roster_entries r WHERE r.duty_date >= ? AND r.duty_date < ? ORDER BY r.duty_date`,
      [from, to],
    ),
    // Leave details are personal, so only managers get them.
    manager
      ? query(
          `SELECT employee_id AS employeeId, start_date AS startDate, end_date AS endDate, status, leave_type AS leaveType
             FROM leave_requests WHERE status IN ('Approved','Pending') AND start_date < ? AND end_date >= ?`,
          [to, from],
        )
      : Promise.resolve([]),
  ]);
  res.json({ ...info, entries, leaves, hidden: false });
});

// ── Edit (managers) ────────────────────────────────────────────────

type Change = { employeeId: number; dutyDate: string; shiftCode: string };

async function applyChanges(conn: PoolConnection, changes: Change[], userId: number) {
  let updated = 0;
  // Attendance for today and earlier depends on the roster shift, so re-check those days.
  const today = localDateKey();
  scheduleMatching(changes.filter((c) => c.dutyDate <= today).map((c) => c.dutyDate));
  for (const change of changes) {
    if (change.shiftCode === "-") {
      const result = await execute("DELETE FROM roster_entries WHERE employee_id = ? AND duty_date = ?", [change.employeeId, change.dutyDate], conn);
      updated += result.affectedRows;
    } else {
      await execute(
        `INSERT INTO roster_entries (employee_id, duty_date, shift_code, updated_by) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE shift_code = VALUES(shift_code), updated_by = VALUES(updated_by)`,
        [change.employeeId, change.dutyDate, change.shiftCode, userId],
        conn,
      );
      updated += 1;
    }
  }
  return updated;
}

async function assertEmployeesExist(ids: number[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const rows = await query<{ id: number }>(
    `SELECT id FROM employees WHERE id IN (${unique.map(() => "?").join(",")})`,
    unique,
  );
  if (rows.length !== unique.length) throw notFound("One or more employees were not found");
}

const changeSchema = z.object({ employeeId: z.number().int().positive(), dutyDate: dateString, shiftCode: z.union([shiftCode, z.literal("-")]) });

/** Single cell (kept for simple clients). */
rosterRouter.put("/", managerOnly, async (req, res) => {
  const change = parse(changeSchema, req.body);
  await assertEmployeesExist([change.employeeId]);
  await transaction((conn) => applyChanges(conn, [change], req.user!.id));
  await audit(req, { action: "roster.update", entity: "employee", entityId: change.employeeId, details: { date: change.dutyDate, shift: change.shiftCode } });
  res.json({ ok: true });
});

/** Many cells in one transaction (grid multi-select, paste, undo). */
rosterRouter.put("/bulk", managerOnly, async (req, res) => {
  const { changes } = parse(z.object({ changes: z.array(changeSchema).min(1).max(3000) }), req.body);
  await assertEmployeesExist(changes.map((c) => c.employeeId));
  const updated = await transaction((conn) => applyChanges(conn, changes, req.user!.id));
  await audit(req, {
    action: "roster.bulk_update",
    details: { cells: changes.length, from: changes.map((c) => c.dutyDate).sort()[0], sample: changes.slice(0, 5) },
  });
  res.json({ updated });
});

const patternSchema = z.object({
  employeeIds: z.array(z.number().int().positive()).min(1).max(500),
  from: dateString,
  to: dateString,
  // Monday → Sunday; "" leaves that weekday untouched.
  pattern: z.array(z.union([shiftCode, z.literal("")])).length(7),
  overwrite: z.boolean().default(false),
});

/** Apply a weekly pattern (Mon–Sun) to staff over a date range. Leave entries are never overwritten. */
rosterRouter.post("/pattern", managerOnly, async (req, res) => {
  const input = parse(patternSchema, req.body);
  if (input.to < input.from) throw badRequest("End date must be on or after the start date");
  const dates = eachDate(input.from, input.to, 93);
  if (dates.length > 92) throw badRequest("Apply a pattern to at most 3 months at a time");
  await assertEmployeesExist(input.employeeIds);

  // Leave days are never touched by a pattern.
  const leaveDays = await query<{ employeeId: number; dutyDate: string }>(
    `SELECT employee_id AS employeeId, duty_date AS dutyDate FROM roster_entries
      WHERE shift_code IN ('AL','EL') AND duty_date BETWEEN ? AND ?
        AND employee_id IN (${input.employeeIds.map(() => "?").join(",")})`,
    [input.from, input.to, ...input.employeeIds],
  );
  const protectedCells = new Set(leaveDays.map((row) => `${row.employeeId}|${row.dutyDate}`));

  const applied = await transaction(async (conn) => {
    let count = 0;
    for (const employeeId of input.employeeIds) {
      for (const date of dates) {
        const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
        const code = input.pattern[weekday];
        if (!code || protectedCells.has(`${employeeId}|${date}`)) continue;
        const result = await execute(
          input.overwrite
            ? `INSERT INTO roster_entries (employee_id, duty_date, shift_code, updated_by) VALUES (?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE shift_code = VALUES(shift_code), updated_by = VALUES(updated_by)`
            : "INSERT IGNORE INTO roster_entries (employee_id, duty_date, shift_code, updated_by) VALUES (?, ?, ?, ?)",
          [employeeId, date, code, req.user!.id],
          conn,
        );
        if (result.affectedRows) count += 1;
      }
    }
    return count;
  });
  await audit(req, { action: "roster.pattern", details: { employees: input.employeeIds.length, from: input.from, to: input.to, pattern: input.pattern, overwrite: input.overwrite, applied } });
  res.json({ applied });
});

/** Copy a whole month's pattern into another month (same day numbers). Existing entries in the target are kept. */
rosterRouter.post("/copy", managerOnly, async (req, res) => {
  const { fromMonth, toMonth } = parse(z.object({ fromMonth: monthString, toMonth: monthString }), req.body);
  if (fromMonth === toMonth) throw badRequest("Choose two different months");
  const result = await execute(
    `INSERT IGNORE INTO roster_entries (employee_id, duty_date, shift_code, updated_by)
     SELECT r.employee_id, STR_TO_DATE(CONCAT(?, '-', LPAD(DAY(r.duty_date), 2, '0')), '%Y-%m-%d'), r.shift_code, ?
       FROM roster_entries r
       JOIN employees e ON e.id = r.employee_id AND e.is_active = 1
      WHERE r.duty_date >= ? AND r.duty_date < ?
        AND r.shift_code NOT IN ('AL', 'EL')
        AND DAY(r.duty_date) <= DAY(LAST_DAY(STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d')))`,
    [toMonth, req.user!.id, `${fromMonth}-01`, nextMonthStart(fromMonth), toMonth],
  );
  await audit(req, { action: "roster.copy", details: { fromMonth, toMonth, copied: result.affectedRows } });
  res.json({ copied: result.affectedRows });
});

const monthSettingsSchema = z
  .object({
    status: z.enum(["draft", "published"]).optional(),
    minStaffWeekday: z.number().int().min(0).max(200).optional(),
    minStaffWeekend: z.number().int().min(0).max(200).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");

/** Publish / unpublish a month, or change its minimum staffing levels. */
rosterRouter.put("/months/:month", managerOnly, async (req, res) => {
  const month = parse(monthString, req.params.month);
  const input = parse(monthSettingsSchema, req.body);
  const current = await monthInfo(month);
  const status = input.status ?? current.status;
  const publishing = input.status === "published" && current.status !== "published";
  await execute(
    `INSERT INTO roster_months (month, status, min_staff_weekday, min_staff_weekend, published_by, published_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       -- published_* first: MySQL applies assignments left to right, so they must read the old status.
       published_by = IF(VALUES(status) = 'published' AND status <> 'published', VALUES(published_by), published_by),
       published_at = IF(VALUES(status) = 'published' AND status <> 'published', VALUES(published_at), published_at),
       status = VALUES(status), min_staff_weekday = VALUES(min_staff_weekday), min_staff_weekend = VALUES(min_staff_weekend)`,
    [
      month,
      status,
      input.minStaffWeekday ?? current.minStaffWeekday,
      input.minStaffWeekend ?? current.minStaffWeekend,
      publishing ? req.user!.id : null,
      publishing ? new Date() : null,
    ],
  );
  await audit(req, { action: input.status ? `roster.${input.status === "published" ? "publish" : "unpublish"}` : "roster.settings", details: { month, ...input } });
  res.json(await monthInfo(month));
});

// ── Shift swaps ────────────────────────────────────────────────────

const SWAP_SELECT = `SELECT s.id, s.duty_date AS dutyDate, s.requester_id AS requesterId, s.target_id AS targetId,
    s.requester_shift AS requesterShift, s.target_shift AS targetShift, s.reason, s.status, s.manager_note AS managerNote,
    s.created_at AS createdAt, s.responded_at AS respondedAt, s.decided_at AS decidedAt,
    r.name AS requesterName, r.employee_code AS requesterCode, t.name AS targetName, t.employee_code AS targetCode,
    d.name AS decidedByName
  FROM shift_swaps s
  JOIN employees r ON r.id = s.requester_id
  JOIN employees t ON t.id = s.target_id
  LEFT JOIN employees d ON d.id = s.decided_by`;

rosterRouter.get("/swaps", async (req, res) => {
  const since = addDaysKey(localDateKey(), -30);
  const rows = isManager(req)
    ? await query(`${SWAP_SELECT} WHERE s.status IN ('Pending','Accepted') OR s.created_at >= ? ORDER BY FIELD(s.status,'Accepted','Pending') DESC, s.duty_date DESC LIMIT 200`, [since])
    : await query(`${SWAP_SELECT} WHERE (s.requester_id = ? OR s.target_id = ?) AND (s.status IN ('Pending','Accepted') OR s.created_at >= ?) ORDER BY s.created_at DESC LIMIT 100`, [req.user!.id, req.user!.id, since]);
  res.json(rows);
});

const shiftOf = (employeeId: number, date: string, conn?: PoolConnection) =>
  queryOne<{ shift_code: string }>(
    `SELECT shift_code FROM roster_entries WHERE employee_id = ? AND duty_date = ?${conn ? " FOR UPDATE" : ""}`,
    [employeeId, date],
    conn,
  ).then((row) => row?.shift_code);

const swapRequestSchema = z.object({ dutyDate: dateString, targetId: z.number().int().positive(), reason: optionalText(500) });

rosterRouter.post("/swaps", async (req, res) => {
  const input = parse(swapRequestSchema, req.body);
  const me = req.user!.id;
  if (input.targetId === me) throw badRequest("Choose a colleague to swap with");
  if (input.dutyDate < localDateKey()) throw badRequest("You can only swap today's or future shifts");
  if (!(await isPublished(input.dutyDate))) throw badRequest("That month's roster is not published yet");
  const target = await queryOne("SELECT id FROM employees WHERE id = ? AND is_active = 1", [input.targetId]);
  if (!target) throw notFound("Colleague not found");

  const [mine, theirs] = await Promise.all([shiftOf(me, input.dutyDate), shiftOf(input.targetId, input.dutyDate)]);
  if (!mine || !theirs) throw badRequest("Both of you need a shift on the roster for that date");
  if (mine === theirs) throw badRequest("You both have the same shift that day");
  if (SHIFT_BY_CODE.get(mine)?.kind === "leave" || SHIFT_BY_CODE.get(theirs)?.kind === "leave") throw badRequest("Leave days cannot be swapped");

  const open = await queryOne(
    `SELECT id FROM shift_swaps WHERE duty_date = ? AND status IN ('Pending','Accepted')
       AND (requester_id IN (?, ?) OR target_id IN (?, ?)) LIMIT 1`,
    [input.dutyDate, me, input.targetId, me, input.targetId],
  );
  if (open) throw conflict("There is already an open swap request for one of you on that date");

  const result = await execute(
    "INSERT INTO shift_swaps (duty_date, requester_id, target_id, requester_shift, target_shift, reason) VALUES (?, ?, ?, ?, ?, ?)",
    [input.dutyDate, me, input.targetId, mine, theirs, input.reason ?? null],
  );
  await audit(req, { action: "swap.request", entity: "shift_swap", entityId: result.insertId, details: { date: input.dutyDate, mine, theirs } });
  res.status(201).json({ id: result.insertId });
});

type SwapRow = { id: number; duty_date: string; requester_id: number; target_id: number; requester_shift: string; target_shift: string; status: SwapStatus };

async function loadSwap(req: Request, conn?: PoolConnection) {
  const id = parse(idParam, req.params.id);
  const swap = await queryOne<SwapRow>(`SELECT * FROM shift_swaps WHERE id = ?${conn ? " FOR UPDATE" : ""}`, [id], conn);
  if (!swap) throw notFound("Swap request not found");
  return swap;
}

rosterRouter.post("/swaps/:id/respond", async (req, res) => {
  const { accept } = parse(z.object({ accept: z.boolean() }), req.body);
  const swap = await loadSwap(req);
  if (swap.target_id !== req.user!.id) throw forbidden("Only the colleague asked can respond");
  if (swap.status !== "Pending") throw conflict(`This request is already ${swap.status.toLowerCase()}`);
  const status: SwapStatus = accept ? "Accepted" : "Declined";
  await execute("UPDATE shift_swaps SET status = ?, responded_at = NOW() WHERE id = ? AND status = 'Pending'", [status, swap.id]);
  await audit(req, { action: `swap.${accept ? "accept" : "decline"}`, entity: "shift_swap", entityId: swap.id });
  res.json({ status });
});

rosterRouter.post("/swaps/:id/cancel", async (req, res) => {
  const swap = await loadSwap(req);
  if (swap.requester_id !== req.user!.id) throw forbidden("Only the person who asked can cancel");
  if (swap.status !== "Pending" && swap.status !== "Accepted") throw conflict(`This request is already ${swap.status.toLowerCase()}`);
  await execute("UPDATE shift_swaps SET status = 'Cancelled' WHERE id = ?", [swap.id]);
  await audit(req, { action: "swap.cancel", entity: "shift_swap", entityId: swap.id });
  res.json({ status: "Cancelled" });
});

const decisionSchema = z.object({ status: z.enum(["Approved", "Rejected"]), managerNote: optionalText(500) });

rosterRouter.patch("/swaps/:id/decision", managerOnly, async (req, res) => {
  const input = parse(decisionSchema, req.body);
  await transaction(async (conn) => {
    const swap = await loadSwap(req, conn);
    if (swap.status !== "Accepted") throw conflict(swap.status === "Pending" ? "The colleague has not accepted yet" : `This request is already ${swap.status.toLowerCase()}`);
    const involved = [swap.requester_id, swap.target_id].includes(req.user!.id);
    if (involved && req.user!.role !== "admin") throw forbidden("You cannot approve a swap you are part of");

    if (input.status === "Approved") {
      // Make sure nobody changed these shifts since the request was made.
      const [mine, theirs] = [await shiftOf(swap.requester_id, swap.duty_date, conn), await shiftOf(swap.target_id, swap.duty_date, conn)];
      if (mine !== swap.requester_shift || theirs !== swap.target_shift) {
        throw conflict("The roster changed after this request was made. Reject it and ask for a new request.");
      }
      await applyChanges(conn, [
        { employeeId: swap.requester_id, dutyDate: swap.duty_date, shiftCode: swap.target_shift },
        { employeeId: swap.target_id, dutyDate: swap.duty_date, shiftCode: swap.requester_shift },
      ], req.user!.id);
    }
    await execute(
      "UPDATE shift_swaps SET status = ?, manager_note = ?, decided_by = ?, decided_at = NOW() WHERE id = ?",
      [input.status, input.managerNote ?? null, req.user!.id, swap.id],
      conn,
    );
  });
  await audit(req, { action: `swap.${input.status.toLowerCase()}`, entity: "shift_swap", entityId: Number(req.params.id) });
  res.json({ ok: true });
});
