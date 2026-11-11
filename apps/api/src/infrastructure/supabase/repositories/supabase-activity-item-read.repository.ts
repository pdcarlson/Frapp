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
 * The upsert targets, each the primary key of its table in
 * `20261111210000_activity_item_reads.sql`. A target that names no unique
 * constraint fails every write with 42P10, which no mocked client notices,
 * so `supabase-activity-item-read.repository.spec.ts` checks these against
 * the migration.
 */
export const ACTIVITY_ITEM_READS_CONFLICT = 'user_id,chapter_id,kind,item_id';
export const ACTIVITY_UNREAD_STARTS_CONFLICT = 'user_id,chapter_id';

/**
 * `activity_item_reads` and `activity_unread_starts` (#4173). RLS on and no
 * policies: the API's service role is the only reader, and every query here
 * filters on `chapter_id` and `user_id` because nothing else would.
 */
@Injectable()
export class SupabaseActivityItemReadRepository implements IActivityItemReadRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findUnreadStart(
    chapterId: string,
    userId: string,
  ): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('activity_unread_starts')
      .select('started_at')
      .eq('chapter_id', chapterId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data?.started_at ?? null;
  }

  async startUnread(
    chapterId: string,
    userId: string,
    startedAt: string,
  ): Promise<void> {
    const row: TablesInsert<'activity_unread_starts'> = {
      user_id: userId,
      chapter_id: chapterId,
      started_at: startedAt,
    };
    // Set once: a later load must not move it, or a row the member never
    // opened would stop being unread.
    const { error } = await this.supabase
      .from('activity_unread_starts')
      .upsert(row, {
        onConflict: ACTIVITY_UNREAD_STARTS_CONFLICT,
        ignoreDuplicates: true,
      });
    if (error) throw new SupabaseQueryError(error);
  }

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
      .upsert(rows, { onConflict: ACTIVITY_ITEM_READS_CONFLICT });
    if (error) throw new SupabaseQueryError(error);
  }
}
