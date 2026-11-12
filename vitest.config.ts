import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const shim = (f: string) => fileURLToPath(new URL(`./sdk-shim/${f}`, import.meta.url));

export default defineConfig({
  test: {
    hookTimeout: 30000,
    testTimeout: 30000,
    coverage: {
      provider: "v8",
      include: ["tgcloud/lib/**/*.js"],
      exclude: ["tgcloud/lib/version.js"],
      reporter: ["text-summary", "html", "json-summary"],
      reportsDirectory: "coverage",
    },
    projects: [
      {
        resolve: {
          // Модули tgcloud/ импортируют платформенный `sdk` — в тестах это локальная замена.
          alias: [
            { find: /^sdk$/, replacement: shim("index.js") },
            { find: /^sdk\/db$/, replacement: shim("db.js") },
            { find: /^sdk\/api$/, replacement: shim("api.js") },
            { find: /^sdk\/fetch$/, replacement: shim("fetch.js") },
          ],
        },
        test: { name: "backend", environment: "node", include: ["tests/**/*.test.{js,ts}"], hookTimeout: 30000, testTimeout: 30000 },
      },
      {
        plugins: [react()],
        define: { __APP_VERSION__: JSON.stringify("test"), __APP_COMMIT__: JSON.stringify("test") },
        test: {
          name: "web", environment: "jsdom", include: ["web/src/**/*.test.{ts,tsx}"], setupFiles: ["web/src/test/setup.ts"],
          env: { TZ: "Europe/Moscow" },
        },
      },
    ],
  },
});
