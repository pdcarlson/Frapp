import { BadRequestException, Injectable } from '@nestjs/common';
import { POINTS_ADJUSTMENT_MAX } from '@repo/validation';
import { SystemPermissions } from '#domain/constants/permissions';
import type { AiSuggestionPayload } from '#domain/entities/ai-suggestion.entity';
import type {
  AiSuggestionCommitResult,
  AiSuggestionKindHandler,
} from './ai-suggestion-kinds';
import { EventService } from './event.service';

export const EVENT_SUGGESTION_NAME_MAX_LENGTH = 255;
export const EVENT_SUGGESTION_TEXT_MAX_LENGTH = 2000;
/** An event proposal is stale by the next day (the acting agent, #718). */
export const EVENT_SUGGESTION_EXPIRY_DAYS = 1;
/** Longer than any ISO 8601 instant, so a model's essay is not one. */
const INSTANT_MAX_LENGTH = 40;

/**
 * A proposed event, as stored and as listed. One event, never a series, and
 * open to the whole chapter: who is invited by role, a check-in zone and a
 * repeat are set on the event form afterwards.
 */
export interface EventSuggestionPayload {
  name: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string;
  /** Null leaves the event service's own default. */
  point_value: number | null;
  is_mandatory: boolean;
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
export function readEventPayload(
  payload: AiSuggestionPayload,
): EventSuggestionPayload {
  return {
    name: text(payload.name, EVENT_SUGGESTION_NAME_MAX_LENGTH) ?? '',
    description: text(payload.description, EVENT_SUGGESTION_TEXT_MAX_LENGTH),
    location: text(payload.location, EVENT_SUGGESTION_TEXT_MAX_LENGTH),
    start_time: instantOrNull(payload.start_time) ?? '',
    end_time: instantOrNull(payload.end_time) ?? '',
    point_value: pointsOrNull(payload.point_value),
    is_mandatory: payload.is_mandatory === true,
  };
}

function incomplete(message: string): BadRequestException {
  return new BadRequestException({ code: 'ai.suggestion.incomplete', message });
}

/**
 * A proposed event (#718: "put formal on the calendar for December 5 at
 * 8"). Accepting it creates the event through {@link EventService.create} as
 * the officer who accepted: the members it invites get the usual new-event
 * push, and no chat card is posted.
 */
@Injectable()
export class EventSuggestionKind implements AiSuggestionKindHandler {
  readonly kind = 'event' as const;
  readonly requiredPermission = SystemPermissions.EVENTS_CREATE;
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
    const name = text(input.name, EVENT_SUGGESTION_NAME_MAX_LENGTH);
    const start = instantOrNull(input.start_time);
    const end = instantOrNull(input.end_time);
    if (!name || !start || !end || end <= start) return null;
    const event: EventSuggestionPayload = {
      name,
      description: text(input.description, EVENT_SUGGESTION_TEXT_MAX_LENGTH),
      location: text(input.location, EVENT_SUGGESTION_TEXT_MAX_LENGTH),
      start_time: start,
      end_time: end,
      point_value: pointsOrNull(input.point_value),
      is_mandatory: input.is_mandatory === true,
    };
    return { ...event };
  }

  applyEdits(
    payload: AiSuggestionPayload,
    edits: Record<string, unknown>,
  ): AiSuggestionPayload {
    const next = readEventPayload(payload);
    const has = (key: string) => edits[key] !== undefined;
    if (has('name')) {
      const name = text(edits.name, EVENT_SUGGESTION_NAME_MAX_LENGTH);
      if (!name) throw new BadRequestException('An event needs a name.');
      next.name = name;
    }
    if (has('location')) {
      next.location = text(edits.location, EVENT_SUGGESTION_TEXT_MAX_LENGTH);
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
    if (next.end_time <= next.start_time) {
      throw new BadRequestException('An event ends after it starts.');
    }
    return { ...next };
  }

  assertAcceptable(payload: AiSuggestionPayload): void {
    const event = readEventPayload(payload);
    if (!event.name) throw incomplete('An event needs a name.');
    if (!event.start_time || !event.end_time) {
      throw incomplete('Pick when it starts and ends.');
    }
  }

  async commit(input: {
    chapterId: string;
    userId: string;
    payload: AiSuggestionPayload;
  }): Promise<AiSuggestionCommitResult> {
    const event = readEventPayload(input.payload);
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
      // Never a chat card (no `channel_id`).
    });
    return { resultId: created.id };
  }
}
