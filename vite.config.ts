import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const commit = (() => {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try { return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return "dev"; }
})();

export default defineConfig({
  root: "web",
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version), __APP_COMMIT__: JSON.stringify(commit) },
  build: {
    outDir: "../dist", emptyOutDir: true, sourcemap: false, target: "es2022",
    // ML-декодер (≈4 МБ) ogg-opus-decoder грузит только при speechQualityEnhancement,
    // который мы не включаем, — в сборку его не тащим.
    rolldownOptions: { external: ["@wasm-audio-decoders/opus-ml"] },
  },
  server: { port: 5173 },
});
