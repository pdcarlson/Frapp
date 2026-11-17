import type { ChapterDocumentFolder } from '../entities/chapter-document.entity';

export const CHAPTER_DOCUMENT_FOLDER_REPOSITORY =
  'CHAPTER_DOCUMENT_FOLDER_REPOSITORY';

/** A rename goes through `rename`, which re-files the documents with it. */
export interface ChapterDocumentFolderUpdate {
  sort_order?: number;
  who_can_see?: string[] | null;
}

export interface IChapterDocumentFolderRepository {
  findByChapter(chapterId: string): Promise<ChapterDocumentFolder[]>;
  findById(
    id: string,
    chapterId: string,
  ): Promise<ChapterDocumentFolder | null>;
  /**
   * Chapter-first, matching `IBackworkProfessorRepository.findByName` and the
   * other chapter-scoped lookups. Both args are `string`; transposing them is
   * a silent miss, not a type error.
   */
  findByName(
    chapterId: string,
    name: string,
  ): Promise<ChapterDocumentFolder | null>;
  create(data: {
    chapter_id: string;
    name: string;
    sort_order: number;
    who_can_see?: string[] | null;
    /** For a folder Drive sync mirrors (#5220). */
    drive_folder_id?: string | null;
  }): Promise<ChapterDocumentFolder>;
  update(
    id: string,
    chapterId: string,
    data: ChapterDocumentFolderUpdate,
  ): Promise<ChapterDocumentFolder>;
  /**
   * Renames the folder and re-files its documents in one transaction
   * (`rename_document_folder`), so a restricted folder's files are never under
   * a name no folder claims. A name the chapter uses is a unique violation
   * (23505) and changes nothing. Null when the folder isn't in the chapter.
   */
  rename(
    id: string,
    chapterId: string,
    name: string,
  ): Promise<ChapterDocumentFolder | null>;
  /**
   * Moves the folder's documents to the top level, carrying a restricted
   * folder's list onto them, and deletes it, in one transaction
   * (`delete_document_folder`). False when the folder isn't in the chapter.
   */
  deleteMovingDocuments(id: string, chapterId: string): Promise<boolean>;
  /**
   * Pins (an ISO time) or unpins (null) a folder for the chapter (#3934).
   * Null when no folder with that id is in the chapter, including one deleted
   * since the caller read it.
   */
  setPinnedAt(
    id: string,
    chapterId: string,
    pinnedAt: string | null,
  ): Promise<ChapterDocumentFolder | null>;
}
