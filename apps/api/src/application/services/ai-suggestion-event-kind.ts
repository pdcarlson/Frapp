import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SystemPermissions } from '#domain/constants/permissions';
import type { AiSuggestionPayload } from '#domain/entities/ai-suggestion.entity';
import type { AiSuggestionKindHandler } from './ai-suggestion-kinds';
import { EventService } from './event.service';

/** An event name longer than this is cut, not refused. */
const EVENT_SUGGESTION_NAME_MAX_LENGTH = 200;

/** How long a suggested event waits for an officer (spec: ai.md § Suggestions). */
const EVENT_SUGGESTION_EXPIRY_DAYS = 14;

/**
 * A suggested event, as stored and as listed (#3930, "this time last year").
 * It names the event and says when it was last held; everything else the
 * officer's form is filled from is read from the source event itself, by the
 * officer, under the event read rule.
 */
export interface EventSuggestionPayload {
  name: string;
  /** When the source event started, last year. */
  last_year_at: string | null;
  /** How many times it was held around then (a weekly series: six). */
  times: number;
  /**
   * The event the officer made from it, set by their accept and never by a
   * proposal: accepting records it, it does not make one.
   */
  event_id: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Longer than any ISO 8601 instant. */
const INSTANT_MAX_LENGTH = 40;

function instantOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > INSTANT_MAX_LENGTH) {
    return null;
  }
  return Number.isNaN(Date.parse(value)) ? null : value;
}

/** Reads a stored payload back; the shape `normalizeProposal` wrote. */
export function readEventPayload(
  payload: AiSuggestionPayload,
): EventSuggestionPayload {
  const times = payload.times;
  return {
    name: typeof payload.name === 'string' ? payload.name : '',
    last_year_at: instantOrNull(payload.last_year_at),
    times:
      typeof times === 'number' && Number.isInteger(times) && times > 0
        ? times
        : 1,
    event_id:
      typeof payload.event_id === 'string' && UUID.test(payload.event_id)
        ? payload.event_id
        : null,
  };
}

/**
 * Suggested events (#3930 is the first producer). An event has too many
 * choices to make from a row (who is invited, by role; whether it is
 * required; points; where), so accepting one does not make it: the officer
 * adds the event through the ordinary event form, filled in from the source,
 * and through the ordinary route with its own permission check. The accept
 * then records which event that was, after checking that it exists in the
 * chapter and that this officer made it. Nothing here writes an event.
 */
@Injectable()
export class EventSuggestionKind implements AiSuggestionKindHandler {
  readonly kind = 'event' as const;
  /**
   * Who plans the chapter's calendar, not who can add an event to it (#4549,
   * Paul 2026-11-13: not every member). `events:create` is a member default
   * since #3709, so gating on it put these in front of the whole chapter and
   * let any member dismiss one for good. `events:update` ("Edit events") is
   * what a chapter gives the officers it trusts with its calendar, a social
   * chair included when it chooses. It gates seeing, accepting and
   * dismissing alike, and `LastYearSuggestionsService` reads last year's
   * events only for a member who holds it,
   * since the permission is stored on the row (the
   * `last_year_event_suggestions_planners` migration moved the rows written
   * before this).
   */
  readonly requiredPermission = SystemPermissions.EVENTS_UPDATE;
  readonly module = 'events';
  readonly expiresAfterDays = EVENT_SUGGESTION_EXPIRY_DAYS;
  readonly pushCategory = 'events';

  constructor(private readonly events: EventService) {}

  describeBatch(count: number): string {
    return count === 1
      ? '1 suggested event to review'
      : `${count} suggested events to review`;
  }

  normalizeProposal(raw: unknown): AiSuggestionPayload | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const input = raw as Record<string, unknown>;
    const name =
      typeof input.name === 'string'
        ? input.name.trim().slice(0, EVENT_SUGGESTION_NAME_MAX_LENGTH).trimEnd()
        : '';
    if (!name) return null;
    const read = readEventPayload(input);
    // Never from a proposal: only an officer's accept names the event made.
    return { name, last_year_at: read.last_year_at, times: read.times };
  }

  applyEdits(
    payload: AiSuggestionPayload,
    edits: Record<string, unknown>,
  ): AiSuggestionPayload {
    const eventId = edits.event_id;
    if (typeof eventId !== 'string' || !UUID.test(eventId)) {
      throw new BadRequestException({
        code: 'ai.suggestion.incomplete',
        message: 'Add the event from its form first.',
      });
    }
    return { ...payload, event_id: eventId };
  }

  /**
   * Never: the event is made in its own form, so what the officer changed
   * there is not this suggestion's to know, and the id every accept carries
   * is not a change.
   */
  countsAsEdited(): boolean {
    return false;
  }

  assertAcceptable(payload: AiSuggestionPayload): void {
    if (!readEventPayload(payload).event_id) {
      throw new BadRequestException({
        code: 'ai.suggestion.incomplete',
        message: 'Add the event from its form first.',
      });
    }
  }

  async commit(input: {
    chapterId: string;
    userId: string;
    payload: AiSuggestionPayload;
  }): Promise<{ resultId: string }> {
    const { event_id: eventId } = readEventPayload(input.payload);
    // `assertAcceptable` ran before the claim; this narrows the type.
    if (!eventId) {
      throw new BadRequestException({
        code: 'ai.suggestion.incomplete',
        message: 'Add the event from its form first.',
      });
    }
    // Missing, another chapter's, or not this member's own: all answer 404,
    // as the event route does for an event the member can't see. Saying
    // "someone else's" would confirm a role-targeted event exists.
    const event = await this.events.findById(eventId, input.chapterId);
    if (event.created_by !== input.userId) {
      throw new NotFoundException('Event not found');
    }
    return { resultId: event.id };
  }
}
