import {
  CURRENCY_AMOUNT,
  localIsoDate,
  neutralizeFormulaCell,
} from "@repo/formatting";
import { type ErrorCopyOptions, errorCopy } from "@repo/hooks/error-copy";
import { signetDarkTokens } from "@repo/theme/signet";
import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge sorts a `text-*` class it does not recognise as a size into
 * the text-colour group, and it cannot recognise the Signet type keys
 * (`text-caption`, `text-label`, …): they are names, not lengths or t-shirt
 * sizes. Unregistered, `cn("text-muted-foreground", "text-caption")` returns
 * `"text-caption"`, dropping the colour as a "conflict", and the reverse order
 * drops the size. It shipped that way: the 404/error crest's code label
 * (`crest-page.tsx`) lost its `text-caption` to `text-primary` and rendered at
 * 16px (#2842). The keys are the §7 roles, which the shared preset binds one to
 * one; `utils.spec.ts` holds the two lists together.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: Object.keys(signetDarkTokens.typography.role) }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Up-to-two-letter avatar fallback for a display name (e.g. "Jane Smith" → "JS"). */
export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

/**
 * Guard-parse a raw text-input string into a nonnegative-by-default integer:
 * trim, then only commit a safe integer >= `min` (default 0). Anything else
 * (empty, negative, decimal, NaN, Infinity, or an integer too large to hold
 * exactly) returns `undefined` so the caller can leave the previous value in
 * place. The empty check is explicit because `Number("")` is `0`, not `NaN`.
 *
 * This is the guard for `apps/web`'s integer inputs (`spec/engineering.md`
 * § Input handling): `min` on an `<input>` never stops `onChange` from handing
 * over `-3` or `1.5`. A `type="number"` input reports text it can't parse
 * (`abc`, `1e999`, a lone `-`) as `""`, so those reach a caller as a cleared
 * field. A field that takes a decimal, a sign, or a range with its own inline
 * error checks at submit instead: the invoice amount, the points adjustment
 * and the founded year do. Don't loosen this one to fit them.
 */
export function parseGuardedInt(raw: string, min = 0): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < min) return undefined;
  return parsed;
}

/**
 * {@link parseGuardedInt}'s sibling for a field that takes a decimal (service
 * hours, where `1.5` is 90 minutes as on mobile): a finite number >= `min`,
 * no larger than `Number.MAX_SAFE_INTEGER`, or `undefined`.
 */
export function parseGuardedDecimal(raw: string, min = 0): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < min) return undefined;
  if (parsed > Number.MAX_SAFE_INTEGER) return undefined;
  return parsed;
}

function guardDraft(
  raw: string,
  parse: (text: string) => number | undefined,
): string | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  return parse(trimmed) === undefined ? undefined : trimmed;
}

/**
 * The keystroke guard for an integer input whose draft is held as text, so
 * the field can be cleared and stays cleared: `""` for an empty input, the
 * trimmed text when {@link parseGuardedInt} accepts it, and `undefined` for
 * anything else, so the caller keeps the previous draft.
 *
 * It has no floor above 0, on purpose. Deleting the 3 of "30" leaves a
 * transient "0", and a year passes through "2" on the way to "2026", so a
 * field's own floor is checked at submit, where `parseGuardedInt(draft, min)`
 * reads the draft.
 */
export function guardIntDraft(raw: string): string | undefined {
  return guardDraft(raw, (text) => parseGuardedInt(text));
}

/** {@link guardIntDraft} for a decimal field; see {@link parseGuardedDecimal}. */
export function guardDecimalDraft(raw: string): string | undefined {
  return guardDraft(raw, (text) => parseGuardedDecimal(text));
}

/**
 * The member's words for a caught error (a toast description, an inline
 * error): what to do next, from the shared map in `@repo/hooks`
 * (`errorCopy`), with `fallback` for a failure whose meaning depends on the
 * screen. It never shows a raw server message (principles.md P2.3).
 */
export function getErrorMessage(
  error: unknown,
  fallback: string,
  options?: ErrorCopyOptions,
): string {
  return errorCopy(error, fallback, options);
}

/**
 * `"Due Fri, Nov 6"`: a label before a formatted value, or null when the value
 * didn't format. The house date helpers return null for a value they can't
 * read, so guarding on the raw field and interpolating the result printed
 * "Due null" for a malformed date. Guard on the formatted value instead.
 */
export function labelled(
  label: string,
  formatted: string | null,
): string | null {
  return formatted ? `${label} ${formatted}` : null;
}

