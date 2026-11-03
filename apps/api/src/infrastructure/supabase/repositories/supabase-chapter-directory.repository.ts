import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type {
  ChapterDirectorySearchResult,
  IChapterDirectoryRepository,
} from '#domain/repositories/chapter-directory.repository.interface';
import { SupabaseQueryError } from '../supabase-query-error';

@Injectable()
export class SupabaseChapterDirectoryRepository implements IChapterDirectoryRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async search(
    q: string,
    university: string | undefined,
    limit: number,
  ): Promise<ChapterDirectorySearchResult[]> {
    let query = this.supabase
      .from('chapter_directory')
      .select(
        'id, org_letters, org_name, archetype, chapter_designation, university, university_short, founded_year, default_colors, website',
      )
      .limit(limit);

    if (university) {
      query = query.ilike('university_short', `%${university}%`);
    }

    if (q) {
      // Use the generated tsvector for full-text search
      query = query.textSearch('search_vector', q, {
        type: 'websearch',
        config: 'english',
      });
    }

    const { data, error } = await query;
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
