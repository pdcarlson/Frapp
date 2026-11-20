import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  EVENT_AGENDA_ITEM_MAX,
  normalizeAgendaText,
  type EventAgendaItem,
} from '@repo/validation';
import { SystemPermissions } from '#domain/constants/permissions';
import type { AiSuggestion } from '#domain/entities/ai-suggestion.entity';
import type { Event } from '#domain/entities/event.entity';
import type {
  MeetingNextAgendaItem,
  MeetingNextAgendaItemState,
} from '#domain/entities/meeting-next-agenda-item.entity';
import {
  MEETING_NEXT_AGENDA_ITEM_REPOSITORY,
  type IMeetingNextAgendaItemRepository,
} from '#domain/repositories/meeting-next-agenda-item.repository.interface';
import {
  NEXT_AGENDA_WAIT_DAYS,
  NEXT_MEETING_LOOKAHEAD_DAYS,
  nextMeetingOf,
} from '#domain/utils/next-meeting';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import { AiSuggestionService } from './ai-suggestion.service';
import { EventService } from './event.service';
import { audienceKey } from './meeting-draft-context.service';
import { MeetingService } from './meeting.service';
import { assertModuleEnabled, type EnabledModules } from './module-gate';
import { RbacService } from './rbac.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** What a send did, and where the item went. */
export interface NextAgendaOutcome {
  item: MeetingNextAgendaItem;
  /** The meeting it was added to or offered on; null while it waits. */
  event: Event | null;
  /** The minutes' own meeting's name, for "the next Chapter Meeting". */
  sourceName: string;
}

/**
 * Add to next meeting's agenda (#5790; Shawn, 2026-11-20): a suggested task
 * from posted minutes goes onto the agenda of the next meeting instead of
 * becoming a task.
 *
 * - **Which meeting:** the earliest upcoming one with the minutes' audience,
 *   and their event type, else series, else name (`isSameMeetingKind`).
 * - **Straight onto its agenda** when the officer may edit it (`events:update`
 *   and can see it), as a plain item at the end.
 * - **Under Suggested instead** when they can't, or its agenda is full:
 *   every upcoming meeting with that audience offers it, as tabled items are
 *   (`AgendaSuggestionService`), until an agenda adds it.
 * - **Waiting** when no such meeting is on the calendar: it goes onto the
 *   next one created, by the same rules for the officer who sent it, and is
 *   deleted after 30 days if none is.
 * - The suggestion is closed, never a task. Undo takes the item back off and
 *   puts the suggestion back as it was.
 *
 * This changes Paul's rule of 2026-11-18 (`meetings.md` "Where it goes
 * next": no rule picks the next instance), by Shawn's ask; the spec keeps
 * Paul's note with the change dated under it.
 */
@Injectable()
export class MinutesNextAgendaService implements OnModuleInit {
  private readonly logger = new Logger(MinutesNextAgendaService.name);
  /** The clock, replaceable in tests. */
  now: () => Date = () => new Date();

  constructor(
    private readonly suggestions: AiSuggestionService,
    private readonly events: EventService,
    private readonly meetings: MeetingService,
    private readonly rbac: RbacService,
    @Inject(MEETING_NEXT_AGENDA_ITEM_REPOSITORY)
    private readonly repo: IMeetingNextAgendaItemRepository,
  ) {}

  onModuleInit(): void {
    this.events.onCreated(async (chapterId) => {
      await this.placeWaiting(chapterId);
    });
  }

  /** Sends a suggested task from minutes to the next meeting's agenda. */
  async send(
    chapterId: string,
    userId: string,
    suggestionId: string,
    enabledModules: EnabledModules,
  ): Promise<NextAgendaOutcome> {
    assertModuleEnabled(enabledModules, 'events');
    return this.suggestions.handleElsewhere(chapterId, userId, suggestionId, {
      reason: 'to_agenda',
      accepts: (row) =>
        row.kind === 'task' &&
        row.source_type === 'meeting' &&
        agendaTextOf(row) !== '',
      findMade: async (row) => {
        const item = await this.repo.findBySuggestion(chapterId, row.id);
        return item ? this.outcomeOf(chapterId, item) : null;
      },
      make: (row) => this.make(chapterId, userId, row),
      unmake: (made) => this.unmake(chapterId, made.item),
    });
  }

