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
  // Lead files go through a server action (up to the 25 MB bucket limit); the default cap is 1 MB.
  experimental: { serverActions: { bodySizeLimit: "26mb" }, proxyClientMaxBodySize: "26mb" },
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@outreach/adapters", "@outreach/core", "@outreach/db", "@outreach/importer"],
  serverExternalPackages: ["papaparse", "exceljs"],
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
