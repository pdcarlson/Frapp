import type { BackworkResource } from '../entities/backwork.entity';
import type { Event } from '../entities/event.entity';
import type { ChannelType, ChatMessage } from '../entities/chat.entity';

export const SEARCH_REPOSITORY = 'SEARCH_REPOSITORY';

/** A member search hit, flattened from the `members` → `users` join. */
export interface SearchMemberHit {
  id: string;
  user_id: string;
  chapter_id: string;
  display_name: string;
  email: string;
}

/** The columns `canAccessChannel` decides a channel's readability from. */
export interface SearchChannelAccessRow {
  id: string;
  type: ChannelType;
  member_ids: string[] | null;
  required_permissions: string[] | null;
}

/**
 * The reads behind global search (spec/behavior/search.md). Each source
 * matches through an indexed full-text query and returns at most `limit` rows;
 * deciding what the caller may see from them stays with `SearchService`.
 */
export interface ISearchRepository {
  searchBackwork(
    chapterId: string,
    query: string,
    limit: number,
  ): Promise<BackworkResource[]>;
  searchEvents(
    chapterId: string,
    query: string,
    limit: number,
  ): Promise<Event[]>;
  /** Members whose display name matches, within the chapter only. */
  searchMembers(
    chapterId: string,
    query: string,
    limit: number,
  ): Promise<SearchMemberHit[]>;
  /**
   * Non-deleted messages in `channelIds` that match, newest first. The caller
   * has already reduced `channelIds` to what it may read, so this applies no
   * access rule of its own.
   */
  searchMessages(
    channelIds: string[],
    query: string,
    limit: number,
  ): Promise<ChatMessage[]>;
  /**
   * The chapter's channels with their access columns. `onlyChannelId` narrows
   * the candidate rows when it is a well-formed uuid and is ignored otherwise,
   * so a malformed id can only make the answer empty, never an error.
   */
  findChannelsForAccess(
    chapterId: string,
    onlyChannelId?: string,
  ): Promise<SearchChannelAccessRow[]>;
}
