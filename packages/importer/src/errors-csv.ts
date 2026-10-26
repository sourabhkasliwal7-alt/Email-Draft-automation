import { toCsv } from "@outreach/core";

export interface ErrorRow {
  row_number: number;
  status: string;
  errors: string[];
  original: Record<string, string>;
}

/**
 * CSV of every row that was not imported, with the reason, so the user can fix and re-upload it.
 * Cells that start with = + - @ tab or CR are prefixed with a quote (spreadsheet formula injection).
 */
export function buildErrorCsv(rows: ErrorRow[], headers: string[]): string {
  const flat = rows.map((r) => ({ row_number: r.row_number, status: r.status, errors: r.errors.join(" | "), ...r.original }));
  const cols = ["row_number", "status", "errors", ...headers.filter((h) => !["row_number", "status", "errors"].includes(h))];
  return "﻿" + toCsv(flat, cols);
}
