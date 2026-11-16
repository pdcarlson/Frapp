export type ChapterDocument = {
  id: string;
  chapter_id: string;
  title: string;
  description: string | null;
  folder: string | null;
  storage_path: string;
  uploaded_by: string;
  created_at: string;
  content_type: string | null;
  byte_size: number | null;
  document_type: string | null;
  effective_date: string | null;
  /** When an officer pinned it for the whole chapter (#3934). */
  pinned_at?: string | null;
  /**
   * The Google Drive file this is a copy of, or null for an upload (#5157).
   * Drive owns a copy: it has no Delete here.
   */
  drive_file_id?: string | null;
  /** The file's page in Google Drive. */
  drive_url?: string | null;
};

export type ChapterDocumentFolder = {
  id: string;
  name: string;
  sort_order: number | null;
  /** When an officer pinned it for the whole chapter (#3934). */
  pinned_at?: string | null;
};

/**
 * A row in the folder rail. `id` is `null` for a name recovered from the
 * documents themselves when the folder endpoint is unreachable — those rows
 * filter but cannot be managed, because there is no record to address.
 */
export type FolderRow = {
  id: string | null;
  name: string;
  sort_order: number | null;
  pinned_at?: string | null;
};
