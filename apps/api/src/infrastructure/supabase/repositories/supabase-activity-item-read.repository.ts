import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type {
  ActivityItemRef,
  IActivityItemReadRepository,
} from '#domain/repositories/activity-item-read.repository.interface';
import type { ActivityItemRead } from '#domain/entities/activity-item-read.entity';
import { SupabaseQueryError } from '../supabase-query-error';
import { chunkIds } from '#domain/utils/chunk-ids';

/**
 * `activity_item_reads` (#4173). RLS on and no policies: the API's service
 * role is the only reader, and every query here filters on `chapter_id` and
 * `user_id` because nothing else would.
 */
@Injectable()
export class SupabaseActivityItemReadRepository implements IActivityItemReadRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  /**
   * The ids go out in `chunkIds` batches: Activity serves up to 135 rows, and
   * one `in` list of that many uuids is near the URL limit (#3265).
   */
  async findReads(
    chapterId: string,
    userId: string,
    itemIds: string[],
  ): Promise<ActivityItemRead[]> {
    const batches = await Promise.all(
      chunkIds(itemIds).map(async (ids) => {
        const { data, error } = await this.supabase
          .from('activity_item_reads')
          .select('*')
          .eq('chapter_id', chapterId)
          .eq('user_id', userId)
          .in('item_id', ids);
        if (error) throw new SupabaseQueryError(error);
        return data ?? [];
      }),
    );
    return batches.flat();
  }

  async markRead(
    chapterId: string,
    userId: string,
    items: ActivityItemRef[],
    readAt: string,
  ): Promise<void> {
    if (items.length === 0) return;
    const rows: TablesInsert<'activity_item_reads'>[] = items.map((item) => ({
      user_id: userId,
      chapter_id: chapterId,
      kind: item.kind,
      item_id: item.item_id,
      read_at: readAt,
    }));
    const { error } = await this.supabase
      .from('activity_item_reads')
      .upsert(rows, { onConflict: 'user_id,chapter_id,kind,item_id' });
    if (error) throw new SupabaseQueryError(error);
  }
}
