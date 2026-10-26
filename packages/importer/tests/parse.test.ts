import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ImportParseError, MAX_ROWS, autoDetectMapping, decodeBytes, normalizeRow, readTable, sha256Hex } from "../src";

const fx = (name: string) => ({ name, bytes: new Uint8Array(readFileSync(join(__dirname, "../../../tests/fixtures/imports", name))) });
const rowsAsObjects = (t: Awaited<ReturnType<typeof readTable>>) => t.rows.map((r) => Object.fromEntries(t.headers.map((h, i) => [h, r[i]!])));

describe("encodings", () => {
  it("UTF-8 BOM: the BOM is stripped so the first header is clean", async () => {
    const t = await readTable(fx("utf8-bom.csv"));
    expect(t.encoding).toBe("utf-8");
    expect(t.headers[0]).toBe("First Name");
    expect(t.rows).toHaveLength(3);
    expect(t.delimiter).toBe(",");
  });

  it("Windows-1252 file: accents survive", async () => {
    const t = await readTable(fx("windows-1252.csv"));
    expect(t.encoding).toBe("windows-1252");
    const [a, b] = rowsAsObjects(t);
    expect(a).toMatchObject({ "First Name": "José", "Last Name": "Müller", Company: "Béta Ltd", Title: "Directeur général" });
    expect(b).toMatchObject({ "First Name": "Zoë", "Last Name": "Åberg" });
  });

  it("UTF-16 LE with BOM", async () => {
    const t = await readTable(fx("utf16le.csv"));
    expect(t.encoding).toBe("utf-16le");
    expect(rowsAsObjects(t)[0]).toMatchObject({ "First Name": "Una", Email: "una@chi.example.com" });
  });

  it("Hindi, Chinese and accented names are kept intact", async () => {
    const t = await readTable(fx("hindi-accented.csv"));
    const names = t.rows.map((r) => r[0]);
    expect(names).toEqual(["राहुल शर्मा", "Zoë Müller", "José Álvarez", "李雷"]);
    const mapping = autoDetectMapping(t.headers);
    const n = normalizeRow(rowsAsObjects(t)[0]!, mapping);
    expect(n.first_name).toBe("राहुल");
    expect(n.last_name).toBe("शर्मा");
    expect(n.company_name).toBe("सिग्मा");
  });

  it("decodeBytes never throws on invalid UTF-8", () => {
    expect(decodeBytes(new Uint8Array([0x41, 0xe9, 0x42])).text).toBe("AéB");
  });
});

