import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';

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
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
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
}
