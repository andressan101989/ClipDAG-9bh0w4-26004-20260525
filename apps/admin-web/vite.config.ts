import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  resolve: { dedupe: ["react", "react-dom", "hls.js"] },
  esbuild: {
    tsconfigRaw: JSON.stringify({
      compilerOptions: {
        useDefineForClassFields: true,
        jsx: "react-jsx",
      },
    }),
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: "./src/tests/setup.ts",
    globals: true,
    env: {
      VITE_SUPABASE_URL: "https://test.invalid",
      VITE_SUPABASE_ANON_KEY: "test-public-anon-key",
    },
  },
});
