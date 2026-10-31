// Kept for hosts configured with "server.js" as the entry file. Prefer server.cjs (see DEPLOY-HOSTINGER.md).
// No top-level await, so this also loads where the host uses require() on Node 20.19+ / 22.12+.
import "./server.cjs";
