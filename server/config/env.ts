import "dotenv/config";
import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");
const optionalBool = z.preprocess((value) => (value === "" ? undefined : value), bool.optional());

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  // Hosting front-ends (LiteSpeed, Passenger) may pass a socket name here and take over listen();
  // anything that is not a port number falls back to the default.
  PORT: z.preprocess((value) => (typeof value === "string" && /^\d{1,5}$/.test(value) ? Number(value) : undefined), z.number().int().min(1).max(65535).default(4000)),
  // Defaults to 127.0.0.1 in development and 0.0.0.0 in production (hosting platforms proxy to the app).
  HOST: z.string().optional(),
  // All dates and times (shifts, late/early, "today") use this time zone, whatever the server's own clock says.
  APP_TIMEZONE: z
    .string()
    .default("Asia/Kolkata")
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown time zone (use e.g. Asia/Kolkata)"),

  DB_HOST: z.string().default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().default(3306),
  DB_USER: z.string().default("root"),
  DB_PASSWORD: z.string().default(""),
  DB_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_]+$/, "DB_NAME may only contain letters, numbers and underscores")
    .default("infinity_ops"),
  DB_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
  // Create tables / run migrations / create the first accounts when the server starts.
  // Useful on hosting where you cannot run "npm run db:setup". Defaults to true in production.
  DB_AUTO_SETUP: optionalBool,
  // Starter data on an empty database: "staff" (admin + staff list + roster) or "demo" (+ sample activity) or "none".
  DB_SEED: z.enum(["staff", "demo", "none"]).default("staff"),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  SEED_STAFF_PASSWORD: z.string().optional(),

  // Extra browser origins allowed to call the API (the site's own address is always allowed).
  CORS_ORIGINS: z.string().default("http://localhost:5288"),
  SESSION_TTL_HOURS: z.coerce.number().min(1).max(24 * 30).default(12),
  SESSION_IDLE_MINUTES: z.coerce.number().min(5).max(24 * 60).default(60),
  // Secure cookies need HTTPS. Defaults to true in production.
  COOKIE_SECURE: optionalBool,
  // Behind a reverse proxy (Hostinger, IIS, Nginx). Defaults to true in production so client IPs are correct.
  TRUST_PROXY: optionalBool,

  // How fingerprint machines are read:
  //   direct = this server connects to the machines on the LAN (office PC install)
  //   agent  = an office PC runs "npm run agent" and sends punches here (cloud hosting)
  BIOMETRIC_MODE: z.enum(["direct", "agent"]).default("direct"),
  // Shared secret for the office agent (agent mode). At least 32 characters: npm run agent:key
  BIOMETRIC_AGENT_KEY: z.string().default(""),
  // Direct mode: pull new punches every N minutes (0 = only when Sync is clicked).
  // Agent mode: how often the agent syncs.
  BIOMETRIC_AUTO_SYNC_MINUTES: z.coerce.number().int().min(0).max(24 * 60).default(15),
  // Comma-separated IPs or CIDR ranges machines may be added with. Empty = private LAN ranges only.
  BIOMETRIC_ALLOWED_IPS: z.string().default(""),

  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(24 * 60).default(15),
});

/** A setting problem. The message names variables but never contains their values. */
export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment configuration:\n  ${problems.join("\n  ")}`);
    this.name = "ConfigError";
  }
}

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new ConfigError(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
}

const raw = parsed.data;
const production = raw.NODE_ENV === "production";

if (raw.BIOMETRIC_MODE === "agent" && raw.BIOMETRIC_AGENT_KEY.length < 32) {
  throw new ConfigError(["BIOMETRIC_AGENT_KEY: needs at least 32 characters when BIOMETRIC_MODE=agent (generate one with: npm run agent:key)"]);
}

// Must happen before any Date is created: Node reads TZ when it is set.
process.env.TZ = raw.APP_TIMEZONE;

export const env = {
  ...raw,
  HOST: raw.HOST ?? (production ? "0.0.0.0" : "127.0.0.1"),
  isProduction: production,
  dbAutoSetup: raw.DB_AUTO_SETUP ?? production,
  cookieSecure: raw.COOKIE_SECURE ?? production,
  trustProxy: raw.TRUST_PROXY ?? production,
  corsOrigins: raw.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
};

if (env.isProduction && env.DB_USER === "root") {
  console.warn("[security] DB_USER is 'root'. Create a dedicated MySQL user (see database/create-app-user.sql).");
}
