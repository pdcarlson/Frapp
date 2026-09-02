import { Inject, Injectable, Logger } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
} from '../../infrastructure/supabase/database.types';

/** Per-channel-or-kind notification level (ADR-06). */
export type ChatNotificationLevel = 'all' | 'mentions' | 'off';

export interface ChatNotificationPreferenceRow {
  user_id: string;
  chapter_id: string;
  scope: 'channel' | 'kind';
  scope_id: string | null;
  scope_kind: string | null;
  level: ChatNotificationLevel;
}

@Injectable()
export class ChatNotificationPreferenceRepository {
  private readonly logger = new Logger(
    ChatNotificationPreferenceRepository.name,
  );

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
  ) {}

  /**
   * Load every chat-pref row for the (user, chapter) pair. The push worker
   * decides per-message whether the channel-specific row or the kind-fallback
   * row applies; loading both arms in one query keeps the hot path cheap.
   * Returns an empty array on missing rows (default falls back to channel
   * name in the worker).
   */
  async findForUser(
    userId: string,
    chapterId: string,
  ): Promise<ChatNotificationPreferenceRow[]> {
    const { data, error } = await this.supabase
      .from('chat_notification_preferences')
      .select('user_id, chapter_id, scope, scope_id, scope_kind, level')
      .eq('user_id', userId)
      .eq('chapter_id', chapterId);

    if (error) {
      this.logger.warn(
        `chat-prefs: lookup failed for user ${userId} in chapter ${chapterId}`,
        error,
      );
      return [];
    }
    return data ?? [];
  }

  /**
   * Channel-scoped rows only, for the caller's own mute UI.
   *
   * Unlike {@link findForUser}, this one **throws** rather than degrading to an
   * empty array. The worker swallows because a failed preference lookup there
   * should not stop a push from being decided at all — a missed mute is better
   * than a dropped notification. Here the array *is* the answer: returning `[]`
   * on a database error would render every channel as unmuted, which is
   * indistinguishable from the user having muted nothing, and the UI would
   * silently lie about their settings.
   */
  async findChannelPreferencesForUser(
    userId: string,
    chapterId: string,
  ): Promise<ChatNotificationPreferenceRow[]> {
    return this.findPreferencesForUserByScope(userId, chapterId, 'channel');
  }

  /**
   * Kind-scoped rows only, for the caller's own per-kind settings UI.
   *
   * Throws rather than degrading to `[]`, for the same reason as
   * {@link findChannelPreferencesForUser}: here the array *is* the answer, and
   * an empty one on a database error would render every kind as un-overridden,
   * indistinguishable from the user having set nothing.
   */
  async findKindPreferencesForUser(
    userId: string,
    chapterId: string,
  ): Promise<ChatNotificationPreferenceRow[]> {
    return this.findPreferencesForUserByScope(userId, chapterId, 'kind');
  }

  /**
   * Drop the caller's kind-scoped row, returning that kind to its default.
   *
   * Scoped by `user_id` AND `chapter_id` as well as the kind: the delete must
   * be unable to reach another member's row or the same member's row in a
   * chapter this request is not for, exactly as the upsert's conflict key is.
   *
   * Deleting a row that does not exist is a success, not an error — PostgREST
   * reports zero affected rows and the caller's intent is already satisfied.
   */
  async deleteKindLevel(
    userId: string,
    chapterId: string,
    kind: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('chat_notification_preferences')
      .delete()
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .eq('scope', 'kind')
      .eq('scope_kind', kind);

    if (error) throw error;
  }

  /**
   * The shared body of the two scope-specific finders above. They differ only
   * in the `scope` literal, and jscpd flagged them as clones; the public
   * methods stay separate because their *contracts* differ (each is documented
   * against its own arm and its own caller), but the query lives once.
   */
  private async findPreferencesForUserByScope(
    userId: string,
    chapterId: string,
    scope: 'channel' | 'kind',
  ): Promise<ChatNotificationPreferenceRow[]> {
    const { data, error } = await this.supabase
      .from('chat_notification_preferences')
      .select('user_id, chapter_id, scope, scope_id, scope_kind, level')
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .eq('scope', scope);

    if (error) throw error;
    return data ?? [];
  }

  /**
   * Set the caller's level for one message kind.
   *
   * `onConflict` names the columns of `idx_chat_notif_prefs_kind_unique`
   * (20260902170000) — the kind arm's counterpart to the channel arm's
   * `idx_chat_notif_prefs_channel_unique`. It deliberately does NOT target the
   * channel index: that one is on `scope_id`, which is NULL on every kind row,
   * so `ON CONFLICT` would match nothing and each call would INSERT a duplicate
   * instead of updating. Nor can it target the original expression index — see
   * that migration's header for why PostgREST cannot name a `coalesce(...)`
   * index.
   *
   * `updated_at` is left to the table's trigger, one writer for that column.
   */
  async upsertKindLevel(
    userId: string,
    chapterId: string,
    kind: string,
    level: ChatNotificationLevel,
  ): Promise<ChatNotificationPreferenceRow> {
    const row: TablesInsert<'chat_notification_preferences'> = {
      user_id: userId,
      chapter_id: chapterId,
      scope: 'kind',
      // Explicitly null, not omitted — mirror of the channel upsert: the
      // table's `chat_notif_prefs_scope_id_when_channel` CHECK requires
      // scope_id to be null on a kind row, and an upsert that updates an
      // existing row must clear it rather than leave whatever was there.
      scope_id: null,
      scope_kind: kind,
      level,
    };

    const { data, error } = await this.supabase
      .from('chat_notification_preferences')
      .upsert(row, { onConflict: 'user_id,chapter_id,scope,scope_kind' })
      .select('user_id, chapter_id, scope, scope_id, scope_kind, level')
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new Error(
        'chat-prefs: upsert returned no row for ' +
          `user ${userId}, kind ${kind}`,
      );
    }
    return data;
  }

  /**
   * Set the caller's level for one channel.
   *
   * `onConflict` names the columns of `idx_chat_notif_prefs_channel_unique`
   * (20260829011200) — the plain `(user_id, chapter_id, scope, scope_id)`
   * index added for exactly this call, and the reason setting a channel level
   * twice updates rather than accumulating rows.
   *
   * It deliberately does NOT target `idx_chat_notif_prefs_unique`
   * (20260527120000), and it cannot: that one is expression-based on
   * `coalesce(scope_id::text, scope_kind)`, `ON CONFLICT` only matches an index
   * defined on those exact columns or expressions, and PostgREST's
   * `on_conflict` takes column NAMES and cannot express `coalesce(...)`.
   * Against the expression index alone Postgres raises `42P10 there is no
   * unique or exclusion constraint matching the ON CONFLICT specification`, so
   * this write would 500 on every call. Both indexes are load-bearing: the
   * expression one still enforces the real invariant across both scope arms,
   * and dropping the plain one breaks this method — see that migration's
   * ROLLBACK note.
   *
   * `updated_at` is left to the table's `trg_chat_notification_preferences_updated_at`
   * trigger rather than being set here — one writer for that column, not two.
   */
  async upsertChannelLevel(
    userId: string,
    chapterId: string,
    channelId: string,
    level: ChatNotificationLevel,
  ): Promise<ChatNotificationPreferenceRow> {
    const row: TablesInsert<'chat_notification_preferences'> = {
      user_id: userId,
      chapter_id: chapterId,
      scope: 'channel',
      scope_id: channelId,
      // Explicitly null, not omitted: the table's
      // `chat_notif_prefs_scope_id_when_channel` CHECK requires scope_kind to
      // be null on a channel row, and an upsert that updates an existing row
      // must clear it rather than leave whatever was there.
      scope_kind: null,
      level,
    };

    const { data, error } = await this.supabase
      .from('chat_notification_preferences')
      .upsert(row, { onConflict: 'user_id,chapter_id,scope,scope_id' })
      .select('user_id, chapter_id, scope, scope_id, scope_kind, level')
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new Error(
        'chat-prefs: upsert returned no row for ' +
          `user ${userId}, channel ${channelId}`,
      );
    }
    return data;
  }
}
