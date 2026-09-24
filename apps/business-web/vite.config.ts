import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import paths from "../../shared/web-routing/paths.json";

export default defineConfig({
  base: `${paths.businessBasePath}/`,
  plugins: [react()],
  resolve: { dedupe: ["react", "react-dom", "hls.js"] },
  server: { port: 8081, strictPort: true },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: "./src/tests/setup.ts",
    globals: true,
    css: true,
  },
});
