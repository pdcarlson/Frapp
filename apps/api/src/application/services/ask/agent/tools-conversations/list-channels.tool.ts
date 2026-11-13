import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SystemPermissions } from '#domain/constants/permissions';
import { ChatChannelReadsService } from '../../../chat-channel-reads.service';
import type {
  AgentReadTool,
  AgentToolContext,
  AgentToolResult,
} from '../agent-tool';
import { oneLine } from '../../ask-lines';
import { ConversationScope } from './conversation-scope';
import { label, nothing } from './conversation-lines';

/** A chapter has a dozen channels; an imported archive can have hundreds. */
const CHANNELS_LISTED = 60;

const input = z.object({
  unread_only: z
    .boolean()
    .default(false)
    .describe(
      'True to list only channels with messages the member has not read.',
    ),
});
type Args = z.infer<typeof input>;

/**
 * The asker's channels with what is unread in each: `GET /v1/channels` and
 * `GET /v1/channels/unread`, through `ChatChannelReadsService` (the two
 * reads of `ChatService` and nothing else of it), which narrows both to
 * what this member can open. It is where a question like "what did I miss"
 * starts, and it gives the model the channel names the other tools take.
 *
 * Reading the counts marks nothing as read.
 */
@Injectable()
export class ListChannelsTool implements AgentReadTool<Args> {
  readonly name = 'list_channels';
  readonly description =
    'The chapter channels the member can open, with how many unread messages and mentions each holds. Use it to find where a conversation is happening, or what the member has not caught up on.';
  readonly reading = 'Looking at your channels';
  readonly permission = SystemPermissions.MEMBERS_VIEW;
  readonly module = null;
  readonly effect = 'read' as const;
  readonly input = input;

  constructor(
    private readonly scope: ConversationScope,
    private readonly channelReads: ChatChannelReadsService,
  ) {}

  async run(args: Args, context: AgentToolContext): Promise<AgentToolResult> {
    const { chapterId } = context;
    const [channels, counts] = await Promise.all([
      this.scope.openChannels(context),
      this.channelReads.unreadCounts(chapterId, context.userId),
    ]);
    const countOf = new Map(counts.map((row) => [row.channel_id, row]));
    const rows = channels
      .map((channel) => ({
        channel,
        name: label(channel.name, 'channel'),
        unread: countOf.get(channel.id)?.unread_count ?? 0,
        mentions: countOf.get(channel.id)?.mention_count ?? 0,
      }))
      .filter((row) => !args.unread_only || row.unread > 0)
      // Where the member is behind comes first: that is what is asked about.
      .sort(
        (a, b) =>
          b.mentions - a.mentions ||
          b.unread - a.unread ||
          a.name.localeCompare(b.name),
      );
    if (rows.length === 0) {
      return nothing(
        chapterId,
        args.unread_only
          ? 'Nothing is unread in any channel.'
          : 'There are no channels to list.',
      );
    }
    const shown = rows.slice(0, CHANNELS_LISTED);
    const lines = shown.map((row) => {
      const unread =
        row.unread === 0
          ? 'nothing unread'
          : `${row.unread} unread${
              row.mentions > 0 ? `, ${row.mentions} mentioning you` : ''
            }`;
      const about = oneLine(row.channel.description);
      return `#${row.name}: ${unread}.${about ? ` About: ${about}` : ''}`;
    });
    return {
      chapterId,
      sources: [
        {
          id: `tool:${this.name}`,
          kind: 'chat',
          title: 'Your channels',
          detail: null,
          date: null,
          target: null,
          text: lines.join('\n'),
          // A list of channels is not anyone's message.
          chat: false,
          authorIds: [],
        },
      ],
      entities: shown.map((row) => ({
        type: 'channel' as const,
        id: row.channel.id,
        name: row.name,
      })),
      note:
        rows.length > shown.length
          ? `Showing ${shown.length} of ${rows.length} channels.`
          : null,
      leftOutMessages: 0,
    };
  }
}
