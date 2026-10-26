import ExcelJS from "exceljs";
import Papa from "papaparse";
import { decodeBytes, type DetectedEncoding } from "./encoding";

export const MAX_ROWS = 50_000;

export class ImportParseError extends Error {
  constructor(
    public readonly code: "too_many_rows" | "unsupported" | "empty" | "unreadable" | "sheet_not_found",
    message: string,
  ) {
    super(message);
    this.name = "ImportParseError";
  }
}

export interface ParsedTable {
  /** one entry per worksheet for XLSX; ["(csv)"] for text files */
  sheetNames: string[];
  sheet: string;
  headers: string[];
  /** header text exactly as in the file (before de-duplication / auto-naming) */
  rawHeaders: string[];
  hasHeader: boolean;
  /** data rows, padded to the header width; blank rows removed */
  rows: string[][];
  /** original row number in the file for each data row (1-based, counting the header and blank rows) */
  rowNumbers: number[];
  blankRows: number;
  encoding: DetectedEncoding | null;
  delimiter: string | null;
  warnings: string[];
}

export interface ReadOptions {
  sheet?: string;
  /** undefined = auto-detect */
  firstRowIsHeader?: boolean;
}

const EMAILISH = /[^\s@]+@[^\s@]+\.[^\s@]+/;

function isBlank(row: string[]) {
  return row.every((c) => c.trim() === "");
}

/** Counts a delimiter outside quotes in the first non-empty line. */
export function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const counts = new Map<string, number>([
    [",", 0],
    [";", 0],
    ["\t", 0],
    ["|", 0],
  ]);
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && counts.has(ch)) counts.set(ch, counts.get(ch)! + 1);
  }
  let best = ",";
  let bestCount = 0;
  for (const [d, n] of counts) {
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

/** A first row is data (not a header) if any cell looks like an email, a URL or a number. */
function looksLikeData(row: string[]): boolean {
  return row.some((c) => {
    const v = c.trim();
    return EMAILISH.test(v) || /^https?:\/\//i.test(v) || /^[\d.,\s+-]+$/.test(v) && /\d/.test(v);
  });
}

/** Unique, non-empty header names: blanks become "Column N", repeats get _2, _3 ... */
export function dedupeHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    const base = h.trim() === "" ? `Column ${i + 1}` : h.trim();
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), n);
    return n === 1 ? base : `${base}_${n}`;
  });
}

function buildTable(
  matrix: string[][],
  physicalRows: number[],
  base: Pick<ParsedTable, "sheetNames" | "sheet" | "encoding" | "delimiter">,
  opts: ReadOptions,
): ParsedTable {
  const warnings: string[] = [];
  const entries = matrix.map((cells, i) => ({ cells, row: physicalRows[i]! }));
  const firstIdx = entries.findIndex((e) => !isBlank(e.cells));
  if (firstIdx < 0) throw new ImportParseError("empty", "The file has no data.");

  const width = Math.max(...entries.map((e) => e.cells.length));
  const pad = (cells: string[]) => (cells.length < width ? [...cells, ...Array<string>(width - cells.length).fill("")] : cells);

  const first = pad(entries[firstIdx]!.cells);
  const hasHeader = opts.firstRowIsHeader ?? !looksLikeData(first);
  const rawHeaders = hasHeader ? first : first.map((_, i) => `Column ${i + 1}`);
  const headers = dedupeHeaders(rawHeaders);
  if (hasHeader && headers.some((h, i) => h !== rawHeaders[i]!.trim() && rawHeaders[i]!.trim() !== "")) {
    warnings.push("Duplicate column names were renamed (second copy becomes Name_2).");
  }
  if (!hasHeader) warnings.push("No header row detected: columns are named Column 1, Column 2, ... Map them by position.");

  const dataEntries = entries.slice(hasHeader ? firstIdx + 1 : firstIdx);
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  let blankRows = 0;
  for (const e of dataEntries) {
    if (isBlank(e.cells)) {
      blankRows++;
      continue;
    }
    rows.push(pad(e.cells));
    rowNumbers.push(e.row);
  }
  if (rows.length === 0) throw new ImportParseError("empty", "The file has a header but no data rows.");
  if (rows.length > MAX_ROWS) {
    throw new ImportParseError(
      "too_many_rows",
      `This file has ${rows.length.toLocaleString("en-US")} data rows. The limit is ${MAX_ROWS.toLocaleString("en-US")} per file. Split it and import the parts one by one.`,
    );
  }
  if (blankRows) warnings.push(`${blankRows} blank row${blankRows === 1 ? "" : "s"} ignored.`);
  return { ...base, headers, rawHeaders, hasHeader, rows, rowNumbers, blankRows, warnings };
}

