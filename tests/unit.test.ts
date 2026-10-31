import { describe, expect, it } from "vitest";
import { passwordProblems } from "../shared/constants";
import { addDays, eachDate, nextMonthStart, parsePunchTime } from "../server/utils/dates";

describe("password policy", () => {
  it("rejects weak passwords", () => {
    expect(passwordProblems("short")).not.toHaveLength(0);
    expect(passwordProblems("alllowercase1!")).toContain("Add an uppercase letter");
    expect(passwordProblems("NoNumbersHere!")).toContain("Add a number");
    expect(passwordProblems("NoSymbols123A")).toContain("Add a symbol");
  });
  it("accepts strong passwords", () => {
    expect(passwordProblems("Str0ng!Passw0rd")).toEqual([]);
  });
});

describe("date helpers", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("finds next month start", () => {
    expect(nextMonthStart("2026-12")).toBe("2027-01-01");
    expect(nextMonthStart("2026-02")).toBe("2026-03-01");
  });
  it("lists inclusive date ranges", () => {
    expect(eachDate("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });
  it("parses local and ISO punch times", () => {
    expect(parsePunchTime("2026-10-28 06:05")).toEqual(new Date(2026, 9, 28, 6, 5));
    expect(parsePunchTime("2026-10-28T06:05:00Z")?.toISOString()).toBe("2026-10-28T06:05:00.000Z");
    expect(parsePunchTime("not a date")).toBeNull();
  });
});
