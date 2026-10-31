import type { Account, AttendanceStatus, ErrorStatus, LeaveStatus, LeaveType, Role, Severity, SwapStatus, PunchDirection } from "@shared/constants";
import type { LeaveSpan } from "@shared/roster";

// Date-time values arrive from the API as ISO strings; DATE values as "YYYY-MM-DD".

export type User = {
  id: number;
  employeeCode: string;
  name: string;
  email: string | null;
  team: string;
  role: Role;
  mustChangePassword: boolean;
};

export type EmployeeSummary = { id: number; employeeCode: string; name: string; team: string; biometricId?: string | null };

export type Employee = EmployeeSummary & {
  biometricId: string | null;
  email: string | null;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  isLocked: boolean;
  createdAt: string;
};

export type DailyReport = {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  reportDate: string;
  account: Account;
  shiftCode: string;
  edrDrt: number;
  edrPmt: number;
  manDrt: number;
  manPmt: number;
  delayMinutes: number;
  extendedMinutes: number;
  notes: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ErrorReport = {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  reportedByName: string | null;
  reportDate: string;
  account: Account;
  errorType: string;
  reference: string | null;
  description: string;
  severity: Severity;
  status: ErrorStatus;
  correctiveAction: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

export type LeaveRequest = {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  managerNote: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

export type RosterEntry = { employeeId: number; dutyDate: string; shiftCode: string };

export type AdhocSession = {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  task: string;
  startTime: string;
  endTime: string | null;
  notes: string | null;
};
export type AdhocResponse = { sessions: AdhocSession[]; active: AdhocSession[]; serverTime: string };

export type AttendanceMatch = {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  biometricId: string | null;
  workDate: string;
  rosterShift: string | null;
  punchCount: number;
  workedMinutes: number | null;
  lateMinutes: number | null;
  earlyMinutes: number | null;
  remarks: string | null;
  systemStart: string | null;
  systemEnd: string | null;
  biometricStart: string | null;
  biometricEnd: string | null;
  varianceMinutes: number | null;
  status: AttendanceStatus;
  matchedAt: string;
};

export type PunchRecord = {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  punchTime: string;
  direction: PunchDirection;
  deviceId: string;
  deviceName: string | null;
  source: "device" | "csv" | "manual";
  note: string | null;
};

export type Dashboard = {
  scope: "team" | "personal";
  today: string;
  myShiftToday: string | null;
  rosterPublished: boolean;
  todayCoverage: { code: string; kind: "work" | "off" | "leave"; timing: string; people: { id: number; name: string }[] }[];
  stats: {
    employees: number;
    reportsToday: number;
    openErrors: number;
    pendingLeave: number;
    activeSessions: number;
    adhocHoursMonth: number;
    attendanceIssues: number;
  };
  production: { account: Account; drt: number; pmt: number }[];
  trend: { date: string; total: number }[];
  recentReports: { id: number; reportDate: string; account: string; shiftCode: string; drt: number; pmt: number; employeeName: string; employeeCode: string }[];
  recentErrors: { id: number; errorType: string; description: string; status: ErrorStatus; severity: Severity; employeeName: string }[];
};

export type AuditLog = {
  id: number;
  action: string;
  entity: string | null;
  entityId: number | null;
  details: string | null;
  ipAddress: string | null;
  createdAt: string;
  actorName: string | null;
  actorCode: string | null;
};

export type RosterMonth = {
  month: string;
  status: "draft" | "published";
  minStaffWeekday: number;
  minStaffWeekend: number;
  publishedAt: string | null;
  publishedByName: string | null;
  /** Includes the 6 days before the month (for consecutive-day checks). */
  entries: RosterEntry[];
  leaves: LeaveSpan[];
  /** True when a staff member asks for a month that is not published yet. */
  hidden: boolean;
};

export type ShiftSwap = {
  id: number;
  dutyDate: string;
  requesterId: number;
  requesterName: string;
  requesterCode: string;
  targetId: number;
  targetName: string;
  targetCode: string;
  requesterShift: string;
  targetShift: string;
  reason: string | null;
  status: SwapStatus;
  managerNote: string | null;
  decidedByName: string | null;
  createdAt: string;
};

export type DeviceSetup = { serverAddresses: string[]; autoSyncMinutes: number; allowList: string };

export type BiometricDevice = {
  id: number;
  name: string;
  ipAddress: string;
  port: number;
  commKey: number;
  location: string | null;
  serialNumber: string | null;
  isActive: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: "OK" | "FAILED" | null;
  lastSyncNote: string | null;
  userCount: number | null;
  logCount: number | null;
  logCapacity: number | null;
  lastPunchAt: string | null;
  storedPunches: number;
  punchesToday: number;
  createdAt: string;
};

export type DeviceTotals = { punches: number; punchesToday: number; users: number; unlinkedUsers: number };

export type DeviceTestResult = {
  info: { userCount: number; logCount: number; logCapacity: number; deviceTime: string | null };
  clockDriftMinutes: number | null;
};

export type SyncResult = {
  devices: { deviceId: number; name: string; ok: boolean; error?: string; users?: number; punchesOnDevice?: number; newPunches: number; seconds?: number; clockDriftMinutes?: number | null }[];
  autoLinked: { pin: string; employeeCode: string; employeeName: string }[];
  converted: number;
  days: number;
  unlinkedUsers: number;
};

export type ImportResult = {
  format: string;
  read: number;
  unreadableLines: number;
  newPunches: number;
  duplicates: number;
  autoLinked: { pin: string; employeeCode: string; employeeName: string }[];
  converted: number;
  days: number;
};

export type MachineUser = {
  pin: string;
  machineName: string | null;
  cardNo: string | null;
  deviceName: string | null;
  employeeId: number | null;
  employeeCode: string | null;
  employeeName: string | null;
  punches: number;
  lastPunchAt: string | null;
};

export type BiometricLog = {
  id: number;
  pin: string;
  punchTime: string;
  source: "device" | "file";
  deviceName: string;
  employeeId: number | null;
  employeeName: string | null;
  employeeCode: string | null;
  machineUserName: string | null;
};
