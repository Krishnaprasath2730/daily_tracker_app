/**
 * Production entry point — set Hostinger's "Entry file" to server.cjs.
 *
 * CommonJS on purpose: Hostinger (LiteSpeed lsnode / Passenger) loads the entry file with
 * require(), which cannot load an ES module that uses top-level await. From here the bundled
 * ES-module server (dist/server/index.js, built by "npm run build") is loaded with import().
 *
 * If start-up fails (missing setting, database unreachable, build missing), a small page explains
 * what to check — without showing any secret values — instead of a blank "503 Service Unavailable".
 * Full details always go to the application log (stderr).
 */
"use strict";
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

if (!process.env.NODE_ENV) process.env.NODE_ENV = "production";
process.env.INFINITY_ENTRY = "1";

const entry = path.join(__dirname, "dist", "server", "index.js");

import(pathToFileURL(entry).href)
  .then((server) => server.started)
  .catch(startFallback);

/** Turn a start-up error into advice that is safe to show publicly. */
function explain(error) {
  const code = String((error && error.code) || "");
  const message = String((error && error.message) || error);
  if (error && error.name === "ConfigError" && Array.isArray(error.problems)) {
    return { title: "A setting is missing or invalid", lines: error.problems.concat("Fix it under hPanel → your Node.js app → Environment variables, then restart / redeploy.") };
  }
  if (code === "ERR_MODULE_NOT_FOUND" && message.includes(path.join("dist", "server"))) {
    return { title: "The app has not been built", lines: ["dist/server/index.js is missing.", 'Set the build command to "npm run build" and redeploy.'] };
  }
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
    return { title: "A package is missing", lines: ["Dependencies were not installed completely. Redeploy so that npm install runs again."] };
  }
  if (/ER_ACCESS_DENIED|ER_DBACCESS_DENIED/.test(code + message)) {
    return { title: "The database refused the login", lines: ["Check DB_USER and DB_PASSWORD (and that the user is assigned to the database in hPanel → MySQL Databases)."] };
  }
  if (/ER_BAD_DB_ERROR/.test(code + message)) {
    return { title: "The database does not exist", lines: ["Check DB_NAME — on Hostinger it looks like u123456789_name."] };
  }
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|Cannot connect to MySQL/.test(code + message)) {
    return { title: "Cannot reach the database", lines: ["Check DB_HOST and DB_PORT (use the host shown in hPanel → MySQL Databases; often localhost, port 3306)."] };
  }
  return { title: "The app could not start", lines: ["See the application logs in hPanel for details."] };
}

function startFallback(error) {
  console.error("[start-up failed]", error && error.stack ? error.stack : error);
  const { title, lines } = explain(error);
  const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Infinity Operations — not started</title><meta name="robots" content="noindex">
<style>body{font-family:system-ui,sans-serif;background:#f6f8fb;color:#1d2939;margin:0;padding:48px 16px}main{max-width:560px;margin:auto;background:#fff;border:1px solid #e4e9f0;border-radius:12px;padding:28px}
h1{font-size:20px;margin:0 0 8px}p{color:#667085;margin:0 0 16px}li{margin:6px 0;font-family:ui-monospace,monospace;font-size:13px}</style></head>
<body><main><h1>${escape(title)}</h1><p>Infinity Operations could not start. An administrator needs to fix this:</p><ul>${lines.map((l) => `<li>${escape(l)}</li>`).join("")}</ul></main></body></html>`;

  const server = http.createServer((req, res) => {
    const api = (req.url || "").startsWith("/api/");
    res.writeHead(503, {
      "Content-Type": api ? "application/json" : "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Retry-After": "60",
    });
    res.end(api ? JSON.stringify({ error: title }) : html);
  });
  const port = /^\d{1,5}$/.test(process.env.PORT || "") ? Number(process.env.PORT) : 4000;
  server.listen(port, process.env.HOST || "0.0.0.0");
}
