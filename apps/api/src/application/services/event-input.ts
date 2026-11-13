import { BadRequestException } from '@nestjs/common';
import { Event } from '#domain/entities/event.entity';
import type { GeofenceCoordinate } from '#domain/entities/study.entity';
import {
  agendaProblem,
  EVENT_ATTACHMENTS_MAX,
  normalizeAgendaText,
  normalizeAttachmentUrl,
  type EventAgendaItem,
  type EventAttachment,
} from '@repo/validation';

export interface CreateEventInput {
  chapter_id: string;
  name: string;
  description?: string | null;
  location?: string | null;
  start_time: string;
  end_time: string;
  point_value?: number;
  is_mandatory?: boolean;
  recurrence_rule?: string | null;
  required_role_ids?: string[] | null;
  optional_role_ids?: string[] | null;
  excluded_role_ids?: string[] | null;
  others_invited?: boolean;
  notes?: string | null;
  /** This meeting's agenda, whole (#4934); omitted leaves it. */
  agenda?: EventAgendaItem[];
  /** This meeting's attachments, whole (#4934); omitted leaves it. */
  attachments?: EventAttachmentInput[];
  check_in_zone?: GeofenceCoordinate[] | null;
  check_in_zone_name?: string | null;
  check_in_opens_minutes?: number;
  /** One of the chapter's event types, or omitted for none (#3730). */
  event_type_id?: string | null;
  /** Creator user id — used as the chat card sender when posting via `/event`. */
  created_by?: string;
  /**
   * When set together with `client_message_id`, an interactive event card is
   * posted to this chat channel after the row commits (the `/event` slash
   * command). Omitted for dashboard creates.
   */
  channel_id?: string;
  client_message_id?: string;
  /**
   * Skip the new-event push. Only an internal caller sets it: starting minutes
   * for a meeting that had no event makes one after the fact
   * (`MeetingService.start`), and "New event" for a meeting that already
   * happened would be noise. The DTO has no such field.
   */
  silent?: boolean;
}

/**
 * The created event row, plus whether the chat card that accompanies it was
 * posted.
 *
 * `card_posted` is present ONLY when this request actually attempted a card —
 * chat context supplied (`channel_id` + `client_message_id`) and a creator
 * to post as. A dashboard create's response shape is therefore unchanged. The
 * card stays best-effort — a failed post never rolls the event back — but the
 * caller now learns it failed instead of inferring success from the 2xx and
 * leaving its optimistic placeholder up forever (#1717). Recurring children
 * are side effects of this write and are not in this return value; the parent
 * is what `POST /v1/events` publishes.
 */
export type CreateEventResult = Event & {
  card_posted?: boolean;
};

export interface UpdateEventInput {
  name?: string;
  description?: string | null;
  location?: string | null;
  start_time?: string;
  end_time?: string;
  point_value?: number;
  is_mandatory?: boolean;
  recurrence_rule?: string | null;
  required_role_ids?: string[] | null;
  optional_role_ids?: string[] | null;
  excluded_role_ids?: string[] | null;
  others_invited?: boolean;
  notes?: string | null;
  /** This meeting's agenda, whole (#4934); omitted leaves it. */
  agenda?: EventAgendaItem[];
  /** This meeting's attachments, whole (#4934); omitted leaves it. */
  attachments?: EventAttachmentInput[];
  check_in_zone?: GeofenceCoordinate[] | null;
  check_in_zone_name?: string | null;
  check_in_opens_minutes?: number;
  /** `null` clears the type; omitted leaves it. */
  event_type_id?: string | null;
}

/**
 * What a series edit may write (`EventSeriesService.updateSeries`): an
 * update without a meeting's own `agenda` and `attachments` (#4934), which
 * `EventService.update` writes to the addressed occurrence only. Leaving them
 * out of the type means no series path can copy them across by accident.
 */
export type SeriesUpdateInput = Omit<
  UpdateEventInput,
  'agenda' | 'attachments'
>;

