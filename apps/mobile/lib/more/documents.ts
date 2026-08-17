/**
 * Narrowing for s12 (Documents), over `GET /v1/documents` and
 * `GET /v1/documents/folders`.
 *
 * The drawn screen has a PINNED section above RECENT. It is not built: nothing
 * on `chapter_documents` marks a document pinned, and picking "the two newest"
 * to fill the slot would dress an arbitrary choice up as a chapter decision.
 * Filed separately.
 */
import { metaLine, num, records, str, isRecord } from "./narrow";

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
 * There is no separate download endpoint: `GET /v1/documents/{id}` returns the
 * document *with* a freshly signed `downloadUrl`, so opening a document means
 * fetching it by id and following that.
 *
 * **`downloadUrl`, not `download_url`.** The service returns a camelCase key and
 * there is no case-transforming interceptor anywhere in the stack; web reads the
 * snake_case form at two call sites and gets `undefined` for its trouble. Both
 * spellings are accepted here so a future server-side rename cannot break the
 * only client that currently works, and neither is guessed at the call site.
 */
export function selectDownloadUrl(data: unknown): string | null {
  if (!isRecord(data)) return null;
  return str(data, "downloadUrl") ?? str(data, "download_url");
}
