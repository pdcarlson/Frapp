import type { ChapterDocument } from '../entities/chapter-document.entity';

export const CHAPTER_DOCUMENT_REPOSITORY = 'CHAPTER_DOCUMENT_REPOSITORY';

export interface ChapterDocumentFilter {
  folder?: string | null;
  /** Case-insensitive substring match on `title`. */
  search?: string;
  /** Only documents this member uploaded. Set by the API, never from a query string. */
  uploaded_by?: string;
}

export interface IChapterDocumentRepository {
  findById(id: string, chapterId: string): Promise<ChapterDocument | null>;
  findByChapter(
    chapterId: string,
    filter?: ChapterDocumentFilter,
  ): Promise<ChapterDocument[]>;
  /** The row that files `storagePath` in the chapter, if any (#3399). */
  findByStoragePath(
    storagePath: string,
    chapterId: string,
  ): Promise<ChapterDocument | null>;
  /**
   * Files a document. When `storage_path` is already filed in the chapter, it
   * returns that row instead of a second one (#3399).
   */
  create(data: Partial<ChapterDocument>): Promise<ChapterDocument>;
  delete(id: string, chapterId: string): Promise<void>;
  /**
   * Pins (an ISO time) or unpins (null) a document for the chapter (#3934).
   * Null when no document with that id is in the chapter, including one
   * deleted since the caller read it.
   */
  setPinnedAt(
    id: string,
    chapterId: string,
    pinnedAt: string | null,
  ): Promise<ChapterDocument | null>;
  moveToRoot(folder: string, chapterId: string): Promise<void>;
  /** Re-files every document under `fromFolder` into `toFolder`. */
  renameFolder(
    fromFolder: string,
    toFolder: string,
    chapterId: string,
  ): Promise<void>;
}
