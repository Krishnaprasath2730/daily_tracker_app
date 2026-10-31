# Infinity Operations Portal

Internal web app for Infinity Solutions support/operations staff: daily production reports, error reports, duty roster, ad-hoc time tracking, leave applications and biometric punch matching.

**Stack:** React 19 + TypeScript + Vite + Tailwind (client) · Node.js + Express 5 + TypeScript (API) · MySQL / MariaDB via XAMPP (database). No Docker.

---

## Hosting

To put the app online on Hostinger (Node.js Web App + MySQL + office sync agent for the fingerprint machine), follow **[DEPLOY-HOSTINGER.md](DEPLOY-HOSTINGER.md)**.

## 1. Requirements

- Node.js 20.19+ (tested on Node 24)
- XAMPP with **MySQL** started from the XAMPP Control Panel (port 3306)

## 2. First-time setup

```bash
npm install
copy .env.example .env        # then edit .env (see below)
npm run db:setup              # creates the "infinity_ops" database, tables and sample data
npm run dev                   # API on :4000 + web app on :5288
```

Open **http://localhost:5288**.

In `.env`, set `SEED_ADMIN_PASSWORD` and `SEED_STAFF_PASSWORD` before running `db:setup` (10+ chars, upper, lower, number, symbol).

| Sign in as | Employee ID | Password |
|---|---|---|
| Administrator | `ADMIN` | `SEED_ADMIN_PASSWORD` |
| Manager | `IS/2026/1033` | `SEED_STAFF_PASSWORD` |
| Staff | `IS/2026/1083`, `IS/2026/1090`, … | `SEED_STAFF_PASSWORD` |

Everyone must choose a new password at first sign-in.

`npm run db:reset` drops and recreates the database. **It deletes all data.**

## 3. Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API (auto-reload) + Vite dev server |
| `npm run db:setup` | Create database + tables, seed sample data if empty |
| `npm run db:reset` | Drop database and set it up again |
| `npm run build` | Typecheck, build client to `dist/client`, bundle server to `dist/server` |
| `npm start` | Run the production build on `PORT` (serves the web app and API together) |
| `npm test` | Unit tests + API security tests (needs MySQL running) |
| `npm run check` / `npm run lint` | TypeScript / ESLint |

## 4. Roles

| Feature | Staff | Manager | Admin |
|---|---|---|---|
| Dashboard | Own figures | Team figures | Team figures |
| Daily reports | Own; edit within 24h; last 7 days | All, any time | All |
| Error reports | Own / self-reported; view status | All; change status | All |
| Leave | Apply, cancel own pending | Approve/reject (not own) → roster auto-updated | All, incl. own |
| Duty roster | View published months, "My shifts", request swaps | Bulk edit grid, weekly patterns, copy month, staffing rules, publish, approve swaps | Same |
| Ad-hoc timer | Own start/end | End anyone's session | Same |
| Punch matching (CSV import, match) | — | ✔ | ✔ |
| Employees (create, roles, reset password, deactivate, unlock) | — | — | ✔ |
| Audit log | — | — | ✔ |

## 5. Security

- **Passwords:** bcrypt (12 rounds); strong-password policy; forced change on first sign-in and after admin reset; changing password signs out other devices.
- **Sessions:** random 256-bit token in an `HttpOnly`, `SameSite=Strict` cookie (`Secure` + `__Host-` prefix on HTTPS). Only a SHA-256 hash is stored in the database. Absolute timeout (`SESSION_TTL_HOURS`) and idle timeout (`SESSION_IDLE_MINUTES`). Logout revokes the session server-side.
- **CSRF:** SameSite cookie plus a per-session token required in the `X-CSRF-Token` header for every POST/PUT/PATCH/DELETE.
- **Brute force:** account lock after `LOGIN_MAX_ATTEMPTS` failures for `LOGIN_LOCK_MINUTES`; login rate limit per IP; generic error message; constant-time checks for unknown users.
- **Authorisation:** role checks on every route on the server (the UI hiding buttons is only cosmetic). Staff can only read and change their own records.
- **Input:** every request body and query string is validated with Zod; all SQL uses parameterised queries (`mysql2` prepared statements); `LIKE` wildcards escaped; 1 MB body limit.
- **Headers:** Helmet with strict Content-Security-Policy, `frame-ancestors 'none'`, no `X-Powered-By`, `Cache-Control: no-store` on API responses, HSTS when on HTTPS.
- **CORS:** only origins in `CORS_ORIGINS`.
- **Errors/logging:** no stack traces sent to clients; structured logs with passwords/tokens redacted; request IDs.
- **Audit trail:** every login (success/failure/lock), and every create/update/delete is written to `audit_logs`.
- **CSV:** imports are size/row limited and validated; exports neutralise spreadsheet formula injection.

