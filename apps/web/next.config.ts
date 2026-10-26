import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// One .env at the repo root is shared by the web app and the worker. Next only reads apps/web/.env* by itself,
// and its env loader is already cached by the time this file runs, so load the root file explicitly.
// process.loadEnvFile never overrides variables that are already set (real deployment env wins).
const rootEnv = path.resolve(__dirname, "../../.env");
if (fs.existsSync(rootEnv) && typeof process.loadEnvFile === "function") process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  // Authenticated, per-user app: nothing here is cacheable, so Cache Components is off.
  cacheComponents: false,
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@outreach/adapters", "@outreach/core", "@outreach/db"],
  serverExternalPackages: ["papaparse"],
  turbopack: {
    root: path.resolve(__dirname, "../.."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