describe("CSV structure", () => {
  it("detects a semicolon delimiter", async () => {
    const t = await readTable(fx("semicolon.csv"));
    expect(t.delimiter).toBe(";");
    expect(t.headers).toEqual(["First Name", "Last Name", "Email", "Company", "Title"]);
    expect(t.rows).toHaveLength(2);
  });

  it("keeps quoted commas, escaped quotes and embedded newlines inside their cells", async () => {
    const t = await readTable(fx("quoted-commas-newlines.csv"));
    const [a, b] = rowsAsObjects(t);
    expect(a).toMatchObject({ Company: "Epsilon, Inc.", Title: "Head of\nOperations" });
    expect(b).toMatchObject({ Company: 'Epsilon "Labs", Inc.' });
    expect(t.rows).toHaveLength(2);
  });

  it("drops blank rows (incl. rows of only commas / spaces) but keeps original row numbers", async () => {
    const t = await readTable(fx("blank-rows.csv"));
    expect(t.rows.map((r) => r[0])).toEqual(["Fay", "Gus"]);
    expect(t.rowNumbers).toEqual([3, 6]);
    expect(t.blankRows).toBeGreaterThanOrEqual(4);
    expect(t.warnings.join(" ")).toMatch(/blank rows? ignored/);
  });

  it("renames duplicate header names and keeps both values", async () => {
    const t = await readTable(fx("duplicate-headers.csv"));
    expect(t.headers).toEqual(["Name", "Email", "Name_2", "Company"]);
    expect(rowsAsObjects(t)[0]).toMatchObject({ Name: "Hal Roe", Name_2: "Hal R." });
    expect(t.warnings.join(" ")).toMatch(/Duplicate column names were renamed/);
  });

  it("detects a missing header row and lets the user override the guess", async () => {
    const t = await readTable(fx("no-header.csv"));
    expect(t.hasHeader).toBe(false);
    expect(t.headers).toEqual(["Column 1", "Column 2", "Column 3", "Column 4"]);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]![0]).toBe("Jo Park");
    const forced = await readTable(fx("no-header.csv"), { firstRowIsHeader: true });
    expect(forced.headers[0]).toBe("Jo Park");
    expect(forced.rows).toHaveLength(1);
  });

  it("refuses a file over 50,000 rows with a clear message, and accepts exactly 50,000", async () => {
    const make = (n: number) => new TextEncoder().encode("First Name,Email\n" + Array.from({ length: n }, (_, i) => `P${i},p${i}@big.example.com`).join("\n") + "\n");
    await expect(readTable({ name: "big.csv", bytes: make(MAX_ROWS + 1) })).rejects.toMatchObject({
      code: "too_many_rows",
      message: expect.stringContaining("50,001 data rows. The limit is 50,000"),
    });
    const ok = await readTable({ name: "ok.csv", bytes: make(MAX_ROWS) });
    expect(ok.rows).toHaveLength(MAX_ROWS);
  });

  it("rejects empty files and old .xls with an actionable message", async () => {
    await expect(readTable({ name: "e.csv", bytes: new Uint8Array() })).rejects.toBeInstanceOf(ImportParseError);
    await expect(readTable({ name: "x.csv", bytes: new TextEncoder().encode("a,b\n") })).rejects.toMatchObject({ code: "empty" });
    await expect(readTable({ name: "old.xls", bytes: new Uint8Array([1, 2, 3]) })).rejects.toMatchObject({ code: "unsupported" });
  });

  it("hashing the same bytes twice gives the same hash (used to warn about re-uploads)", () => {
    const a = fx("utf8-bom.csv").bytes;
    expect(sha256Hex(a)).toBe(sha256Hex(new Uint8Array(a)));
    expect(sha256Hex(a)).not.toBe(sha256Hex(fx("semicolon.csv").bytes));
  });
});

describe("Excel", () => {
  it("lists every worksheet, defaults to the fullest one, and lets the user pick another", async () => {
    const t = await readTable(fx("excel-types.xlsx"));
    expect(t.sheetNames).toEqual(["Notes", "Leads", "Other"]);
    expect(t.sheet).toBe("Leads");
    const other = await readTable(fx("excel-types.xlsx"), { sheet: "Other" });
    expect(other.sheet).toBe("Other");
    expect(other.rows).toEqual([["Pat Cox", "pat@other.example.com"]]);
    await expect(readTable(fx("excel-types.xlsx"), { sheet: "Nope" })).rejects.toMatchObject({ code: "sheet_not_found" });
  });

  it("turns dates, numbers, numbers-as-text, links, formulas and rich text into text", async () => {
    const t = await readTable(fx("excel-types.xlsx"));
    const rows = rowsAsObjects(t);
    expect(rows[0]).toMatchObject({
      Employees: "1200",
      Zip: "00501", // text cell: leading zeros kept
      "Signed Up": "2026-09-01",
      Profile: "https://www.linkedin.com/in/yan-zed/",
      Score: "70",
    });
    expect(rows[1]).toMatchObject({ Employees: "300", "Signed Up": "2026-10-15T13:30:00.000Z", Score: "20" });
    expect(rows).toHaveLength(3); // the empty row is dropped
    expect(rows[2]!.Email).toBe("ola@omega.example.com");
    expect(t.rowNumbers).toEqual([2, 3, 5]);
  });
});
