import mysql, { type PoolConnection, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import { env } from "../config/env";

export const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  connectionLimit: env.DB_CONNECTION_LIMIT,
  waitForConnections: true,
  // DATE columns come back as "YYYY-MM-DD" strings so they never shift across time zones.
  dateStrings: ["DATE"],
  timezone: "local",
  charset: "utf8mb4",
  // Never allow several statements in one query from request handlers.
  multipleStatements: false,
  decimalNumbers: true,
});

/** "+05:30" style offset of APP_TIMEZONE right now (process.env.TZ is set from it in config/env). */
export function mysqlTimeZoneOffset(date = new Date()): string {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

// MySQL's NOW() / CURRENT_TIMESTAMP must use the same clock as the app, even when the
// database server runs in UTC (common on hosting). Applied to every new pooled connection.
pool.on("connection", (connection) => {
  connection.query(`SET time_zone = '${mysqlTimeZoneOffset()}'`);
});

type Params = (string | number | boolean | Date | null)[];
type Executor = Pick<PoolConnection, "execute">;

/** Run a parameterised SELECT and return typed rows. */
export async function query<T>(sql: string, params: Params = [], db: Executor = pool): Promise<T[]> {
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows as T[];
}

export async function queryOne<T>(sql: string, params: Params = [], db: Executor = pool): Promise<T | undefined> {
  const rows = await query<T>(sql, params, db);
  return rows[0];
}

/** Run a parameterised INSERT / UPDATE / DELETE. */
export async function execute(sql: string, params: Params = [], db: Executor = pool): Promise<ResultSetHeader> {
  const [result] = await db.execute<ResultSetHeader>(sql, params);
  return result;
}

/** Run work inside a transaction; rolls back automatically on error. */
export async function transaction<T>(work: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
