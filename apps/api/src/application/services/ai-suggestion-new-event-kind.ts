import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MAX_REPEAT_RULE_LENGTH,
  POINTS_ADJUSTMENT_MAX,
  isRepeatRule,
} from '@repo/validation';
import { SystemPermissions } from '#domain/constants/permissions';
import type { AiSuggestionPayload } from '#domain/entities/ai-suggestion.entity';
import type {
  AiSuggestionCommitResult,
  AiSuggestionKindHandler,
} from './ai-suggestion-kinds';
import { EventService } from './event.service';
import { EventTypeService } from './event-type.service';

export const NEW_EVENT_SUGGESTION_NAME_MAX_LENGTH = 255;
export const NEW_EVENT_SUGGESTION_TEXT_MAX_LENGTH = 2000;
/** An event proposal is stale by the next day (the acting agent, #718). */
const NEW_EVENT_SUGGESTION_EXPIRY_DAYS = 1;
/** Longer than any ISO 8601 instant, so a model's essay is not one. */
const INSTANT_MAX_LENGTH = 40;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A proposed event, as stored and as listed: one event, or a series when the
 * member asked for one ("every Sunday at 6:48"), open to the whole chapter.
 * Who is invited by role, a check-in zone and anything else the card does not
 * show are set in the event form, which the card's Edit opens (#5117).
 */
export interface NewEventSuggestionPayload {
  name: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string;
  /**
   * Points for coming. Null when the member did not say and nothing could
   * be copied: the card asks for them, and accepting waits for them.
   */
  point_value: number | null;
  /**
   * Where points the member did not say were copied from, for the card's
   * line under them ("From your Chapter meeting event type"). Null when
   * they were said, or are still missing.
   */
  points_from: NewEventPointsFrom | null;
  /** The chapter's event type the event is one of, when one matched. */
  event_type_id: string | null;
  is_mandatory: boolean;
  /**
   * The repeat the series is made with (`packages/validation` recurrence
   * format), or null for one event.
   */
  recurrence_rule: string | null;
}

interface NewEventPointsFrom {
  /** The chapter's event type of that name, or its last event of that name. */
  kind: 'type' | 'event';
  name: string;
}

function pointsFromOrNull(value: unknown): NewEventPointsFrom | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const from = value as Record<string, unknown>;
  const name = text(from.name, NEW_EVENT_SUGGESTION_NAME_MAX_LENGTH);
  return (from.kind === 'type' || from.kind === 'event') && name
    ? { kind: from.kind, name }
    : null;
}

function idOrNull(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

/**
 * The event the member made from this proposal in the ordinary event form
 * (the card's Edit), set by their accept and never by a proposal: accepting
 * then records it and makes nothing.
 */
function madeEventIdOf(payload: AiSuggestionPayload): string | null {
  return typeof payload.event_id === 'string' && UUID.test(payload.event_id)
    ? payload.event_id
    : null;
}

function ruleOrNull(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length <= MAX_REPEAT_RULE_LENGTH &&
    isRepeatRule(value)
    ? value
    : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max).trimEnd() : trimmed;
}

function instantOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > INSTANT_MAX_LENGTH) {
    return null;
  }
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}

function pointsOrNull(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= POINTS_ADJUSTMENT_MAX
    ? value
    : null;
}

/** Reads a stored payload back; the shape `normalizeProposal` wrote. */
export function readNewEventPayload(
  payload: AiSuggestionPayload,
): NewEventSuggestionPayload {
  return {
    name: text(payload.name, NEW_EVENT_SUGGESTION_NAME_MAX_LENGTH) ?? '',
    description: text(
      payload.description,
      NEW_EVENT_SUGGESTION_TEXT_MAX_LENGTH,
    ),
    location: text(payload.location, NEW_EVENT_SUGGESTION_TEXT_MAX_LENGTH),
    start_time: instantOrNull(payload.start_time) ?? '',
    end_time: instantOrNull(payload.end_time) ?? '',
    point_value: pointsOrNull(payload.point_value),
    points_from: pointsFromOrNull(payload.points_from),
    event_type_id: idOrNull(payload.event_type_id),
    is_mandatory: payload.is_mandatory === true,
    recurrence_rule: ruleOrNull(payload.recurrence_rule),
  };
}

function incomplete(message: string): BadRequestException {
  return new BadRequestException({ code: 'ai.suggestion.incomplete', message });
}

/**
 * An event to create, distinct from the `event` kind (#3930), whose accept
 * records an event the officer already made in its form.
 *
 * A proposed event (#718: "put formal on the calendar for December 5 at
 * 8"). Accepting it creates the event through {@link EventService.create} as
 * the officer who accepted: the members it invites get the usual new-event
 * push, and no chat card is posted.
 */
@Injectable()
export class NewEventSuggestionKind implements AiSuggestionKindHandler {
  readonly kind = 'new_event' as const;
  readonly requiredPermission = SystemPermissions.EVENTS_CREATE;
  readonly module = 'events';
  readonly expiresAfterDays = NEW_EVENT_SUGGESTION_EXPIRY_DAYS;
  readonly pushCategory = 'events';

  constructor(
    private readonly events: EventService,
    private readonly eventTypes: EventTypeService,
  ) {}

  describeBatch(count: number): string {
    return count === 1
      ? '1 suggested event to review'
      : `${count} suggested events to review`;
  }

