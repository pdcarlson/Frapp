/**
 * A member's own arrangement of the chat sidebar (#2877), one row per
 * (member, chapter) in `chat_sidebar_preferences`
 * (`20260929213000_chat_sidebar_preferences.sql`).
 *
 * No row means every default: both filters off, nothing collapsed. The rule is
 * `spec/behavior/chat/README.md` § Sidebar arrangement.
 */
export interface ChatSidebarPreferences {
  user_id: string;
  chapter_id: string;
  /** Show only channels with something unread (a mention included). */
  unread_only: boolean;
  /** Leave out channels whose notification level is `off`. */
  hide_muted: boolean;
  /**
   * Section keys the member folded, per `isSidebarSectionKey` in
   * `@repo/validation`. Written only through
   * `set_chat_sidebar_section_collapsed`, which edits the array in place.
   */
  collapsed_sections: string[];
  created_at: string;
  updated_at: string;
}

/**
 * One channel a member pinned to the top of their sidebar, in
 * `chat_sidebar_pins`. Keyed on (member, channel); deleting the channel
 * cascades the pin away.
 */
export interface ChatSidebarPin {
  user_id: string;
  chapter_id: string;
  channel_id: string;
  created_at: string;
}
