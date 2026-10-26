/**
 * Neutralise spreadsheet formula injection in exported CSV cells: a cell that starts with = + - @ tab or CR
 * is prefixed with a single quote so Excel/Sheets treat it as text.
 */
export function protectCsvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [columns.map(esc).join(",")];
  for (const row of rows) lines.push(columns.map((c) => esc(protectCsvCell(row[c]))).join(","));
  return lines.join("\r\n");
}
