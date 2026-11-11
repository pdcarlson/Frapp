import type {
  ChapterDocumentStar,
  ChapterDocumentStarTarget,
} from '../entities/chapter-document.entity';

export const CHAPTER_DOCUMENT_STAR_REPOSITORY =
  'CHAPTER_DOCUMENT_STAR_REPOSITORY';

/**
 * A member's own stars on folders and documents (#3934).
 *
 * Every method takes the member's id and filters on it: that filter is the
 * privacy boundary, since the table has RLS on and no policies and the API
 * reads it through the service role.
 */
export interface IChapterDocumentStarRepository {
  /** The member's stars in one chapter. */
  findByUser(userId: string, chapterId: string): Promise<ChapterDocumentStar[]>;
  /** Idempotent: starring twice leaves one row. */
  add(
    userId: string,
    chapterId: string,
    target: ChapterDocumentStarTarget,
  ): Promise<void>;
  /** Idempotent: removing a star that isn't there is not an error. */
  remove(
    userId: string,
    chapterId: string,
    target: ChapterDocumentStarTarget,
  ): Promise<void>;
}
