// Production entry point (Hostinger "Entry file": server.js).
// Runs the bundled server built by "npm run build" (dist/server/index.js), which also serves the web app.
process.env.NODE_ENV ??= "production";
await import("./dist/server/index.js");
