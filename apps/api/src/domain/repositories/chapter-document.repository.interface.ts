import type { ChapterDocument } from '../entities/chapter-document.entity';

export const CHAPTER_DOCUMENT_REPOSITORY = 'CHAPTER_DOCUMENT_REPOSITORY';

export interface ChapterDocumentFilter {
  folder?: string | null;
  /** Case-insensitive substring match on `title`. */
  search?: string;
}

export interface IChapterDocumentRepository {
  findById(id: string, chapterId: string): Promise<ChapterDocument | null>;
  /** The chapter's documents among `ids`; ids in another chapter or gone are left out. */
  findByIds(ids: string[], chapterId: string): Promise<ChapterDocument[]>;
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
  /** The chapter's copies of Google Drive files (#5157). */
  findDriveCopies(chapterId: string): Promise<ChapterDocument[]>;
  /** Rewrites a Drive copy after the sync replaced, renamed or refiled it. */
  updateDriveCopy(
    id: string,
    chapterId: string,
    patch: Pick<
      Partial<ChapterDocument>,
      | 'title'
      | 'folder'
      | 'storage_path'
      | 'content_type'
      | 'byte_size'
      | 'drive_modified_at'
      | 'drive_url'
    >,
  ): Promise<void>;
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
  /** Sets one file's own who can see (`null`: the same as its folder). */
  setWhoCanSee(
    id: string,
    chapterId: string,
    whoCanSee: string[] | null,
  ): Promise<ChapterDocument | null>;
  /**
   * Gives every file in `folder` that follows it the folder's list, before
   * the folder goes, so leaving it never opens them wider.
   */
  keepFolderList(
    folder: string,
    whoCanSee: string[],
    chapterId: string,
  ): Promise<void>;
  moveToRoot(folder: string, chapterId: string): Promise<void>;
  /** Re-files every document under `fromFolder` into `toFolder`. */
  renameFolder(
    fromFolder: string,
    toFolder: string,
    chapterId: string,
  ): Promise<void>;
}
