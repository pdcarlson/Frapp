import { Inject, Injectable } from '@nestjs/common';
import type { CorpusCandidate } from '#domain/entities/corpus.entity';
import {
  CHAT_MEMBER_BLOCK_REPOSITORY,
  type IChatMemberBlockRepository,
} from '#domain/repositories/chat-moderation.repository.interface';
import {
  CORPUS_REPOSITORY,
  type ICorpusRepository,
} from '#domain/repositories/corpus.repository.interface';
import {
  buildChatWindowChunks,
  chatSourceTitle,
} from '#domain/utils/corpus-chat';
import { AiConsentService } from '../ai/ai-consent.service';
import { ChannelAccessService } from '../channel-access.service';
import type {
  CorpusAdmission,
  CorpusSourceAdapter,
  CorpusSourceRead,
} from './corpus-source';

export const CHAT_SOURCE_TYPE = 'chat_message';

/** The parts of the consent service chat needs: whose messages may be read. */
export type ChatConsentReader = Pick<AiConsentService, 'chatAuthorsWhoSaidYes'>;
/** The parts of channel access chat needs: the same read check as the timeline. */
export type ChatChannelReader = Pick<
  ChannelAccessService,
  'filterAccessibleChannelIds'
>;
/** The part of the block list chat needs. */
export type ChatBlockReader = Pick<
  IChatMemberBlockRepository,
  'findBlockedUserIds'
>;

/** What `chatPassagesStillAllowed` needs of a passage. */
export interface ChatPassageAuthors {
  sourceType: string;
  sourceId: string;
  authorIds: readonly string[];
  /** Messages in the passage, for the left-out count. */
  messageCount?: number | null;
}

/**
 * The last of the three consent checks (`ai.md` § Chat as a source, #4314):
 * at prompt assembly, just before text leaves Frapp, drop every chat passage
 * with an author who no longer says yes. Indexing left them out when they
 * had not said yes, and retrieval dropped them when they had changed their
 * mind; this catches a No given in between. Returns the passages that may
 * be sent, in order, and how many messages were dropped, to add to the
 * answer's left-out count.
 */
export async function chatPassagesStillAllowed<P extends ChatPassageAuthors>(
  passages: readonly P[],
  chapterId: string,
  consent: ChatConsentReader,
): Promise<{ passages: P[]; withheldMessages: number }> {
  const authors = [
    ...new Set(
      passages.flatMap((passage) =>
        passage.sourceType === CHAT_SOURCE_TYPE ? passage.authorIds : [],
      ),
    ),
  ];
  const yes = await consent.chatAuthorsWhoSaidYes(chapterId, authors);
  let withheldMessages = 0;
  const kept = passages.filter((passage) => {
    if (passage.sourceType !== CHAT_SOURCE_TYPE) return true;
    const ok =
      passage.authorIds.length > 0 &&
      passage.authorIds.every((author) => yes.has(author));
    if (!ok) withheldMessages += passage.messageCount ?? 1;
    return ok;
  });
  return { passages: kept, withheldMessages };
}

/**
 * Messages in chapter channels as a corpus source (#4314, ADR-28 decision 5,
 * `spec/behavior/ai.md` § Chat as a source, threat model C8).
 *
 * A source is a conversation window: one channel's messages on one day, each
 * thread's replies under the message they answer
 * (`20261112150000_ai_corpus_chat.sql`). The database keeps the windows in
 * step with the chat and never offers a DM or group DM; this adapter decides
 * whose words are read.
 *
 * - **Only from members who said yes.** Reading a window keeps only messages
 *   whose author said yes on the current sheet while the chapter's chat
 *   switch is on (`AiConsentService.chatAuthorsWhoSaidYes`). The rest are
 *   left out and counted, and the passage is rebuilt without them: neither
 *   dropped whole nor kept whole. An imported Discord message counts only
 *   once its author is linked to a member who said yes (#2878).
 * - **Checked again at retrieval** (`admit`): a passage by an author whose
 *   answer is no longer yes is withheld until the window is rebuilt, and so
 *   is one by a member the asker blocked (`chat/README.md` § What a block
 *   does and does not hide). And once more at prompt assembly, by the caller
 *   (`chatPassagesStillAllowed`).
 * - **Answers follow the asker's access.** `readableBy` asks the same check
 *   the timeline and search make (`ChannelAccessService`), at the moment of
 *   the question.
 *
 * Indexing acts for the member whose message last changed the window, under
 * the chapter's switch (the `corpus` family); it sends only the words of
 * members who said yes.
 */