function isZip(bytes: Uint8Array) {
  return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export function isXlsx(name: string, bytes: Uint8Array) {
  return /\.(xlsx|xlsm)$/i.test(name) || (isZip(bytes) && !/\.(csv|txt|tsv)$/i.test(name));
}

function parseCsv(bytes: Uint8Array, opts: ReadOptions): ParsedTable {
  const { text, encoding } = decodeBytes(bytes);
  if (text.trim() === "") throw new ImportParseError("empty", "The file is empty.");
  const delimiter = detectDelimiter(text);
  const result = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: false });
  const matrix = result.data.map((r) => r.map((c) => (typeof c === "string" ? c : String(c ?? ""))));
  // Papaparse yields a trailing [""] row for a final newline; it is just blank and gets dropped later.
  const physical = matrix.map((_, i) => i + 1);
  return buildTable(matrix, physical, { sheetNames: ["(csv)"], sheet: "(csv)", encoding, delimiter }, opts);
}

/** Text of one cell, whatever ExcelJS gives us (dates, rich text, formulas, hyperlinks, numbers). */
function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  }
  if (typeof v === "number") return cell.text || String(v);
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("result" in v && v.result !== undefined && v.result !== null) {
      const r = v.result;
      if (r instanceof Date) return r.toISOString().slice(0, 10);
      return typeof r === "object" ? "" : String(r);
    }
    // The link target is the useful value (a Profile column shows a label; the URL is what we need).
    if ("hyperlink" in v) return String(v.hyperlink).replace(/^mailto:/i, "");
    if ("error" in v) return "";
  }
  return cell.text ?? "";
}

async function parseXlsx(bytes: Uint8Array, opts: ReadOptions): Promise<ParsedTable> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    throw new ImportParseError("unreadable", "That Excel file could not be read. Re-save it as .xlsx or export a CSV.");
  }
  const sheets = wb.worksheets;
  if (sheets.length === 0) throw new ImportParseError("empty", "The workbook has no worksheets.");
  const names = sheets.map((s) => s.name);
  const ws = opts.sheet ? sheets.find((s) => s.name === opts.sheet) : [...sheets].sort((a, b) => b.actualRowCount - a.actualRowCount)[0];
  if (!ws) throw new ImportParseError("sheet_not_found", `Worksheet "${opts.sheet}" was not found.`);

  const matrix: string[][] = [];
  const physical: number[] = [];
  const cols = ws.columnCount;
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= cols; c++) cells.push(cellText(row.getCell(c)));
    matrix.push(cells);
    physical.push(r);
  }
  if (matrix.length === 0) throw new ImportParseError("empty", `Worksheet "${ws.name}" is empty.`);
  return buildTable(matrix, physical, { sheetNames: names, sheet: ws.name, encoding: null, delimiter: null }, opts);
}

/** Reads a CSV/TSV/TXT or XLSX upload into a clean table. */
export async function readTable(input: { name: string; bytes: Uint8Array }, opts: ReadOptions = {}): Promise<ParsedTable> {
  if (input.bytes.length === 0) throw new ImportParseError("empty", "The file is empty.");
  if (/\.xls$/i.test(input.name)) {
    throw new ImportParseError("unsupported", "Old .xls files are not supported. Save the sheet as .xlsx or CSV and upload that.");
  }
  return isXlsx(input.name, input.bytes) ? parseXlsx(input.bytes, opts) : parseCsv(input.bytes, opts);
}
