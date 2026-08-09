import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';

const SEARCH_LIMIT = 20;

@Injectable()
export class ChapterDirectoryService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
  ) {}

  async search(q: string, university?: string) {
    let query = this.supabase
      .from('chapter_directory')
      .select(
        'id, org_letters, org_name, archetype, chapter_designation, university, university_short, founded_year, default_colors, website',
      )
      .limit(SEARCH_LIMIT);

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

    if (error) {
      throw error;
    }

    return data ?? [];
  }
}
