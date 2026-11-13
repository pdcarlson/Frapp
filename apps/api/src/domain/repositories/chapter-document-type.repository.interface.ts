import type { ChapterDocumentType } from '../entities/chapter-document.entity';

export const CHAPTER_DOCUMENT_TYPE_REPOSITORY =
  'CHAPTER_DOCUMENT_TYPE_REPOSITORY';

export interface IChapterDocumentTypeRepository {
  /** The chapter's types by `sort_order`, then name. */
  findByChapter(chapterId: string): Promise<ChapterDocumentType[]>;
  findById(id: string, chapterId: string): Promise<ChapterDocumentType | null>;
  /**
   * The type whose key (`documentTypeKey`) matches `name`'s, or null.
   * Chapter-first, like the folder lookup: both args are `string`, so a
   * transposition is a silent miss, not a type error.
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
  /** Moves a type; undefined when no type with that id is in the chapter. */
  setSortOrder(
    id: string,
    chapterId: string,
    sortOrder: number,
  ): Promise<ChapterDocumentType | undefined>;
  /**
   * Renames a type and every document of it, in one transaction
   * (`rename_chapter_document_type`). Null when another type has the name,
   * and nothing changed; undefined when no type with that id is in the
   * chapter.
   */
  rename(
    chapterId: string,
    id: string,
    name: string,
  ): Promise<ChapterDocumentType | null | undefined>;
  /**
   * Clears a type from its documents and deletes it, in one transaction
   * (`delete_chapter_document_type`). False when the chapter has no such
   * type.
   */
  deleteWithDocuments(chapterId: string, id: string): Promise<boolean>;
}
