import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "../../..");
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".git", "coverage", ".turbo"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

/** The one module allowed to call the Gmail send API (created in Phase 11). */
const SEND_MODULE = ["apps", "worker", "src", "jobs", "send.ts"].join(sep);
const GMAIL_SEND_API = /(messages|drafts)\s*\.\s*send\b/;
const SELF = join("packages", "adapters", "tests", "architecture.test.ts");

describe("send isolation", () => {
  const files = [...walk(join(root, "apps")), ...walk(join(root, "packages"))].map((f) => relative(root, f));

  it("the Gmail send API appears in no source file other than the send job", () => {
    const offenders = files.filter((f) => f !== SELF && f !== SEND_MODULE && GMAIL_SEND_API.test(readFileSync(join(root, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("GmailSender is only wired through the adapters package and the send job", () => {
    const allowed = new Set([
      join("packages", "adapters", "src", "types.ts"),
      join("packages", "adapters", "src", "mock.ts"),
      join("packages", "adapters", "src", "index.ts"),
      join("packages", "adapters", "src", "live.ts"),
      join("packages", "adapters", "tests", "adapters.test.ts"),
      SELF,
      SEND_MODULE,
    ]);
    const offenders = files.filter((f) => !allowed.has(f) && /\bgmailSender\b|\bsendDraft\b/.test(readFileSync(join(root, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
