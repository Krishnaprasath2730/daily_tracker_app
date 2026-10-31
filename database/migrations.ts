/**
 * Ordered, idempotent schema changes applied after schema.sql.
 * Each migration runs once and is recorded in schema_migrations.
 * Works on MariaDB 10.4 (XAMPP) and MySQL 8 — column checks use information_schema
 * instead of "ADD COLUMN IF NOT EXISTS", which MySQL does not support.
 */
import type { Connection, RowDataPacket } from "mysql2/promise";

type Migration = { id: string; description: string; up: (db: Helpers) => Promise<void> };

type Helpers = {
  sql: (statement: string) => Promise<void>;
  addColumn: (table: string, column: string, definition: string) => Promise<void>;
  addIndex: (table: string, index: string, definition: string) => Promise<void>;
  columnExists: (table: string, column: string) => Promise<boolean>;
  indexExists: (table: string, index: string) => Promise<boolean>;
  foreignKeyExists: (table: string, constraint: string) => Promise<boolean>;
  /** True when the table is missing or has no rows. */
  tableIsEmpty: (table: string) => Promise<boolean>;
};

export const MIGRATIONS: Migration[] = [
  {
    id: "2026-10-29-01-biometric-devices",
    description: "eSSL/ZKTeco device push (ADMS), biometric IDs, roster-aware attendance",
    up: async ({ sql, addColumn, addIndex }) => {
      // Enrollment number (PIN) of the person on the biometric machine.
      await addColumn("employees", "biometric_id", "VARCHAR(20) NULL AFTER employee_code");
      await addIndex("employees", "uq_employees_biometric", "UNIQUE KEY uq_employees_biometric (biometric_id)");

      // AUTO = the machine did not record in/out; first punch of the day is treated as IN, last as OUT.
      await sql("ALTER TABLE punch_records MODIFY direction ENUM('IN','OUT','AUTO') NOT NULL");
      await addColumn("punch_records", "source", "ENUM('device','csv','manual') NOT NULL DEFAULT 'csv' AFTER device_id");
      await addColumn("punch_records", "note", "VARCHAR(255) NULL AFTER source");

      await sql("ALTER TABLE attendance_matches MODIFY status ENUM('Matched','Review','Missing','Absent','On duty') NOT NULL");
      await addColumn("attendance_matches", "roster_shift", "VARCHAR(12) NULL AFTER work_date");
      await addColumn("attendance_matches", "punch_count", "INT UNSIGNED NOT NULL DEFAULT 0 AFTER biometric_end");
      await addColumn("attendance_matches", "worked_minutes", "INT NULL AFTER punch_count");
      await addColumn("attendance_matches", "late_minutes", "INT NULL AFTER worked_minutes");
      await addColumn("attendance_matches", "early_minutes", "INT NULL AFTER late_minutes");
      await addColumn("attendance_matches", "remarks", "VARCHAR(500) NULL AFTER status");

      await sql(`CREATE TABLE IF NOT EXISTS biometric_devices (
        id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
        serial_number   VARCHAR(40)  NOT NULL,
        name            VARCHAR(80)  NOT NULL,
        location        VARCHAR(120) NULL,
        status          ENUM('pending','approved','disabled') NOT NULL DEFAULT 'pending',
        model           VARCHAR(80)  NULL,
        firmware        VARCHAR(80)  NULL,
        push_version    VARCHAR(20)  NULL,
        last_ip         VARCHAR(45)  NULL,
        last_seen_at    DATETIME     NULL,
        last_punch_at   DATETIME     NULL,
        attlog_stamp    VARCHAR(20)  NULL,
        operlog_stamp   VARCHAR(20)  NULL,
        total_punches   INT UNSIGNED NOT NULL DEFAULT 0,
        approved_by     INT UNSIGNED NULL,
        approved_at     DATETIME     NULL,
        created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_device_sn (serial_number),
        CONSTRAINT fk_device_approver FOREIGN KEY (approved_by) REFERENCES employees (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

      // Every punch exactly as the machine sent it, matched to an employee when the PIN is known.
      await sql(`CREATE TABLE IF NOT EXISTS biometric_logs (
        id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        device_id    INT UNSIGNED NOT NULL,
        pin          VARCHAR(20)  NOT NULL,
        punch_time   DATETIME     NOT NULL,
        status_code  TINYINT UNSIGNED NULL,
        verify_code  TINYINT UNSIGNED NULL,
        employee_id  INT UNSIGNED NULL,
        received_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_biolog (device_id, pin, punch_time),
        KEY idx_biolog_pin (pin, employee_id),
        KEY idx_biolog_time (punch_time),
        CONSTRAINT fk_biolog_device FOREIGN KEY (device_id) REFERENCES biometric_devices (id) ON DELETE CASCADE,
        CONSTRAINT fk_biolog_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

      // Names the machine reports for its enrolled users (helps map unknown PINs).
      await sql(`CREATE TABLE IF NOT EXISTS biometric_users (
        device_id   INT UNSIGNED NOT NULL,
        pin         VARCHAR(20)  NOT NULL,
        name        VARCHAR(80)  NULL,
        updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (device_id, pin),
        CONSTRAINT fk_biouser_device FOREIGN KEY (device_id) REFERENCES biometric_devices (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

      // Commands queued for a machine; delivered on its next heartbeat.
      await sql(`CREATE TABLE IF NOT EXISTS device_commands (
        id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
        device_id    INT UNSIGNED NOT NULL,
        command      VARCHAR(255) NOT NULL,
        label        VARCHAR(80)  NOT NULL,
        status       ENUM('queued','sent','done','failed') NOT NULL DEFAULT 'queued',
        return_code  VARCHAR(20)  NULL,
        created_by   INT UNSIGNED NULL,
        created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        sent_at      DATETIME     NULL,
        done_at      DATETIME     NULL,
        PRIMARY KEY (id),
        KEY idx_cmd_device_status (device_id, status),
        CONSTRAINT fk_cmd_device FOREIGN KEY (device_id) REFERENCES biometric_devices (id) ON DELETE CASCADE,
        CONSTRAINT fk_cmd_creator FOREIGN KEY (created_by) REFERENCES employees (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    },
  },
  {
    id: "2026-10-29-02-biometric-pull",
    description: "Pull punches from eSSL/ZKTeco machines over TCP 4370 (same as HRMS), USB log import, device user mapping",
    up: async ({ sql, addColumn, addIndex, columnExists, indexExists, foreignKeyExists, tableIsEmpty }) => {
      // Machines are added by IP address (pull mode). Serial number becomes optional.
      await sql("ALTER TABLE biometric_devices MODIFY serial_number VARCHAR(40) NULL");
      await addColumn("biometric_devices", "ip_address", "VARCHAR(45) NULL AFTER name");
      await addColumn("biometric_devices", "port", "INT UNSIGNED NOT NULL DEFAULT 4370 AFTER ip_address");
      await addColumn("biometric_devices", "comm_key", "INT UNSIGNED NOT NULL DEFAULT 0 AFTER port");
      await addColumn("biometric_devices", "last_sync_at", "DATETIME NULL");
      await addColumn("biometric_devices", "last_sync_status", "ENUM('OK','FAILED') NULL");
      await addColumn("biometric_devices", "last_sync_note", "VARCHAR(255) NULL");
      await addColumn("biometric_devices", "user_count", "INT UNSIGNED NULL");
      await addColumn("biometric_devices", "log_count", "INT UNSIGNED NULL");
      await addColumn("biometric_devices", "log_capacity", "INT UNSIGNED NULL");
      await addIndex("biometric_devices", "uq_device_address", "UNIQUE KEY uq_device_address (ip_address, port)");

      // Raw punches may also come from a USB log file (no device), and keep history when a device is removed.
      if (await foreignKeyExists("biometric_logs", "fk_biolog_device")) await sql("ALTER TABLE biometric_logs DROP FOREIGN KEY fk_biolog_device");
      await sql("ALTER TABLE biometric_logs MODIFY device_id INT UNSIGNED NULL");
      await addColumn("biometric_logs", "source", "ENUM('device','file') NOT NULL DEFAULT 'device' AFTER employee_id");
      // One punch per machine user per second, whichever machine or file it came from.
      if (await indexExists("biometric_logs", "uq_biolog")) await sql("ALTER TABLE biometric_logs DROP INDEX uq_biolog");
      await addIndex("biometric_logs", "uq_biolog_pin_time", "UNIQUE KEY uq_biolog_pin_time (pin, punch_time)");
      await addIndex("biometric_logs", "idx_biolog_device", "KEY idx_biolog_device (device_id)");
      if (!(await foreignKeyExists("biometric_logs", "fk_biolog_device"))) {
        await sql("ALTER TABLE biometric_logs ADD CONSTRAINT fk_biolog_device FOREIGN KEY (device_id) REFERENCES biometric_devices (id) ON DELETE SET NULL");
      }

      // Device user list: one row per machine user ID (as in HRMS). The old table only held names and is rebuilt when empty.
      if (!(await columnExists("biometric_users", "id")) && (await tableIsEmpty("biometric_users"))) {
        await sql("DROP TABLE biometric_users");
      }
      await sql(`CREATE TABLE IF NOT EXISTS biometric_users (
        id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
        pin           VARCHAR(20)  NOT NULL,
        name          VARCHAR(80)  NULL,
        card_no       VARCHAR(40)  NULL,
        device_id     INT UNSIGNED NULL,
        last_seen_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_biouser_pin (pin),
        CONSTRAINT fk_biouser_device2 FOREIGN KEY (device_id) REFERENCES biometric_devices (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

      // Link each punch to the raw log it came from, so unlinking a machine ID can undo it cleanly.
      await addColumn("punch_records", "log_id", "BIGINT UNSIGNED NULL AFTER note");
      await addIndex("punch_records", "idx_punch_log", "KEY idx_punch_log (log_id)");

      // The push-mode command queue is no longer used.
      if (await tableIsEmpty("device_commands")) await sql("DROP TABLE IF EXISTS device_commands");
    },
  },
];

export const LATEST_MIGRATION = MIGRATIONS[MIGRATIONS.length - 1].id;

export async function runMigrations(conn: Connection, database: string): Promise<string[]> {
  await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id VARCHAR(80) NOT NULL PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  const [done] = await conn.query<RowDataPacket[]>("SELECT id FROM schema_migrations");
  const applied = new Set(done.map((row) => row.id as string));

  const exists = async (sqlText: string, params: string[]) => {
    const [rows] = await conn.query<RowDataPacket[]>(sqlText, params);
    return rows.length > 0;
  };
  const columnExists = (table: string, column: string) =>
    exists("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?", [database, table, column]);
  const indexExists = (table: string, index: string) =>
    exists("SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?", [database, table, index]);
  const helpers: Helpers = {
    sql: async (statement) => {
      await conn.query(statement);
    },
    columnExists,
    indexExists,
    foreignKeyExists: (table, constraint) =>
      exists(
        "SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'",
        [database, table, constraint],
      ),
    tableIsEmpty: async (table) => {
      if (!(await exists("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?", [database, table]))) return true;
      const [rows] = await conn.query<RowDataPacket[]>(`SELECT 1 FROM \`${table}\` LIMIT 1`);
      return rows.length === 0;
    },
    addColumn: async (table, column, definition) => {
      if (await columnExists(table, column)) return;
      await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    },
    addIndex: async (table, index, definition) => {
      if (await indexExists(table, index)) return;
      await conn.query(`ALTER TABLE \`${table}\` ADD ${definition}`);
    },
  };

  const ran: string[] = [];
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    await migration.up(helpers);
    await conn.query("INSERT INTO schema_migrations (id) VALUES (?)", [migration.id]);
    ran.push(`${migration.id} — ${migration.description}`);
  }
  return ran;
}
