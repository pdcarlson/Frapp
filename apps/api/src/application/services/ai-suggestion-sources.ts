import { Injectable, NotFoundException } from '@nestjs/common';
import type { AiSuggestionSourceType } from '#domain/entities/ai-suggestion.entity';
import { ChannelAccessService } from './channel-access.service';
import { EventService } from './event.service';

/**
 * Who may see a suggestion, by what it was drawn from (#4309,
 * spec/behavior/ai.md § Whose access an AI run uses): a suggestion drawn from
 * an Exec meeting or a role-gated channel is listed only for people who can
 * open that meeting or channel, at the moment they look, and its quote is
 * shown only to them.
 *
 * One checker per source type, each answering through the source's own read
 * rule. A source type with no checker registered is openable by nobody, so a
 * new source can't leak before its rule is wired.
 */
export const AI_SUGGESTION_SOURCE_ACCESS = 'AI_SUGGESTION_SOURCE_ACCESS';

export interface AiSuggestionSourceAccess {
  readonly sourceType: AiSuggestionSourceType;
  /** Of `sourceIds` in the chapter, the ones `userId` can open now. */
  filterOpenable(
    chapterId: string,
    userId: string,
    sourceIds: readonly string[],
  ): Promise<Set<string>>;
}

/** An event, by `spec/behavior/events.md` § Attendance by role. */
@Injectable()
export class EventSuggestionSource implements AiSuggestionSourceAccess {
  readonly sourceType = 'event' as const;

  constructor(private readonly events: EventService) {}

  async filterOpenable(
    chapterId: string,
    userId: string,
    sourceIds: readonly string[],
  ): Promise<Set<string>> {
    const openable = new Set<string>();
    await Promise.all(
      [...new Set(sourceIds)].map(async (eventId) => {
        try {
          await this.events.findById(eventId, chapterId, userId);
          openable.add(eventId);
        } catch (error) {
          // Missing and hidden read the same, as they do on the event route.
          if (!(error instanceof NotFoundException)) throw error;
        }
      }),
    );
    return openable;
  }
}

/**
 * A channel, by the channel read rule. Archived channels stay readable by
 * whoever could read them, so a suggestion drawn from one still lists.
 */
@Injectable()
export class ChannelSuggestionSource implements AiSuggestionSourceAccess {
  readonly sourceType = 'channel' as const;

  constructor(private readonly channels: ChannelAccessService) {}

  filterOpenable(
    chapterId: string,
    userId: string,
    sourceIds: readonly string[],
  ): Promise<Set<string>> {
    return this.channels.filterAccessibleChannelIds(
      chapterId,
      userId,
      [...sourceIds],
      { includeArchived: true },
    );
  }
}
