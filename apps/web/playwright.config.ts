import { defineConfig } from "@playwright/test";

const ZERO_KEY_PORT = 3100;
const APP_PORT = 3101;

/**
 * Two servers from one production build:
 *  - zero-key: mock mode with every Supabase variable blank. Proves the app comes up healthy with no services.
 *  - app: the real dev project from the root .env, for sign-in, roles and the setup screens.
 * `pnpm e2e` builds first (see package.json).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  projects: [
    { name: "zero-key", testMatch: /health\.spec\.ts/, use: { baseURL: `http://localhost:${ZERO_KEY_PORT}` } },
    { name: "app", testMatch: /app\.spec\.ts|roles\.spec\.ts/, use: { baseURL: `http://localhost:${APP_PORT}` } },
  ],
  webServer: [
    {
      command: `pnpm exec next start -p ${ZERO_KEY_PORT}`,
      url: `http://localhost:${ZERO_KEY_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { APP_MODE: "mock", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SECRET_KEY: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" },
    },
    {
      command: `pnpm exec next start -p ${APP_PORT}`,
      url: `http://localhost:${APP_PORT}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { APP_MODE: "mock" },
    },
  ],
});
