export interface ChapterDocument {
  id: string;
  chapter_id: string;
  title: string;
  description: string | null;
  folder: string | null;
  storage_path: string;
  uploaded_by: string;
  created_at: string;
  /** MIME type, client-declared at upload (e.g. `application/pdf`). */
  content_type: string | null;
  /** File size in bytes, client-declared at upload. */
  byte_size: number | null;
  /**
   * The name of one of the chapter's document types
   * (`ChapterDocumentType`), or null. Rows filed before the list may hold
   * another spelling of a type (by key), which rename and delete still match.
   */
  document_type: string | null;
  /**
   * The date this document took effect, distinct from `created_at` (upload
   * time). User-supplied; never inferred.
   */
  effective_date: string | null;
  /**
   * When an officer pinned this document for the whole chapter, or null.
   * `spec/behavior/chapter-docs.md` § Pinned and starred (#3934).
   */
  pinned_at: string | null;
  /**
   * The Google Drive file this document is a copy of, or null for an upload
   * (#5157; `spec/behavior/chapter-docs.md` § Google Drive folder). Drive owns
   * a copy: the sync replaces, refiles and removes it, and nobody deletes it
   * in Frapp.
   */
  drive_file_id: string | null;
  /** The Drive file's modified time when it was last copied. */
  drive_modified_at: string | null;
  /** The file's page in Google Drive. */
  drive_url: string | null;
  /**
   * Set on a Drive copy that Drive moved into a folder more people may see
   * (#5220): that folder's id (not its name, which the copy's reader may not
   * be allowed to see). The copy stays in its folder, at its old list, until
   * someone who manages documents opens it up.
   */
  drive_held_folder_id: string | null;
  /**
   * Set on a document added by its Drive link (#5434;
   * `spec/behavior/chapter-docs.md` § Google Drive file by link), null on an
   * upload or a folder copy. `no_access` once Google answers that Frapp can't
   * see the file any more; the copy stays as it was.
   */
  drive_link_status: 'active' | 'no_access' | null;
  /** When a linked document last matched its Drive file. */
  drive_synced_at: string | null;
  /**
   * Who can see it (#3642): `null` is the same as its folder; a list of
   * `tier:`, `role:` and `group:` entries narrows the folder's, since a member
   * must pass both (`document-access.ts`).
   */
  who_can_see: string[] | null;
}

/**
 * A named, ordered folder within a chapter's documents.
 *
 * `ChapterDocument.folder` stores this folder's `name`, not its `id` — see the
 * note in `20260809120000_chapter_document_folders.sql`. Renaming a folder
 * therefore has to rewrite the documents filed under it, which
 * `ChapterDocumentService.updateFolder` does.
 */
export interface ChapterDocumentFolder {
  id: string;
  chapter_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  /** When an officer pinned this folder for the whole chapter, or null (#3934). */
  pinned_at: string | null;
  /**
   * The Google Drive folder this one mirrors, or null (#5220). Sync matches
   * folders by it, so a rename in Drive renames this folder and keeps its
   * list. Its name and place follow Drive's, so it's renamed and deleted in
   * Drive, not in Frapp.
   */
  drive_folder_id: string | null;
  /**
   * Who sees the folder and its files (#3642): `null` is everyone who can
   * open Documents, else a list of `tier:`, `role:` and `group:` entries.
   */
  who_can_see: string[] | null;
}

/**
 * One of a chapter's document types (#3642, piece 4). Like folders,
 * `ChapterDocument.document_type` stores the type's `name`, so renaming a type
 * renames it on its documents and deleting one clears it from them
 * (`ChapterDocumentTypeService.update` / `delete`, through the database's
 * `rename_chapter_document_type` / `delete_chapter_document_type`). Names are
 * unique per chapter by key (`documentTypeKey`: case and everything but
 * letters and digits ignored).
 */
export interface ChapterDocumentType {
  id: string;
  chapter_id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

/**
 * One member's star on a folder or a document (#3934). Exactly one of
 * `folder_id` and `document_id` is set (`chapter_document_stars_one_target`).
 * Private to the member: nothing reads another member's stars.
 */
export interface ChapterDocumentStar {
  id: string;
  user_id: string;
  chapter_id: string;
  folder_id: string | null;
  document_id: string | null;
  created_at: string;
}

/** What a star points at: a folder or a document, never both. */
export type ChapterDocumentStarTarget =
  | { folder_id: string; document_id?: never }
  | { document_id: string; folder_id?: never };

/** The caller's stars in their active chapter, as two id lists. */
export interface ChapterDocumentStars {
  folder_ids: string[];
  document_ids: string[];
}
