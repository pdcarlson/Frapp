import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SystemPermissions } from '#domain/constants/permissions';
import type { CatchUpMessageRow } from '#domain/repositories/chat-catch-up.repository.interface';
import type { CatchUpMessage } from '#domain/utils/chat-catch-up';
import { ChatCatchUpService } from '../../../chat-catch-up/chat-catch-up.service';
import { CHAT_SOURCE_TYPE } from '../../../corpus/chat-message-corpus-source';
import { CorpusRetrievalService } from '../../../corpus/corpus-retrieval.service';
import { SearchService } from '../../../search.service';
import type {
  AgentEntity,
  AgentReadTool,
  AgentSource,
  AgentToolContext,
  AgentToolResult,
} from '../agent-tool';
import {
  ConversationScope,
  NO_SUCH_CHANNEL_NOTE,
  memberNote,
  type OpenChannel,
} from './conversation-scope';
import {
  BAD_DATES_NOTE,
  MESSAGES_PER_RESULT,
  distinctEntities,
  fitSources,
  messageSource,
  nothing,
  readDateRange,
} from './conversation-lines';

/** Conversations the search by meaning opens, best first. */
const MEANING_PASSAGES = 4;
/** Messages read from the start of each of those conversations. */
const MESSAGES_PER_PASSAGE = 4;
/** The kinds a member wrote. Cards and system rows are not conversation. */
const WRITTEN_KINDS: readonly string[] = ['text', 'announcement', 'imported'];
/** `SearchService` answers nothing for less (`spec/behavior/search.md`). */
const MIN_QUERY = 3;

const input = z.object({
  query: z
    .string()
    .max(200)
    .default('')
    .describe(
      'What to look for: a few words on the topic ("formal venue deposit"). May be empty when `from`, `since` or `until` narrows the search, for everything one member said or everything in a stretch of days.',
    ),
  channel: z
    .string()
    .max(120)
    .default('')
    .describe(
      'Only this channel, by name ("general"). Empty for every channel the member can open.',
    ),
  from: z
    .string()
    .max(120)
    .default('')
    .describe(
      'Only messages this member wrote, by their name as the roster writes it, or "me" for the member who is asking.',
    ),
  since: z
    .string()
    .max(40)
    .default('')
    .describe('Only messages from this day on, as 2026-11-01.'),
  until: z
    .string()
    .max(40)
    .default('')
    .describe('Only messages up to the end of this day, as 2026-11-07.'),
});
type Args = z.infer<typeof input>;

/**
 * Finds channel messages: by their words, and by what they are about.
 *
 * Two searches, because each misses what the other finds. Members ask in
 * their own words ("did anyone sort out the bus for formal"), and the
 * message that answers may share none of them ("coach is booked, deposit
 * went Tuesday").
 *
 * - **By words** is the app's own message search (`GET /v1/search`,
 *   `SearchService`): exact, newest first, narrowed by channel, sender and
 *   dates in the query. It also answers a search with no words at all,
 *   "everything Jordan posted this week".
 * - **By meaning** is the chapter's index (`CorpusRetrievalService`),
 *   narrowed in the database to chat, to the channels the asker can open,
 *   and to the member and dates asked for. A hit there is a stretch of
 *   conversation, so it is used only to find where to read: the messages
 *   themselves are read from the channel through `ChatCatchUpService`, and
 *   each becomes its own source like any other message.
 *
 * Every message that comes back passed the same checks, whichever search
 * found it: its channel is one the asker can open and is never a direct
 * message, its author said yes, the asker has not blocked them, and it is
 * not under a recruitment candidate's card. What consent left out is
 * counted.
 *
 * `from` is a name, matched against the roster (`ConversationScope` says
 * why names). A name that fits more than one member reads nothing and says
 * so, without saying who.
 */
@Injectable()
export class SearchMessagesTool implements AgentReadTool<Args> {
  readonly name = 'search_messages';
  readonly description =
    'Searches messages in the chapter channels the member can open, by words and by meaning. Can be narrowed to one channel, to what one member wrote ("me" for the asker), and to a stretch of days. Returns single messages; read_channel shows the conversation around one.';
  readonly reading = 'Searching messages';
  readonly permission = SystemPermissions.MEMBERS_VIEW;
  readonly module = null;
  readonly effect = 'read' as const;
  readonly input = input;

