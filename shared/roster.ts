// Shift definitions and roster rules shared by the API and the React client.

export type ShiftKind = "work" | "off" | "leave";

export type ShiftDef = {
  code: string;
  label: string;
  kind: ShiftKind;
  /** "HH:mm" — only for working shifts */
  start?: string;
  end?: string;
  /** Tailwind-friendly colours for the grid cell */
  bg: string;
  fg: string;
};

export const SHIFT_DEFS: ShiftDef[] = [
  { code: "1", label: "Morning", kind: "work", start: "06:00", end: "14:00", bg: "#e8f1ff", fg: "#0053bf" },
  { code: "1A", label: "Day", kind: "work", start: "09:00", end: "17:30", bg: "#e6f6ff", fg: "#026aa2" },
  { code: "1B", label: "Mid-day", kind: "work", start: "11:00", end: "19:30", bg: "#eef4ff", fg: "#3538cd" },
  { code: "1C", label: "Early day", kind: "work", start: "08:00", end: "16:00", bg: "#e6f6ff", fg: "#026aa2" },
  { code: "1D", label: "Late day", kind: "work", start: "10:00", end: "18:30", bg: "#eef4ff", fg: "#3538cd" },
  { code: "2", label: "Evening", kind: "work", start: "13:30", end: "21:30", bg: "#f4ebff", fg: "#6941c6" },
  { code: "A", label: "Half · early", kind: "work", start: "06:00", end: "12:00", bg: "#ecfdf3", fg: "#067647" },
  { code: "B", label: "Half · mid", kind: "work", start: "11:30", end: "17:30", bg: "#ecfdf3", fg: "#067647" },
  { code: "C", label: "Half · late", kind: "work", start: "15:30", end: "21:30", bg: "#fdf2fa", fg: "#c11574" },
  { code: "D", label: "Half · day", kind: "work", start: "09:00", end: "15:00", bg: "#ecfdf3", fg: "#067647" },
  { code: "E", label: "Half · evening", kind: "work", start: "15:30", end: "21:30", bg: "#fdf2fa", fg: "#c11574" },
  { code: "WO", label: "Weekly off", kind: "off", bg: "#f2f4f7", fg: "#667085" },
  { code: "AL", label: "Annual leave", kind: "leave", bg: "#fff6e0", fg: "#946200" },
  { code: "EL", label: "Emergency leave", kind: "leave", bg: "#fff0e6", fg: "#b54708" },
];

export const SHIFT_BY_CODE = new Map(SHIFT_DEFS.map((def) => [def.code, def]));

/** Rest hours required between the end of one shift and the start of the next. */
export const MIN_REST_HOURS = 11;
/** Maximum working days in a row before a weekly off is required. */
export const MAX_CONSECUTIVE_DAYS = 6;
export const DEFAULT_MIN_STAFF_WEEKDAY = 5;
export const DEFAULT_MIN_STAFF_WEEKEND = 2;

const toMinutes = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

export const isWorkShift = (code: string | undefined) => SHIFT_BY_CODE.get(code ?? "")?.kind === "work";

/** Length of a shift in hours (0 for off / leave). */
export function shiftHours(code: string | undefined): number {
  const def = SHIFT_BY_CODE.get(code ?? "");
  if (!def?.start || !def.end) return 0;
  return (toMinutes(def.end) - toMinutes(def.start)) / 60;
}

/** Hours of rest between a shift on one day and a shift on the next day. */
export function restHoursBetween(today: string, tomorrow: string): number | null {
  const a = SHIFT_BY_CODE.get(today);
  const b = SHIFT_BY_CODE.get(tomorrow);
  if (!a?.end || !b?.start) return null;
  return (24 * 60 - toMinutes(a.end) + toMinutes(b.start)) / 60;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const addDaysKey = (dateKey: string, days: number) => {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};
export const isWeekend = (dateKey: string) => {
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
};

export type RosterIssueType = "rest" | "consecutive" | "leave-conflict" | "pending-leave";
export type RosterIssue = { type: RosterIssueType; severity: "warning" | "info"; message: string };

export type LeaveSpan = { employeeId: number; startDate: string; endDate: string; status: "Approved" | "Pending"; leaveType: string };

/**
 * Check one employee's shifts. `shifts` maps date → code and may include days
 * before the visible month so consecutive-day counting is correct.
 */
export function employeeIssues(
  employeeId: number,
  shifts: Map<string, string>,
  dates: string[],
  leaves: LeaveSpan[],
): Map<string, RosterIssue[]> {
  const issues = new Map<string, RosterIssue[]>();
  const add = (date: string, issue: RosterIssue) => issues.set(date, [...(issues.get(date) ?? []), issue]);
  const myLeaves = leaves.filter((l) => l.employeeId === employeeId);

  for (const date of dates) {
    const code = shifts.get(date);

    // Rest gap from the previous day's shift.
    const previous = shifts.get(addDaysKey(date, -1));
    if (code && previous) {
      const rest = restHoursBetween(previous, code);
      if (rest !== null && rest < MIN_REST_HOURS) {
        add(date, { type: "rest", severity: "warning", message: `Only ${rest} h rest after shift ${previous} the day before (minimum ${MIN_REST_HOURS} h)` });
      }
    }

    // Too many working days in a row.
    if (isWorkShift(code)) {
      let streak = 0;
      for (let back = 0; back < 31 && isWorkShift(shifts.get(addDaysKey(date, -back))); back += 1) streak += 1;
      if (streak > MAX_CONSECUTIVE_DAYS) {
        add(date, { type: "consecutive", severity: "warning", message: `${streak} working days in a row without a weekly off (max ${MAX_CONSECUTIVE_DAYS})` });
      }
    }

    // Working while on leave.
    const leave = myLeaves.find((l) => l.startDate <= date && l.endDate >= date);
    if (leave && isWorkShift(code)) {
      add(date, leave.status === "Approved"
        ? { type: "leave-conflict", severity: "warning", message: `Has approved ${leave.leaveType.toLowerCase()} on this date` }
        : { type: "pending-leave", severity: "info", message: `Has a pending ${leave.leaveType.toLowerCase()} request` });
    }
  }
  return issues;
}

export type DayCoverage = { date: string; working: number; byShift: Record<string, number>; required: number; short: boolean };

export function dayCoverage(
  date: string,
  codes: (string | undefined)[],
  minWeekday = DEFAULT_MIN_STAFF_WEEKDAY,
  minWeekend = DEFAULT_MIN_STAFF_WEEKEND,
): DayCoverage {
  const byShift: Record<string, number> = {};
  let working = 0;
  for (const code of codes) {
    if (!isWorkShift(code)) continue;
    working += 1;
    byShift[code!] = (byShift[code!] ?? 0) + 1;
  }
  const required = isWeekend(date) ? minWeekend : minWeekday;
  return { date, working, byShift, required, short: working < required };
}

export type EmployeeSummary = { workDays: number; hours: number; off: number; leave: number; unplanned: number };

export function summarise(codes: (string | undefined)[]): EmployeeSummary {
  const summary: EmployeeSummary = { workDays: 0, hours: 0, off: 0, leave: 0, unplanned: 0 };
  for (const code of codes) {
    const kind = SHIFT_BY_CODE.get(code ?? "")?.kind;
    if (kind === "work") {
      summary.workDays += 1;
      summary.hours += shiftHours(code);
    } else if (kind === "off") summary.off += 1;
    else if (kind === "leave") summary.leave += 1;
    else summary.unplanned += 1;
  }
  return summary;
}
