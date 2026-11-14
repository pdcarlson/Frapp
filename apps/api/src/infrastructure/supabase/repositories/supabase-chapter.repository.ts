import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import {
  type ChapterBirthdayChannel,
  IChapterRepository,
  type AppliedSubscriptionWebhook,
  type SubscriptionWebhookPatch,
} from '#domain/repositories/chapter.repository.interface';
import { Chapter } from '#domain/entities/chapter.entity';
import { SupabaseQueryError } from '../supabase-query-error';
import { fetchAllPages } from '../supabase.utils';

/** Rows per page of the birthday sweep's chapter list (#4959). */
const BIRTHDAY_CHANNEL_PAGE = 500;

@Injectable()
export class SupabaseChapterRepository implements IChapterRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findById(id: string): Promise<Chapter | null> {
    const { data, error } = await this.supabase
      .from('chapters')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async isAnalyticsOptedOut(id: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('chapters')
      .select('analytics_opt_out')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data?.analytics_opt_out ?? false;
  }

  async findByIds(ids: string[]): Promise<Chapter[]> {
    if (!ids.length) return [];
    const { data, error } = await this.supabase
      .from('chapters')
      .select('*')
      .in('id', ids);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findWithBirthdayChannel(): Promise<ChapterBirthdayChannel[]> {
    const rows = await fetchAllPages(
      (from, to) =>
        this.supabase
          .from('chapters')
          .select(
            'id, birthday_channel_id, subscription_status, past_due_since',
          )
          .not('birthday_channel_id', 'is', null)
          .order('id', { ascending: true })
          .range(from, to),
      { pageSize: BIRTHDAY_CHANNEL_PAGE },
    );
    const chapters: ChapterBirthdayChannel[] = [];
    for (const row of rows) {
      if (!row.birthday_channel_id) continue;
      chapters.push({
        id: row.id,
        birthday_channel_id: row.birthday_channel_id,
        subscription_status: row.subscription_status,
        past_due_since: row.past_due_since,
      });
    }
    return chapters;
  }

  async findBySubscriptionId(subscriptionId: string): Promise<Chapter | null> {
    const { data, error } = await this.supabase
      .from('chapters')
      .select('*')
      .eq('subscription_id', subscriptionId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findByCustomerId(customerId: string): Promise<Chapter | null> {
    // `stripe_customer_id text unique` (initial schema), so `maybeSingle` cannot
    // hit the multiple-rows error here.
    const { data, error } = await this.supabase
      .from('chapters')
      .select('*')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async claimSubscriptionId(
    chapterId: string,
    subscriptionId: string,
    expectedSubscriptionId: string | null,
  ): Promise<Chapter | null> {
    const patch: TablesUpdate<'chapters'> = {
      subscription_id: subscriptionId,
    };

    // Pin the stored id we read, plus refuse to steal a live subscription.
    // Two `.neq` filters rather than `NOT IN`: the tenant-scope harness (and
    // PostgREST) AND them, and `incomplete`/`canceled` pass both. Same live
    // pair `createCheckoutSession` refuses to reopen.
    let query = this.supabase
      .from('chapters')
      .update(patch)
      .eq('id', chapterId)
      .neq('subscription_status', 'active')
      .neq('subscription_status', 'past_due');

    query =
      expectedSubscriptionId === null
        ? query.is('subscription_id', null)
        : query.eq('subscription_id', expectedSubscriptionId);

    const { data, error } = await query.select('*');
    if (error) throw new SupabaseQueryError(error);
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  }

  async applySubscriptionWebhook(
    chapterId: string,
    eventAt: string,
    patch: SubscriptionWebhookPatch,
  ): Promise<AppliedSubscriptionWebhook | null> {
    const { data, error } = await this.supabase.rpc(
      'apply_subscription_webhook',
      {
        p_chapter_id: chapterId,
        p_event_at: eventAt,
        p_patch: patch,
      },
    );
    if (error) throw new SupabaseQueryError(error);
    const rows = data ?? [];
    if (rows.length === 0) return null;
    const row = rows[0];
    if (!row.applied || typeof row.applied !== 'object') {
      throw new Error(
        'apply_subscription_webhook returned a row without an applied chapter',
      );
    }
    return {
      ...row.applied,
      previous_subscription_status: row.previous_subscription_status,
    };
  }

  async create(chapterData: TablesInsert<'chapters'>): Promise<Chapter> {
    const { data, error } = await this.supabase
      .from('chapters')
      .insert(chapterData)
      .select()
      .single();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async update(
    id: string,
    chapterData: TablesUpdate<'chapters'>,
  ): Promise<Chapter> {
    const { data, error } = await this.supabase
      .from('chapters')
      .update(chapterData)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async updatePaletteIfSeedUnchanged(
    chapterId: string,
    palette: TablesUpdate<'chapters'>,
    seedAccent: string | undefined,
  ): Promise<boolean> {
    const update = this.supabase
      .from('chapters')
      .update(palette)
      .eq('id', chapterId);
    const guarded =
      typeof seedAccent === 'string'
        ? update.eq('branding->colors->>accent', seedAccent)
        : update.is('branding->colors->>accent', null);
    const { data, error } = await guarded.select('id');
    if (error) throw new SupabaseQueryError(error);
    return (data?.length ?? 0) > 0;
  }
}
