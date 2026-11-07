import type {
  ChapterDirectoryEntry,
  ChapterDirectoryRequest,
} from '../entities/chapter-directory.entity';

export const CHAPTER_DIRECTORY_REPOSITORY = 'CHAPTER_DIRECTORY_REPOSITORY';

/** A directory entry as onboarding autocomplete returns it. */
export type ChapterDirectorySearchResult = Pick<
  ChapterDirectoryEntry,
  | 'id'
  | 'org_letters'
  | 'org_name'
  | 'archetype'
  | 'chapter_designation'
  | 'university'
  | 'university_short'
  | 'founded_year'
  | 'default_colors'
  | 'website'
>;

/** A backfill candidate raised by onboarding; the table fills the rest. */
export type NewChapterDirectoryRequest = Pick<
  ChapterDirectoryRequest,
  | 'chapter_id'
  | 'requested_by'
  | 'org_letters'
  | 'org_name'
  | 'chapter_designation'
  | 'university'
  | 'university_short'
  | 'founded_year'
  | 'archetype'
>;

/**
 * The curated national directory (`chapter_directory`, global, not
 * chapter-scoped) and the backfill queue onboarding feeds
 * (`chapter_directory_requests`).
 */
export interface IChapterDirectoryRepository {
  /**
   * Word-prefix search with typo tolerance over the directory, optionally
   * narrowed to a school by a word prefix of its name, short name or an
   * alias. An empty `query` with a school lists its chapters; with no school
   * it finds nothing.
   */
  search(
    query: string,
    university: string | undefined,
    limit: number,
  ): Promise<ChapterDirectorySearchResult[]>;
  createRequest(request: NewChapterDirectoryRequest): Promise<void>;
}
