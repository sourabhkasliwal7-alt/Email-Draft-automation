import { defineConfig } from "vitest/config";

// Integration tests talk to the real dev database over the network.
export default defineConfig({ test: { include: ["tests/**/*.test.ts"], testTimeout: 120_000, hookTimeout: 120_000, fileParallelism: false } });
