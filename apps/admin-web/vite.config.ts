import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ["react", "react-dom", "hls.js"] },
  test: { environment: "jsdom", setupFiles: "./src/tests/setup.ts", globals: true },
});
