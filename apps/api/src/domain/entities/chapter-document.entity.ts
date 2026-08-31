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
  /** Free text (bylaws, budget, minutes, ...) — no fixed taxonomy. */
  document_type: string | null;
  /**
   * The date this document took effect, distinct from `created_at` (upload
   * time). User-supplied; never inferred.
   */
  effective_date: string | null;
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
}