@Injectable()
export class ChatMessageCorpusSource implements CorpusSourceAdapter {
  readonly type = CHAT_SOURCE_TYPE;

  constructor(
    @Inject(CORPUS_REPOSITORY) private readonly corpus: ICorpusRepository,
    @Inject(AiConsentService) private readonly consent: ChatConsentReader,
    @Inject(ChannelAccessService) private readonly channels: ChatChannelReader,
    @Inject(CHAT_MEMBER_BLOCK_REPOSITORY)
    private readonly blocks: ChatBlockReader,
  ) {}

  async read(chapterId: string, sourceId: string): Promise<CorpusSourceRead> {
    const window = await this.corpus.readChatWindow(chapterId, sourceId);
    if (!window) return { status: 'gone' };

    const authors = [
      ...new Set(
        window.messages.flatMap((message) =>
          message.senderId ? [message.senderId] : [],
        ),
      ),
    ];
    // The consent check comes before anything is sent: a message is embedded
    // only if its author said yes, and the switch is read here too.
    const yes = await this.consent.chatAuthorsWhoSaidYes(chapterId, authors);
    const built = buildChatWindowChunks(window, yes);
    const leftOut = {
      count: built.leftOutCount,
      authorIds: built.leftOutAuthorIds,
    };
    return {
      status: 'ok',
      content: {
        title: chatSourceTitle(window.channelName),
        sourceAt:
          built.firstAt ?? new Date(`${window.day}T09:00:00Z`).toISOString(),
        // Chat dates like minutes: last month's plan is older news.
        decays: true,
        sections: [],
        passages: built.passages,
        leftOut,
      },
    };
  }

  async readableBy(
    chapterId: string,
    userId: string,
    sourceIds: readonly string[],
  ): Promise<Set<string>> {
    if (sourceIds.length === 0) return new Set();
    // DM windows are not returned by the lookup at all.
    const channelOf = await this.corpus.chatWindowChannels(
      chapterId,
      sourceIds,
    );
    if (channelOf.size === 0) return new Set();
    const open = await this.channels.filterAccessibleChannelIds(
      chapterId,
      userId,
      [...new Set(channelOf.values())],
    );
    return new Set(
      [...channelOf].flatMap(([windowId, channelId]) =>
        open.has(channelId) ? [windowId] : [],
      ),
    );
  }

  async admit(
    chapterId: string,
    userId: string,
    candidates: readonly CorpusCandidate[],
  ): Promise<CorpusAdmission> {
    const authors = [
      ...new Set(candidates.flatMap((candidate) => candidate.author_ids ?? [])),
    ];
    // A block list that cannot be read is not an empty block list: an error
    // here fails the retrieval rather than serving a blocked member's words.
    const [yes, blocked] = await Promise.all([
      this.consent.chatAuthorsWhoSaidYes(chapterId, authors),
      this.blocks.findBlockedUserIds(chapterId, userId),
    ]);
    const blockedSet = new Set(blocked);
    const admitted = new Set<string>();
    const withheldBySource = new Map<string, number>();
    for (const candidate of candidates) {
      const ids = candidate.author_ids ?? [];
      const consented = ids.length > 0 && ids.every((id) => yes.has(id));
      if (!consented) {
        withheldBySource.set(
          candidate.source_id,
          (withheldBySource.get(candidate.source_id) ?? 0) +
            (candidate.message_count ?? 1),
        );
        continue;
      }
      // Withheld, and not counted: a count that moved when the asker
      // blocked someone would say who.
      if (ids.some((id) => blockedSet.has(id))) continue;
      admitted.add(candidate.chunk_id);
    }
    return { admitted, withheldBySource };
  }
}