/**
 * Which occurrences of a recurring event a write applies to.
 *
 * `spec/behavior/events.md` § Recurring events fixes this at two values, not
 * the usual calendar-app three: *"Each instance can be individually edited or
 * canceled. Recurrence rules can be modified (changes apply to future instances
 * only)."* There is deliberately no "this and past" — see `EventSeriesService.partitionByTime` for
 * why the past boundary is enforced rather than merely documented.
 *
 * `'instance'` is the default on every route so existing callers, which send no
 * scope at all, keep their exact current single-row behavior.
 */
export type EventMutationScope = 'instance' | 'series';

/**
 * An attachment as a request sends it (#4934): one flat shape, whose `kind`
 * says which of `url` and `document_id` it carries. `normalizeAttachments`
 * turns it into the stored `EventAttachment`.
 */
export interface EventAttachmentInput {
  id: string;
  kind: EventAttachment['kind'];
  url?: string;
  document_id?: string;
  title: string;
}

/**
 * Normalize an inbound check-in zone to what the column stores.
 *
 * An empty array **clears** the zone, mirroring the `required_role_ids` wire
 * semantics already documented in `spec/behavior/events.md` — one rule for
 * "unset this optional collection" across the whole event payload rather than
 * two. A 1- or 2-point array is rejected here so the caller gets a 400 naming
 * the problem instead of a 500 surfacing from the table's shape CHECK.
 */
export function normalizeCheckInZone(
  zone: GeofenceCoordinate[] | null | undefined,
): GeofenceCoordinate[] | null | undefined {
  if (zone === undefined) return undefined;
  if (zone === null || zone.length === 0) return null;
  if (zone.length < 3) {
    throw new BadRequestException(
      'check_in_zone must have at least 3 points, or be empty to clear it',
    );
  }
  return zone;
}

/**
 * An agenda as the column stores it (#4934): each item's text trimmed with
 * inner whitespace collapsed. An empty item, a duplicate id, or a list past
 * the limits is a 400 naming it, rather than the table check's 500. The DTO
 * has already checked each field's type and length.
 */
export function normalizeAgenda(
  items: readonly EventAgendaItem[] | undefined,
): EventAgendaItem[] | undefined {
  if (items === undefined) return undefined;
  const cleaned = items.map((item) => ({
    id: item.id,
    text: normalizeAgendaText(item.text),
    done: item.done,
  }));
  const problem = agendaProblem(cleaned);
  if (problem) throw new BadRequestException(problem);
  assertUniqueIds(cleaned, 'agenda');
  return cleaned;
}

/**
 * Attachments as the column stores them (#4934): a link's URL normalized
 * (http or https only), every title trimmed and non-empty, and only the
 * fields its `kind` carries. Whether a document is the chapter's is the
 * caller's check (`EventService`), since it needs a read.
 */
export function normalizeAttachments(
  items: readonly EventAttachmentInput[] | undefined,
): EventAttachment[] | undefined {
  if (items === undefined) return undefined;
  if (items.length > EVENT_ATTACHMENTS_MAX) {
    throw new BadRequestException(
      `An event holds at most ${EVENT_ATTACHMENTS_MAX} attachments.`,
    );
  }
  const cleaned = items.map((item): EventAttachment => {
    const title = item.title.replace(/\s+/g, ' ').trim();
    if (!title) {
      throw new BadRequestException('Every attachment needs a title.');
    }
    if (item.kind === 'link') {
      const url = normalizeAttachmentUrl(item.url ?? '');
      if (!url) {
        throw new BadRequestException(
          'A link attachment needs a web address starting with http:// or https://.',
        );
      }
      return { id: item.id, kind: 'link', url, title };
    }
    if (!item.document_id) {
      throw new BadRequestException(
        'A document attachment needs the document it points at.',
      );
    }
    return {
      id: item.id,
      kind: 'document',
      document_id: item.document_id,
      title,
    };
  });
  assertUniqueIds(cleaned, 'attachments');
  return cleaned;
}

function assertUniqueIds(
  items: readonly { id: string }[],
  field: 'agenda' | 'attachments',
): void {
  const seen = new Set<string>();
  for (const { id } of items) {
    if (!id.trim()) {
      throw new BadRequestException(`Every ${field} entry needs an id.`);
    }
    if (seen.has(id)) {
      throw new BadRequestException(`${field} has two entries with id ${id}.`);
    }
    seen.add(id);
  }
}
