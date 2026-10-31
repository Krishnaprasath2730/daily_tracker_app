import { beforeEach, describe, expect, it, vi } from "vitest";

// A fake eSSL/ZKTeco machine for node-zklib.
const machine = {
  failConnect: null as null | { code?: string; message?: string },
  users: [] as unknown[],
  logs: [] as unknown[],
  calls: [] as string[],
};
vi.mock("node-zklib", () => ({
  default: class FakeZK {
    constructor(public ip: string, public port: number) {
      machine.calls.push(`new ${ip}:${port}`);
    }
    async createSocket() {
      machine.calls.push("connect");
      if (machine.failConnect) throw machine.failConnect;
    }
    async getInfo() {
      return { userCounts: machine.users.length, logCounts: machine.logs.length, logCapacity: 100000 };
    }
    async getUsers() {
      return { data: machine.users };
    }
    async getAttendances() {
      return { data: machine.logs };
    }
    async disconnect() {
      machine.calls.push("disconnect");
    }
    async clearAttendanceLog() {
      machine.calls.push("CLEAR");
    }
  },
}));

const { describeDeviceError, pullDevice, testDevice } = await import("../server/services/zkDevice");
const { isAllowedDeviceAddress, parseLogDateTime, parsePunchFile } = await import("../server/services/biometric");

beforeEach(() => {
  machine.failConnect = null;
  machine.users = [];
  machine.logs = [];
  machine.calls = [];
});

describe("reading an eSSL / ZKTeco machine (TCP 4370)", () => {
  it("pulls users and punches, cleans IDs and always disconnects", async () => {
    machine.users = [
      { uid: 1, userId: "1033\u0000", name: "SURYA\u0000\u0000", cardno: 0 },
      { uid: 2, userId: "1083", name: "", cardno: 445566 },
      { uid: 3, userId: "", name: "ghost" },
    ];
    machine.logs = [
      { deviceUserId: "1033", recordTime: new Date(2026, 9, 29, 6, 1) },
      { deviceUserId: "1083", recordTime: "2026-10-29T09:27:00" },
      { deviceUserId: "1083", recordTime: new Date(1999, 0, 1) }, // wrong machine clock
      { deviceUserId: "bad id!", recordTime: new Date() },
    ];
    const result = await pullDevice({ id: 1, ipAddress: "192.168.1.201", port: 4370 });
    expect(result.users).toEqual([
      { pin: "1033", name: "SURYA", cardNo: null },
      { pin: "1083", name: null, cardNo: "445566" },
    ]);
    expect(result.punches.map((p) => p.pin)).toEqual(["1033", "1083"]);
    expect(result.info).toMatchObject({ userCount: 3, logCount: 4, logCapacity: 100000 });
    expect(machine.calls).toEqual(["new 192.168.1.201:4370", "connect", "disconnect"]);
  });

  it("never clears the machine's log", async () => {
    await pullDevice({ ipAddress: "192.168.1.201", port: 4370 });
    await testDevice({ ipAddress: "192.168.1.201", port: 4370 });
    expect(machine.calls).not.toContain("CLEAR");
  });

  it("explains connection problems in plain words", async () => {
    machine.failConnect = { code: "ECONNREFUSED" };
    await expect(testDevice({ ipAddress: "192.168.1.201", port: 4370 })).rejects.toMatchObject({ status: 502, message: expect.stringContaining("port 4370") });
    expect(machine.calls).toContain("disconnect");
    expect(describeDeviceError({ code: "EHOSTUNREACH" })).toContain("same network");
    expect(describeDeviceError({ message: "Unauthorized" })).toContain("Comm Key to 0");
  });
});

describe("machine address rules", () => {
  it("accepts office-network IPv4 addresses", () => {
    expect(isAllowedDeviceAddress("192.168.1.201", "")).toBe(true);
    expect(isAllowedDeviceAddress("10.0.0.5", "")).toBe(true);
    expect(isAllowedDeviceAddress("172.20.1.9", "")).toBe(true);
  });
  it("rejects public addresses, localhost and host names", () => {
    expect(isAllowedDeviceAddress("8.8.8.8", "")).toBe(false);
    expect(isAllowedDeviceAddress("127.0.0.1", "")).toBe(false);
    expect(isAllowedDeviceAddress("169.254.169.254", "")).toBe(false);
    expect(isAllowedDeviceAddress("device.local", "")).toBe(false);
    expect(isAllowedDeviceAddress("192.168.1.300", "")).toBe(false);
  });
  it("follows BIOMETRIC_ALLOWED_IPS when set", () => {
    expect(isAllowedDeviceAddress("192.168.1.201", "192.168.1.201")).toBe(true);
    expect(isAllowedDeviceAddress("192.168.1.202", "192.168.1.201")).toBe(false);
    expect(isAllowedDeviceAddress("192.168.5.9", "192.168.5.0/24, 10.1.1.1")).toBe(true);
  });
});

describe("USB / exported punch logs", () => {
  it("reads the machine's attlog.dat format", () => {
    const { punches, skipped, format } = parsePunchFile("  1033\t2026-10-29 06:01:23\t0\t1\t0\t0\n1083\t2026-10-29 09:27:00\t1\t1\t0\t0\nrubbish\n", "1_attlog.dat");
    expect(format).toContain("attlog");
    expect(skipped).toBe(1);
    expect(punches).toHaveLength(2);
    expect(punches[0].pin).toBe("1033");
    expect(punches[0].punchTime).toEqual(new Date(2026, 9, 29, 6, 1, 23));
  });

  it("reads CSV exports with Date Time or separate Date and Time columns", () => {
    const a = parsePunchFile("Enroll No,Name,Date Time\n1033,Surya,29/10/2026 6:05 PM\n1083,Suganthi,2026-10-29 09:27\n", "export.csv");
    expect(a.punches.map((p) => [p.pin, p.punchTime.getHours()])).toEqual([["1033", 18], ["1083", 9]]);
    const b = parsePunchFile("User ID,Date,Time\n1033,2026-10-29,06:01\n", "log.csv");
    expect(b.punches[0].punchTime).toEqual(new Date(2026, 9, 29, 6, 1));
  });

  it("explains a CSV without the needed columns", () => {
    expect(() => parsePunchFile("Foo,Bar\n1,2\n", "x.csv")).toThrow(/User ID/);
  });

  it("parses common date formats", () => {
    expect(parseLogDateTime("2026/10/29 06:01")).toEqual(new Date(2026, 9, 29, 6, 1));
    expect(parseLogDateTime("29-10-2026 12:30 AM")).toEqual(new Date(2026, 9, 29, 0, 30));
    expect(parseLogDateTime("2026-13-01 06:00")).toBeNull();
    expect(parseLogDateTime("hello")).toBeNull();
  });
});
