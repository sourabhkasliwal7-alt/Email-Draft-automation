import Papa from "papaparse";
import { normalizeDomain, normalizeEmail } from "@outreach/core";

export const MAX_SUPPRESSION_ROWS = 20000;

export interface ParsedSuppression {
  entries: { email_lower: string | null; domain: string | null; reason: string | null }[];
  invalid: { row: number; value: string; problem: string }[];
  duplicatesInFile: number;
  tooMany: boolean;
}

/**
 * Parses an uploaded suppression list. Accepts either a header row with `email` and/or `domain` (+ optional
 * `reason`) columns, or a single column of values where anything containing "@" is an email and the rest are domains.
 * Never throws on bad rows: they are reported individually.
 */
export function parseSuppressionCsv(text: string): ParsedSuppression {
  const clean = text.replace(/^﻿/, "");
  const rows = Papa.parse<string[]>(clean, { skipEmptyLines: "greedy" }).data;
  const result: ParsedSuppression = { entries: [], invalid: [], duplicatesInFile: 0, tooMany: false };
  if (rows.length === 0) return result;

  const first = rows[0]!.map((c) => c.trim().toLowerCase());
  const emailCol = first.indexOf("email");
  const domainCol = first.indexOf("domain");
  const reasonCol = first.indexOf("reason");
  const hasHeader = emailCol >= 0 || domainCol >= 0;
  const body = hasHeader ? rows.slice(1) : rows;
  if (body.length > MAX_SUPPRESSION_ROWS) {
    result.tooMany = true;
    return result;
  }

  const seen = new Set<string>();
  body.forEach((cells, i) => {
    const rowNumber = i + (hasHeader ? 2 : 1);
    const raw = (hasHeader ? (emailCol >= 0 && cells[emailCol]?.trim() ? cells[emailCol] : domainCol >= 0 ? cells[domainCol] : "") : cells[0]) ?? "";
    const value = raw.trim();
    if (!value) return result.invalid.push({ row: rowNumber, value: "", problem: "empty value" });
    const reason = reasonCol >= 0 ? cells[reasonCol]?.trim() || null : null;
    const isEmail = value.includes("@");
    const email = isEmail ? normalizeEmail(value) : null;
    const domain = isEmail ? null : normalizeDomain(value);
    if (isEmail ? !email : !domain) return result.invalid.push({ row: rowNumber, value, problem: isEmail ? "not a valid email" : "not a valid domain" });
    const key = email ? `e:${email}` : `d:${domain}`;
    if (seen.has(key)) {
      result.duplicatesInFile++;
      return;
    }
    seen.add(key);
    result.entries.push({ email_lower: email, domain, reason });
  });
  return result;
}
