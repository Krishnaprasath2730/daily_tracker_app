// Values shared by the Express server and the React client.
// Keep this file free of Node or browser-only imports.
import { SHIFT_DEFS } from "./roster";

export const ACCOUNTS = [
  "GAI AIR IMPORT",
  "GAI AIR EXPORT",
  "GAI AIR OCEAN",
  "APEX",
  "LOGWIN OCEAN EXPORT",
  "LOGWIN AIR EXPORT",
  "BOLLORE AIR",
  "BOLLORE SEA",
] as const;
export type Account = (typeof ACCOUNTS)[number];

/** Shift code → timing (or label for off/leave). Defined in shared/roster.ts. */
export const SHIFTS: Record<string, string> = Object.fromEntries(
  SHIFT_DEFS.map((def) => [def.code, def.start ? `${def.start}–${def.end}` : def.label]),
);
export const SHIFT_CODES = SHIFT_DEFS.map((def) => def.code);
/** Shift codes that represent a working shift (not off / leave). */
export const WORK_SHIFT_CODES = SHIFT_DEFS.filter((def) => def.kind === "work").map((def) => def.code);

export const SWAP_STATUSES = ["Pending", "Accepted", "Approved", "Declined", "Rejected", "Cancelled"] as const;
export type SwapStatus = (typeof SWAP_STATUSES)[number];

export const ROLES = ["admin", "manager", "employee"] as const;
export type Role = (typeof ROLES)[number];

export const ERROR_TYPES = ["Documentation", "Data entry", "Process delay", "System issue", "Compliance", "Other"] as const;
export const SEVERITIES = ["Low", "Medium", "High", "Critical"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const ERROR_STATUSES = ["Open", "In review", "Resolved"] as const;
export type ErrorStatus = (typeof ERROR_STATUSES)[number];

export const LEAVE_TYPES = ["Annual leave", "Emergency leave"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];
export const LEAVE_STATUSES = ["Pending", "Approved", "Rejected", "Cancelled"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const ATTENDANCE_STATUSES = ["Matched", "Review", "Missing", "Absent", "On duty"] as const;
/** After shift end, how long to wait for the OUT punch before calling it missing. */
export const OUT_PUNCH_WAIT_MINUTES = 120;
/** Minutes after shift start before a punch counts as late (and before shift end for early leaving). */
export const LATE_GRACE_MINUTES = 10;
export const EARLY_GRACE_MINUTES = 10;
export const PUNCH_DIRECTIONS = ["IN", "OUT", "AUTO"] as const;
export type PunchDirection = (typeof PUNCH_DIRECTIONS)[number];
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
/** Variance (minutes) allowed between system time and biometric time before a record is flagged. */
export const ATTENDANCE_TOLERANCE_MINUTES = 5;

export const PASSWORD_RULES = {
  minLength: 10,
  maxLength: 128,
  description: "At least 10 characters with an uppercase letter, a lowercase letter, a number and a symbol.",
};

/** Returns a list of problems; an empty list means the password is acceptable. */
export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_RULES.minLength) problems.push(`Use at least ${PASSWORD_RULES.minLength} characters`);
  if (password.length > PASSWORD_RULES.maxLength) problems.push(`Use at most ${PASSWORD_RULES.maxLength} characters`);
  if (!/[a-z]/.test(password)) problems.push("Add a lowercase letter");
  if (!/[A-Z]/.test(password)) problems.push("Add an uppercase letter");
  if (!/[0-9]/.test(password)) problems.push("Add a number");
  if (!/[^A-Za-z0-9]/.test(password)) problems.push("Add a symbol");
  return problems;
}
