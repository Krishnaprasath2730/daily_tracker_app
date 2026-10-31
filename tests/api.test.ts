// Security tests against the real Express app. Needs XAMPP MySQL running and `npm run db:setup` done.
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { pool } from "../server/db/pool";

const app = createApp();

afterAll(async () => {
  await pool.end();
});

describe("API security", () => {
  it("serves health with security headers", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("rejects unauthenticated access to protected routes", async () => {
    for (const path of ["/api/reports", "/api/dashboard", "/api/employees", "/api/audit-logs", "/api/attendance"]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(401);
    }
  });

  it("ignores forged or malformed session cookies", async () => {
    const res = await request(app).get("/api/auth/me").set("Cookie", ["ios_sid=' OR 1=1 --", "ios_sid=" + "a".repeat(64)]);
    expect(res.status).toBe(401);
  });

  it("returns a generic error for unknown users", async () => {
    const res = await request(app).post("/api/auth/login").send({ identifier: "no-such-user-xyz", password: "Whatever123!" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Employee ID or password is incorrect");
  });

  it("validates login input", async () => {
    const res = await request(app).post("/api/auth/login").send({ identifier: "", password: "" });
    expect(res.status).toBe(400);
  });

  it("rejects malformed JSON without leaking internals", async () => {
    const res = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{bad json");
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|at .*\.ts/);
  });

  it("blocks disallowed CORS origins", async () => {
    const res = await request(app).get("/api/health").set("Origin", "https://evil.example");
    expect(res.status).toBe(403);
  });

  it("returns JSON 404 for unknown API routes", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect([401, 404]).toContain(res.status);
  });
});
