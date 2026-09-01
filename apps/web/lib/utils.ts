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
