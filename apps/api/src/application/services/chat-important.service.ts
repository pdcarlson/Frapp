import { Inject, Injectable } from '@nestjs/common';
import { CHAT_MESSAGE_REPOSITORY } from '#domain/repositories/chat.repository.interface';
import type { IChatMessageRepository } from '#domain/repositories/chat.repository.interface';
import { CHAT_IMPORTANT_SEEN_REPOSITORY } from '#domain/repositories/chat-important.repository.interface';
import type { IChatImportantSeenRepository } from '#domain/repositories/chat-important.repository.interface';
import type {
  ChatMessage,
  ImportantMessageRef,
  ImportantMessages,
} from '#domain/entities';
import { ChannelAccessService } from './channel-access.service';
import { ChatBlockService } from './chat-block.service';

/** Only Important messages flagged this recently count (Shawn, 2026-11-11). */
export const IMPORTANT_WINDOW_DAYS = 14;
/** One page of the candidate read. A channel rarely flags this many in two weeks. */
export const IMPORTANT_PAGE_SIZE = 200;
/**
 * The most candidates one request reads, in pages of
 * {@link IMPORTANT_PAGE_SIZE}: a ceiling on a pathological channel, not a
 * limit any real one meets. Below it, `total` is exact.
 */
export const IMPORTANT_READ_CEILING = 1000;
/** How many unseen messages one answer lists; `total` counts them all. */
export const IMPORTANT_LIST_LIMIT = 50;
/** How many ids one seen report may carry. */
export const IMPORTANT_SEEN_BATCH_MAX = 100;
/** An excerpt's length in characters, before the client cuts it to one line. */
export const IMPORTANT_EXCERPT_LENGTH = 140;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The "1 important message" strip (#4186, slice 4 of #3921):
 * spec/behavior/chat/README.md § Message flags.
 *
 * A channel's strip counts the timeline messages flagged Important in the last
 * {@link IMPORTANT_WINDOW_DAYS} days that the member hasn't seen. Never counted:
 * thread replies, deleted messages (both in the repository read), the member's
 * own messages, messages they flagged themselves, and messages from a member
 * they blocked. A message is seen once the member jumps to it, scrolls it onto
 * their screen, or dismisses the strip; each is a row of
 * `chat_message_important_seen`, so a message once seen stays seen.
 *
 * One request reads at most {@link IMPORTANT_READ_CEILING} candidates; past
 * that, the oldest flags in the window go uncounted.
 *
 * Its own service, as bookmarks are: it shares only the channel-access seam
 * and the block list with `ChatService`.
 */
@Injectable()
export class ChatImportantService {
  constructor(
    @Inject(CHAT_MESSAGE_REPOSITORY)
    private readonly messageRepo: IChatMessageRepository,
    @Inject(CHAT_IMPORTANT_SEEN_REPOSITORY)
    private readonly seenRepo: IChatImportantSeenRepository,
    private readonly channelAccess: ChannelAccessService,
    private readonly chatBlocks: ChatBlockService,
  ) {}

  /** The unseen Important messages in a channel the caller can read. */
  async listUnseen(
    channelId: string,
    chapterId: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<ImportantMessages> {
    await this.channelAccess.assertChannelAccess(channelId, chapterId, userId);
    const unseen = await this.unseenFor(channelId, chapterId, userId, now);
    return toAnswer(unseen);
  }

  /**
   * Marks the given messages seen and answers the strip's new state.
   *
   * Only ids that are Important messages the strip would count for the caller
   * in this channel are written; any other id is ignored rather than refused,
   * because a client reports what scrolled past and a flag can come off
   * between its read and this write. Ids are compared lowercased: a UUID is
   * case-insensitive and the database answers lowercase (#688).
   */
  async markSeen(
    channelId: string,
    chapterId: string,
    userId: string,
    messageIds: readonly string[],
    now: Date = new Date(),
  ): Promise<ImportantMessages> {
    await this.channelAccess.assertChannelAccess(channelId, chapterId, userId);
    const eligible = await this.eligibleFor(channelId, chapterId, userId, now);
    const asked = new Set(messageIds.map((id) => id.toLowerCase()));
    await this.seenRepo.markSeen(
      chapterId,
      userId,
      eligible.filter((m) => asked.has(m.id.toLowerCase())).map((m) => m.id),
    );
    return toAnswer(await this.withoutSeen(eligible, chapterId, userId));
  }

  /**
   * The strip's ×: every message it counts is marked seen. Writing ones
   * already seen is harmless, since the write keeps the first `seen_at`.
   */
  async dismissAll(
    channelId: string,
    chapterId: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<ImportantMessages> {
    await this.channelAccess.assertChannelAccess(channelId, chapterId, userId);
    const eligible = await this.eligibleFor(channelId, chapterId, userId, now);
    await this.seenRepo.markSeen(
      chapterId,
      userId,
      eligible.map((m) => m.id),
    );
    return toAnswer([]);
  }

  private async unseenFor(
    channelId: string,
    chapterId: string,
    userId: string,
    now: Date,
  ): Promise<ChatMessage[]> {
    const eligible = await this.eligibleFor(channelId, chapterId, userId, now);
    return this.withoutSeen(eligible, chapterId, userId);
  }

  /** What the strip would count for this member, seen or not. */
  private async eligibleFor(
    channelId: string,
    chapterId: string,
    userId: string,
    now: Date,
  ): Promise<ChatMessage[]> {
    const since = new Date(
      now.getTime() - IMPORTANT_WINDOW_DAYS * DAY_MS,
    ).toISOString();
    const [candidates, blocked] = await Promise.all([
      this.readCandidates(channelId, since),
      this.chatBlocks.listBlockedUserIds(chapterId, userId),
    ]);
    const blockedIds = new Set(blocked);
    return candidates.filter(
      (m) =>
        m.sender_id !== userId &&
        m.flagged_by !== userId &&
        !(m.sender_id && blockedIds.has(m.sender_id)),
    );
  }

  /**
   * Every Important message in the window, page by page, so the filters
   * above run over all of them rather than over the newest page only, up to
   * {@link IMPORTANT_READ_CEILING}.
   */
  private async readCandidates(
    channelId: string,
    since: string,
  ): Promise<ChatMessage[]> {
    const all: ChatMessage[] = [];
    for (
      let offset = 0;
      offset < IMPORTANT_READ_CEILING;
      offset += IMPORTANT_PAGE_SIZE
    ) {
      const page = await this.messageRepo.findImportantInChannel(
        channelId,
        since,
        { offset, limit: IMPORTANT_PAGE_SIZE },
      );
      all.push(...page);
      if (page.length < IMPORTANT_PAGE_SIZE) break;
    }
    return all;
  }

  private async withoutSeen(
    messages: ChatMessage[],
    chapterId: string,
    userId: string,
  ): Promise<ChatMessage[]> {
    const seen = await this.seenRepo.findSeenMessageIds(
      chapterId,
      userId,
      messages.map((m) => m.id),
    );
    return messages.filter((m) => !seen.has(m.id));
  }
}

/** Oldest first, the order the strip jumps in; ties broken by id. */
function toAnswer(unseen: ChatMessage[]): ImportantMessages {
  const ordered = [...unseen].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  return {
    messages: ordered.slice(0, IMPORTANT_LIST_LIMIT).map(toRef),
    total: ordered.length,
  };
}

function toRef(message: ChatMessage): ImportantMessageRef {
  // By code point, not UTF-16 unit, so the cut never splits an emoji.
  const chars = Array.from((message.content ?? '').replace(/\s+/g, ' ').trim());
  return {
    id: message.id,
    created_at: message.created_at,
    // Present on every candidate: the read filters on it.
    flagged_at: message.flagged_at ?? message.created_at,
    sender_id: message.sender_id ?? null,
    author_name: message.sender_id ? null : (message.author_name ?? null),
    excerpt:
      chars.length > IMPORTANT_EXCERPT_LENGTH
        ? `${chars.slice(0, IMPORTANT_EXCERPT_LENGTH - 1).join('')}…`
        : chars.join(''),
  };
}
