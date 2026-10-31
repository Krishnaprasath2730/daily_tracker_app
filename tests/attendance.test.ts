import { describe, expect, it } from "vitest";
import { matchAttendance, type MatchInput } from "../server/services/attendance";

const DAY = "2026-10-28";
const at = (h: number, m = 0) => new Date(2026, 9, 28, h, m);
const IN = (h: number, m = 0) => ({ punchTime: at(h, m), direction: "IN" as const });
const OUT = (h: number, m = 0) => ({ punchTime: at(h, m), direction: "OUT" as const });
const AUTO = (h: number, m = 0) => ({ punchTime: at(h, m), direction: "AUTO" as const });
// Judge as if it is the next morning unless a test says otherwise.
const NEXT_DAY = new Date(2026, 9, 29, 8, 0);
const match = (input: MatchInput) => {
  const result = matchAttendance({ now: NEXT_DAY, ...input });
  if (!result) throw new Error("expected a result");
  return result;
};

describe("attendance matching against the roster", () => {
  it("matches an on-time day", () => {
    const r = match({ workDate: DAY, rosterShift: "1", sessions: [], punches: [IN(5, 55), OUT(14, 5)] });
    expect(r).toMatchObject({ status: "Matched", lateMinutes: 0, earlyMinutes: 0, workedMinutes: 490, punchCount: 2, remarks: null });
  });

  it("flags late arrival beyond the grace period", () => {
    const r = match({ workDate: DAY, rosterShift: "1", sessions: [], punches: [IN(6, 25), OUT(14, 0)] });
    expect(r.status).toBe("Review");
    expect(r.lateMinutes).toBe(25);
    expect(r.remarks).toContain("Late by 25 min");
  });

  it("allows a few minutes within grace", () => {
    expect(match({ workDate: DAY, rosterShift: "1", sessions: [], punches: [IN(6, 8), OUT(14, 0)] }).status).toBe("Matched");
  });

  it("flags leaving early", () => {
    const r = match({ workDate: DAY, rosterShift: "1A", sessions: [], punches: [IN(9), OUT(16, 30)] });
    expect(r.earlyMinutes).toBe(60);
    expect(r.remarks).toContain("Left 60 min early");
  });

  it("marks absent when rostered to work with no punches", () => {
    const r = match({ workDate: DAY, rosterShift: "2", sessions: [], punches: [] });
    expect(r.status).toBe("Absent");
  });

  it("marks missing when there is only one punch", () => {
    const r = match({ workDate: DAY, rosterShift: "1", sessions: [], punches: [IN(6)] });
    expect(r.status).toBe("Missing");
    expect(r.biometricEnd).toBeNull();
  });

  it("uses first and last punch when the machine has no in/out keys", () => {
    const r = match({ workDate: DAY, rosterShift: "1", sessions: [], punches: [AUTO(5, 58), AUTO(10, 0), AUTO(14, 3)] });
    expect(r.biometricStart).toEqual(at(5, 58));
    expect(r.biometricEnd).toEqual(at(14, 3));
    expect(r.status).toBe("Matched");
  });

  it("notes punches on a weekly off", () => {
    const r = match({ workDate: DAY, rosterShift: "WO", sessions: [], punches: [IN(9), OUT(13)] });
    expect(r.status).toBe("Review");
    expect(r.remarks).toContain("weekly off");
  });

  it("compares ad-hoc system times when sessions exist", () => {
    const ok = match({ workDate: DAY, rosterShift: null, sessions: [{ startTime: at(11), endTime: at(19) }], punches: [IN(11, 3), OUT(19, 2)] });
    expect(ok).toMatchObject({ status: "Matched", varianceMinutes: 3 });
    const off = match({ workDate: DAY, rosterShift: null, sessions: [{ startTime: at(11), endTime: at(19) }], punches: [IN(11, 22), OUT(19, 4)] });
    expect(off.status).toBe("Review");
    expect(off.varianceMinutes).toBe(22);
  });

  it("reports ad-hoc work without any punch as missing", () => {
    expect(match({ workDate: DAY, rosterShift: null, sessions: [{ startTime: at(9), endTime: at(12) }], punches: [] }).status).toBe("Missing");
  });

  it("shows someone still at work as on duty instead of missing the OUT punch", () => {
    const r = match({ workDate: DAY, rosterShift: "1", sessions: [], punches: [IN(6, 2)], now: at(11) });
    expect(r.status).toBe("On duty");
    expect(r.remarks).toBeNull();
  });

  it("calls the OUT punch missing once the shift is well over", () => {
    expect(match({ workDate: DAY, rosterShift: "1", sessions: [], punches: [IN(6, 2)], now: at(17) }).status).toBe("Missing");
  });

  it("does not mark absent before the shift has started", () => {
    expect(matchAttendance({ workDate: DAY, rosterShift: "2", sessions: [], punches: [], now: at(12) })).toBeNull();
    expect(match({ workDate: DAY, rosterShift: "2", sessions: [], punches: [], now: at(13, 45) }).status).toBe("Absent");
  });
});
