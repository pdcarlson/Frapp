/**
 * Narrowing for s12 (Documents), over `GET /v1/documents` and
 * `GET /v1/documents/folders`.
 *
 * The drawn screen's PINNED section above the list is built since #3934: an
 * officer's pin is `pinned_at` on a folder or a document, so the slot shows a
 * chapter decision, not a guess.
 */
import { formatDay } from "@repo/formatting";
import {
  uploadedLine,
  type LibraryDocument,
} from "@repo/hooks/document-library";
import { metaLine, num, records, str } from "./narrow";

/**
 * A `GET /v1/documents` row narrowed to what s12 draws and the shared library
 * (`@repo/hooks/document-library`, #3938) searches, filters and orders.
 */
export interface MobileDocument {
  id: string;
  title: string;
  description: string | null;
  folder: string | null;
  document_type: string | null;
  uploaded_by: string | null;
  created_at: string;
  /** For the File type filter (`fileKind`); null on older rows. */
  content_type: string | null;
  storage_path: string | null;
  /** When an officer pinned it for the whole chapter, or null (#3934). */
  pinned_at: string | null;
}

export interface DocumentFolder {
  id: string;
  name: string;
  /** When an officer pinned it for the whole chapter, or null (#3934). */
  pinned_at?: string | null;
}

/**
 * Every drawable document. A row with no id cannot be opened and a row with
 * no title has nothing to show, so both are dropped. Order is left to the
 * library's sort.
 */
export function selectDocuments(data: unknown): MobileDocument[] {
  return records(data)
    .map((row): MobileDocument | null => {
      const id = str(row, "id");
      const title = str(row, "title");
      if (!id || !title) return null;
      return {
        id,
        title,
        description: str(row, "description"),
        folder: str(row, "folder"),
        document_type: str(row, "document_type"),
        uploaded_by: str(row, "uploaded_by"),
        created_at: str(row, "created_at") ?? "",
        content_type: str(row, "content_type"),
        storage_path: str(row, "storage_path"),
        pinned_at: str(row, "pinned_at"),
      };
    })
    .filter((row): row is MobileDocument => !!row);
}

/**
 * The row's second line, web's order without its free-text tail:
 * `"Uploaded Aug 12 by Jane Doe · Governance · Bylaws"`, dropping whatever is
 * unknown. An unparseable date is left off rather than drawn as "Invalid Date".
 * The description is searched but not drawn: a phone row has no room to
 * truncate it the way web's single line does.
 */
export function documentMeta(
  row: LibraryDocument<MobileDocument>,
  now: Date = new Date(),
): string | null {
  return metaLine([
    uploadedLine(formatDay(row.doc.created_at || null, now), row.uploader),
    row.doc.folder,
    row.doc.document_type,
  ]);
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
      return {
        id,
        name,
        pinned_at: str(row, "pinned_at"),
        sort: num(row, "sort_order") ?? 0,
      };
    })
    .filter((row): row is NonNullable<typeof row> => !!row)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
    .map(({ id, name, pinned_at }) => ({ id, name, pinned_at }));
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
