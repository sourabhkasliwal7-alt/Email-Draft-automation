import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: join(__dirname, "../../../.env") });

const testsDir = join(__dirname, "../../../supabase/tests");
const url = process.env.DATABASE_URL ?? "";
const hasDb = /^postgres(ql)?:\/\//.test(url);
if (!hasDb) {
  console.warn(
    "[db tests] DATABASE_URL is not a real connection string; SQL suites are NOT run by vitest. " +
      "Run them via the Supabase MCP (see PROGRESS.md) or set DATABASE_URL. Tracked in BLOCKERS.md.",
  );
}

const helpers = readFileSync(join(testsDir, "_helpers.sql"), "utf8");
const suites = readdirSync(testsDir)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort();

// Each suite ends with `raise exception 'SUITE_OK'`, so every fixture row is rolled back.
describe.skipIf(!hasDb)("database SQL suites", () => {
  let client: pg.Client;
  beforeAll(async () => {
    client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });

  for (const file of suites) {
    it(file, async () => {
      const sql = helpers + "\n" + readFileSync(join(testsDir, file), "utf8");
      await expect(client.query(sql)).rejects.toThrow(/SUITE_OK/);
    });
  }
});

describe("suite files", () => {
  it("every suite ends in SUITE_OK so it always rolls back", () => {
    expect(suites.length).toBeGreaterThanOrEqual(3);
    for (const f of suites) {
      expect(readFileSync(join(testsDir, f), "utf8")).toContain("raise exception 'SUITE_OK'");
    }
  });
});
