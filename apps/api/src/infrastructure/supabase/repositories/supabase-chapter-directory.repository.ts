import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type {
  ChapterDirectorySearchResult,
  IChapterDirectoryRepository,
} from '#domain/repositories/chapter-directory.repository.interface';
import { SupabaseQueryError } from '../supabase-query-error';
import type { PagedQueryResult } from '../supabase.utils';

const SEARCH_COLUMNS =
  'id, org_letters, org_name, archetype, chapter_designation, university, university_short, founded_year, default_colors, website';

@Injectable()
export class SupabaseChapterDirectoryRepository implements IChapterDirectoryRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  /**
   * Onboarding autocomplete through `search_chapter_directory`
   * (20261106210000_chapter_directory_search.sql): every word of the query
   * starts a word of the organization, letters, chapter, school or its
   * aliases ("phi gam rens" finds Tau Nu at Rensselaer), and a longer word
   * may be a close misspelling. The raw query travels as one opaque argument
   * and is never spliced into a filter. `university` narrows by school name,
   * short name or alias; with it and an empty query the call lists that
   * school's chapters, and with neither it finds nothing.
   *
   * The explicit `select` is the autocomplete contract: the generated
   * `search_*` columns and the aliases stay out of the response.
   */
  async search(
    q: string,
    university: string | undefined,
    limit: number,
  ): Promise<ChapterDirectorySearchResult[]> {
    const { data, error } = (await this.supabase
      .rpc('search_chapter_directory', {
        p_query: q,
        p_university: university ?? null,
        p_limit: limit,
      })
      .select(
        SEARCH_COLUMNS,
      )) as PagedQueryResult<ChapterDirectorySearchResult>;

    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async createRequest(
    request: TablesInsert<'chapter_directory_requests'>,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('chapter_directory_requests')
      .insert(request);
    if (error) throw new SupabaseQueryError(error);
  }
}