  /**
   * Undo: takes the item back off the meeting it went on (or out of
   * Suggested, or the wait) and puts the suggestion back as it was.
   */
  async undo(
    chapterId: string,
    userId: string,
    suggestionId: string,
  ): Promise<void> {
    await this.suggestions.undoHandled(chapterId, userId, suggestionId, {
      findMade: (row) => this.repo.findBySuggestion(chapterId, row.id),
      wordsOf: (item) => ({
        payload: item.suggestion_payload,
        quote: item.suggestion_quote,
      }),
      unmake: (item) => this.unmake(chapterId, item),
    });
  }

  /**
   * Puts the chapter's waiting items onto their next meeting, now that one
   * may exist: called after every event is created. Each goes on for the
   * officer who sent it, by the same rules as a send.
   */
  async placeWaiting(chapterId: string): Promise<number> {
    const now = this.now();
    const waiting = await this.repo.listWaiting(chapterId, now.toISOString());
    if (waiting.length === 0) return 0;
    const upcoming = await this.upcoming(chapterId, now);
    let moved = 0;
    for (const item of waiting) {
      const source = item.source_event_id
        ? await this.events
            .findById(item.source_event_id, chapterId)
            .catch(() => null)
        : null;
      if (!source) continue;
      const next = nextMeetingOf(source, upcoming, now, audienceKey);
      if (!next) continue;
      const state = item.created_by
        ? await this.place(chapterId, item.created_by, next, item)
        : 'offered';
      const ok = await this.repo.moveWaiting(
        chapterId,
        item.id,
        state === 'placed'
          ? {
              state,
              event_id: next.id,
              agenda_item_id: nextAgendaItemIdOf(item.id),
            }
          : { state: 'offered', event_id: next.id },
      );
      if (!ok && state === 'placed') {
        // Another creation moved it first, or Undo took it back.
        await this.takeOff(chapterId, next.id, nextAgendaItemIdOf(item.id));
        continue;
      }
      if (ok) moved += 1;
    }
    return moved;
  }

  /** Deletes the waiting items no meeting picked up in 30 days. */
  async deleteExpired(): Promise<number> {
    return this.repo.deleteExpired(this.now().toISOString());
  }

  private async make(
    chapterId: string,
    userId: string,
    row: AiSuggestion,
  ): Promise<NextAgendaOutcome> {
    const { meeting } = await this.meetings.get(
      chapterId,
      row.source_id,
      userId,
    );
    const source = meeting.event_id
      ? await this.events
          .findById(meeting.event_id, chapterId)
          .catch(() => null)
      : null;
    if (!source) {
      // Minutes with no meeting of their own have no "next" to go to.
      throw new BadRequestException({
        code: 'ai.suggestion.not_handled_here',
        message: 'These minutes have no meeting to follow.',
      });
    }
    const now = this.now();
    const next = nextMeetingOf(
      source,
      await this.upcoming(chapterId, now),
      now,
      audienceKey,
    );
    const id = randomUUID();
    const text = agendaTextOf(row);
    const state: MeetingNextAgendaItemState = next
      ? await this.place(chapterId, userId, next, { id, text })
      : 'waiting';
    try {
      const item = await this.repo.insert({
        id,
        chapter_id: chapterId,
        meeting_id: meeting.id,
        source_event_id: source.id,
        text,
        state,
        event_id: next?.id ?? null,
        agenda_item_id: state === 'placed' ? nextAgendaItemIdOf(id) : null,
        expires_at:
          state === 'waiting'
            ? new Date(
                now.getTime() + NEXT_AGENDA_WAIT_DAYS * DAY_MS,
              ).toISOString()
            : null,
        ai_suggestion_id: row.id,
        suggestion_payload: row.payload,
        suggestion_quote: row.quote,
        created_by: userId,
      });
      return { item, event: next, sourceName: source.name };
    } catch (error) {
      if (state === 'placed' && next) {
        await this.takeOff(chapterId, next.id, nextAgendaItemIdOf(id));
      }
      throw error;
    }
  }

