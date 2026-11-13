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
   * (`ChapterDocumentType`), in the list's spelling, or null. Older rows may
   * hold a spelling that differs from the list's only in case.
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
}

/**
 * One of a chapter's document types (#3642, piece 4). Like folders,
 * `ChapterDocument.document_type` stores the type's `name`, so renaming a type
 * renames it on its documents and deleting one clears it from them
 * (`ChapterDocumentService.updateType` / `deleteType`). Names are unique per
 * chapter ignoring case and outer whitespace.
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
