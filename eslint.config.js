import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist", "_legacy", "node_modules"]),
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended, reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
  },
  {
    // Generated shadcn/ui components: keep upstream code as-is.
    files: ["src/components/ui/**/*.tsx"],
    rules: { "react-refresh/only-export-components": "off", "react-hooks/purity": "off" },
  },
  {
    files: ["server/**/*.ts", "database/**/*.ts", "shared/**/*.ts", "tests/**/*.ts", "agent/**/*.ts", "server.js", "vite.config.ts", "vitest.config.ts"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: globals.node },
  },
  {
    files: ["server.cjs"],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2022, sourceType: "commonjs", globals: globals.node },
  },
]);
