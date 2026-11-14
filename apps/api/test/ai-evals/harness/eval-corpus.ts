/**
 * The eval corpus: one invocation's documents and messages, set up as the
 * product's index would hold them, behind the product's own retrieval.
 *
 * What is the product's here, and so is what a case grades:
 *
 * - `CorpusRetrievalService`: which chapter is searched, the per-source
 *   access check, the passage-level consent check, chat after official
 *   sources, the left-out count.
 * - `ChatMessageCorpusSource` (#4314): a chat passage is readable only in a
 *   channel the asker can open, and only while every author in it says yes.
 * - `buildChatWindowChunks`: how a channel's messages become passages, and
 *   that a message whose author has not said yes is left out and counted.
 *
 * What stands in for the database, and so is NOT proven by a green run:
 *
 * - `match` below stands in for `match_corpus_chunks`. It returns the
 *   passages of the chapter it is asked for, as the SQL does; that the SQL
 *   really filters by chapter is proven by the PGlite tiers
 *   (`scripts/pglite/tiers/ai-corpus.mjs`, `ai-corpus-chat.mjs`), not here.
 *   What a case does prove is that Ask asks for the asker's chapter and for
 *   no other. Ranking is by shared words, which is not the product's
 *   ranking and is not graded: a case whose answer depends on which of many
 *   passages ranks first proves nothing about retrieval quality.
 * - Documents, minutes and announcements are one passage each and readable
 *   by every member of their chapter: the fixtures have no private document.
 *   Their access rules are covered by the adapters' own specs. Announcements
 *   count as official here, which the product does not do yet (#4381).
 * - A window is one channel's whole conversation, not one day of it.
 */
import type { CorpusCandidate } from '#domain/entities/corpus.entity';
import type {
  ICorpusRepository,
  MatchCorpusInput,
} from '#domain/repositories/corpus.repository.interface';
import {
  buildChatWindowChunks,
  chatSourceTitle,
} from '#domain/utils/corpus-chat';
import { isQuoteGrounded } from '#domain/utils/quote-grounding';
import type { AiGatewayService } from '../../../src/application/services/ai/ai-gateway.service';
import {
  CHAT_SOURCE_TYPE,
  ChatMessageCorpusSource,
  type ChatConsentReader,
} from '../../../src/application/services/corpus/chat-message-corpus-source';
import { CorpusRetrievalService } from '../../../src/application/services/corpus/corpus-retrieval.service';
import type { CorpusSourceAdapter } from '../../../src/application/services/corpus/corpus-source';
import type { AgentInvocation, CorpusDocument } from './types';

const OFFICIAL_TYPES = [
  'chapter_document',
  'meeting_minutes',
  'announcement',
] as const;

function isChat(document: CorpusDocument): boolean {
  return document.sourceType === CHAT_SOURCE_TYPE;
}

const STOP_WORDS = new Set(
  'the and for are was were what when where who how does did our your you with about this that have has say says saying said much many there any can will from into they their not which yet people going this year right now last new'.split(
    ' ',
  ),
);

function words(text: string): Set<string> {
  const found: string[] = text.toLowerCase().match(/[a-z0-9$]+/g) ?? [];
  return new Set(
    found.filter((word) => word.length >= 3 && !STOP_WORDS.has(word)),
  );
}

interface ChatPassage {
  candidate: CorpusCandidate;
  chapterId: string;
  /** The fixture messages the passage holds, oldest first. */
  messages: CorpusDocument[];
}

export interface EvalCorpus {
  retrieval: CorpusRetrievalService;
  /** Whose chat may be read: the fixtures' own answer on the sheet. */
  consent: ChatConsentReader;
  /**
   * The fixture document a citation of `passageId` stands for: the document
   * itself, or for a chat passage the message the quote is from. Undefined
   * for anything that is not a passage of this corpus (a tool result).
   */
  documentFor(passageId: string, quote: string): string | undefined;
}