### Production checklist

1. Set a password on the XAMPP MySQL `root` account.
2. Create a least-privilege DB user with `database/create-app-user.sql` and put it in `.env`.
3. `NODE_ENV=production`, serve over **HTTPS** (IIS / Nginx / Apache reverse proxy) with `COOKIE_SECURE=true` and `TRUST_PROXY=true`.
4. Set `CORS_ORIGINS` to your real site address.
5. Remove or change `SEED_*` passwords from `.env` after setup.
6. Back up the `infinity_ops` database regularly (phpMyAdmin → Export, or `mysqldump`).

## 6. Project layout

```
server/            Express API
  app.ts           middleware + route wiring
  index.ts         start-up, graceful shutdown
  config/env.ts    validated environment variables
  db/pool.ts       MySQL pool + query helpers + transactions
  middleware/      auth, CSRF, security headers, rate limits, errors
  routes/          auth, employees, reports, errors, leave, roster, adhoc, attendance, dashboard, audit
  services/        sessions/passwords, audit log, attendance matching
src/               React app (pages, components, API client, auth provider)
shared/            constants used by both client and server
database/          schema.sql, setup/seed script, seed data, DB user script
tests/             Vitest unit + API security tests
```

## 7. Duty roster

- **Grid editing (managers):** drag to select cells (Shift/Ctrl-click to extend), click a row name or day header to select it, then pick a shift from the palette or just type the code (`1`, `1A`, `WO`…). Delete clears, Ctrl+Z undoes (last 20 changes). Changes save instantly in one transaction.
- **Rule checks** (shared/roster.ts): less than 11 h rest between shifts, more than 6 working days in a row, working on approved leave, pending leave. Shown as red/blue corner marks with hover details.
- **Coverage row:** staff working per day against the month's minimum (weekday / weekend, set under *Staffing rules*). Short days turn red.
- **Per-person totals:** work days, hours, weekly offs, leave.
- **Weekly pattern:** fill a date range with a Mon–Sun pattern for selected staff. Leave (AL/EL) is never overwritten.
- **Draft / Published:** staff see a month only after it is published.
- **Shift swaps:** staff request → colleague accepts → manager approves → both cells swap automatically. Approval is refused if either shift changed after the request.
- Approved leave is written to the roster as AL/EL automatically.

## 8. Biometric machines (eSSL / ZKTeco)

Same connection model as the HRMS portal: the server reads each machine over the office network on **TCP port 4370** (node-zklib, UDP fallback). It is read-only — nothing on the machine is ever changed or cleared. No inbound firewall port is needed.

1. Connect the machine to the office LAN / Wi-Fi. On the machine: **Menu → Comm. → Ethernet** — note the IP and make it fixed (DHCP off). **Comm Key = 0** (Menu → Comm. → Security).
2. In the app: **Biometric devices → Add machine** → IP + port 4370 → **Test connection** (shows users, punches, capacity and clock difference).
3. **Sync** one machine or all. Users and punches are pulled; machine users are linked to employees automatically when the match is clear (`1033` ↔ `IS/2026/1033`, same ID, or same name). Link the rest under *Machine users* (admin).
4. New punches are pulled automatically every `BIOMETRIC_AUTO_SYNC_MINUTES` (default 15; 0 = manual sync only).
5. Machine off the network? **Load USB file**: `attlog.dat` / `.txt` from a pen drive, or a CSV export (save Excel files as CSV first).

Security: machines can only be added with an office-network IPv4 address (or `BIOMETRIC_ALLOWED_IPS`); fingerprint templates are never read; punches pulled from a machine cannot be deleted (USB/CSV and manual ones can); manual punches need a reason; unlinking a machine ID takes its punches back out of attendance; everything is audited.

Attendance is matched against the roster: first punch of the day = IN, last = OUT; late after 10 min, early before 10 min, **Absent** (rostered, no punch), **Missing** (no OUT 2 h after shift), **On duty** (still at work), plus ad-hoc time comparison. Use *Re-process attendance* after changing links or the roster.

Database changes ship as migrations in `database/migrations.ts`; after updating the code run `npm run db:setup` (safe to repeat, never deletes data).

## 9. Biometric CSV format

```
employee_id,punch_time,direction,device_id
IS/2026/1033,2026-10-29 06:01,IN,BIO-01
IS/2026/1033,2026-10-29 14:03,OUT,BIO-01
```

`punch_time` may be `YYYY-MM-DD HH:mm` (local time) or ISO 8601. Duplicate punches are ignored.
