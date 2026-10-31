import { describe, expect, it } from "vitest";
import { addDaysKey, dayCoverage, employeeIssues, restHoursBetween, shiftHours, summarise, type LeaveSpan } from "../shared/roster";

const days = (start: string, count: number) => Array.from({ length: count }, (_, i) => addDaysKey(start, i));

describe("shift maths", () => {
  it("computes shift length", () => {
    expect(shiftHours("1")).toBe(8);
    expect(shiftHours("1A")).toBe(8.5);
    expect(shiftHours("WO")).toBe(0);
    expect(shiftHours(undefined)).toBe(0);
  });
  it("computes rest between consecutive days", () => {
    expect(restHoursBetween("2", "1")).toBe(8.5); // 21:30 → 06:00
    expect(restHoursBetween("1", "2")).toBe(23.5);
    expect(restHoursBetween("WO", "1")).toBeNull();
  });
});

describe("employee issues", () => {
  it("flags short rest after a late shift", () => {
    const shifts = new Map([["2026-11-02", "2"], ["2026-11-03", "1"]]);
    const issues = employeeIssues(1, shifts, ["2026-11-03"], []);
    expect(issues.get("2026-11-03")?.[0].type).toBe("rest");
  });

  it("flags more than six working days in a row, using days before the month", () => {
    const dates = days("2026-10-27", 9); // Oct 27 → Nov 4
    const shifts = new Map(dates.map((d) => [d, "1"]));
    const issues = employeeIssues(1, shifts, days("2026-11-01", 4), []);
    expect(issues.get("2026-11-01")).toBeUndefined(); // 6th day
    expect(issues.get("2026-11-02")?.[0].type).toBe("consecutive"); // 7th day
  });

  it("resets the streak after a weekly off", () => {
    const shifts = new Map(days("2026-11-01", 10).map((d, i) => [d, i === 5 ? "WO" : "1"]));
    const issues = employeeIssues(1, shifts, days("2026-11-01", 10), []);
    expect([...issues.values()].flat().filter((i) => i.type === "consecutive")).toHaveLength(0);
  });

  it("warns about working on approved leave and notes pending leave", () => {
    const leaves: LeaveSpan[] = [
      { employeeId: 1, startDate: "2026-11-05", endDate: "2026-11-06", status: "Approved", leaveType: "Annual leave" },
      { employeeId: 1, startDate: "2026-11-09", endDate: "2026-11-09", status: "Pending", leaveType: "Annual leave" },
      { employeeId: 2, startDate: "2026-11-10", endDate: "2026-11-10", status: "Approved", leaveType: "Annual leave" },
    ];
    const shifts = new Map([["2026-11-05", "1"], ["2026-11-06", "AL"], ["2026-11-09", "1"], ["2026-11-10", "1"]]);
    const issues = employeeIssues(1, shifts, ["2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10"], leaves);
    expect(issues.get("2026-11-05")?.[0]).toMatchObject({ type: "leave-conflict", severity: "warning" });
    expect(issues.get("2026-11-06")).toBeUndefined();
    expect(issues.get("2026-11-09")?.[0]).toMatchObject({ type: "pending-leave", severity: "info" });
    expect(issues.get("2026-11-10")).toBeUndefined(); // someone else's leave
  });
});

describe("coverage and summaries", () => {
  it("counts working staff and flags short days with weekday/weekend minimums", () => {
    const weekday = dayCoverage("2026-11-02", ["1", "1", "2", "WO", undefined], 4, 2); // Monday
    expect(weekday).toMatchObject({ working: 3, required: 4, short: true, byShift: { "1": 2, "2": 1 } });
    const weekend = dayCoverage("2026-11-01", ["1", "2"], 4, 2); // Sunday
    expect(weekend.short).toBe(false);
  });
  it("summarises an employee's month", () => {
    expect(summarise(["1", "1A", "WO", "AL", undefined])).toEqual({ workDays: 2, hours: 16.5, off: 1, leave: 1, unplanned: 1 });
  });
});
