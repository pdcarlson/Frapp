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
    const { data, error } = await this.supabase
      .from('chat_notification_preferences')
      .select('user_id, chapter_id, scope, scope_id, scope_kind, level')
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .eq('scope', 'channel');

    if (error) throw error;
    return data ?? [];
  }

  /**
   * Set the caller's level for one channel.
   *
   * `onConflict` names the columns of `idx_chat_notif_prefs_unique`
   * (20260527120000). That index is expression-based —
   * `coalesce(scope_id::text, scope_kind)` — so it covers both the `channel`
   * and `kind` arms in one constraint; naming the plain columns here is what
   * PostgREST needs to target it, and it is why setting a channel level twice
   * updates rather than accumulating rows.
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
