import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Demo data exists only for tests and hand-loaded demos. Nothing may add it when the app or the worker starts, and
 * the demo file must not sit where a tool would run it by itself (supabase/seed.sql is the file `supabase db reset` loads).
 */
const root = join(__dirname, "../../..");
const SKIP = new Set(["node_modules", ".next", "dist", ".git", "coverage"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|json|yml|yaml|toml)$/.test(name)) out.push(p);
  }
  return out;
}
const rel = (f: string) => relative(root, f).split(sep).join("/");

describe("no demo data is created by the product", () => {
  const sources = [...walk(join(root, "apps/web/src")), ...walk(join(root, "apps/worker/src")), ...walk(join(root, "packages"))].filter((f) => !/\/tests?\//.test(rel(f)) && !rel(f).includes("/node_modules/"));

  it("there is no supabase/seed.sql for a tool to load by itself, and the demo file refuses a real project", () => {
    expect(existsSync(join(root, "supabase/seed.sql"))).toBe(false);
    const demo = readFileSync(join(root, "supabase/test-data/demo_seed.sql"), "utf8");
    expect(demo).toMatch(/refusing to add demo data/);
    // the defaults file holds only settings and caps, never demo rows
    const defaults = readFileSync(join(root, "supabase/defaults.sql"), "utf8");
    expect(defaults).not.toMatch(/insert into public\.(offers|case_studies|inboxes|campaigns|suppression|contacts|companies|campaign_leads)/);
  });

  it("no tool configuration points at a seed file", () => {
    const configs = [join(root, "package.json"), join(root, "apps/worker/package.json"), join(root, "apps/web/package.json"), join(root, "packages/db/package.json")];
    for (const c of configs) expect(readFileSync(c, "utf8"), rel(c)).not.toMatch(/seed/i);
    expect(existsSync(join(root, "supabase/config.toml"))).toBe(false); // a config.toml with [db.seed] would load demo data on every reset
  });

  it("no product source mentions the demo seed or its fixed ids", () => {
    const offenders = sources.filter((f) => {
      const text = readFileSync(f, "utf8");
      return /demo_seed|seed\.sql/.test(text) || /00000000-0000-4000-8000-0000000000[a-d]\d/.test(text);
    });
    // lib/demo-data.ts only RECOGNISES the demo records (to label and archive them); it never creates them
    expect(offenders.map(rel).filter((f) => f !== "apps/web/src/lib/demo-data.ts")).toEqual([]);
  });

  it("the worker never creates offers, campaigns, case studies or mailboxes, and startup inserts nothing but the heartbeat", () => {
    const worker = walk(join(root, "apps/worker/src"));
    for (const f of worker) {
      const text = readFileSync(f, "utf8");
      expect(text, rel(f)).not.toMatch(/from\("(offers|campaigns|case_studies|inboxes)"\)\s*\.(insert|upsert)/);
    }
    const index = readFileSync(join(root, "apps/worker/src/index.ts"), "utf8");
    expect(index).not.toMatch(/\.insert\(|\.upsert\(/);
  });

  it("in the web app, rows for offers, campaigns, case studies and mailboxes are only written by server actions a person triggers", () => {
    const web = walk(join(root, "apps/web/src")).filter((f) => !/actions?\.ts$/.test(f));
    for (const f of web) {
      const text = readFileSync(f, "utf8");
      expect(text, rel(f)).not.toMatch(/from\("(offers|campaigns|case_studies|inboxes)"\)\s*\.(insert|upsert)/);
    }
  });
});