  /**
   * Puts the item on `next`'s agenda when `userId` may edit it and the agenda
   * has room; otherwise it is offered there under Suggested.
   */
  private async place(
    chapterId: string,
    userId: string,
    next: Event,
    item: { id: string; text: string },
  ): Promise<'placed' | 'offered'> {
    const [mayEdit, sees] = await Promise.all([
      this.rbac.memberHasAnyPermission(chapterId, userId, [
        SystemPermissions.EVENTS_UPDATE,
      ]),
      this.events
        .findById(next.id, chapterId, userId)
        .then(() => true)
        .catch((error: unknown) => {
          if (error instanceof NotFoundException) return false;
          throw error;
        }),
    ]);
    if (!mayEdit || !sees) return 'offered';
    const agendaItem: EventAgendaItem = {
      id: nextAgendaItemIdOf(item.id),
      text: item.text,
      done: false,
    };
    try {
      await this.events.appendAgendaItem(next.id, chapterId, agendaItem);
      return 'placed';
    } catch (error) {
      // A full agenda: offered there instead, for an officer to make room.
      if (error instanceof ConflictException) return 'offered';
      throw error;
    }
  }

  private async unmake(
    chapterId: string,
    item: MeetingNextAgendaItem,
  ): Promise<void> {
    if (item.state === 'placed' && item.event_id && item.agenda_item_id) {
      await this.takeOff(chapterId, item.event_id, item.agenda_item_id);
    }
    await this.repo.delete(chapterId, item.id);
  }

  /** Takes an item off a meeting's agenda; a meeting gone since is fine. */
  private async takeOff(
    chapterId: string,
    eventId: string,
    agendaItemId: string,
  ): Promise<void> {
    try {
      await this.events.removeAgendaItem(eventId, chapterId, agendaItemId);
    } catch (error) {
      if (error instanceof NotFoundException) return;
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'next-agenda-take-off',
        message: `Could not take item ${agendaItemId} off event ${eventId}`,
        error,
      });
      throw error;
    }
  }

  private async outcomeOf(
    chapterId: string,
    item: MeetingNextAgendaItem,
  ): Promise<NextAgendaOutcome> {
    const [event, source] = await Promise.all([
      item.event_id
        ? this.events.findById(item.event_id, chapterId).catch(() => null)
        : null,
      item.source_event_id
        ? this.events
            .findById(item.source_event_id, chapterId)
            .catch(() => null)
        : null,
    ]);
    return { item, event, sourceName: source?.name ?? '' };
  }

  /** The chapter's meetings in the next few months, as the server sees them. */
  private upcoming(chapterId: string, now: Date): Promise<Event[]> {
    return this.events.findByChapter(chapterId, undefined, {
      endsAfter: now.toISOString(),
      startsBefore: new Date(
        now.getTime() + NEXT_MEETING_LOOKAHEAD_DAYS * DAY_MS,
      ).toISOString(),
    });
  }
}

/** The agenda item an item sent on becomes: one per item. */
export function nextAgendaItemIdOf(itemId: string): string {
  return `n-${itemId}`;
}

/**
 * The words a suggested task goes on an agenda with: the whole action item
 * when its title had to be cut from it, else the title, as an agenda item
 * holds them.
 */
export function agendaTextOf(row: AiSuggestion): string {
  const title = typeof row.payload.title === 'string' ? row.payload.title : '';
  return normalizeAgendaText(row.quote ?? title).slice(
    0,
    EVENT_AGENDA_ITEM_MAX,
  );
}
