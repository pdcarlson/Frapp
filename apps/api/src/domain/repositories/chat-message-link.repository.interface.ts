import type {
  ChatLinkMemberState,
  ChatLinkMemberStateValue,
  ChatMessageLink,
} from '../entities/chat.entity';

export const CHAT_MESSAGE_LINK_REPOSITORY = 'CHAT_MESSAGE_LINK_REPOSITORY';

/**
 * Sign-up links posted in chat and each member's Done or Hide on them (#3897,
 * `spec/behavior/activity.md` § Links).
 *
 * Nothing here writes a link: the `chat_messages` triggers index them, so
 * every way a message is written indexes the same way. This repository reads
 * them, records an officer's remove, and keeps the member states. Every
 * method is scoped by chapter. None applies a channel's access rule:
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
}
