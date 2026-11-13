import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CHAT_CATCH_UP_MAX_DAYS,
  CHAT_CATCH_UP_MAX_MESSAGES,
  CHAT_CATCH_UP_MIN_MESSAGES,
  type ChatCatchUp,
  type ChatCatchUpStatus,
  type ChatCatchUpUnavailableReason,
} from '@repo/validation';
import { aiCatalogEntry } from '#domain/constants/ai-model-catalog';
import {
  CHAT_CATCH_UP_REPOSITORY,
  type CatchUpMessagePlace,
  type CatchUpMessageRow,
  type CatchUpStretch,
  type IChatCatchUpRepository,
} from '#domain/repositories/chat-catch-up.repository.interface';
import {
  CHAT_MEMBER_BLOCK_REPOSITORY,
  type IChatMemberBlockRepository,
} from '#domain/repositories/chat-moderation.repository.interface';
import type { ChatChannel } from '#domain/entities/chat.entity';
import {
  USER_REPOSITORY,
  type IUserRepository,
} from '#domain/repositories/user.repository.interface';
import {
  CHAT_CATCH_UP_PROMPT_VERSION,
  CatchUpOutputSchema,
  buildCatchUpLines,
  catchUpMessages,
  catchUpSystem,
  checkCatchUpPoints,
  type CatchUpMessage,
  type CatchUpOutput,
} from '#domain/utils/chat-catch-up';
import { sealChatSummaryReportReceipt } from '#domain/utils/ai-report-receipt';
import { aiStoredTextKeyRing } from '../../../config/ai-stored-text-config';
import { reportCaughtFailure } from '../../../infrastructure/observability/report-caught-failure';
import { aiConsentRefusal } from '../ai/ai-consent-refusal';
import { AiConsentService } from '../ai/ai-consent.service';
import { AiGatewayService, type AiUnavailable } from '../ai/ai-gateway.service';
import { ChannelAccessService } from '../channel-access.service';

const TASK = 'chat.catch-up';
const DAY_MS = 86_400_000;

export interface ChatCatchUpInput {
  /** From `ChapterGuard`. Never from the request body or a model. */
  chapterId: string;
  /** The reader, from the auth guard. */
  userId: string;
  channelId: string;
  /** Exactly one of these three says what to read. */
  threadRootId?: string;
  since?: string;
  unread?: { count: number; asOf: string };
  /** The reader's IANA time zone, for "today". */
  timeZone: string;
  signal?: AbortSignal;
}

/** Whose messages are being read, and for whom. */
export interface ChatReader {
  /** From `ChapterGuard`. Never from the request body or a model. */
  chapterId: string;
  /** The reader, from the auth guard. */
  userId: string;
}

/** One stretch {@link ChatCatchUpService.readStretch} is asked for. */
export type ChatStretchRequest =
  /**
   * The thread one message is in or started: its first message and its
   * replies. The message names its own channel.
   */
  | { threadOfMessageId: string; limit: number }
  /**
   * The messages around one message, which names its own channel. A thread
   * reply reads its thread.
   */
  | { aroundMessageId: string; limit: number }
  /** A stretch of a channel between two moments, either optional. */
  | {
      channelId: string;
      from?: string;
      before?: string;
      limit: number;
      /** Which end of a longer stretch is read. Default the newest. */
      keep?: 'newest' | 'oldest';
    };

/** A stretch as a reader may be given it: no summary, no model call. */
export interface ChatStretchRead {
  channel: { id: string; name: string };
  /** Oldest first: only authors who said yes, the reader's blocks left out. */
  messages: CatchUpMessage[];
  /** Messages left out because their authors have not said yes. A count. */
  leftOut: number;
  /** Messages of the stretch that were past `limit` and not read. */
  notRead: number;
  /** The chapter has channel messages switched off for AI: nothing is read. */
  chatOff: boolean;
}

function result(
  status: ChatCatchUpStatus,
  fields: Partial<ChatCatchUp> = {},
): ChatCatchUp {
  return {
    status,
    reason: null,
    points: [],
    messages_read: 0,
    messages_total: 0,
    left_out_messages: 0,
    unverified_points: 0,
    covers_from: null,
    covers_to: null,
    ...fields,
  };
}

