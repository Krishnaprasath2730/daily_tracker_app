-- Infinity Operations database schema
-- Works with XAMPP MySQL / MariaDB 10.4+ and MySQL 8.
-- Run with:  npm run db:setup   (or import this file in phpMyAdmin)
-- The database name comes from DB_NAME in .env when using db:setup.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS employees (
  id                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_code          VARCHAR(40)  NOT NULL,
  name                   VARCHAR(120) NOT NULL,
  email                  VARCHAR(160) NULL,
  team                   VARCHAR(80)  NOT NULL DEFAULT 'Support',
  role                   ENUM('admin','manager','employee') NOT NULL DEFAULT 'employee',
  password_hash          VARCHAR(255) NOT NULL,
  must_change_password   TINYINT(1)   NOT NULL DEFAULT 1,
  is_active              TINYINT(1)   NOT NULL DEFAULT 1,
  failed_login_attempts  INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until           DATETIME     NULL,
  last_login_at          DATETIME     NULL,
  password_changed_at    DATETIME     NULL,
  created_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_employees_code (employee_code),
  UNIQUE KEY uq_employees_email (email),
  KEY idx_employees_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Server-side login sessions. Only a SHA-256 hash of the session token is stored,
-- so a leaked database dump cannot be used to log in.
CREATE TABLE IF NOT EXISTS sessions (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  token_hash    CHAR(64)     NOT NULL,
  csrf_token    CHAR(64)     NOT NULL,
  employee_id   INT UNSIGNED NOT NULL,
  ip_address    VARCHAR(45)  NULL,
  user_agent    VARCHAR(255) NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at    DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessions_token (token_hash),
  KEY idx_sessions_employee (employee_id),
  KEY idx_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS daily_reports (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id       INT UNSIGNED NOT NULL,
  report_date       DATE         NOT NULL,
  account           VARCHAR(80)  NOT NULL,
  shift_code        VARCHAR(12)  NOT NULL,
  edr_drt           INT UNSIGNED NOT NULL DEFAULT 0,
  edr_pmt           INT UNSIGNED NOT NULL DEFAULT 0,
  man_drt           INT UNSIGNED NOT NULL DEFAULT 0,
  man_pmt           INT UNSIGNED NOT NULL DEFAULT 0,
  delay_minutes     INT UNSIGNED NOT NULL DEFAULT 0,
  extended_minutes  INT UNSIGNED NOT NULL DEFAULT 0,
  notes             TEXT         NULL,
  created_by        INT UNSIGNED NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_daily_report (employee_id, report_date, account, shift_code),
  KEY idx_daily_report_date (report_date),
  CONSTRAINT fk_daily_report_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,
  CONSTRAINT fk_daily_report_creator  FOREIGN KEY (created_by)  REFERENCES employees (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS error_reports (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id        INT UNSIGNED NOT NULL,
  report_date        DATE         NOT NULL,
  account            VARCHAR(80)  NOT NULL,
  error_type         VARCHAR(80)  NOT NULL,
  reference          VARCHAR(100) NULL,
  description        TEXT         NOT NULL,
  severity           ENUM('Low','Medium','High','Critical') NOT NULL DEFAULT 'Medium',
  status             ENUM('Open','In review','Resolved')    NOT NULL DEFAULT 'Open',
  corrective_action  TEXT         NULL,
  reported_by        INT UNSIGNED NULL,
  resolved_by        INT UNSIGNED NULL,
  resolved_at        DATETIME     NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_error_date (report_date),
  KEY idx_error_status (status),
  CONSTRAINT fk_error_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,
  CONSTRAINT fk_error_reporter FOREIGN KEY (reported_by) REFERENCES employees (id) ON DELETE SET NULL,
  CONSTRAINT fk_error_resolver FOREIGN KEY (resolved_by) REFERENCES employees (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leave_requests (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id   INT UNSIGNED NOT NULL,
  leave_type    ENUM('Annual leave','Emergency leave') NOT NULL,
  start_date    DATE         NOT NULL,
  end_date      DATE         NOT NULL,
  reason        TEXT         NOT NULL,
  status        ENUM('Pending','Approved','Rejected','Cancelled') NOT NULL DEFAULT 'Pending',
  manager_note  TEXT         NULL,
  reviewed_by   INT UNSIGNED NULL,
  reviewed_at   DATETIME     NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_leave_employee (employee_id, start_date),
  KEY idx_leave_status (status),
  CONSTRAINT fk_leave_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,
  CONSTRAINT fk_leave_reviewer FOREIGN KEY (reviewed_by) REFERENCES employees (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roster_entries (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id  INT UNSIGNED NOT NULL,
  duty_date    DATE         NOT NULL,
  shift_code   VARCHAR(12)  NOT NULL,
  updated_by   INT UNSIGNED NULL,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roster_employee_date (employee_id, duty_date),
  KEY idx_roster_date (duty_date),
  CONSTRAINT fk_roster_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,
  CONSTRAINT fk_roster_updater  FOREIGN KEY (updated_by)  REFERENCES employees (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Publishing state and staffing rules per roster month (YYYY-MM).
-- Staff only see a month once it is published.
CREATE TABLE IF NOT EXISTS roster_months (
  month              CHAR(7)      NOT NULL,
  status             ENUM('draft','published') NOT NULL DEFAULT 'draft',
  min_staff_weekday  TINYINT UNSIGNED NOT NULL DEFAULT 5,
  min_staff_weekend  TINYINT UNSIGNED NOT NULL DEFAULT 2,
  published_by       INT UNSIGNED NULL,
  published_at       DATETIME     NULL,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (month),
  CONSTRAINT fk_roster_month_publisher FOREIGN KEY (published_by) REFERENCES employees (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Shift swaps: requester asks a colleague, colleague accepts, a manager approves.
-- The shift codes at request time are stored so approval fails safely if the roster changed meanwhile.
CREATE TABLE IF NOT EXISTS shift_swaps (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  duty_date         DATE         NOT NULL,
  requester_id      INT UNSIGNED NOT NULL,
  target_id         INT UNSIGNED NOT NULL,
  requester_shift   VARCHAR(12)  NOT NULL,
  target_shift      VARCHAR(12)  NOT NULL,
  reason            VARCHAR(500) NULL,
  status            ENUM('Pending','Accepted','Approved','Declined','Rejected','Cancelled') NOT NULL DEFAULT 'Pending',
  responded_at      DATETIME     NULL,
  decided_by        INT UNSIGNED NULL,
  decided_at        DATETIME     NULL,
  manager_note      VARCHAR(500) NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_swap_status (status),
  KEY idx_swap_date (duty_date),
  CONSTRAINT fk_swap_requester FOREIGN KEY (requester_id) REFERENCES employees (id) ON DELETE CASCADE,
  CONSTRAINT fk_swap_target    FOREIGN KEY (target_id)    REFERENCES employees (id) ON DELETE CASCADE,
  CONSTRAINT fk_swap_decider   FOREIGN KEY (decided_by)   REFERENCES employees (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS adhoc_sessions (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id  INT UNSIGNED NOT NULL,
  task         VARCHAR(180) NOT NULL,
  start_time   DATETIME     NOT NULL,
  end_time     DATETIME     NULL,
  notes        TEXT         NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_adhoc_employee_start (employee_id, start_time),
  KEY idx_adhoc_start (start_time),
  CONSTRAINT fk_adhoc_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS punch_records (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id  INT UNSIGNED NOT NULL,
  punch_time   DATETIME     NOT NULL,
  direction    ENUM('IN','OUT') NOT NULL,
  device_id    VARCHAR(80)  NOT NULL DEFAULT 'BIO-01',
  imported_by  INT UNSIGNED NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_punch (employee_id, punch_time, direction),
  KEY idx_punch_time (punch_time),
  CONSTRAINT fk_punch_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,
  CONSTRAINT fk_punch_importer FOREIGN KEY (imported_by) REFERENCES employees (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_matches (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id       INT UNSIGNED NOT NULL,
  work_date         DATE         NOT NULL,
  system_start      DATETIME     NULL,
  system_end        DATETIME     NULL,
  biometric_start   DATETIME     NULL,
  biometric_end     DATETIME     NULL,
  variance_minutes  INT          NULL,
  status            ENUM('Matched','Review','Missing') NOT NULL,
  matched_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_attendance_employee_date (employee_id, work_date),
  KEY idx_attendance_date (work_date),
  CONSTRAINT fk_attendance_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Who did what, and when. Written by the server for every change and every login attempt.
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id    INT UNSIGNED NULL,
  action      VARCHAR(80)  NOT NULL,
  entity      VARCHAR(60)  NULL,
  entity_id   INT UNSIGNED NULL,
  details     TEXT         NULL,
  ip_address  VARCHAR(45)  NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_created (created_at),
  KEY idx_audit_actor (actor_id),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES employees (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
