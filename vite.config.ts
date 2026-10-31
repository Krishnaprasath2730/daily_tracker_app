import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = import.meta.dirname;
const apiPort = process.env.PORT || "4000";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(root, "./src"),
      "@shared": path.resolve(root, "./shared"),
    },
  },
  server: {
    port: 5288,
    strictPort: true,
    host: "localhost",
    // The browser talks to Vite only; API calls are proxied to Express so cookies stay same-origin.
    proxy: {
      "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
    },
  },
  build: {
    outDir: path.resolve(root, "dist/client"),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router", "@tanstack/react-query"],
          charts: ["recharts"],
        },
      },
    },
  },
});
