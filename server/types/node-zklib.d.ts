// Minimal typings for node-zklib (CommonJS, no bundled types).
// Only read operations are declared on purpose: this app must never clear or
// change anything on the machine, so methods like clearAttendanceLog are left out.
declare module "node-zklib" {
  type ZkUser = { uid?: number; userId?: string; name?: string; role?: number; cardno?: number | string };
  type ZkAttendance = { userSn?: number; deviceUserId?: string | number; userId?: string | number; recordTime: Date | string };
  type ZkInfo = { userCounts?: number; logCounts?: number; logCapacity?: number };

  export default class ZKLib {
    constructor(ip: string, port: number, timeout: number, inport: number);
    createSocket(): Promise<void>;
    getInfo(): Promise<ZkInfo>;
    getUsers(): Promise<{ data?: ZkUser[] }>;
    getAttendances(): Promise<{ data?: ZkAttendance[]; err?: unknown }>;
    getTime?(): Promise<Date>;
    disconnect(): Promise<void>;
  }
}
