/**
 * Narrowing for s12 (Documents), over `GET /v1/documents` and
 * `GET /v1/documents/folders`.
 *
 * The drawn screen has a PINNED section above RECENT. It is not built: nothing
 * on `chapter_documents` marks a document pinned, and picking "the two newest"
 * to fill the slot would dress an arbitrary choice up as a chapter decision.
 * Filed separately.
 */
import { metaLine, num, records, str } from "./narrow";

export interface DocumentRow {
  id: string;
  title: string;
  /** e.g. `"Bylaws · Aug 12"`, or `null` when neither part is known. */
  meta: string | null;
  folder: string | null;
}

export interface DocumentFolder {
  id: string;
  name: string;
}

/** `2026-08-12T…` → `"Aug 12"`. `null` for anything unparseable. */
function formatUploadedAt(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function toRow(row: Record<string, unknown>): DocumentRow | null {
  const id = str(row, "id");
  const title = str(row, "title");
  if (!id || !title) return null;

  const folder = str(row, "folder");
  return {
    id,
    title,
    meta: metaLine([folder, formatUploadedAt(str(row, "created_at"))]),
    folder,
  };
}

/** Newest first — the reference labels this list RECENT. */
export function selectDocumentRows(data: unknown): DocumentRow[] {
  return records(data)
    .map((row) => ({ row, created: str(row, "created_at") ?? "" }))
    .sort((a, b) => b.created.localeCompare(a.created))
    .map(({ row }) => toRow(row))
    .filter((row): row is DocumentRow => !!row);
}

/**
 * The chapter's folders in display order.
 *
 * Read from `GET /v1/documents/folders` rather than derived from the documents
 * themselves, which would silently omit every empty folder — and an empty
 * folder is exactly the one a member is about to be told is empty.
 */
export function selectDocumentFolders(data: unknown): DocumentFolder[] {
  return records(data)
    .map((row) => {
      const id = str(row, "id");
      const name = str(row, "name");
      if (!id || !name) return null;
      return { id, name, sort: num(row, "sort_order") ?? 0 };
    })
    .filter((row): row is DocumentFolder & { sort: number } => !!row)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
    .map(({ id, name }) => ({ id, name }));
}

/**
 * The signed URL off a single-document read.
 *
 * Re-exported from `@repo/hooks`, which is where it now lives — beside the
 * `useDocument` query that returns the payload it reads, so web and mobile
 * cannot drift apart on the key. It stayed exported from here so this module
 * remains the one import site for the s12 narrowing.
 *
 * The web call sites that read `download_url` and opened `undefined` are fixed
 * (#1040); both spellings are still accepted so a future server-side rename
 * cannot break either client.
 */
export { selectDownloadUrl } from "@repo/hooks";
