import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  ChatCatchUpService,
  type ChatStretchRequest,
} from '../../../chat-catch-up/chat-catch-up.service';
import type {
  AgentReadTool,
  AgentToolContext,
  AgentToolResult,
} from '../agent-tool';
import { ConversationScope, NO_SUCH_CHANNEL_NOTE } from './conversation-scope';
import {
  BAD_DATES_NOTE,
  CHAT_OFF_NOTE,
  MESSAGES_PER_RESULT,
  distinctEntities,
  fitSources,
  label,
  messageSources,
  nothing,
  readDateRange,
  recordId,
} from './conversation-lines';

const input = z.object({
  channel: z
    .string()
    .max(120)
    .default('')
    .describe(
      'The channel to read, by name ("general"). Leave empty when `around` or `thread` names a message.',
    ),
  around: z
    .string()
    .max(120)
    .default('')
    .describe(
      'The id of a message source from an earlier result ("message:..."). Reads the conversation around it: the messages just before and after, or its thread when it is a reply.',
    ),
  thread: z
    .string()
    .max(120)
    .default('')
    .describe(
      'The id of a message source. Reads the thread that message is in or started: the message and its replies.',
    ),
  since: z
    .string()
    .max(40)
    .default('')
    .describe('Only messages from this day on, as 2026-11-01. With `channel`.'),
  until: z
    .string()
    .max(40)
    .default('')
    .describe(
      'Only messages up to the end of this day, as 2026-11-07, or before an exact time. With `channel`.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MESSAGES_PER_RESULT)
    .default(MESSAGES_PER_RESULT)
    .describe('How many messages to read.'),
});
type Args = z.infer<typeof input>;

const NOTHING_THERE_NOTE =
  'Nothing to read there: it is not a channel or a message you can open.';

/**
 * A stretch of one channel in the order it was said: the newest messages of
 * a channel, a stretch between two days, the conversation around a search
 * hit, or one thread. The channel's timeline (`GET /v1/channels/:id/messages`)
 * as a model may read it.
 *
 * It reads through `ChatCatchUpService.readStretch`, the reader Catch me up
 * already has, so the rules for chat reaching a model are in one place: the
 * asker must be able to open the channel, never a direct message, only
 * messages whose authors said yes, the asker's blocked members left out and
 * the rest counted, and no thread under a recruitment candidate's card.
 * Nothing is marked read.
 *
 * **Why a call is capped.** One message is one source, so each can be
 * cited and opened, and a result holds at most `AGENT_RESULT_MAX_SOURCES`.
 * A busy channel moves a few hundred messages a week, so a week does not
 * fit one call and is not meant to: the model reads the newest stretch,
 * and the note says how to step back when it needs more.
 */
@Injectable()
export class ReadChannelTool implements AgentReadTool<Args> {
  readonly name = 'read_channel';
  readonly description =
    'Reads messages of one channel in order: the newest ones, a stretch between two days, the conversation around a message a search found, or one thread. Use it to follow a discussion, not to find one (search_messages finds).';
  readonly reading = 'Reading the conversation';
  readonly permission = SystemPermissions.MEMBERS_VIEW;
  readonly module = null;
  readonly effect = 'read' as const;
  readonly input = input;

  constructor(
    private readonly scope: ConversationScope,
    private readonly catchUp: ChatCatchUpService,
  ) {}

  async run(args: Args, context: AgentToolContext): Promise<AgentToolResult> {
    const { chapterId, userId, timeZone } = context;
    const request = await this.request(args, context);
    if (typeof request === 'string') return nothing(chapterId, request);

    const stretch = await this.catchUp.readStretch(
      { chapterId, userId },
      request,
    );
    if (!stretch) return nothing(chapterId, NOTHING_THERE_NOTE);
    if (stretch.chatOff) return nothing(chapterId, CHAT_OFF_NOTE);

    const name = label(stretch.channel.name, 'channel');
    const built = messageSources(stretch.messages, stretch.channel, timeZone);
    // A channel is read for its newest messages, so when the caps cut the
    // stretch it is the oldest that go. A thread and the conversation around
    // a message are read from their start, so there the end goes.
    const fromEnd = 'channelId' in request;
    const fitted = fitSources(built.sources, {
      keep: fromEnd ? 'last' : 'first',
      whole: true,
    });
    const kept = new Set(fitted.sources.map((source) => source.id));
    const shown = stretch.messages.filter((message) =>
      kept.has(`message:${message.id}`),
    );
    const notes: string[] = [];
    if (fitted.sources.length === 0) {
      notes.push(`No messages to read in #${name} there.`);
    }
    const unread = stretch.notRead + fitted.dropped;
    if (unread > 0 && shown.length > 0) {
      if (fromEnd) {
        notes.push(
          `${unread} earlier messages in this stretch were not read. To read them, call again with until set to ${shown[0].createdAt}.`,
        );
      } else if ('aroundMessageId' in request) {
        notes.push(
          `${unread} later messages did not fit. To read on, call again with around set to message:${shown[shown.length - 1].id}.`,
        );
      } else {
        notes.push(`${unread} more replies in this thread were not read.`);
      }
    }
    return {
      chapterId,
      sources: fitted.sources,
      entities: distinctEntities(
        built.entities.filter(
          (entity) =>
            entity.type === 'channel' ||
            built.sources.some(
              (source) =>
                kept.has(source.id) && source.authorIds.includes(entity.id),
            ),
        ),
      ),
      note: notes.length > 0 ? notes.join(' ') : null,
      leftOutMessages: stretch.leftOut,
    };
  }

  /** What to read, or the line saying why nothing can be. */
  private async request(
    args: Args,
    context: AgentToolContext,
  ): Promise<ChatStretchRequest | string> {
    const limit = args.limit;
    if (args.thread.trim()) {
      const id = recordId(args.thread, 'message');
      return id ? { threadOfMessageId: id, limit } : NOTHING_THERE_NOTE;
    }
    if (args.around.trim()) {
      const id = recordId(args.around, 'message');
      return id ? { aroundMessageId: id, limit } : NOTHING_THERE_NOTE;
    }
    if (!args.channel.trim()) {
      return 'Name a channel to read, or pass a message id as around or thread.';
    }
    const channel = this.scope.findChannel(
      await this.scope.openChannels(context),
      args.channel,
    );
    if (!channel) return NO_SUCH_CHANNEL_NOTE;
    const range = readDateRange(args.since, args.until, context.timeZone);
    if (!range) return BAD_DATES_NOTE;
    return {
      channelId: channel.id,
      ...(range.from ? { from: range.from.toISOString() } : {}),
      ...(range.before ? { before: range.before.toISOString() } : {}),
      limit,
      keep: 'newest',
    };
  }
}
