import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import type { MeetingNextAgendaItem } from '#domain/entities/meeting-next-agenda-item.entity';
import {
  EVENT_AGENDA_SUGGESTION_REPOSITORY,
  type IEventAgendaSuggestionRepository,
} from '#domain/repositories/event-agenda-suggestion.repository.interface';
import {
  MEETING_NEXT_AGENDA_ITEM_REPOSITORY,
  type IMeetingNextAgendaItemRepository,
} from '#domain/repositories/meeting-next-agenda-item.repository.interface';
import { sentSuggestionKey } from '#domain/utils/agenda-suggestions';
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
/** How long Undo stays possible, and the suggestion's words are kept for it. */
export const NEXT_AGENDA_UNDO_MS = DAY_MS;

/** What a send did, and where the item went. */
export interface NextAgendaOutcome {
  item: MeetingNextAgendaItem;
  /**
   * The meeting it was added to or offered on, when the sender can see it;
   * null while it waits, or when that meeting is hidden from them.
   */
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
 * - The suggestion is closed, never a task. Undo, for a day, takes the item
 *   back off and puts the suggestion back as it was.
 * - Its agenda item's id is the suggestion's (`nextAgendaItemIdOf`), so two
 *   sends, or two placements, racing each other add one item.
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
    @Inject(EVENT_AGENDA_SUGGESTION_REPOSITORY)
    private readonly agendaSuggestions: Pick<
      IEventAgendaSuggestionRepository,
      'addedKeys'
    >,
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
        return item ? this.outcomeOf(chapterId, userId, item) : null;
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
      mayUndo: (item) => this.assertMayUndo(chapterId, userId, item),
      // Kept for a day; after that the sweep empties them and Undo is over.
      wordsOf: (item) =>
        Object.keys(item.suggestion_payload).length > 0 &&
        Date.parse(item.created_at) > this.now().getTime() - NEXT_AGENDA_UNDO_MS
          ? { payload: item.suggestion_payload, quote: item.suggestion_quote }
          : null,
      unmake: (item) => this.unmake(chapterId, item),
    });
  }

  /**
   * Puts the chapter's waiting items onto their next meeting, now that one
   * may exist: after every event is created, and hourly from the sweep (a
   * series edit adds meetings without a create). Each goes on for the
   * officer who sent it, by the same rules as a send.
   */
  async placeWaiting(chapterId: string): Promise<number> {
    const now = this.now();
    const waiting = await this.repo.listWaiting(chapterId, now.toISOString());
    if (waiting.length === 0) return 0;
    const upcoming = await this.upcoming(chapterId, now);
    const sources = new Map<string, Event | null>();
    let moved = 0;
    for (const item of waiting) {
      const sourceId = item.source_event_id;
      if (!sourceId) continue;
      if (!sources.has(sourceId)) {
        sources.set(sourceId, await this.eventOrNull(sourceId, chapterId));
      }
      const source = sources.get(sourceId);
      if (!source) continue;
      const next = nextMeetingOf(source, upcoming, now, audienceKey);
      if (!next || !item.ai_suggestion_id) continue;
      const agendaItemId = nextAgendaItemIdOf(item.ai_suggestion_id);
      const { state } = item.created_by
        ? await this.place(chapterId, item.created_by, next, {
            agendaItemId,
            text: item.text,
          })
        : { state: 'offered' as const };
      const ok = await this.repo.moveWaiting(
        chapterId,
        item.id,
        state === 'placed'
          ? { state, event_id: next.id, agenda_item_id: agendaItemId }
          : { state: 'offered', event_id: next.id },
      );
      if (ok) {
        moved += 1;
      } else if (
        state === 'placed' &&
        !(await this.repo.findBySuggestion(chapterId, item.ai_suggestion_id))
      ) {
        // Undo took it back meanwhile. Another placement that won put the
        // same item (one id) on and keeps it.
        await this.takeOff(chapterId, next.id, agendaItemId);
      }
    }
    return moved;
  }

  /** The hourly sweep's pass over every chapter with an item waiting. */
  async placeWaitingEverywhere(): Promise<number> {
    const chapters = await this.repo.listWaitingChapters(
      this.now().toISOString(),
    );
    let moved = 0;
    for (const chapterId of chapters) {
      try {
        moved += await this.placeWaiting(chapterId);
      } catch (error) {
        reportCaughtFailure(this.logger, {
          level: 'warning',
          site: 'next-agenda-place-waiting',
          message: `Placing waiting next-agenda items failed in chapter ${chapterId}`,
          error,
        });
      }
    }
    return moved;
  }

  /** Empties the kept words of items whose Undo is over. */
  async forgetWords(): Promise<number> {
    return this.repo.forgetWords(
      new Date(this.now().getTime() - NEXT_AGENDA_UNDO_MS).toISOString(),
    );
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
      ? await this.eventOrNull(meeting.event_id, chapterId)
      : null;
    if (!source) {
      // Minutes whose meeting was deleted have no "next" to go to.
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
    const agendaItemId = nextAgendaItemIdOf(row.id);
    const text = agendaTextOf(row);
    const placed = next
      ? await this.place(chapterId, userId, next, { agendaItemId, text })
      : { state: 'waiting' as const, visible: false };
    try {
      const item = await this.repo.insert({
        id: randomUUID(),
        chapter_id: chapterId,
        meeting_id: meeting.id,
        source_event_id: source.id,
        text,
        state: placed.state,
        event_id: next?.id ?? null,
        agenda_item_id: placed.state === 'placed' ? agendaItemId : null,
        expires_at:
          placed.state === 'waiting'
            ? new Date(
                now.getTime() + NEXT_AGENDA_WAIT_DAYS * DAY_MS,
              ).toISOString()
            : null,
        ai_suggestion_id: row.id,
        suggestion_payload: row.payload,
        suggestion_quote: row.quote,
        created_by: userId,
      });
      return {
        item,
        event: next && placed.visible ? next : null,
        sourceName: source.name,
      };
    } catch (error) {
      if (placed.state === 'placed' && next) {
        await this.takeOff(chapterId, next.id, agendaItemId);
      }
      throw error;
    }
  }

  /**
   * Puts the item on `next`'s agenda when `userId` may edit it and the agenda
   * has room; otherwise it is offered there under Suggested. `visible` says
   * whether they can see `next`, so a hidden meeting is never named to them.
   */
  private async place(
    chapterId: string,
    userId: string,
    next: Event,
    item: { agendaItemId: string; text: string },
  ): Promise<{ state: 'placed' | 'offered'; visible: boolean }> {
    const [mayEdit, visible] = await Promise.all([
      this.rbac.memberHasAnyPermission(chapterId, userId, [
        SystemPermissions.EVENTS_UPDATE,
      ]),
      this.sees(chapterId, userId, next.id),
    ]);
    if (!mayEdit || !visible) return { state: 'offered', visible };
    const agendaItem: EventAgendaItem = {
      id: item.agendaItemId,
      text: item.text,
      done: false,
    };
    try {
      await this.events.appendAgendaItem(next.id, chapterId, agendaItem);
      return { state: 'placed', visible };
    } catch (error) {
      // A full agenda: offered there instead, for an officer to make room.
      if (error instanceof ConflictException) {
        return { state: 'offered', visible };
      }
      throw error;
    }
  }

  /**
   * Undo takes an item off a meeting's agenda, so it needs what editing that
   * agenda needs; and an offered item another officer already added from
   * Suggested has left the sender's hands.
   */
  private async assertMayUndo(
    chapterId: string,
    userId: string,
    item: MeetingNextAgendaItem,
  ): Promise<void> {
    if (item.state === 'placed' && item.event_id) {
      const [mayEdit, visible] = await Promise.all([
        this.rbac.memberHasAnyPermission(chapterId, userId, [
          SystemPermissions.EVENTS_UPDATE,
        ]),
        this.sees(chapterId, userId, item.event_id),
      ]);
      if (!mayEdit || !visible) {
        throw new ForbiddenException({
          code: 'ai.suggestion.forbidden',
          message: 'You can’t edit that meeting’s agenda.',
        });
      }
    }
    if (item.state === 'offered') {
      const added = await this.agendaSuggestions.addedKeys(chapterId, [
        sentSuggestionKey(item.id),
      ]);
      if (added.size > 0) {
        throw new ConflictException({
          code: 'ai.suggestion.decided',
          message: 'An officer already added it to a meeting’s agenda.',
        });
      }
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
    userId: string,
    item: MeetingNextAgendaItem,
  ): Promise<NextAgendaOutcome> {
    const [event, source] = await Promise.all([
      item.event_id
        ? this.events
            .findById(item.event_id, chapterId, userId)
            .catch(nullIfNotFound)
        : null,
      item.source_event_id
        ? this.eventOrNull(item.source_event_id, chapterId)
        : null,
    ]);
    return { item, event, sourceName: source?.name ?? '' };
  }

  /** Whether `userId` can see the event, by the events list's own rule. */
  private sees(
    chapterId: string,
    userId: string,
    eventId: string,
  ): Promise<boolean> {
    return this.events
      .findById(eventId, chapterId, userId)
      .then(() => true)
      .catch((error: unknown) => {
        if (error instanceof NotFoundException) return false;
        throw error;
      });
  }

  /** The event as the server sees it, or null when it is gone. */
  private eventOrNull(
    eventId: string,
    chapterId: string,
  ): Promise<Event | null> {
    return this.events.findById(eventId, chapterId).catch(nullIfNotFound);
  }

  /** The chapter's meetings in the coming year, as the server sees them. */
  private upcoming(chapterId: string, now: Date): Promise<Event[]> {
    return this.events.findByChapter(chapterId, undefined, {
      endsAfter: now.toISOString(),
      startsBefore: new Date(
        now.getTime() + NEXT_MEETING_LOOKAHEAD_DAYS * DAY_MS,
      ).toISOString(),
    });
  }
}

/** The agenda item a suggestion sent on becomes: one per suggestion. */
export function nextAgendaItemIdOf(suggestionId: string): string {
  return `n-${suggestionId}`;
}

/** A read that answers null for a missing event and rethrows anything else. */
function nullIfNotFound(error: unknown): null {
  if (error instanceof NotFoundException) return null;
  throw error;
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
