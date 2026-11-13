import { Injectable } from '@nestjs/common';
import { CHAPTER_CHANNEL_TYPES } from '#domain/utils/chat-catch-up';
import { ChatChannelReadsService } from '../../../chat-channel-reads.service';
import { MemberService } from '../../../member.service';
import type { AgentToolContext } from '../agent-tool';

/** A chapter channel the asker can open. */
export interface OpenChannel {
  id: string;
  name: string;
  description: string | null;
}

export type MemberMatch =
  | { status: 'found'; userId: string }
  | { status: 'none' }
  /** More than one member fits what was typed. Never which. */
  | { status: 'several'; count: number };

const CHANNEL_TYPES: readonly string[] = CHAPTER_CHANNEL_TYPES;

const ASKER_WORDS = new Set(['me', 'myself', 'i', 'mine']);

function folded(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Turns the names a model writes into the ids a read needs (#4900), inside
 * what the asker can open.
 *
 * **Why names, not ids.** The model is shown names: a source's line reads
 * "Jordan Lee in #general", and an answer writes `@Jordan Lee` and
 * `#general` (`../agent-tool.ts`). It never sees a member's or a channel's
 * id, and a tool that asked for one would have the model copy 36 characters
 * out of nowhere. So `channel` and `from` are names, and they are matched
 * here against the list the asker already has: the channels their own
 * channel list shows, and the roster. A name that matches nothing reads
 * nothing; it cannot reach a channel the asker is not in, because that
 * channel is not in the list it is matched against.
 *
 * Both reads are the routes' own (`GET /v1/channels`, `GET /v1/members`'
 * roster), through the services those routes call.
 */
@Injectable()
export class ConversationScope {
  constructor(
    private readonly channelReads: ChatChannelReadsService,
    private readonly members: MemberService,
  ) {}

  /**
   * The chapter channels this asker can open, as their channel list has
   * them. Direct messages, group DMs and the audit log are never among
   * them: no tool reads those, whoever asks.
   */
  async openChannels(context: AgentToolContext): Promise<OpenChannel[]> {
    const channels = await this.channelReads.list(
      context.chapterId,
      context.userId,
    );
    return channels
      .filter(
        (channel) =>
          channel.chapter_id === context.chapterId &&
          CHANNEL_TYPES.includes(channel.type) &&
          !channel.is_audit_log,
      )
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        description: channel.description,
      }));
  }

  /** The open channel a model named, with or without its `#`. */
  findChannel(
    channels: readonly OpenChannel[],
    name: string,
  ): OpenChannel | null {
    const wanted = folded(name.replace(/^#+/, ''));
    if (!wanted) return null;
    return (
      channels.find((channel) => folded(channel.name) === wanted) ??
      channels.find((channel) => channel.id === wanted) ??
      null
    );
  }

  /**
   * The member a model named. "me" is the asker. Otherwise the roster's
   * display names: the whole name first, then one word of a name ("Jordan"
   * or "Lee" for Jordan Lee) when exactly one member has it. Part of a word
   * ("Jord") matches nobody.
   */
  async findMember(
    context: AgentToolContext,
    name: string,
  ): Promise<MemberMatch> {
    const wanted = folded(name.replace(/^@+/, ''));
    if (!wanted) return { status: 'none' };
    if (ASKER_WORDS.has(wanted)) {
      return { status: 'found', userId: context.userId };
    }
    const roster = await this.members.findRosterByChapter(context.chapterId);
    const whole = roster.filter(
      (entry) => folded(entry.display_name) === wanted,
    );
    const matches =
      whole.length > 0
        ? whole
        : roster.filter((entry) =>
            folded(entry.display_name)
              .split(' ')
              .some((part) => part === wanted),
          );
    if (matches.length === 0) return { status: 'none' };
    if (matches.length > 1) return { status: 'several', count: matches.length };
    return { status: 'found', userId: matches[0].user_id };
  }
}

/** What a tool says when a named member cannot be told apart or found. */
export function memberNote(match: Exclude<MemberMatch, { status: 'found' }>) {
  return match.status === 'several'
    ? `${match.count} members match that name. Use the full name as the roster writes it.`
    : 'No member of this chapter has that name. Use the name as the roster writes it.';
}

export const NO_SUCH_CHANNEL_NOTE =
  'There is no channel by that name among the ones you can open. list_channels shows them.';