  normalizeProposal(raw: unknown): AiSuggestionPayload | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const input = raw as Record<string, unknown>;
    const name = text(input.name, NEW_EVENT_SUGGESTION_NAME_MAX_LENGTH);
    const start = instantOrNull(input.start_time);
    const end = instantOrNull(input.end_time);
    if (!name || !start || !end || end <= start) return null;
    const event: NewEventSuggestionPayload = {
      name,
      description: text(
        input.description,
        NEW_EVENT_SUGGESTION_TEXT_MAX_LENGTH,
      ),
      location: text(input.location, NEW_EVENT_SUGGESTION_TEXT_MAX_LENGTH),
      start_time: start,
      end_time: end,
      point_value: pointsOrNull(input.point_value),
      points_from: pointsFromOrNull(input.points_from),
      event_type_id: idOrNull(input.event_type_id),
      is_mandatory: input.is_mandatory === true,
      recurrence_rule: ruleOrNull(input.recurrence_rule),
    };
    // Never from a proposal: only the member's accept names an event made.
    return { ...event };
  }

  applyEdits(
    payload: AiSuggestionPayload,
    edits: Record<string, unknown>,
  ): AiSuggestionPayload {
    // Made in the event form from the card's Edit: whatever the member set
    // there is the event, so the accept records it and the proposal's own
    // fields are left as they were.
    if (edits.event_id !== undefined) {
      if (typeof edits.event_id !== 'string' || !UUID.test(edits.event_id)) {
        throw incomplete('Add the event from its form first.');
      }
      return { ...payload, event_id: edits.event_id };
    }
    const next = readNewEventPayload(payload);
    const has = (key: string) => edits[key] !== undefined;
    if (has('name')) {
      const name = text(edits.name, NEW_EVENT_SUGGESTION_NAME_MAX_LENGTH);
      if (!name) throw new BadRequestException('An event needs a name.');
      next.name = name;
    }
    if (has('location')) {
      next.location = text(
        edits.location,
        NEW_EVENT_SUGGESTION_TEXT_MAX_LENGTH,
      );
    }
    if (has('start_time')) {
      const start = instantOrNull(edits.start_time);
      if (!start) throw new BadRequestException('Pick when it starts.');
      next.start_time = start;
    }
    if (has('end_time')) {
      const end = instantOrNull(edits.end_time);
      if (!end) throw new BadRequestException('Pick when it ends.');
      next.end_time = end;
    }
    if (has('point_value')) {
      const points = pointsOrNull(edits.point_value);
      if (points === null) {
        throw new BadRequestException(
          `Points are a whole number from 0 to ${POINTS_ADJUSTMENT_MAX}.`,
        );
      }
      // Typed on the card: no longer copied from anywhere.
      if (points !== next.point_value) next.points_from = null;
      next.point_value = points;
    }
    if (next.end_time <= next.start_time) {
      throw new BadRequestException('An event ends after it starts.');
    }
    return { ...next };
  }

  /**
   * An event made in the form counts as changed: the member opened Edit
   * because the card was not what they wanted, and what they changed there
   * is the form's to know. Otherwise, any difference in the payload.
   */
  countsAsEdited(
    proposed: AiSuggestionPayload,
    accepted: AiSuggestionPayload,
  ): boolean {
    if (madeEventIdOf(accepted)) return true;
    return (
      JSON.stringify(readNewEventPayload(proposed)) !==
      JSON.stringify(readNewEventPayload(accepted))
    );
  }

  assertAcceptable(payload: AiSuggestionPayload): void {
    if (madeEventIdOf(payload)) return;
    const event = readNewEventPayload(payload);
    if (!event.name) throw incomplete('An event needs a name.');
    if (!event.start_time || !event.end_time) {
      throw incomplete('Pick when it starts and ends.');
    }
    // Never a default nobody chose (Paul, 2026-11-16).
    if (event.point_value === null) {
      throw incomplete('Say how many points it is worth, 0 for none.');
    }
  }

  /** The id, unless the chapter's types were read and it isn't among them. */
  private async typeStillThere(
    id: string | null,
    chapterId: string,
  ): Promise<string | null> {
    if (id === null) return null;
    const types = await this.eventTypes.list(chapterId).catch(() => null);
    if (types === null) return id;
    return types.some((type) => type.id === id) ? id : null;
  }

  async commit(input: {
    chapterId: string;
    userId: string;
    payload: AiSuggestionPayload;
  }): Promise<AiSuggestionCommitResult> {
    const madeId = madeEventIdOf(input.payload);
    if (madeId) {
      // Missing, another chapter's, or not this member's own: all answer
      // 404, as the event route does for an event the member can't see, so
      // naming someone else's event confirms nothing (as the `event` kind).
      const made = await this.events.findById(madeId, input.chapterId);
      if (made.created_by !== input.userId) {
        throw new NotFoundException('Event not found');
      }
      return { resultId: made.id };
    }
    const event = readNewEventPayload(input.payload);
    // The type Ask matched may have been deleted since: the event is made
    // without it rather than refused until the card expires (#5148).
    const typeId = await this.typeStillThere(
      event.event_type_id,
      input.chapterId,
    );
    const created = await this.events.create({
      chapter_id: input.chapterId,
      created_by: input.userId,
      name: event.name,
      description: event.description,
      location: event.location,
      start_time: event.start_time,
      end_time: event.end_time,
      is_mandatory: event.is_mandatory,
      ...(event.point_value === null ? {} : { point_value: event.point_value }),
      ...(typeId === null ? {} : { event_type_id: typeId }),
      ...(event.recurrence_rule === null
        ? {}
        : { recurrence_rule: event.recurrence_rule }),
      // Never a chat card (no `channel_id`).
    });
    return { resultId: created.id };
  }
}
