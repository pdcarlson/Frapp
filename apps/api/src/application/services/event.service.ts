import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { EVENT_REPOSITORY } from '../../domain/repositories/event.repository.interface';
import type { IEventRepository } from '../../domain/repositories/event.repository.interface';
import { USER_REPOSITORY } from '../../domain/repositories/user.repository.interface';
import type { IUserRepository } from '../../domain/repositories/user.repository.interface';
import { Event } from '../../domain/entities/event.entity';
import type { GeofenceCoordinate } from '../../domain/entities/study.entity';
import { NotificationService } from './notification.service';
import { ChatService } from './chat.service';

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
  notes?: string | null;
  check_in_zone?: GeofenceCoordinate[] | null;
  check_in_zone_name?: string | null;
  /** Creator user id — used as the chat card sender when posting via `/event`. */
  created_by?: string;
  /**
   * When set together with `client_message_id`, an interactive event card is
   * posted to this chat channel after the row commits (the `/event` slash
   * command). Omitted for dashboard creates.
   */
  channel_id?: string;
  client_message_id?: string;
}

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
  notes?: string | null;
  check_in_zone?: GeofenceCoordinate[] | null;
  check_in_zone_name?: string | null;
}

/**
 * Which occurrences of a recurring event a write applies to.
 *
 * `spec/behavior/events.md` § Recurring events fixes this at two values, not
 * the usual calendar-app three: *"Each instance can be individually edited or
 * canceled. Recurrence rules can be modified (changes apply to future instances
 * only)."* There is deliberately no "this and past" — see `partitionByTime` for
 * why the past boundary is enforced rather than merely documented.
 *
 * `'instance'` is the default on every route so existing callers, which send no
 * scope at all, keep their exact current single-row behavior.
 */
export type EventMutationScope = 'instance' | 'series';

/**
 * Fields whose change forces future instances to be regenerated rather than
 * patched, because they determine *when* the generated occurrences fall.
 *
 * Compared by value, not by presence: a client that PATCHes the whole event
 * object back (which the web editor does — `event-editor-dialog.tsx:396` always
 * sends `recurrence_rule`) would otherwise trigger a destructive regenerate on
 * every save. Regeneration deletes rows, and `event_attendance` is
 * `on delete cascade`, so a needless regenerate is a data-loss bug.
 */
const RECURRENCE_DEFINING_FIELDS = [
  'recurrence_rule',
  'start_time',
  'end_time',
] as const satisfies readonly (keyof UpdateEventInput)[];

/**
 * Fields that are meaningful on a generated instance and therefore propagate
 * when a series is patched in place.
 *
 * `start_time` / `end_time` are excluded because each occurrence owns its own
 * times; `recurrence_rule` because only the parent carries one (children are
 * generated with `null`); `parent_event_id` because propagating it would
 * re-point the series at itself.
 */