/** Why a gateway call was not made, in the words the clients know. */
function unavailableReason(
  refusal: AiUnavailable,
): ChatCatchUpUnavailableReason {
  if (refusal.reason === 'consent') {
    return refusal.detail === 'chapter_off'
      ? 'chapter_off'
      : 'consent_required';
  }
  if (refusal.reason === 'spend_cap') {
    if (refusal.detail === 'chapter_cap') return 'chapter_limit';
    if (refusal.detail === 'member_cap') return 'member_limit';
  }
  return 'not_available';
}

function longDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  }).format(date);
}

/**
 * Catch me up (#3946, `spec/behavior/ai.md` § Catch me up): a member asks
 * for the short version of a channel's new messages or of one thread, and
 * gets a few points, each tied to the message it came from.
 *
 * It runs only when a member asks. Nothing here is scheduled, nothing reads
 * a channel nobody asked about, and nothing is stored: the summary is the
 * response and exists nowhere else (ADR-28 decision 8). The one way any of
 * it is kept is the reader reporting it (`AiReportService`), from the sealed
 * receipt the response carries. No message, name or
 * point is logged.
 *
 * One request runs these steps, and each rule is here, in the product, not
 * in a prompt (`docs/security/ai-prompt-injection.md` C1 to C8):
 *
 * 1. **The reader can open the channel.** The timeline's own check
 *    (`ChannelAccessService`), in the chapter the request's guard resolved.
 *    A direct message, a group DM and the audit-log channel are refused
 *    here, and again by the read itself.
 * 2. **The chapter and the reader said yes.** The president's Ask switch and
 *    the reader's answer on the AI sheet, as for Ask (the gateway checks the
 *    same again before the call). Then the chat switch: with it off, no
 *    member's messages may be read, and the answer says so.
 * 3. **The stretch is read.** The newest messages of it, up to a fixed
 *    number.
 * 4. **Only messages whose authors said yes.** `chatAuthorsWhoSaidYes`, the
 *    rule the chat index applies: everyone else's messages are left out and
 *    counted, never named. An imported message nobody linked to a member has
 *    no author to have said yes. A member the reader blocked is left out and
 *    not counted, since a count that moved when the reader blocked someone
 *    would say who.
 * 5. **Too little, no model call.** A stretch with only a few readable
 *    messages is quicker to read than to shorten.
 * 6. **The summary.** One structured call. The conversation is the user
 *    turn, as data; the instructions are the system channel.
 * 7. **No point without its message.** Each point must name a message that
 *    was sent and quote words that are in it. The rest are dropped and
 *    counted; a summary left with none is not shown.
 *
 * Chat never triggers an action (C8): the call has no tools, and what comes
 * back is text for one reader.
 */
@Injectable()
export class ChatCatchUpService {
  private readonly logger = new Logger(ChatCatchUpService.name);

  constructor(
    private readonly channels: ChannelAccessService,
    private readonly consent: AiConsentService,
    private readonly gateway: AiGatewayService,
    @Inject(CHAT_CATCH_UP_REPOSITORY)
    private readonly stretches: IChatCatchUpRepository,
    @Inject(CHAT_MEMBER_BLOCK_REPOSITORY)
    private readonly blocks: Pick<
      IChatMemberBlockRepository,
      'findBlockedUserIds'
    >,
    @Inject(USER_REPOSITORY)
    private readonly users: Pick<IUserRepository, 'findDisplayIdentitiesByIds'>,
  ) {}