/** The index as the product would hold it, for every chapter in the fixtures. */
export function createEvalCorpus(
  invocation: AgentInvocation,
  /** Retrieval embeds the question through this. The stand-in ignores the vector. */
  gateway: AiGatewayService,
): EvalCorpus {
  const { caller, corpus } = invocation;
  const saidYes = new Set(
    corpus.flatMap((document) =>
      document.chat?.authorConsented ? [document.chat.authorMemberId] : [],
    ),
  );
  const consent: ChatConsentReader = {
    chatAuthorsWhoSaidYes: (_chapterId, authorIds) =>
      Promise.resolve(new Set(authorIds.filter((id) => saidYes.has(id)))),
  };

  const official: Array<{ candidate: CorpusCandidate; chapterId: string }> =
    corpus
      .filter((document) => !isChat(document))
      .map((document) => ({
        chapterId: document.chapterId,
        candidate: {
          chunk_id: document.id,
          corpus_source_id: `source:${document.id}`,
          source_type: document.sourceType,
          source_id: document.id,
          title: document.title,
          heading: null,
          content: document.body,
          page_start: null,
          page_end: null,
          source_at: document.effectiveAt ?? document.createdAt,
          decays: document.sourceType !== 'chapter_document',
          dense_rank: null,
          sparse_rank: null,
          distance: null,
          author_ids: null,
          anchor_id: null,
          anchor_at: null,
          message_count: null,
          left_out_count: 0,
          channel_id: null,
        },
      }));

  // One window per channel of each chapter, cut into passages by the
  // product's own rule, with the opted-out members' messages left out.
  const chat: ChatPassage[] = [];
  const windowChannel = new Map<
    string,
    { chapterId: string; channelId: string }
  >();
  const byWindow = new Map<string, CorpusDocument[]>();
  for (const document of corpus) {
    if (!isChat(document) || !document.chat) continue;
    const windowId = `window:${document.chapterId}:${document.chat.channelId}`;
    windowChannel.set(windowId, {
      chapterId: document.chapterId,
      channelId: document.chat.channelId,
    });
    byWindow.set(windowId, [...(byWindow.get(windowId) ?? []), document]);
  }
  for (const [windowId, documents] of byWindow) {
    const ordered = [...documents].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    const channelName =
      /#([\w-]+)/.exec(ordered[0].title)?.[1] ??
      windowChannel.get(windowId)!.channelId;
    const built = buildChatWindowChunks(
      {
        channelName,
        day: ordered[0].createdAt.slice(0, 10),
        messages: ordered.map((document) => ({
          id: document.id,
          senderId: document.chat!.authorMemberId,
          // No names: a case can then say a member is never named.
          senderName: '',
          content: document.body,
          createdAt: document.createdAt,
          threadRootId: null,
          conversationAt: document.createdAt,
        })),
      },
      saidYes,
    );
    const included = ordered.filter((document) =>
      saidYes.has(document.chat!.authorMemberId),
    );
    let next = 0;
    built.passages.forEach((passage, index) => {
      const messages = included.slice(next, next + passage.messageCount);
      next += passage.messageCount;
      chat.push({
        chapterId: windowChannel.get(windowId)!.chapterId,
        messages,
        candidate: {
          chunk_id: `${windowId}#${index}`,
          corpus_source_id: `source:${windowId}`,
          source_type: CHAT_SOURCE_TYPE,
          source_id: windowId,
          title: chatSourceTitle(channelName),
          heading: passage.heading,
          content: passage.content,
          page_start: null,
          page_end: null,
          source_at: passage.anchorAt,
          decays: true,
          dense_rank: null,
          sparse_rank: null,
          distance: null,
          author_ids: passage.authorIds,
          anchor_id: passage.anchorId,
          anchor_at: passage.anchorAt,
          message_count: passage.messageCount,
          left_out_count: built.leftOutCount,
          channel_id: windowChannel.get(windowId)!.channelId,
        },
      });
    });
  }

  const repository: Pick<
    ICorpusRepository,
    'match' | 'chatWindowChannels' | 'readSourceChunks'
  > = {
    match(input: MatchCorpusInput): Promise<CorpusCandidate[]> {
      // The stand-in for `match_corpus_chunks`: this chapter's passages only,
      // narrowed as the SQL narrows them when a tool asks (#4900).
      const asked = words(input.query);
      const filter = input.filter;
      const kept = ({ candidate }: { candidate: CorpusCandidate }) =>
        (!filter?.sourceTypes ||
          filter.sourceTypes.includes(candidate.source_type)) &&
        (!filter?.channelIds ||
          candidate.channel_id === null ||
          filter.channelIds.includes(candidate.channel_id)) &&
        (!filter?.authorId ||
          (candidate.author_ids ?? []).includes(filter.authorId)) &&
        (!filter?.since ||
          (candidate.source_at !== null &&
            Date.parse(candidate.source_at) >= Date.parse(filter.since))) &&
        (!filter?.until ||
          (candidate.source_at !== null &&
            Date.parse(candidate.source_at) < Date.parse(filter.until)));
      const scored = [...official, ...chat]
        .filter((entry) => entry.chapterId === input.chapterId)
        .filter(kept)
        .map(({ candidate }) => {
          let shared = 0;
          // The indexed text of a passage leads with its source's title.
          for (const word of words(`${candidate.title} ${candidate.content}`)) {
            if (asked.has(word)) shared += 1;
          }
          return { candidate, shared };
        })
        .sort(
          (a, b) =>
            b.shared - a.shared ||
            a.candidate.chunk_id.localeCompare(b.candidate.chunk_id),
        )
        .slice(0, input.limit);
      // The words half finds a passage that holds at least half of the
      // question's words; the nearest half ranks everything.
      const needed = Math.max(1, Math.ceil(asked.size / 2));
      let wordRank = 0;
      return Promise.resolve(
        scored.map(({ candidate, shared }, index) => ({
          ...candidate,
          dense_rank: index + 1,
          sparse_rank: shared >= needed ? (wordRank += 1) : null,
        })),
      );
    },
    readSourceChunks(input) {
      // A document or minutes is one passage here, so it has one part.
      const source = official.find(
        (entry) =>
          entry.chapterId === input.chapterId &&
          entry.candidate.source_type === input.sourceType &&
          entry.candidate.source_id === input.sourceId,
      );
      if (!source) return Promise.resolve(null);
      const chunks = [
        {
          id: source.candidate.chunk_id,
          chunk_index: 0,
          heading: null,
          content: source.candidate.content,
          page_start: null,
          page_end: null,
        },
      ].slice(input.offset, input.offset + input.limit);
      return Promise.resolve({
        title: source.candidate.title,
        source_at: source.candidate.source_at,
        total: 1,
        chunks,
      });
    },
    chatWindowChannels(chapterId, windowIds) {
      return Promise.resolve(
        new Map(
          windowIds.flatMap((id): Array<[string, string]> => {
            const window = windowChannel.get(id);
            return window?.chapterId === chapterId
              ? [[id, window.channelId]]
              : [];
          }),
        ),
      );
    },
  };

  const everyMemberReads = (type: string): CorpusSourceAdapter => ({
    type: type as CorpusSourceAdapter['type'],
    read: () => Promise.resolve({ status: 'gone' }),
    readableBy: (_chapterId, _userId, sourceIds) =>
      Promise.resolve(new Set(sourceIds)),
  });
  const adapters: CorpusSourceAdapter[] = [
    ...OFFICIAL_TYPES.map(everyMemberReads),
    // The product's chat source, over the fixtures' channels and consent.
    new ChatMessageCorpusSource(
      repository as ICorpusRepository,
      consent,
      {
        filterAccessibleChannelIds: (_chapterId, userId, channelIds) =>
          Promise.resolve(
            new Set(
              userId === caller.memberId
                ? channelIds.filter((id) =>
                    (caller.channelIds ?? []).includes(id),
                  )
                : [],
            ),
          ),
      },
      { findBlockedUserIds: () => Promise.resolve([]) },
    ),
  ];

  return {
    retrieval: new CorpusRetrievalService(
      repository as ICorpusRepository,
      adapters,
      gateway,
    ),
    consent,
    documentFor(passageId, quote) {
      if (official.some(({ candidate }) => candidate.chunk_id === passageId)) {
        return passageId;
      }
      const passage = chat.find(
        ({ candidate }) => candidate.chunk_id === passageId,
      );
      if (!passage) return undefined;
      return (
        passage.messages.find((message) =>
          isQuoteGrounded(quote, message.body),
        ) ?? passage.messages[0]
      )?.id;
    },
  };
}
