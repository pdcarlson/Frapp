import type { ChapterDocument } from '../entities/chapter-document.entity';

export const CHAPTER_DOCUMENT_REPOSITORY = 'CHAPTER_DOCUMENT_REPOSITORY';

export interface ChapterDocumentFilter {
  folder?: string | null;
  /** Case-insensitive substring match on `title`. */
  search?: string;
}

export interface IChapterDocumentRepository {
  findById(id: string, chapterId: string): Promise<ChapterDocument | null>;
  findByChapter(
    chapterId: string,
    filter?: ChapterDocumentFilter,
  ): Promise<ChapterDocument[]>;
  create(data: Partial<ChapterDocument>): Promise<ChapterDocument>;
  delete(id: string, chapterId: string): Promise<void>;
  moveToRoot(folder: string, chapterId: string): Promise<void>;
  /** Re-files every document under `fromFolder` into `toFolder`. */
  renameFolder(
    fromFolder: string,
    toFolder: string,
    chapterId: string,
  ): Promise<void>;
}
