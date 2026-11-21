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
  effectiveLine,
  isDriveCopy,
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
  /** The day it takes effect, when an officer set one (#5207). */
  effective_date: string | null;
  uploaded_by: string | null;
  created_at: string;
  /** For the File type filter (`fileKind`); null on older rows. */
  content_type: string | null;
  storage_path: string | null;
  /** When an officer pinned it for the whole chapter, or null (#3934). */
  pinned_at: string | null;
  /**
   * The Google Drive file this is a copy of, or null for an upload (#5157).
   * Drive owns a copy: the row says so and offers no Delete.
   */
  drive_file_id: string | null;
  /**
   * The file's own who-can-see list (#5216), left out when it follows its
   * folder. The API only sends what this member may see, so it is only
   * ever drawn as a lock.
   */
  who_can_see?: string[];
}

export interface DocumentFolder {
  id: string;
  name: string;
  /** When an officer pinned it for the whole chapter, or null (#3934). */
  pinned_at?: string | null;
  /** Who can see it (#5216), left out when everyone can. */
  who_can_see?: string[];
}

/** A list on a row, or `undefined` for none (everyone, or Same as folder). */
function accessList(row: Record<string, unknown>): string[] | undefined {
  const list = row.who_can_see;
  return Array.isArray(list)
    ? list.filter((entry): entry is string => typeof entry === "string")
    : undefined;
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
        effective_date: str(row, "effective_date"),
        uploaded_by: str(row, "uploaded_by"),
        created_at: str(row, "created_at") ?? "",
        content_type: str(row, "content_type"),
        storage_path: str(row, "storage_path"),
        pinned_at: str(row, "pinned_at"),
        drive_file_id: str(row, "drive_file_id"),
        ...(accessList(row) ? { who_can_see: accessList(row) } : {}),
      };
    })
    .filter((row): row is MobileDocument => !!row);
}

/**
 * The row's second line, web's order without its free-text tail:
 * `"Uploaded August 12 by Jane Doe · Governance · Bylaws · Effective September 1"`,
 * dropping whatever is unknown (the effective day since 2026-11-19, as web's
 * row says it). An unparseable date is left off rather than drawn as "Invalid Date".
 * The description is searched but not drawn: a phone row has no room to
 * truncate it the way web's single line does.
 */
export function documentMeta(
  row: LibraryDocument<MobileDocument>,
  now: Date = new Date(),
): string | null {
  const uploadedDay = formatDay(row.doc.created_at || null, now);
  return metaLine([
    uploadedLine(uploadedDay, row.uploader, isDriveCopy(row.doc)),
    row.doc.folder,
    row.doc.document_type,
    effectiveLine(formatDay(row.doc.effective_date, now), uploadedDay),
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
        who_can_see: accessList(row),
      };
    })
    .filter((row): row is NonNullable<typeof row> => !!row)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
    .map(({ id, name, pinned_at, who_can_see }) => ({
      id,
      name,
      pinned_at,
      ...(who_can_see ? { who_can_see } : {}),
    }));
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
