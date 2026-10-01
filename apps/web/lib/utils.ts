import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

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
 * trim, then only commit a finite integer >= `min` (default 0). Anything else
 * (empty, negative, decimal, NaN, `"1e999"`'s Infinity) returns `undefined`
 * so the caller can leave the previous value in place. The empty check is
 * explicit because `Number("")` is `0`, not `NaN`.
 *
 * This is the guard for every numeric input in `apps/web`
 * (`spec/engineering.md` § Input handling): `min`/`max` on an `<input>` are
 * advisory and never stop `onChange` from handing over `-3`, `1.5` or
 * `1e999`. Every API field these inputs feed is an integer; if one ever needs
 * a float, add a sibling rather than loosening this one.
 */
export function parseGuardedInt(raw: string, min = 0): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < min) return undefined;
  return parsed;
}

/**
 * The keystroke guard for a numeric input whose draft is held as text, so the
 * field can be cleared: `""` for an empty input, the trimmed text when
 * {@link parseGuardedInt} accepts it, and `undefined` for anything else, so
 * the caller keeps the previous draft. Submit then reads the draft with
 * `parseGuardedInt`, which can only see an integer `>= min` or `""`.
 *
 * Keep `min` at what a half-typed value can satisfy: a year field guarded at
 * 1900 would refuse the "2" on the way to "2026", so a floor above 1 belongs
 * to the API's validation, not this guard.
 */
export function guardIntDraft(raw: string, min = 0): string | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  return parseGuardedInt(trimmed, min) === undefined ? undefined : trimmed;
}

/** Human-readable message for caught errors (e.g. toast descriptions). */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: string }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return fallback;
}

/** Escape one CSV cell per RFC 4180 (quote when it contains a comma, quote, or newline). */
export function quoteCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Serialize flat row objects to a CSV string: UTF-8 BOM + CRLF line endings so
 * Excel renders umlauts/emoji correctly and downstream spreadsheet behavior
 * stays predictable without extra client libs. Column order is the union of
 * every row's own keys, in first-seen order, so rows with different shapes
 * still produce one header. Shared by the reports CSV export and the
 * dashboard bulk-export actions (Billing, Points) rather than each hand-rolling
 * the same escaping and BOM/CRLF handling.
 */
export function rowsToCsv(rows: Record<string, string>[]): string {
  if (rows.length === 0) return "";
  const headerSet = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) headerSet.add(key);
  }
  const headers = Array.from(headerSet);
  const lines = [headers.map(quoteCsvCell).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => quoteCsvCell(row[header] ?? "")).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}`;
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

/**
 * Serialize rows to CSV and download them as `frapp-<filenamePrefix>-<date>.csv`.
 * Shared so the MIME type and filename convention live in one place — the
 * reports export and the dashboard bulk-export actions (Billing, Points) used
 * to each hand-roll this same three-line sequence.
 */
export function downloadCsv(rows: Record<string, string>[], filenamePrefix: string): void {
  const blob = new Blob([rowsToCsv(rows)], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `frapp-${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv`);
}
