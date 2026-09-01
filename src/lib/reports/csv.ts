export interface CsvColumn<T> {
  key: keyof T;
  header: string;
}

// A cell that starts with one of these renders as a live formula in
// Excel/Sheets when the CSV is opened -- report data (display names,
// article titles) is user-influenced, so every cell is neutralized with
// a leading `'` before RFC4180 quoting is applied. See THREAT_MODEL.md.
const FORMULA_TRIGGER_CHARS = new Set(["=", "+", "-", "@"]);

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isNaN(value)) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function escapeCell(raw: string): string {
  const neutralized = FORMULA_TRIGGER_CHARS.has(raw[0] ?? "") ? `'${raw}` : raw;
  if (/[",\r\n]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
}

/** Renders rows as RFC4180 CSV, prefixed with a UTF-8 BOM for Excel. */
export function toCsv<T>(rows: T[], columns: Array<CsvColumn<T>>): string {
  const lines = [
    columns.map((c) => escapeCell(c.header)).join(","),
    ...rows.map((row) =>
      columns.map((c) => escapeCell(cellToString(row[c.key]))).join(","),
    ),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}