  constructor(
    private readonly scope: ConversationScope,
    private readonly search: SearchService,
    private readonly retrieval: CorpusRetrievalService,
    private readonly catchUp: ChatCatchUpService,
  ) {}

  async run(args: Args, context: AgentToolContext): Promise<AgentToolResult> {
    const { chapterId, userId, timeZone } = context;
    const reader = { chapterId, userId };
    const query = args.query.trim();

    const range = readDateRange(args.since, args.until, timeZone);
    if (!range) return nothing(chapterId, BAD_DATES_NOTE);
    const narrowed = Boolean(args.from.trim() || range.from || range.before);
    if (query.length < MIN_QUERY && !narrowed) {
      return nothing(
        chapterId,
        'Give at least three characters to search for, or narrow by from, since or until. To read a channel in order, use read_channel.',
      );
    }

    const open = await this.scope.openChannels(context);
    if (open.length === 0) {
      return nothing(chapterId, 'There are no channels to search.');
    }
    let channels = open;
    if (args.channel.trim()) {
      const channel = this.scope.findChannel(open, args.channel);
      if (!channel) return nothing(chapterId, NO_SUCH_CHANNEL_NOTE);
      channels = [channel];
    }
    let fromUserId: string | undefined;
    if (args.from.trim()) {
      const member = await this.scope.findMember(context, args.from);
      if (member.status !== 'found') {
        return nothing(chapterId, memberNote(member));
      }
      fromUserId = member.userId;
    }
    const since = range.from?.toISOString();
    const until = range.before?.toISOString();
    const channelOf = new Map(channels.map((channel) => [channel.id, channel]));

    const [byWords, byMeaning] = await Promise.all([
      this.byWords(reader, query, channelOf, args.channel.trim() !== '', {
        fromUserId,
        since,
        until,
      }),
      query.length >= MIN_QUERY
        ? this.byMeaning(context, query, channelOf, {
            fromUserId,
            since,
            until,
          })
        : Promise.resolve({ found: [], leftOut: 0 }),
    ]);

    // Exact matches first, newest first; then the conversations the meaning
    // search opened, best first, each in the order it was said.
    const seen = new Set<string>();
    const sources: AgentSource[] = [];
    const entities: AgentEntity[] = [];
    for (const { message, channel } of [...byWords.found, ...byMeaning.found]) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      const built = messageSource(message, channel, timeZone);
      sources.push(built.source);
      entities.push(...built.entities);
    }
    const fitted = fitSources(sources);
    const authors = new Set(
      fitted.sources.flatMap((source) => source.authorIds),
    );
    const shownChannels = new Set(
      fitted.sources.flatMap((source) =>
        source.target?.type === 'message' ? [source.target.channel_id] : [],
      ),
    );
    return {
      chapterId,
      sources: fitted.sources,
      entities: distinctEntities(
        entities.filter((entity) =>
          entity.type === 'member'
            ? authors.has(entity.id)
            : shownChannels.has(entity.id),
        ),
      ),
      note:
        fitted.sources.length === 0
          ? 'No messages matched.'
          : fitted.cut
            ? `${fitted.dropped} more matching messages are not shown. Narrow the search to see them.`
            : null,
      leftOutMessages: byWords.leftOut + byMeaning.leftOut,
    };
  }

  /** The app's message search, held to chapter channels and to consent. */
  private async byWords(
    reader: { chapterId: string; userId: string },
    query: string,
    channelOf: ReadonlyMap<string, OpenChannel>,
    oneChannel: boolean,
    filters: { fromUserId?: string; since?: string; until?: string },
  ): Promise<Found> {
    const { messages } = await this.search.search(
      reader.chapterId,
      reader.userId,
      query.length >= MIN_QUERY ? query : '',
      {
        ...(oneChannel ? { channelId: [...channelOf.keys()][0] } : {}),
        ...(filters.fromUserId ? { fromUserId: filters.fromUserId } : {}),
        ...(filters.since ? { after: filters.since } : {}),
        ...(filters.until ? { before: filters.until } : {}),
      },
    );
    // The search covers everything the member can open, direct messages
    // included, and every kind of row. Only a member's words in a chapter
    // channel go further, and never a row the search masked as blocked.
    const rows: (CatchUpMessageRow & { channel_id: string })[] = messages
      .filter(
        (message) =>
          !message.sender_blocked &&
          channelOf.has(message.channel_id) &&
          // A row from before kinds existed is plain text.
          WRITTEN_KINDS.includes(message.kind ?? 'text') &&
          message.thread_root_id == null &&
          message.content.trim() !== '',
      )
      .map((message) => ({
        id: message.id,
        channel_id: message.channel_id,
        sender_id: message.sender_id,
        content: message.content,
        created_at: message.created_at,
        thread_root_id: null,
        mentions: message.mentions ?? null,
      }));
    const readable = await this.catchUp.readableAmong(reader, rows);
    const channelIdOf = new Map(rows.map((row) => [row.id, row.channel_id]));
    return {
      found: readable.messages.flatMap((message) => {
        const channel = channelOf.get(channelIdOf.get(message.id) ?? '');
        return channel ? [{ message, channel }] : [];
      }),
      leftOut: readable.leftOut,
    };
  }

  /**
   * The index, used as a pointer: where the conversations about this are.
   * The messages are then read from the channel, so what reaches the model
   * is checked now, not as it stood when the passage was indexed.
   */
  private async byMeaning(
    context: AgentToolContext,
    query: string,
    channelOf: ReadonlyMap<string, OpenChannel>,
    filters: { fromUserId?: string; since?: string; until?: string },
  ): Promise<Found> {
    const reader = { chapterId: context.chapterId, userId: context.userId };
    const retrieved = await this.retrieval.retrieve(
      {
        chapterId: context.chapterId,
        actingUserId: context.userId,
        query,
        limit: MEANING_PASSAGES,
        filter: {
          sourceTypes: [CHAT_SOURCE_TYPE],
          channelIds: [...channelOf.keys()],
          ...(filters.fromUserId ? { authorId: filters.fromUserId } : {}),
          ...(filters.since ? { since: filters.since } : {}),
          ...(filters.until ? { until: filters.until } : {}),
        },
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      },
      context.now,
    );
    // The index being unavailable (the chapter's cap, the provider) costs
    // this half only: the search by words still answers.
    if (retrieved.status !== 'ok') return { found: [], leftOut: 0 };

    const stretches = await Promise.all(
      retrieved.passages.map(async (passage) => {
        const channel = channelOf.get(passage.channelId ?? '');
        if (!channel || !passage.sourceAt) return null;
        const stretch = await this.catchUp.readStretch(reader, {
          channelId: channel.id,
          from: passage.sourceAt,
          ...(filters.until ? { before: filters.until } : {}),
          // One member's words can sit anywhere in the conversation, so
          // all of it is read and theirs are picked out below.
          limit: Math.min(
            Math.max(passage.messageCount ?? 1, 1),
            filters.fromUserId ? MESSAGES_PER_RESULT : MESSAGES_PER_PASSAGE,
          ),
          keep: 'oldest',
        });
        return stretch && !stretch.chatOff ? { stretch, channel } : null;
      }),
    );
    const found: Found['found'] = [];
    let leftOut = 0;
    for (const entry of stretches) {
      if (!entry) continue;
      leftOut += entry.stretch.leftOut;
      const theirs = entry.stretch.messages.filter(
        (message) =>
          !filters.fromUserId || message.senderId === filters.fromUserId,
      );
      for (const message of theirs.slice(0, MESSAGES_PER_PASSAGE)) {
        found.push({ message, channel: entry.channel });
      }
    }
    return { found, leftOut };
  }
}

interface Found {
  found: { message: CatchUpMessage; channel: OpenChannel }[];
  leftOut: number;
}
