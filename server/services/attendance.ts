import { ATTENDANCE_TOLERANCE_MINUTES, EARLY_GRACE_MINUTES, LATE_GRACE_MINUTES, OUT_PUNCH_WAIT_MINUTES, type AttendanceStatus, type PunchDirection } from "../../shared/constants";
import { SHIFT_BY_CODE } from "../../shared/roster";
import { execute, query, transaction } from "../db/pool";
import { addDays } from "../utils/dates";
import { logger } from "../utils/logger";

export type MatchInput = {
  workDate: string;
  rosterShift?: string | null;
  sessions: { startTime: Date; endTime: Date | null }[];
  punches: { punchTime: Date; direction: PunchDirection }[];
  /** Current time; lets "today" show people as on duty instead of missing. */
  now?: Date;
};

export type MatchResult = {
  rosterShift: string | null;
  systemStart: Date | null;
  systemEnd: Date | null;
  biometricStart: Date | null;
  biometricEnd: Date | null;
  punchCount: number;
  workedMinutes: number | null;
  lateMinutes: number | null;
  earlyMinutes: number | null;
  varianceMinutes: number | null;
  status: AttendanceStatus;
  remarks: string | null;
};

const minOf = (dates: Date[]) => (dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null);
const maxOf = (dates: Date[]) => (dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null);
const minutes = (ms: number) => Math.round(ms / 60000);

/** Local date-time for "HH:mm" on a YYYY-MM-DD day (server time zone, same as the machine). */
function at(workDate: string, time: string) {
  const [y, m, d] = workDate.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  return new Date(y, m - 1, d, h, min);
}

/**
 * One employee, one day. Compares:
 *  - biometric first IN / last OUT with the rostered shift (late, early leaving, absent), and
 *  - biometric times with ad-hoc system times when ad-hoc sessions exist.
 * Punches marked AUTO (machine had no in/out key) count as both possible IN and OUT.
 * Returns null when there is nothing to judge yet (shift has not started).
 */
export function matchAttendance({ workDate, rosterShift, sessions, punches, now = new Date() }: MatchInput): MatchResult | null {
  const shift = rosterShift ? SHIFT_BY_CODE.get(rosterShift) : undefined;
  const working = shift?.kind === "work" && shift.start && shift.end ? shift : undefined;
  const shiftStart = working ? at(workDate, working.start!) : null;
  const shiftEnd = working ? at(workDate, working.end!) : null;
  const isToday = at(workDate, "00:00").toDateString() === now.toDateString();

  const systemStart = minOf(sessions.map((s) => s.startTime));
  const systemEnd = maxOf(sessions.flatMap((s) => (s.endTime ? [s.endTime] : [])));

  const all = punches.map((p) => p.punchTime);
  const starts = punches.filter((p) => p.direction !== "OUT").map((p) => p.punchTime);
  const ends = punches.filter((p) => p.direction !== "IN").map((p) => p.punchTime);
  const biometricStart = minOf(starts.length ? starts : all);
  let biometricEnd = maxOf(ends.length ? ends : all);
  if (biometricStart && biometricEnd && biometricEnd.getTime() - biometricStart.getTime() < 60_000) biometricEnd = null;

  const workedMinutes = biometricStart && biometricEnd ? minutes(biometricEnd.getTime() - biometricStart.getTime()) : null;

  let lateMinutes: number | null = null;
  let earlyMinutes: number | null = null;
  if (shiftStart && shiftEnd) {
    if (biometricStart) lateMinutes = Math.max(0, minutes(biometricStart.getTime() - shiftStart.getTime()));
    if (biometricEnd) earlyMinutes = Math.max(0, minutes(shiftEnd.getTime() - biometricEnd.getTime()));
  }

  const differences: number[] = [];
  if (systemStart && biometricStart) differences.push(Math.abs(systemStart.getTime() - biometricStart.getTime()) / 60000);
  if (systemEnd && biometricEnd) differences.push(Math.abs(systemEnd.getTime() - biometricEnd.getTime()) / 60000);
  const varianceMinutes = differences.length ? Math.round(Math.max(...differences)) : null;

  const reasons: string[] = [];
  let status: AttendanceStatus;

  if (!punches.length) {
    // Shift has not started (plus grace) yet: nothing to report.
    if (shiftStart && now.getTime() < shiftStart.getTime() + LATE_GRACE_MINUTES * 60_000 && !sessions.length) return null;
    if (working) {
      status = "Absent";
      reasons.push(`No punch on a working day (shift ${working.code} ${working.start}–${working.end})`);
    } else {
      status = "Missing";
      reasons.push("Ad-hoc work recorded but no biometric punch");
    }
  } else {
    // Still at work: only IN so far, and the shift (plus a wait for the OUT punch) is not over.
    const stillWorking = !biometricEnd && (shiftEnd ? now.getTime() < shiftEnd.getTime() + OUT_PUNCH_WAIT_MINUTES * 60_000 : isToday);
    if (!biometricEnd && !stillWorking) reasons.push("Only one punch — OUT punch missing");
    if (lateMinutes !== null && lateMinutes > LATE_GRACE_MINUTES) reasons.push(`Late by ${lateMinutes} min`);
    if (earlyMinutes !== null && earlyMinutes > EARLY_GRACE_MINUTES) reasons.push(`Left ${earlyMinutes} min early`);
    if (shift && shift.kind !== "work") reasons.push(`Punched on a ${shift.kind === "off" ? "weekly off" : "leave"} day (${shift.code})`);
    if (sessions.some((s) => !s.endTime)) reasons.push("Ad-hoc session not ended");
    if (varianceMinutes !== null && varianceMinutes > ATTENDANCE_TOLERANCE_MINUTES) reasons.push(`Ad-hoc and biometric times differ by ${varianceMinutes} min`);
    status = stillWorking ? "On duty" : !biometricEnd ? "Missing" : reasons.length ? "Review" : "Matched";
  }

  return {
    rosterShift: rosterShift ?? null,
    systemStart,
    systemEnd,
    biometricStart,
    biometricEnd,
    punchCount: punches.length,
    workedMinutes,
    lateMinutes,
    earlyMinutes,
    varianceMinutes,
    status,
    remarks: reasons.length ? reasons.join("; ").slice(0, 500) : null,
  };
}

