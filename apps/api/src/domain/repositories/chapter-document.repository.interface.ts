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
  /**
   * The chapter's copies of its connected Google Drive folder's files
   * (#5157). Files added by their own link (#5434) aren't the folder's.
   */
  findDriveCopies(chapterId: string): Promise<ChapterDocument[]>;
  /** The chapter's document copied from this Drive file, if any. */
  findByDriveFileId(
    chapterId: string,
    driveFileId: string,
  ): Promise<ChapterDocument | null>;
  /** The Drive file ids the chapter added by link (#5434). */
  findLinkedDriveFileIds(chapterId: string): Promise<Set<string>>;
  /**
   * Rewrites a Drive copy after the sync replaced, renamed or refiled it.
   * False when no such copy is in the chapter (deleted since it was read).
   */
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
      | 'drive_held_folder_id'
      | 'drive_link_status'
      | 'drive_synced_at'
    >,
  ): Promise<boolean>;
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
  /** Rename or refile an upload or linked file; `null` for a folder copy or a miss. */
  updateFiling(
    id: string,
    chapterId: string,
    patch: Pick<Partial<ChapterDocument>, 'title' | 'folder'>,
  ): Promise<ChapterDocument | null>;
  /** Refile uploads and linked files into `folder`; folder copies are skipped. */
  moveMany(
    ids: string[],
    chapterId: string,
    folder: string | null,
  ): Promise<ChapterDocument[]>;
  /** Sets one file's own who can see (`null`: the same as its folder). */
  setWhoCanSee(
    id: string,
    chapterId: string,
    whoCanSee: string[] | null,
  ): Promise<ChapterDocument | null>;
}
