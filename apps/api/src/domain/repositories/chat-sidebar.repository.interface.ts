import type { ChatSidebarPreferences } from '../entities/chat-sidebar.entity';

export const CHAT_SIDEBAR_REPOSITORY = 'CHAT_SIDEBAR_REPOSITORY';

/** The two filters a member can switch; either may be left out of a write. */
export interface ChatSidebarFilters {
  unread_only?: boolean;
  hide_muted?: boolean;
}

/**
 * A member's own sidebar arrangement (#2877): `chat_sidebar_preferences` and
 * `chat_sidebar_pins`.
 *
 * **Every method takes both the chapter and the member, and every query filters
 * on both.** Chapter-first, per the repository convention, because both are
 * `string` and a transposition would type-check. There is no method that reads
 * another member's arrangement: nobody else, an officer included, has a reason
 * to know which channels a member pinned or folded.
 */
export interface IChatSidebarRepository {
  /** The member's row, or `null` when they have never changed a setting. */
  findPreferences(
    chapterId: string,
    userId: string,
  ): Promise<ChatSidebarPreferences | null>;
  /**
   * Writes only the filters given, creating the row on first use. A filter left
   * out keeps its stored value, so two devices switching different filters
   * both land.
   */
  updateFilters(
    chapterId: string,
    userId: string,
    filters: ChatSidebarFilters,
  ): Promise<ChatSidebarPreferences>;
  /**
   * Folds or unfolds one section in a single database statement
   * (`set_chat_sidebar_section_collapsed`). Idempotent both ways. The key is
   * the caller's to validate.
   */
  setSectionCollapsed(
    chapterId: string,
    userId: string,
    sectionKey: string,
    collapsed: boolean,
  ): Promise<ChatSidebarPreferences>;
  /**
   * Channel ids the member pinned in this chapter, unfiltered by access. The
   * caller drops the ones the member can no longer read.
   */
  findPinnedChannelIds(chapterId: string, userId: string): Promise<string[]>;
  /** Idempotent: pinning a pinned channel changes nothing. */
  pin(chapterId: string, userId: string, channelId: string): Promise<void>;
  /** Idempotent: unpinning an unpinned channel changes nothing. */
  unpin(chapterId: string, userId: string, channelId: string): Promise<void>;
}
