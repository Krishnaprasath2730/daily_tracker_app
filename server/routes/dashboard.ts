import { Router } from "express";
import { ACCOUNTS } from "../../shared/constants";
import { SHIFT_DEFS } from "../../shared/roster";
import { query, queryOne } from "../db/pool";
import { isManager } from "../middleware/auth";
import { addDays, localDateKey } from "../utils/dates";

export const dashboardRouter = Router();

/** Team-wide figures for managers, personal figures for employees. */
dashboardRouter.get("/", async (req, res) => {
  const manager = isManager(req);
  const userId = req.user!.id;
  const today = localDateKey();
  const monthStart = `${today.slice(0, 7)}-01`;
  const trendStart = addDays(today, -13);
  // Scope filter for employee-owned tables. Values are bound, never concatenated.
  const scope = (alias: string) => (manager ? "" : ` AND ${alias}.employee_id = ?`);
  const scoped = (params: (string | number)[]) => (manager ? params : [...params, userId]);

  const monthRow = await queryOne<{ status: string }>("SELECT status FROM roster_months WHERE month = ?", [today.slice(0, 7)]);
  const rosterVisible = manager || monthRow?.status === "published";

  const [counts, production, trend, recentReports, recentErrors, todayShift, todayRoster] = await Promise.all([
    queryOne<Record<string, number>>(
      `SELECT
         (SELECT COUNT(*) FROM employees WHERE is_active = 1) AS employees,
         (SELECT COUNT(*) FROM daily_reports r WHERE r.report_date = ?${scope("r")}) AS reportsToday,
         (SELECT COUNT(*) FROM error_reports x WHERE x.status <> 'Resolved'${scope("x")}) AS openErrors,
         (SELECT COUNT(*) FROM leave_requests l WHERE l.status = 'Pending'${scope("l")}) AS pendingLeave,
         (SELECT COUNT(*) FROM adhoc_sessions s WHERE s.end_time IS NULL${scope("s")}) AS activeSessions,
         (SELECT COALESCE(SUM(TIMESTAMPDIFF(MINUTE, s.start_time, s.end_time)), 0) FROM adhoc_sessions s
            WHERE s.end_time IS NOT NULL AND s.start_time >= ?${scope("s")}) AS adhocMinutesMonth,
         (SELECT COUNT(*) FROM attendance_matches m WHERE m.status <> 'Matched' AND m.work_date >= ?${scope("m")}) AS attendanceIssues`,
      [
        ...scoped([today]),
        ...scoped([]),
        ...scoped([]),
        ...scoped([]),
        ...scoped([monthStart]),
        ...scoped([addDays(today, -7)]),
      ],
    ),
    query<{ account: string; drt: number; pmt: number }>(
      `SELECT r.account, SUM(r.edr_drt + r.man_drt) AS drt, SUM(r.edr_pmt + r.man_pmt) AS pmt
         FROM daily_reports r WHERE r.report_date >= ?${scope("r")} GROUP BY r.account`,
      scoped([monthStart]),
    ),
    query<{ date: string; total: number }>(
      `SELECT DATE_FORMAT(r.report_date, '%Y-%m-%d') AS date, SUM(r.edr_drt + r.edr_pmt + r.man_drt + r.man_pmt) AS total
         FROM daily_reports r WHERE r.report_date >= ?${scope("r")} GROUP BY r.report_date ORDER BY r.report_date`,
      scoped([trendStart]),
    ),
    query(
      `SELECT r.id, r.report_date AS reportDate, r.account, r.shift_code AS shiftCode,
              r.edr_drt + r.man_drt AS drt, r.edr_pmt + r.man_pmt AS pmt, e.name AS employeeName, e.employee_code AS employeeCode
         FROM daily_reports r JOIN employees e ON e.id = r.employee_id
        WHERE 1 = 1${scope("r")} ORDER BY r.report_date DESC, r.id DESC LIMIT 6`,
      scoped([]),
    ),
    query(
      `SELECT x.id, x.error_type AS errorType, x.description, x.status, x.severity, e.name AS employeeName
         FROM error_reports x JOIN employees e ON e.id = x.employee_id
        WHERE 1 = 1${scope("x")} ORDER BY x.report_date DESC, x.id DESC LIMIT 5`,
      scoped([]),
    ),
    queryOne<{ shiftCode: string }>(
      "SELECT shift_code AS shiftCode FROM roster_entries WHERE employee_id = ? AND duty_date = ?",
      [userId, today],
    ),
    rosterVisible
      ? query<{ shiftCode: string; name: string; employeeId: number }>(
          `SELECT r.shift_code AS shiftCode, e.name, e.id AS employeeId FROM roster_entries r
             JOIN employees e ON e.id = r.employee_id AND e.is_active = 1
            WHERE r.duty_date = ? ORDER BY r.shift_code, e.name`,
          [today],
        )
      : Promise.resolve([]),
  ]);

  // Group today's roster by shift code, in the order shifts are defined.
  const todayCoverage = SHIFT_DEFS.map((def) => ({
    code: def.code,
    kind: def.kind,
    timing: def.start ? `${def.start}–${def.end}` : def.label,
    people: todayRoster.filter((row) => row.shiftCode === def.code).map((row) => ({ id: row.employeeId, name: row.name })),
  })).filter((group) => group.people.length);

  const byAccount = new Map(production.map((row) => [row.account, row]));
  const trendByDate = new Map(trend.map((row) => [row.date, Number(row.total)]));
  res.json({
    scope: manager ? "team" : "personal",
    today,
    myShiftToday: rosterVisible ? (todayShift?.shiftCode ?? null) : null,
    rosterPublished: monthRow?.status === "published",
    todayCoverage,
    stats: {
      employees: Number(counts?.employees ?? 0),
      reportsToday: Number(counts?.reportsToday ?? 0),
      openErrors: Number(counts?.openErrors ?? 0),
      pendingLeave: Number(counts?.pendingLeave ?? 0),
      activeSessions: Number(counts?.activeSessions ?? 0),
      adhocHoursMonth: Math.round((Number(counts?.adhocMinutesMonth ?? 0) / 60) * 10) / 10,
      attendanceIssues: Number(counts?.attendanceIssues ?? 0),
    },
    production: ACCOUNTS.map((account) => ({
      account,
      drt: Number(byAccount.get(account)?.drt ?? 0),
      pmt: Number(byAccount.get(account)?.pmt ?? 0),
    })),
    trend: Array.from({ length: 14 }, (_, index) => {
      const date = addDays(trendStart, index);
      return { date, total: trendByDate.get(date) ?? 0 };
    }),
    recentReports,
    recentErrors,
  });
});
