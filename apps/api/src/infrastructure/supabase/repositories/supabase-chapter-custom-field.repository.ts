import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type { IChapterCustomFieldRepository } from '#domain/repositories/chapter-custom-field.repository.interface';
import { SupabaseQueryError } from '../supabase-query-error';

@Injectable()
export class SupabaseChapterCustomFieldRepository implements IChapterCustomFieldRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async seedDefaults(
    rows: TablesInsert<'chapter_custom_fields'>[],
  ): Promise<void> {
    // `ignoreDuplicates` turns a unique violation on `(chapter_id, key)` into
    // a skipped row, which is what makes re-running provisioning a no-op.
    const { error } = await this.supabase
      .from('chapter_custom_fields')
      .upsert(rows, { onConflict: 'chapter_id,key', ignoreDuplicates: true });
    if (error) throw new SupabaseQueryError(error);
  }
}
