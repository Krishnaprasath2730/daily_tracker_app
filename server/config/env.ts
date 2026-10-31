import "dotenv/config";
import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default("127.0.0.1"),

  DB_HOST: z.string().default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().default(3306),
  DB_USER: z.string().default("root"),
  DB_PASSWORD: z.string().default(""),
  DB_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_]+$/, "DB_NAME may only contain letters, numbers and underscores")
    .default("infinity_ops"),
  DB_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(100).default(10),

  // Comma-separated list of browser origins allowed to call the API.
  CORS_ORIGINS: z.string().default("http://localhost:5288"),
  SESSION_TTL_HOURS: z.coerce.number().min(1).max(24 * 30).default(12),
  SESSION_IDLE_MINUTES: z.coerce.number().min(5).max(24 * 60).default(60),
  // Secure cookies need HTTPS. Defaults to true in production.
  COOKIE_SECURE: z.preprocess((value) => (value === "" ? undefined : value), bool.optional()),
  // Set to true when running behind a reverse proxy (IIS, Nginx, Apache) so client IPs are correct.
  TRUST_PROXY: bool.default(false),

  // eSSL / ZKTeco machines are read over the LAN (TCP 4370, same as the HRMS portal).
  // How often to pull new punches automatically. 0 = only when someone clicks Sync.
  BIOMETRIC_AUTO_SYNC_MINUTES: z.coerce.number().int().min(0).max(24 * 60).default(15),
  // Comma-separated IPs or CIDR ranges machines may be added with. Empty = private LAN ranges only.
  BIOMETRIC_ALLOWED_IPS: z.string().default(""),

  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(24 * 60).default(15),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

const raw = parsed.data;
export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === "production",
  cookieSecure: raw.COOKIE_SECURE ?? raw.NODE_ENV === "production",
  corsOrigins: raw.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
};

if (env.isProduction && env.DB_USER === "root") {
  console.warn("[security] DB_USER is 'root'. Create a dedicated MySQL user (see database/create-app-user.sql).");
}