/** Escape one CSV cell per RFC 4180 (quote when it contains a comma, quote, or newline). */
export function quoteCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Column order for an export: every row's own keys, in first-seen order. */
function exportHeaders(rows: Record<string, string>[]): string[] {
  const headerSet = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) headerSet.add(key);
  }
  return Array.from(headerSet);
}

/**
 * Serialize flat row objects to a CSV string: UTF-8 BOM + CRLF line endings so
 * Excel renders umlauts/emoji correctly and downstream spreadsheet behavior
 * stays predictable without extra client libs. Column order is the union of
 * every row's own keys, in first-seen order, so rows with different shapes
 * still produce one header. Formula-shaped cells are made inert
 * (`neutralizeFormulaCell`). Shared by every dashboard export (Points,
 * Billing, Reports) through `exportRows` rather than each hand-rolling the
 * same escaping and BOM/CRLF handling.
 */
export function rowsToCsv(rows: Record<string, string>[]): string {
  if (rows.length === 0) return "";
  const headers = exportHeaders(rows);
  const cell = (value: string) => quoteCsvCell(neutralizeFormulaCell(value));
  const lines = [headers.map(cell).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => cell(row[header] ?? "")).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

/**
 * Serialize rows as tab-separated text for the clipboard, the shape Google
 * Sheets (and Excel) split into cells on paste. A tab or line break inside a
 * cell would start a new cell or row there, so each becomes a space;
 * formula-shaped cells are made inert the same way the CSV's are, and before
 * the flattening, so a cell that led with a tab still gets its apostrophe. A
 * cell holding a double quote is quoted the way the CSV's is: a paste reads a
 * leading `"` as the start of a quoted cell and would otherwise swallow the
 * cells after it.
 */
export function rowsToTsv(rows: Record<string, string>[]): string {
  if (rows.length === 0) return "";
  const headers = exportHeaders(rows);
  const cell = (value: string) => {
    const flat = neutralizeFormulaCell(value).replace(/[\t\r\n]+/g, " ");
    return flat.includes('"') ? `"${flat.replace(/"/g, '""')}"` : flat;
  };
  const lines = [headers.map(cell).join("\t")];
  for (const row of rows) {
    lines.push(headers.map((header) => cell(row[header] ?? "")).join("\t"));
  }
  return lines.join("\n");
}

/** One `.xlsx` cell: a typed value with its number format, or empty. */
export type XlsxCell =
  | { value: string; type: StringConstructor }
  | { value: number; type: NumberConstructor; format?: string }
  | { value: Date; type: DateConstructor; format: string }
  | null;

type XlsxColumnKind = "number" | "currency" | "date" | "datetime" | "text";

// No leading zeros (a zip code or a roll number is text) and at most 15
// digits, the most a spreadsheet number holds exactly.
const XLSX_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

function xlsxCellKind(value: string): XlsxColumnKind {
  if (XLSX_NUMBER.test(value) && value.replace(/\D/g, "").length <= 15) {
    return "number";
  }
  if (CURRENCY_AMOUNT.test(value)) return "currency";
  if (ISO_DATE.test(value) && !Number.isNaN(Date.parse(value))) return "date";
  if (ISO_DATETIME.test(value) && !Number.isNaN(Date.parse(value))) {
    return "datetime";
  }
  return "text";
}

/**
 * Rows as a typed `.xlsx` grid: a bold header row, then one row per record.
 *
 * The exports hand over strings (the CSV's shape), so a column's type is read
 * back from them: a column is numbers, currency, dates or timestamps only when
 * every non-empty cell in it is, and text otherwise. Deciding per column, not
 * per cell, keeps one stray value from splitting a column into two types that
 * sort apart. Timestamps are written in UTC, since a workbook cell carries no
 * time zone. Text cells are typed as text, so a formula-shaped string is shown,
 * never evaluated.
 */
export function rowsToXlsxData(rows: Record<string, string>[]): XlsxCell[][] {
  const headers = exportHeaders(rows);
  const kinds = headers.map((header): XlsxColumnKind => {
    let kind: XlsxColumnKind | null = null;
    for (const row of rows) {
      const value = row[header] ?? "";
      if (value === "") continue;
      const cellKind = xlsxCellKind(value);
      if (kind !== null && kind !== cellKind) return "text";
      kind = cellKind;
    }
    return kind ?? "text";
  });
  const data: XlsxCell[][] = [
    headers.map((header) => ({ value: header, type: String })),
  ];
  for (const row of rows) {
    data.push(
      headers.map((header, index): XlsxCell => {
        const value = row[header] ?? "";
        if (value === "") return null;
        switch (kinds[index]) {
          case "number":
            return { value: Number(value), type: Number };
          case "currency":
            return {
              value: Number(value.replace(/[$,]/g, "")),
              type: Number,
              format: "$#,##0.00",
            };
          case "date":
            return { value: new Date(value), type: Date, format: "yyyy-mm-dd" };
          case "datetime":
            return {
              value: new Date(value),
              type: Date,
              format: "yyyy-mm-dd hh:mm:ss",
            };
          default:
            return { value, type: String };
        }
      }),
    );
  }
  return data;
}

/**
 * Trigger a browser download of in-memory bytes: object URL → hidden anchor
 * → click → revoke. Shared so the object URL is always revoked and the
 * anchor always removed, even if `.click()` throws — a bare inline copy of
 * this sequence (as `reports-page.tsx`'s CSV export and the events detail
 * sheet's calendar export each had) leaks both on that path.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof window === "undefined") return;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
}

/** `frapp-<filenamePrefix>-<date>.<extension>`, the one export filename shape. */
function exportFilename(filenamePrefix: string, extension: string): string {
  // The member's own day, not UTC's: an evening export in the Americas would
  // otherwise be dated tomorrow.
  return `frapp-${filenamePrefix}-${localIsoDate(new Date())}.${extension}`;
}

/**
 * Serialize rows to CSV and download them as `frapp-<filenamePrefix>-<date>.csv`.
 * Shared so the MIME type and filename convention live in one place.
 */
export function downloadCsv(
  rows: Record<string, string>[],
  filenamePrefix: string,
): void {
  const blob = new Blob([rowsToCsv(rows)], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, exportFilename(filenamePrefix, "csv"));
}

/**
 * Write rows to a real Excel workbook and download it as
 * `frapp-<filenamePrefix>-<date>.xlsx`.
 *
 * The writer (`write-excel-file`) is imported here, on demand, so it reaches
 * the browser only when someone picks Excel, never with a page's first load.
 */
export async function downloadXlsx(
  rows: Record<string, string>[],
  filenamePrefix: string,
): Promise<void> {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const data = rowsToXlsxData(rows).map((row, rowIndex) =>
    rowIndex === 0
      ? row.map((cell) => (cell ? { ...cell, fontWeight: "bold" as const } : cell))
      : row,
  );
  // The writer does no auto-fit, and a date cell wider than its column shows
  // as ######## in Excel, so size each column to its longest value.
  const columns = exportHeaders(rows).map((header) => ({
    width: Math.min(
      60,
      Math.max(header.length, ...rows.map((row) => (row[header] ?? "").length)) +
        2,
    ),
  }));
  const blob = await writeXlsxFile(data, {
    stickyRowsCount: 1,
    columns,
  }).toBlob();
  downloadBlob(blob, exportFilename(filenamePrefix, "xlsx"));
}

/** The file types an export offers, in menu order. */
export const EXPORT_FORMATS = ["csv", "xlsx", "sheets"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/**
 * Hand rows to the member in the format they picked: a `.csv` download, an
 * `.xlsx` download, or tab-separated text on the clipboard to paste into a
 * Google Sheet (no Google account connection involved). The one entry point
 * behind `ExportMenu`, so Points, Billing and Reports cannot drift apart.
 * Rejects when the workbook cannot be built or the clipboard is refused.
 */
export async function exportRows(
  rows: Record<string, string>[],
  filenamePrefix: string,
  format: ExportFormat,
): Promise<void> {
  if (format === "xlsx") {
    await downloadXlsx(rows, filenamePrefix);
  } else if (format === "sheets") {
    await navigator.clipboard.writeText(rowsToTsv(rows));
  } else {
    downloadCsv(rows, filenamePrefix);
  }
}

const EXPORT_FORMAT_STORAGE_KEY = "frapp.export-format";

/**
 * The file type this browser last exported with, or null. localStorage,
 * best-effort: a private window or blocked site data throws or reads empty,
 * and the menu then marks nothing.
 */
export function readLastExportFormat(): ExportFormat | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(EXPORT_FORMAT_STORAGE_KEY);
    return EXPORT_FORMATS.find((format) => format === stored) ?? null;
  } catch {
    return null;
  }
}

export function rememberExportFormat(format: ExportFormat): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(EXPORT_FORMAT_STORAGE_KEY, format);
  } catch {
    // Remembering is a convenience; the export itself already happened.
  }
}