  async catchUp(
    input: ChatCatchUpInput,
    now: Date = new Date(),
  ): Promise<ChatCatchUp> {
    // 1. A channel in another chapter is a 404, one the reader cannot open a
    // 403, before anything about it is said.
    const channel = await this.channels.assertChannelAccess(
      input.channelId,
      input.chapterId,
      input.userId,
      'read',
    );
    if (
      channel.type === 'DM' ||
      channel.type === 'GROUP_DM' ||
      channel.is_audit_log
    ) {
      throw new BadRequestException({
        code: 'ai.catch_up.not_a_channel',
        message: 'Summaries are for chapter channels, never direct messages.',
      });
    }

    // 2. Refusals a client acts on arrive as ordinary errors, as Ask's do.
    const entry = aiCatalogEntry(TASK);
    const decision = await this.consent.check({
      chapterId: input.chapterId,
      actingUserId: input.userId,
      task: TASK,
      family: entry.family,
      provider: entry.provider,
      model: entry.model,
      promptVersion: CHAT_CATCH_UP_PROMPT_VERSION,
    });
    if (!decision.allowed) throw aiConsentRefusal(decision.reason);
    if (!(await this.consent.chapterSwitchOn(input.chapterId, 'chat_source'))) {
      return result('unavailable', { reason: 'chat_off' });
    }

    // 3.
    const stretch = await this.read(input, now);
    if (stretch.total === 0) return result('nothing_new');

    // 4.
    const readable = await this.readable(input, stretch.messages);
    // Only the reader's blocked members wrote here: to the reader that is
    // an empty stretch, as the timeline draws it.
    if (stretch.total - readable.blocked === 0) return result('nothing_new');
    const { lines, dropped } = buildCatchUpLines(readable.messages);
    const counts = {
      // What was read, plus what only length kept out: older messages past
      // the text one summary sends, and those past the most it fetches.
      // Messages left out for consent are `left_out_messages`, never here,
      // so "the most recent N of M" is said only when the stretch was cut.
      messages_total:
        lines.length + dropped + (stretch.total - stretch.messages.length),
      left_out_messages: readable.leftOut,
      messages_read: lines.length,
      covers_from: lines[0]?.message.createdAt ?? null,
      covers_to: lines.at(-1)?.message.createdAt ?? null,
    };

    // 5.
    if (lines.length < CHAT_CATCH_UP_MIN_MESSAGES && dropped === 0) {
      return result('too_little', counts);
    }

    // 6.
    const readerName = readable.readerName;
    const conversation = catchUpMessages(lines, readerName);
    const generated = await this.gateway.generateObject(
      TASK,
      {
        promptVersion: CHAT_CATCH_UP_PROMPT_VERSION,
        system: catchUpSystem({
          readerName,
          channelName: channel.name,
          thread: input.threadRootId !== undefined,
          today: longDate(now, input.timeZone),
        }),
        messages: conversation,
        schema: CatchUpOutputSchema,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
      { chapterId: input.chapterId, actingUserId: input.userId },
    );
    if (generated.status === 'unavailable') {
      return result('unavailable', {
        ...counts,
        reason: unavailableReason(generated),
      });
    }
    if (generated.status === 'refused') return result('refused', counts);
    if (generated.status === 'invalid_output') {
      return result('not_found', counts);
    }

    // 7.
    const checked = checkCatchUpPoints(generated.value, lines);
    if (checked.points.length === 0) {
      return result('not_found', {
        ...counts,
        unverified_points: checked.dropped,
      });
    }
    const summary = result('summarized', {
      ...counts,
      points: checked.points,
      unverified_points: checked.dropped,
    });
    // "Report this" (#4315): an id to report under, and the exchange sealed
    // for the reader to hand back. Still nothing is stored here.
    summary.summary_id = randomUUID();
    summary.report_receipt = this.receipt(
      summary,
      input,
      {
        given: conversation.map((turn) => turn.content).join('\n'),
        authors: lines.map((line) => line.message.senderId),
        written: generated.value,
      },
      now,
    );
    return summary;
  }

  /**
   * A stretch of a channel as its messages, for a reader that is not this
   * service's own summary: Ask's tools read a channel through here (#4900),
   * so there is one reader of chat for a model and one copy of its rules.
   * Steps 1, 3 and 4 of {@link catchUp}, and nothing else: no model is
   * called, nothing is written, and no read marker moves.
   *
   * Null when there is nothing this reader may be told about: a channel that
   * is not there, is another chapter's, is one they cannot open, or is a
   * direct message, group DM or the audit log; a message or thread that is
   * not there or sits under a recruitment candidate's card. One answer for
   * all of them, so the read is never a way to learn that a channel or a
   * message exists.
   *
   * The caller owns the consent check for its own model call (the gateway
   * makes it). The chapter's chat switch is read here, because with it off
   * no member's messages may reach any model.
   */
  async readStretch(
    reader: ChatReader,
    request: ChatStretchRequest,
  ): Promise<ChatStretchRead | null> {
    const messageId =
      'threadOfMessageId' in request
        ? request.threadOfMessageId
        : 'aroundMessageId' in request
          ? request.aroundMessageId
          : null;
    let channelId: string;
    let place: CatchUpMessagePlace | null = null;
    if (messageId !== null) {
      place = await this.stretches.locateMessage({
        chapterId: reader.chapterId,
        messageId,
      });
      if (!place) return null;
      channelId = place.channel_id;
    } else {
      channelId = (request as { channelId: string }).channelId;
    }

    const channel = await this.openChannel(reader, channelId);
    if (!channel) return null;
    const base = { channel: { id: channel.id, name: channel.name } };
    if (
      !(await this.consent.chapterSwitchOn(reader.chapterId, 'chat_source'))
    ) {
      return { ...base, messages: [], leftOut: 0, notRead: 0, chatOff: true };
    }

    const scope = { chapterId: reader.chapterId, channelId };
    const limit = Math.min(
      Math.max(Math.trunc(request.limit), 1),
      CHAT_CATCH_UP_MAX_MESSAGES,
    );
    let stretch: CatchUpStretch;
    const threadRootId =
      place === null
        ? null
        : 'threadOfMessageId' in request
          ? (place.thread_root_id ?? request.threadOfMessageId)
          : place.thread_root_id;
    if (threadRootId !== null) {
      const thread = await this.stretches.readThread({
        ...scope,
        rootId: threadRootId,
        limit,
      });
      if (!thread) return null;
      stretch = thread;
    } else if (place) {
      // The message itself opens the later half, so it is always read.
      const before = Math.floor((limit - 1) / 2);
      const [earlier, later] = await Promise.all([
        before > 0
          ? this.stretches.readChannelWindow({
              ...scope,
              before: place.created_at,
              limit: before,
              keep: 'newest',
            })
          : Promise.resolve({ messages: [], total: 0 }),
        this.stretches.readChannelWindow({
          ...scope,
          from: place.created_at,
          limit: limit - before,
          keep: 'oldest',
        }),
      ]);
      stretch = {
        messages: [...earlier.messages, ...later.messages],
        // "Around a message" is the stretch asked for; the rest of the
        // channel on either side is not a part of it that went unread.
        total: earlier.messages.length + later.messages.length,
      };
    } else {
      const window = request as Extract<ChatStretchRequest, { keep?: unknown }>;
      stretch = await this.stretches.readChannelWindow({
        ...scope,
        ...(window.from === undefined ? {} : { from: window.from }),
        ...(window.before === undefined ? {} : { before: window.before }),
        limit,
        keep: window.keep ?? 'newest',
      });
    }

    const readable = await this.readable(reader, stretch.messages);
    return {
      ...base,
      messages: readable.messages,
      leftOut: readable.leftOut,
      notRead: Math.max(stretch.total - stretch.messages.length, 0),
      chatOff: false,
    };
  }

  /**
   * Step 4 for messages a caller already holds (#4900): a search's hits,
   * from channels the caller has checked this reader can open. Which of
   * them a model may be shown, by the same rule as a stretch, with the
   * author's name. Nothing while the chapter's chat switch is off.
   */
  async readableAmong(
    reader: ChatReader,
    rows: readonly CatchUpMessageRow[],
  ): Promise<{ messages: CatchUpMessage[]; leftOut: number }> {
    if (rows.length === 0) return { messages: [], leftOut: 0 };
    const { messages, leftOut } = await this.readable(reader, rows);
    return { messages, leftOut };
  }

  /**
   * Step 1 without the throw: the channel when this reader can open it and
   * it is one a model may read, otherwise null.
   */
  private async openChannel(
    reader: ChatReader,
    channelId: string,
  ): Promise<ChatChannel | null> {
    let channel: ChatChannel;
    try {
      channel = await this.channels.assertChannelAccess(
        channelId,
        reader.chapterId,
        reader.userId,
        'read',
      );
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        return null;
      }
      throw error;
    }
    return channel.type === 'DM' ||
      channel.type === 'GROUP_DM' ||
      channel.is_audit_log
      ? null
      : channel;
  }