function propagatableFields(
  input: UpdateEventInput,
): Omit<UpdateEventInput, 'start_time' | 'end_time' | 'recurrence_rule'> {
  const propagate: UpdateEventInput = { ...input };
  delete propagate.start_time;
  delete propagate.end_time;
  delete propagate.recurrence_rule;
  return propagate;
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
function normalizeCheckInZone(
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

@Injectable()
export class EventService {
  private readonly logger = new Logger(EventService.name);

  constructor(
    @Inject(EVENT_REPOSITORY) private readonly eventRepo: IEventRepository,
    @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository,
    private readonly notificationService: NotificationService,
    private readonly chatService: ChatService,
  ) {}

  async findById(id: string, chapterId: string): Promise<Event> {
    const event = await this.eventRepo.findById(id, chapterId);
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  async findByChapter(chapterId: string): Promise<Event[]> {
    return this.eventRepo.findByChapter(chapterId);
  }

  async create(input: CreateEventInput): Promise<Event> {
    const { start_time, end_time } = input;

    const start = new Date(start_time);
    const end = new Date(end_time);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException(
        'start_time and end_time must be valid ISO dates',
      );
    }
    if (end <= start) {
      throw new BadRequestException('end_time must be after start_time');
    }

    const parent = await this.eventRepo.create({
      chapter_id: input.chapter_id,
      name: input.name,
      description: input.description ?? null,
      location: input.location ?? null,
      start_time: input.start_time,
      end_time: input.end_time,
      point_value: input.point_value ?? 10,
      is_mandatory: input.is_mandatory ?? false,
      recurrence_rule: input.recurrence_rule ?? null,
      parent_event_id: null,
      required_role_ids: input.required_role_ids ?? null,
      notes: input.notes ?? null,
      check_in_zone: normalizeCheckInZone(input.check_in_zone) ?? null,
      check_in_zone_name: input.check_in_zone_name ?? null,
    });

    if (parent.recurrence_rule) {
      await this.generateRecurringInstances(parent);
    }

    try {
      await this.notificationService.notifyChapter(input.chapter_id, {
        title: 'New Event',
        body: `${parent.name} has been scheduled`,
        priority: 'SILENT',
        category: 'events',
        data: { target: { screen: 'events', eventId: parent.id } },
      });
    } catch {}

    // The `/event` slash command asks us to surface an interactive event card
    // in chat. The card is server-originated (a client cannot forge
    // `kind:"event"` — see ChatService.SERVER_ONLY_KINDS) and best-effort: the
    // event row is the source of truth, so a failed post is logged and never
    // rolls the event back.
    //
    // channel_id and client_message_id are paired (the optimistic placeholder
    // is keyed on client_message_id). If only one is supplied the card is
    // silently skipped and the client's placeholder would hang — surface that.
    if (Boolean(input.channel_id) !== Boolean(input.client_message_id)) {
      this.logger.warn(
        'Event card not posted: channel_id and client_message_id must be supplied together',
        { chapterId: input.chapter_id, eventId: parent.id },
      );
    }
    if (input.channel_id && input.client_message_id && input.created_by) {
      try {
        await this.postEventCard(input, parent);
      } catch (error) {
        this.logger.warn('Failed to post event card to chat', {
          eventId: parent.id,
          channelId: input.channel_id,
          chapterId: input.chapter_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return parent;
  }

  /**
   * Materialize the generated occurrences of a recurring parent.
   *
   * `skipBefore`, when supplied, drops any occurrence falling at or before that
   * instant. Regeneration passes `Date.now()`: rebuilding a series whose parent
   * already started would otherwise *create* occurrences in the past — rows for
   * meetings that never happened — which is the opposite of "changes apply to
   * future instances only". Creation passes nothing, preserving its behavior.
   */
  private async generateRecurringInstances(
    parent: Event,
    skipBefore?: number,
  ): Promise<void> {
    const rule = parent.recurrence_rule;
    if (!rule) return;

    const start = new Date(parent.start_time);
    const end = new Date(parent.end_time);

    let count: number;
    switch (rule) {
      case 'WEEKLY':
        count = 12;
        break;
      case 'BIWEEKLY':
        count = 6;
        break;
      case 'MONTHLY':
        count = 6;
        break;
      default:
        return;
    }

    // ⚡ Bolt: Optimize recurring instance creation using Promise.all
    // Eliminates N+1 sequential database queries by executing them concurrently.
    const payloads = Array.from({ length: count }, (_, idx) => {
      const i = idx + 1;
      const instanceStart = new Date(start);
      const instanceEnd = new Date(end);

      if (rule === 'WEEKLY') {
        instanceStart.setDate(instanceStart.getDate() + i * 7);
        instanceEnd.setDate(instanceEnd.getDate() + i * 7);
      } else if (rule === 'BIWEEKLY') {
        instanceStart.setDate(instanceStart.getDate() + i * 14);
        instanceEnd.setDate(instanceEnd.getDate() + i * 14);
      } else if (rule === 'MONTHLY') {
        const targetStartMonth = start.getMonth() + i;
        instanceStart.setDate(1);
        instanceStart.setMonth(targetStartMonth);
        const maxStartDay = new Date(
          instanceStart.getFullYear(),
          instanceStart.getMonth() + 1,
          0,
        ).getDate();
        instanceStart.setDate(Math.min(start.getDate(), maxStartDay));

        const targetEndMonth = end.getMonth() + i;
        instanceEnd.setDate(1);
        instanceEnd.setMonth(targetEndMonth);
        const maxEndDay = new Date(
          instanceEnd.getFullYear(),
          instanceEnd.getMonth() + 1,
          0,
        ).getDate();
        instanceEnd.setDate(Math.min(end.getDate(), maxEndDay));
      }

      return {
        chapter_id: parent.chapter_id,
        name: parent.name,
        description: parent.description,
        location: parent.location,
        start_time: instanceStart.toISOString(),
        end_time: instanceEnd.toISOString(),
        point_value: parent.point_value,
        is_mandatory: parent.is_mandatory,
        recurrence_rule: null,
        parent_event_id: parent.id,
        required_role_ids: parent.required_role_ids,
        notes: parent.notes,
        // The zone is part of "where this event is", so every occurrence needs
        // it — without this a weekly meeting's check-in geofence applied only to
        // the first date, and a series edit that patches future instances would
        // set a zone that a later regenerate silently dropped again.
        check_in_zone: parent.check_in_zone,
        check_in_zone_name: parent.check_in_zone_name,
      };
    });

    const due =
      skipBefore === undefined
        ? payloads
        : payloads.filter(
            (payload) => new Date(payload.start_time).getTime() > skipBefore,
          );

    await Promise.all(due.map((payload) => this.eventRepo.create(payload)));
  }

  /**
   * Post the `kind:"event"` card for a committed event. The creator's name is
   * resolved here and the details embedded in the payload so the snapshot stays
   * a correct record even if the event is later edited. The card carries the
   * event id; the renderer reads the live attendance count back through the
   * attendance query (the chat message row is never mutated). Posts as the
   * creator into the channel they ran the command from; channel access is
   * re-checked by `ChatService.sendMessage`.
   */
  private async postEventCard(
    input: CreateEventInput,
    event: Event,
  ): Promise<void> {
    const createdBy = input.created_by!;
    const users = await this.userRepo.findByIds([createdBy]);
    const creatorName =
      users.find((u) => u.id === createdBy)?.display_name ?? 'Unknown member';

    const payload = {
      event_id: event.id,
      name: event.name,
      start_time: event.start_time,
      end_time: event.end_time,
      location: event.location ?? null,
      point_value: event.point_value,
      is_mandatory: event.is_mandatory,
      created_at: event.created_at,
    };

    // The server has no creator-timezone context, so render the snapshot time
    // explicitly in UTC (labelled) rather than the API host's local zone. This
    // string is only the fallback shown when the rich renderer can't read the
    // payload; the event card itself localises start_time per viewer.
    const startLabel = new Date(event.start_time).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    });
    const locationSuffix = event.location ? ` at ${event.location}` : '';
    const content = `${creatorName} scheduled "${event.name}" — ${startLabel} UTC${locationSuffix}`;

    await this.chatService.sendMessage({
      chapter_id: input.chapter_id,
      channel_id: input.channel_id!,
      sender_id: createdBy,
      content,
      kind: 'event',
      payload,
      client_message_id: input.client_message_id,
      system_originated: true,
    });
  }

  /**
   * Resolve the row a series operation should act on.
   *
   * A client may hold any occurrence of a series, so `scope:'series'` on a
   * generated child means "the series this belongs to". A child whose parent has
   * since been deleted has a dangling `parent_event_id` (the column is
   * `on delete set null`, but a row read before that fires still carries it), so
   * an unresolvable parent degrades to treating the child as its own series head
   * rather than 404-ing on a row the caller never named.
   */
  private async resolveSeriesParent(
    event: Event,
    chapterId: string,
  ): Promise<Event> {
    if (!event.parent_event_id) return event;
    const parent = await this.eventRepo.findById(
      event.parent_event_id,
      chapterId,
    );
    return parent ?? event;
  }

  /**
   * Split a series into the occurrences a write may touch and those it may not.
   *
   * The boundary is time, evaluated server-side — never a flag the caller sends.
   * `event_attendance.event_id` is `on delete cascade`, so letting a series
   * operation reach a past occurrence would not just edit history, it would
   * destroy the attendance record for a meeting that already happened.
   *
   * Children are not assumed to fall after their parent: an individually-edited
   * instance (which `spec/behavior/events.md` explicitly allows) can be moved
   * anywhere, so every row is partitioned on its own `start_time`.
   */
  private partitionByTime(
    events: Event[],
    now: number,
  ): { future: Event[]; past: Event[] } {
    const future: Event[] = [];
    const past: Event[] = [];
    for (const event of events) {
      if (new Date(event.start_time).getTime() > now) future.push(event);
      else past.push(event);
    }
    return { future, past };
  }

  async update(
    id: string,
    chapterId: string,
    input: UpdateEventInput,
    scope: EventMutationScope = 'instance',
  ): Promise<Event> {
    if (input.start_time || input.end_time) {
      const existing = await this.findById(id, chapterId);
      const startTime = input.start_time ?? existing.start_time;
      const endTime = input.end_time ?? existing.end_time;

      const start = new Date(startTime);
      const end = new Date(endTime);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw new BadRequestException(
          'start_time and end_time must be valid ISO dates',
        );
      }
      if (end <= start) {
        throw new BadRequestException('end_time must be after start_time');
      }
    }

    if (scope === 'series') {
      return this.updateSeries(id, chapterId, input);
    }

    const updated = await this.eventRepo.update(id, chapterId, {
      ...input,
      // Spread first, then overwrite: `normalizeCheckInZone` returns `undefined`
      // for an absent key, which the repository's partial update ignores, so an
      // update that never mentions the zone leaves it untouched.
      ...(input.check_in_zone !== undefined
        ? { check_in_zone: normalizeCheckInZone(input.check_in_zone) }
        : {}),
    });

    await this.notifyEventUpdated(chapterId, updated, input);

    return updated;
  }

  /**
   * Announce an edit that changes where or when members need to be. Silent for
   * cosmetic edits, and best-effort: the row is the source of truth, so a failed
   * push never rolls the update back.
   */
  private async notifyEventUpdated(
    chapterId: string,
    updated: Event,
    input: UpdateEventInput,
  ): Promise<void> {
    if (!input.start_time && !input.end_time && input.location === undefined) {
      return;
    }
    try {
      await this.notificationService.notifyChapter(chapterId, {
        title: 'Event Updated',
        body: `${updated.name} has been updated`,
        priority: 'NORMAL',
        category: 'events',
        data: { target: { screen: 'events', eventId: updated.id } },
      });
    } catch {}
  }

  /**
   * Apply an edit to a whole recurring series — the parent and every *future*
   * occurrence. Past occurrences are never in the write set.
   */
  private async updateSeries(
    id: string,
    chapterId: string,
    input: UpdateEventInput,
  ): Promise<Event> {
    const target = await this.findById(id, chapterId);
    const parent = await this.resolveSeriesParent(target, chapterId);

    // Re-validate against the row actually being written. `update()` checked the
    // interval against `target`, but a series edit lands on the *parent*, and an
    // individually-moved child can have entirely different times — so a patch
    // that is valid against the child can still invert the parent's interval.
    if (input.start_time || input.end_time) {
      const start = new Date(input.start_time ?? parent.start_time);
      const end = new Date(input.end_time ?? parent.end_time);
      if (end <= start) {
        throw new BadRequestException(
          'end_time must be after start_time for the series',
        );
      }
    }

    const normalized: UpdateEventInput = {
      ...input,
      ...(input.check_in_zone !== undefined
        ? { check_in_zone: normalizeCheckInZone(input.check_in_zone) }
        : {}),
    };

    // Compare instants rather than strings for the date fields: Postgres returns
    // `+00:00` where a client sends `Z`, and a spelling difference is not a
    // change. Treating it as one would delete and rebuild the future half of the
    // series on a no-op save, cascading away any attendance those rows carry.
    const hasChanged = (field: (typeof RECURRENCE_DEFINING_FIELDS)[number]) => {
      const next = input[field];
      if (next === undefined) return false;
      const current = parent[field];
      if (field === 'recurrence_rule') return next !== current;
      if (typeof next !== 'string' || typeof current !== 'string') {
        return next !== current;
      }
      return new Date(next).getTime() !== new Date(current).getTime();
    };
    const regenerates = RECURRENCE_DEFINING_FIELDS.some(hasChanged);

    const updatedParent = await this.eventRepo.update(
      parent.id,
      chapterId,
      normalized,
    );

    // Resolve children before any delete: `parent_event_id` is
    // `on delete set null`, so a parent removed first takes the pointers with it.
    const children = await this.eventRepo.findChildren(parent.id, chapterId);
    const { future } = this.partitionByTime(children, Date.now());

    if (regenerates) {
      await this.eventRepo.deleteMany(
        future.map((child) => child.id),
        chapterId,
      );
      if (updatedParent.recurrence_rule) {
        await this.generateRecurringInstances(updatedParent, Date.now());
      }
    } else {
      const propagate = propagatableFields(normalized);
      if (Object.keys(propagate).length > 0) {
        await this.eventRepo.updateMany(
          future.map((child) => child.id),
          chapterId,
          propagate,
        );
      }
    }

    await this.notifyEventUpdated(chapterId, updatedParent, input);

    return updatedParent;
  }

  async delete(
    id: string,
    chapterId: string,
    scope: EventMutationScope = 'instance',
  ): Promise<void> {
    // Deliberately the nullable repository read, not the throwing `findById`:
    // deleting an id that is not there has always been a no-op success, and the
    // series bookkeeping below must not turn that into a 404.
    const target = await this.eventRepo.findById(id, chapterId);
    if (!target) {
      await this.eventRepo.delete(id, chapterId);
      return;
    }

    if (scope === 'series') {
      await this.deleteSeries(target, chapterId);
      return;
    }

    // Canceling one occurrence that happens to be the series head must not take
    // the series with it. `parent_event_id` is `on delete set null`, so without
    // this the remaining instances survive as unowned rows that no series
    // operation can ever reach again — the orphan defect this issue names.
    if (!target.parent_event_id && target.recurrence_rule) {
      const children = await this.eventRepo.findChildren(target.id, chapterId);
      if (children.length > 0) {
        await this.promoteSuccessor(target, children, chapterId);
      }
    }

    await this.eventRepo.delete(id, chapterId);
  }

  /**
   * Hand a series to its earliest surviving occurrence, so deleting the head
   * cancels one occurrence rather than decapitating the series.
   *
   * `findChildren` returns oldest-first, so `children[0]` is the successor.
   */
  private async promoteSuccessor(
    parent: Event,
    children: Event[],
    chapterId: string,
  ): Promise<void> {
    const [successor, ...rest] = children;

    await this.eventRepo.update(successor.id, chapterId, {
      recurrence_rule: parent.recurrence_rule,
      parent_event_id: null,
    });

    await this.eventRepo.updateMany(
      rest.map((child) => child.id),
      chapterId,
      { parent_event_id: successor.id },
    );
  }

  /**
   * Cancel a recurring series from now forward.
   *
   * Future occurrences are deleted. Occurrences that have already happened are
   * kept — deleting one would cascade its `event_attendance` rows away, erasing
   * the record of a meeting that took place. They are detached instead, leaving
   * each past occurrence a standalone historical event.
   */
  private async deleteSeries(target: Event, chapterId: string): Promise<void> {
    const parent = await this.resolveSeriesParent(target, chapterId);
    const children = await this.eventRepo.findChildren(parent.id, chapterId);
    const now = Date.now();
    const { future, past } = this.partitionByTime(children, now);

    await this.eventRepo.deleteMany(
      future.map((child) => child.id),
      chapterId,
    );

    if (new Date(parent.start_time).getTime() <= now) {
      // The head itself already happened, so it is history too: end the series
      // in place rather than deleting the row and its attendance.
      await this.eventRepo.update(parent.id, chapterId, {
        recurrence_rule: null,
      });
      await this.eventRepo.updateMany(
        past.map((child) => child.id),
        chapterId,
        { parent_event_id: null },
      );
      return;
    }

    // The head is still upcoming, so it carries no attendance worth keeping.
    // Deleting it detaches any surviving past occurrence through the FK, which
    // is the same end state as the branch above.
    await this.eventRepo.delete(parent.id, chapterId);
  }

  async generateIcs(eventId: string, chapterId: string): Promise<string> {
    const event = await this.findById(eventId, chapterId);

    const formatDate = (iso: string): string =>
      new Date(iso)
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '');

    const escapeText = (text: string): string =>
      text
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Frapp//Events//EN',
      'BEGIN:VEVENT',
      `DTSTART:${formatDate(event.start_time)}`,
      `DTEND:${formatDate(event.end_time)}`,
      `SUMMARY:${escapeText(event.name)}`,
    ];

    if (event.description) {
      lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    }
    if (event.location) {
      lines.push(`LOCATION:${escapeText(event.location)}`);
    }

    lines.push(`UID:${event.id}@frapp.live`, 'END:VEVENT', 'END:VCALENDAR');

    return lines.join('\r\n');
  }
}