type SessionRow = { employeeId: number; startTime: Date; endTime: Date | null };
type PunchRow = { employeeId: number; punchTime: Date; direction: PunchDirection };
type RosterRow = { employeeId: number; shiftCode: string };

/** Reconcile every relevant employee for one date and store the results. Returns how many were processed. */
export async function runMatching(workDate: string): Promise<number> {
  const nextDay = addDays(workDate, 1);
  const [sessions, punches, roster] = await Promise.all([
    query<SessionRow>(
      "SELECT employee_id AS employeeId, start_time AS startTime, end_time AS endTime FROM adhoc_sessions WHERE start_time >= ? AND start_time < ?",
      [workDate, nextDay],
    ),
    query<PunchRow>(
      "SELECT employee_id AS employeeId, punch_time AS punchTime, direction FROM punch_records WHERE punch_time >= ? AND punch_time < ?",
      [workDate, nextDay],
    ),
    query<RosterRow>(
      `SELECT r.employee_id AS employeeId, r.shift_code AS shiftCode FROM roster_entries r
         JOIN employees e ON e.id = r.employee_id AND e.is_active = 1 WHERE r.duty_date = ?`,
      [workDate],
    ),
  ]);

  const shiftOf = new Map(roster.map((r) => [r.employeeId, r.shiftCode]));
  const workingRostered = roster.filter((r) => SHIFT_BY_CODE.get(r.shiftCode)?.kind === "work").map((r) => r.employeeId);
  const ids = new Set([...sessions.map((s) => s.employeeId), ...punches.map((p) => p.employeeId), ...workingRostered]);

  await transaction(async (conn) => {
    for (const employeeId of ids) {
      const r = matchAttendance({
        workDate,
        now: new Date(),
        rosterShift: shiftOf.get(employeeId) ?? null,
        sessions: sessions.filter((s) => s.employeeId === employeeId),
        punches: punches.filter((p) => p.employeeId === employeeId),
      });
      if (!r) {
        ids.delete(employeeId);
        continue;
      }
      await execute(
        `INSERT INTO attendance_matches (employee_id, work_date, roster_shift, system_start, system_end, biometric_start, biometric_end,
           punch_count, worked_minutes, late_minutes, early_minutes, variance_minutes, status, remarks, matched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE roster_shift = VALUES(roster_shift), system_start = VALUES(system_start), system_end = VALUES(system_end),
           biometric_start = VALUES(biometric_start), biometric_end = VALUES(biometric_end), punch_count = VALUES(punch_count),
           worked_minutes = VALUES(worked_minutes), late_minutes = VALUES(late_minutes), early_minutes = VALUES(early_minutes),
           variance_minutes = VALUES(variance_minutes), status = VALUES(status), remarks = VALUES(remarks), matched_at = NOW()`,
        [employeeId, workDate, r.rosterShift, r.systemStart, r.systemEnd, r.biometricStart, r.biometricEnd, r.punchCount,
          r.workedMinutes, r.lateMinutes, r.earlyMinutes, r.varianceMinutes, r.status, r.remarks],
        conn,
      );
    }
    // Remove results for people who no longer have anything that day (e.g. roster cleared).
    const keep = [...ids];
    await execute(
      `DELETE FROM attendance_matches WHERE work_date = ?${keep.length ? ` AND employee_id NOT IN (${keep.map(() => "?").join(",")})` : ""}`,
      [workDate, ...keep],
      conn,
    );
  });
  return ids.size;
}

// Punches often arrive one by one from the machine; coalesce re-matching per date.
const pending = new Map<string, NodeJS.Timeout>();

export function scheduleMatching(dates: Iterable<string>, delayMs = 3000) {
  for (const date of new Set(dates)) {
    clearTimeout(pending.get(date));
    pending.set(
      date,
      setTimeout(() => {
        pending.delete(date);
        runMatching(date).catch((error) => logger.error("auto matching failed", { date, error: (error as Error).message }));
      }, delayMs),
    );
  }
}