  /**
   * The exchange, sealed into the response so a report can hand it back.
   * Null when the server holds no sealing key. Never throws: a receipt that
   * could not be made costs the member only the text in a report, never
   * their summary.
   */
  private receipt(
    summary: ChatCatchUp,
    input: ChatCatchUpInput,
    exchange: {
      /** The conversation as the model was handed it. */
      given: string;
      /** Who wrote the messages in it. */
      authors: readonly string[];
      written: CatchUpOutput;
    },
    now: Date,
  ): string | null {
    try {
      const entry = aiCatalogEntry(TASK);
      const quoted = new Set(exchange.authors);
      quoted.delete(input.userId);
      return sealChatSummaryReportReceipt(
        aiStoredTextKeyRing(),
        {
          v: 1,
          summary_id: summary.summary_id ?? '',
          issued_at: now.toISOString(),
          channel_id: input.channelId,
          thread_root_id: input.threadRootId ?? null,
          given: exchange.given,
          written: exchange.written.points,
          shown: {
            points: summary.points.map((point) => ({
              kind: point.kind,
              text: point.text,
              message_id: point.message_id,
              quote: point.quote,
            })),
            messages_read: summary.messages_read,
            messages_total: summary.messages_total,
            left_out_messages: summary.left_out_messages,
            unverified_points: summary.unverified_points,
          },
          model: entry.model,
          prompt_version: CHAT_CATCH_UP_PROMPT_VERSION,
          quoted_user_ids: [...quoted],
        },
        { chapterId: input.chapterId, userId: input.userId },
      );
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'chat-catch-up-report-receipt',
        message: 'Catch me up: the report receipt could not be sealed',
        // A cipher or encoding error; neither carries the text.
        error,
      });
      return null;
    }
  }

  private async read(
    input: ChatCatchUpInput,
    now: Date,
  ): Promise<CatchUpStretch> {
    const scope = { chapterId: input.chapterId, channelId: input.channelId };
    if (input.threadRootId !== undefined) {
      const thread = await this.stretches.readThread({
        ...scope,
        rootId: input.threadRootId,
        limit: CHAT_CATCH_UP_MAX_MESSAGES,
      });
      if (!thread) throw new NotFoundException('Thread not found');
      return thread;
    }

    const floor = now.getTime() - CHAT_CATCH_UP_MAX_DAYS * DAY_MS;
    let since: number;
    if (input.unread !== undefined) {
      // The client's clock is not trusted past now: a later `as_of` would
      // only count messages the member has not been shown as unread.
      const given = Date.parse(input.unread.asOf);
      if (Number.isNaN(given)) {
        throw new BadRequestException('unread.as_of must be a date and time');
      }
      const asOf = Math.min(given, now.getTime());
      const start = await this.stretches.unreadStart({
        ...scope,
        userId: input.userId,
        count: input.unread.count,
        // The badge the client counted from leaves these out.
        blockedUserIds: await this.blocks.findBlockedUserIds(
          input.chapterId,
          input.userId,
        ),
        asOf: new Date(asOf).toISOString(),
      });
      // Fewer messages than the client counted (some were deleted since):
      // everything in reach is the stretch.
      since = start === null ? floor : Date.parse(start);
    } else {
      since = Date.parse(input.since ?? '');
    }
    if (Number.isNaN(since)) {
      throw new BadRequestException('since must be a date and time');
    }
    return this.stretches.readChannelSince({
      ...scope,
      since: new Date(Math.max(since, floor)).toISOString(),
      limit: CHAT_CATCH_UP_MAX_MESSAGES,
    });
  }

  /** Step 4: whose messages the summary may read, and how many it may not. */
  private async readable(
    input: ChatReader,
    rows: readonly CatchUpMessageRow[],
  ): Promise<{
    messages: CatchUpMessage[];
    leftOut: number;
    blocked: number;
    readerName: string;
  }> {
    const authors = [
      ...new Set(rows.flatMap((row) => (row.sender_id ? [row.sender_id] : []))),
    ];
    // A block list that cannot be read is not an empty block list: an error
    // here fails the request rather than summarizing a blocked member.
    const [yes, blockedIds, identities] = await Promise.all([
      this.consent.chatAuthorsWhoSaidYes(input.chapterId, authors),
      this.blocks.findBlockedUserIds(input.chapterId, input.userId),
      this.users.findDisplayIdentitiesByIds([
        ...new Set([...authors, input.userId]),
      ]),
    ]);
    const blockedSet = new Set(blockedIds);
    const names = new Map(
      identities.map((identity) => [identity.id, identity.display_name]),
    );
    const messages: CatchUpMessage[] = [];
    let leftOut = 0;
    let blocked = 0;
    for (const row of rows) {
      if (row.sender_id !== null && blockedSet.has(row.sender_id)) {
        blocked += 1;
        continue;
      }
      if (row.sender_id === null || !yes.has(row.sender_id)) {
        leftOut += 1;
        continue;
      }
      messages.push({
        id: row.id,
        senderId: row.sender_id,
        senderName: names.get(row.sender_id) ?? '',
        content: row.content,
        createdAt: row.created_at,
        threadRootId: row.thread_root_id,
        // The reader's own message never addresses them, though their own
        // `@here` stores them in `mentions` (2026-11-13).
        mentionsReader:
          row.sender_id !== input.userId &&
          (row.mentions?.includes(input.userId) ?? false),
      });
    }
    return {
      messages,
      leftOut,
      blocked,
      readerName: names.get(input.userId) ?? '',
    };
  }
}
