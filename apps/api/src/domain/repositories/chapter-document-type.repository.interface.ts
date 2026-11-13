import type { ChapterDocumentType } from '../entities/chapter-document.entity';

export const CHAPTER_DOCUMENT_TYPE_REPOSITORY =
  'CHAPTER_DOCUMENT_TYPE_REPOSITORY';

export interface ChapterDocumentTypeUpdate {
  name?: string;
  sort_order?: number;
}

export interface IChapterDocumentTypeRepository {
  /** The chapter's types by `sort_order`, then name. */
  findByChapter(chapterId: string): Promise<ChapterDocumentType[]>;
  findById(id: string, chapterId: string): Promise<ChapterDocumentType | null>;
  /**
   * The type named `name` ignoring case, or null. Chapter-first, like the
   * folder lookup: both args are `string`, so a transposition is a silent
   * miss, not a type error.
   */
  findByName(
    chapterId: string,
    name: string,
  ): Promise<ChapterDocumentType | null>;
  /** Null when the name is already taken in the chapter (unique index). */
  create(data: {
    chapter_id: string;
    name: string;
    sort_order: number;
  }): Promise<ChapterDocumentType | null>;
  /**
   * The updated row; null when the new name is taken; undefined when no type
   * with that id is in the chapter.
   */
  update(
    id: string,
    chapterId: string,
    data: ChapterDocumentTypeUpdate,
  ): Promise<ChapterDocumentType | null | undefined>;
  delete(id: string, chapterId: string): Promise<void>;
}
