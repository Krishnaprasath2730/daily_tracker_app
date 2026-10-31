# Deploying to Hostinger (Business / Cloud web hosting)

The app runs as a **Node.js Web App** in hPanel with a Hostinger **MySQL** database.
The fingerprint machine stays in the office; an **office sync agent** on one office PC reads it
and sends punches to the hosted app over HTTPS.

```
 Office LAN                                   Internet (Hostinger)
 ┌───────────────┐  TCP 4370  ┌────────────┐  HTTPS + key  ┌──────────────────────┐   ┌───────┐
 │ eSSL machine  │ ◄───────── │ Office PC  │ ────────────► │ Node.js app (Express │ ─►│ MySQL │
 │ 192.168.1.x   │  read-only │ agent      │               │ + React, server.js)  │   └───────┘
 └───────────────┘            └────────────┘               └──────────────────────┘
```

---

## 1. Create the database (hPanel → Databases → MySQL Databases)

1. Create a database, user and strong password. Note them, e.g.
   - Database: `u123456789_infinity`
   - User: `u123456789_infinity`
   - Host: shown on the same page (usually `localhost`)
2. Leave it empty. The app creates its tables, the admin account, the staff list and the roster on first start.

> Want to move your existing local data instead? In XAMPP phpMyAdmin export `infinity_ops` (SQL), then in
> Hostinger phpMyAdmin import it into the new database **before** the first deploy. The app then only adds
> anything missing.

## 2. Create the agent key (on your PC, in the project folder)

```
npm run agent:key
```

Copy the printed value. It goes into Hostinger (step 3) **and** the office agent (step 5). Keep it secret.

## 3. Create the Node.js app (hPanel → Websites → Add website → Node.js Apps)

1. **Import Git repository** → connect GitHub → `Krishnaprasath2730/daily_tracker_app`, branch `main`.
2. Build settings (names can differ slightly in hPanel):

   | Setting | Value |
   |---|---|
   | Framework / preset | Express (or Other) |
   | Node.js version | 20.x or 22.x |
   | Root directory | `./` |
   | Package manager | npm |
   | Build command | `npm run build` |
   | Entry file / start file | `server.js` |

3. **Environment variables** (add each one):

   | Name | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `APP_TIMEZONE` | `Asia/Kolkata` |
   | `DB_HOST` | host from step 1 (usually `localhost`) |
   | `DB_PORT` | `3306` |
   | `DB_NAME` | your database name |
   | `DB_USER` | your database user |
   | `DB_PASSWORD` | your database password |
   | `DB_SEED` | `staff` (admin + staff list + roster, no demo data) |
   | `SEED_ADMIN_PASSWORD` | first password for `ADMIN` (10+ chars, A-z, 0-9, symbol) |
   | `SEED_STAFF_PASSWORD` | first password for all staff (same rules) |
   | `BIOMETRIC_MODE` | `agent` |
   | `BIOMETRIC_AGENT_KEY` | the key from step 2 |
   | `BIOMETRIC_AUTO_SYNC_MINUTES` | `15` |

   Do not set `PORT` — Hostinger provides it. HTTPS cookies and proxy settings switch on automatically in production.

4. **Deploy.** Hostinger runs `npm install`, `npm run build`, then starts `server.js`.
   Open the temporary domain (e.g. `https://xxxx.hostingersite.com`).

5. Sign in as **ADMIN** with `SEED_ADMIN_PASSWORD`; you must choose a new password.
   Staff sign in with their employee ID and `SEED_STAFF_PASSWORD` and also set their own.
   After this first start you can delete `SEED_ADMIN_PASSWORD` / `SEED_STAFF_PASSWORD` from the environment variables.

If the site shows an error, open the app's **Logs** in hPanel. Lines starting with `[db]` show the database setup.
`Cannot connect to MySQL` → check `DB_HOST` / user / password (try the host name shown in hPanel instead of `localhost`).

## 4. Add the machine in the app

**Biometric devices → Add machine** → name, the machine's office IP (e.g. `192.168.1.201`), port `4370`.
(Test connection is not available online — the agent does the connecting.)

## 5. Install the office agent (one PC in the office that stays on)

1. Install **Node.js 20 or newer** from nodejs.org.
2. On your development PC run `npm run build:agent`. Copy these from `dist/agent/` to the office PC,
   e.g. into `C:\InfinityAgent\`:
   - `infinity-agent.mjs`
   - `agent.env.example` → rename to `agent.env` and fill in:
     ```
     AGENT_SERVER_URL=https://xxxx.hostingersite.com
     AGENT_KEY=<the key from step 2>
     AGENT_NAME=Office-PC
     ```
3. Test once (PowerShell):
   ```
   cd C:\InfinityAgent
   node infinity-agent.mjs --once
   ```
   You should see `Reading Main entrance (192.168.1.201:4370)…` and the number of punches sent.
   On the website, *Biometric devices* shows **Office agent: Online**.
4. Start it automatically with Windows (PowerShell **as Administrator**):
   ```
   schtasks /Create /TN "Infinity Biometric Agent" /SC ONSTART /RU SYSTEM /RL HIGHEST /F /TR "\"C:\Program Files\nodejs\node.exe\" C:\InfinityAgent\infinity-agent.mjs"
   schtasks /Run /TN "Infinity Biometric Agent"
   ```
   The agent checks in every minute, syncs every `BIOMETRIC_AUTO_SYNC_MINUTES`, and syncs immediately
   when someone clicks **Sync** on the website.

Machine setup is the same as before: **Menu → Comm. → Ethernet** (fixed IP), **Comm Key = 0**.

## 6. Updating the app later

Push to `main` on GitHub → in hPanel click **Redeploy** (or enable auto-deploy). New database migrations
run automatically on start. Your data is kept.

## Security notes

- Keep `BIOMETRIC_AGENT_KEY`, `agent.env` and database passwords private. To change the key, update it in
  both hPanel and `agent.env`.
- The agent only sends data over HTTPS and only reads the machine — it never clears or changes it.
- Machine punches cannot be deleted in the app; every change and sign-in is in the Audit log.
