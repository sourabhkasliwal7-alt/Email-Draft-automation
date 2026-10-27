import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// One .env at the repo root is shared by the web app and the worker. Next only reads apps/web/.env* by itself,
// and its env loader is already cached by the time this file runs, so load the root file explicitly.
// Variables that are already set are never overridden (real deployment env wins). This reads line by line on purpose:
// process.loadEnvFile treats a stray line without "=" as the start of the next key and silently drops that variable.
function loadRootEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
    if (!m) continue;
    let value = m[2]!;
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    if (process.env[m[1]!] === undefined) process.env[m[1]!] = value;
  }
}
loadRootEnv(path.resolve(__dirname, "../../.env"));

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
