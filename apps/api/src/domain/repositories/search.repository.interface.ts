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
  who_can_see: string[] | null;
}

/** What a message can be asked to carry (`has=` on `GET /v1/search`). */
export const SEARCH_MESSAGE_HAS = ['file', 'image', 'link', 'poll'] as const;
export type SearchMessageHas = (typeof SEARCH_MESSAGE_HAS)[number];

/**
 * Narrowings on the message source beyond its channel set (#3958). Each one
 * can only remove rows from what the channel set already allows, so none of
 * them is an access rule and none can widen what a caller reads.
 */
export interface SearchMessageFilters {
  /** `users.id` of the sender. The caller validates it is a uuid. */
  fromUserId?: string;
  /** ISO instant; messages at or after it. */
  after?: string;
  /** ISO instant; messages strictly before it. */
  before?: string;
  /** Every listed trait must hold. */
  has?: readonly SearchMessageHas[];
}

/**
 * The reads behind global search (spec/behavior/search.md). Each source
 * matches through an indexed full-text query, except a message search with
 * filters and no text, and returns at most `limit` rows;
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
   * access rule of its own. An empty `query` skips the text match, which the
   * caller allows only alongside a filter; `filters` narrow further.
   */
  searchMessages(
    channelIds: string[],
    query: string,
    limit: number,
    filters?: SearchMessageFilters,
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
