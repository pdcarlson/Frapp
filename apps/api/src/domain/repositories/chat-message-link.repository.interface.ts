import type {
  ChatLinkMemberState,
  ChatLinkMemberStateValue,
  ChatMessageLink,
} from '../entities/chat.entity';

/** A link the title sweep reads the page of (#4187). */
export type LinkTitleCandidate = Pick<
  ChatMessageLink,
  'id' | 'chapter_id' | 'url' | 'title_attempts'
>;

/**
 * How many times the title sweep tries a page before giving up on it. A
 * definite answer (a name, or a page with none) sets the count straight to
 * this, so only reads that failed on the way are ever tried again.
 */
export const MAX_LINK_TITLE_ATTEMPTS = 3;

export const CHAT_MESSAGE_LINK_REPOSITORY = 'CHAT_MESSAGE_LINK_REPOSITORY';

/**
 * Sign-up links posted in chat and each member's Done or Hide on them (#3897,
 * `spec/behavior/activity.md` § Links).
 *
 * Nothing here writes a link: the `chat_messages` triggers index them, so
 * every way a message is written indexes the same way. This repository reads
 * them, records an officer's remove, keeps the member states, and stores
 * each link's page title. Every method is scoped by chapter except the title
 * sweep's read and claim, which walk every chapter's unread links by design
 * and return only ids, chapters, URLs and attempt counts. None applies a channel's access rule:
 * `ActivityLinkService` does, through chat's own channel list.
 */
export interface IChatMessageLinkRepository {
  /**
   * The chapter's links still showing (not removed by an officer), posted
   * after `since`, in `channelIds`, newest first, at most `limit`. An empty
   * `channelIds` reads nothing.
   */
  findShowing(
    chapterId: string,
    options: {
      since: string;
      channelIds: string[];
      limit: number;
    },
  ): Promise<ChatMessageLink[]>;
  /** One link in the chapter, removed or not; null when there is none. */
  findById(chapterId: string, linkId: string): Promise<ChatMessageLink | null>;
  /** One member's states on these links. */
  findStates(
    chapterId: string,
    userId: string,
    linkIds: string[],
  ): Promise<ChatLinkMemberState[]>;
  /** Sets a member's Done or Hide, replacing the other. Idempotent. */
  setState(
    chapterId: string,
    linkId: string,
    userId: string,
    state: ChatLinkMemberStateValue,
  ): Promise<void>;
  /** Clears a member's state, so the link shows again. A no-op without one. */
  clearState(chapterId: string, linkId: string, userId: string): Promise<void>;
  /**
   * An officer's remove (`removedBy` set) or restore (`null`). Returns the
   * link as stored after, or null when the chapter has no such link.
   */
  setRemoved(
    chapterId: string,
    linkId: string,
    removedBy: string | null,
  ): Promise<ChatMessageLink | null>;
  /**
   * The title sweep's work (#4187), across every chapter, newest first, at
   * most `limit`: links with no title and fewer than
   * {@link MAX_LINK_TITLE_ATTEMPTS} tries, not removed, posted after `since`,
   * and either never tried or last tried before `retryBefore`.
   */
  findTitlePending(options: {
    since: string;
    retryBefore: string;
    limit: number;
  }): Promise<LinkTitleCandidate[]>;
  /**
   * Claims one link for a title read: raises its `title_attempts` by one and
   * stamps `title_checked_at`, only while the count is still the one the
   * sweep read. A compare-and-set, so of two sweeps (two API replicas) only
   * one reads each link each time. True when this call won it.
   */
  claimForTitle(link: LinkTitleCandidate): Promise<boolean>;
  /**
   * Ends these links' title reads with a definite answer: stores the name,
   * or, for `null`, none, and either way stops further tries.
   */
  finishTitle(
    chapterId: string,
    linkIds: string[],
    title: string | null,
  ): Promise<void>;
}
