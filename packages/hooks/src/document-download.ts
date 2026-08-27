/**
 * The signed-download-URL selector, shared by web and mobile.
 *
 * Deliberately pure: no `"use client"`, no React, no react-query — the same rule
 * `display-names.ts` states and for the same reason. Mobile's `lib/more/documents.ts`
 * is a plain-functions module with a plain-node spec, and it must be able to
 * re-export this without dragging a query client into that graph. It also keeps
 * the selector importable from a server component, which a `"use client"` module
 * would refuse at runtime.
 *
 * ## Why a selector rather than a property read
 *
 * There is no separate download endpoint: `GET /v1/documents/{id}` and
 * `GET /v1/backwork/{id}` return the row *with* a freshly signed URL, on the key
 * **`downloadUrl`** — `ChapterDocumentService.findById` and `BackworkService.findById`
 * each `return { ...row, downloadUrl }`. There is no case-transforming interceptor
 * anywhere in the stack, so a client that reads `download_url` gets `undefined`,
 * which is what both web call sites did until #1040.
 *
 * Nothing typed catches that: neither endpoint declares an OpenAPI response
 * schema, so the SDK infers the body as `never` and *any* property access
 * compiles. A named selector with its own tests is the only thing that can.
 * Both spellings are accepted so a future server-side rename cannot break a
 * working client, and neither is guessed at a call site.
 */

/**
 * A non-blank string at `key`, or `null`.
 *
 * Blank-is-absent matches `apps/mobile/lib/more/narrow.ts`'s `str`, which this
 * selector was lifted from: a whitespace-only URL must fail the caller's
 * `if (!url) throw` and surface the "couldn't fetch download link" toast rather
 * than opening a blank tab.
 */
function nonBlankString(record: Record<string, unknown>, key: string): string | null {
  const raw = record[key];
  return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
}

export function selectDownloadUrl(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  return (
    nonBlankString(record, "downloadUrl") ?? nonBlankString(record, "download_url")
  );
}
