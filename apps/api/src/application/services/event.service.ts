import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { EVENT_REPOSITORY } from '#domain/repositories/event.repository.interface';
import type { IEventRepository } from '#domain/repositories/event.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { Event } from '#domain/entities/event.entity';
import { RbacService } from './rbac.service';
import { EventSeriesService } from './event-series.service';
import { EventAnnouncementService } from './event-announcement.service';
import { SystemPermissions } from '#domain/constants/permissions';
import { toRRuleLine } from '@repo/validation';
import { hasRequiredRole } from './event-role-targeting';
import { normalizeCheckInZone } from './event-input';
import type {
  CreateEventInput,
  CreateEventResult,
  EventMutationScope,
  UpdateEventInput,
} from './event-input';

/**
 * Event reads, single-row writes and the `.ics` export. Recurring-series writes
 * live in `EventSeriesService` and the pushes and chat card that follow a write
 * in `EventAnnouncementService` (#3270).
 */
@Injectable()
export class EventService {
  constructor(
    @Inject(EVENT_REPOSITORY) private readonly eventRepo: IEventRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    private readonly rbac: RbacService,
    private readonly series: EventSeriesService,
    private readonly announcements: EventAnnouncementService,
  ) {}

  /**
   * `spec/behavior/events.md` § Role-based required attendance: a role-targeted
   * event is visible only to members who hold one of its `required_role_ids`
   * (an untargeted event, `null`/`[]`, is visible chapter-wide) — **or** who
   * hold `events:update` (which covers the wildcard President role too, per
   * `RbacService.memberHasAnyPermission`). Without that exemption, an officer
   * who can `PATCH`/`DELETE` any event but doesn't hold the specific targeted
   * role would lose read access to events they are authorized to manage — an
   * authorization gap in the wrong direction. `viewerId` is omitted by every
   * internal caller (`update`/`delete`/series ops) — those routes are already
   * gated on `events:update`/`events:delete`, a stronger authorization than
   * read visibility, so they must not be narrowed by it. Only the read-only
   * routes (`list`/`getOne`/`getIcs`) pass a viewer.
   */
  private async isVisibleToViewer(
    event: Event,
    chapterId: string,
    viewerId: string,
  ): Promise<boolean> {
    if (!event.required_role_ids || event.required_role_ids.length === 0) {
      return true;
    }
    if (
      await this.rbac.memberHasAnyPermission(chapterId, viewerId, [
        SystemPermissions.EVENTS_UPDATE,
      ])
    ) {
      return true;
    }
    const member = await this.memberRepo.findByUserAndChapter(
      viewerId,
      chapterId,
    );
    if (!member) return false;
    return hasRequiredRole(event.required_role_ids, member.role_ids);
  }

  async findById(
    id: string,
    chapterId: string,
    viewerId?: string,
  ): Promise<Event> {
    const event = await this.eventRepo.findById(id, chapterId);
    // A role-targeted event a viewer can't see 404s rather than 403 — the same
    // "not found" a nonexistent id gets, so the response never confirms a
    // role-targeted event exists to a caller who isn't cleared to see it.
    if (
      !event ||
      (viewerId && !(await this.isVisibleToViewer(event, chapterId, viewerId)))
    ) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  async findByChapter(chapterId: string, viewerId?: string): Promise<Event[]> {
    const events = await this.eventRepo.findByChapter(chapterId);
    if (!viewerId) return events;
    // Skip the permission/member lookups entirely for the common case — a
    // chapter with no role-targeted events — rather than paying for them on
    // every list call.
    const hasTargetedEvents = events.some(
      (event) => event.required_role_ids && event.required_role_ids.length > 0,
    );
    if (!hasTargetedEvents) return events;
    if (
      await this.rbac.memberHasAnyPermission(chapterId, viewerId, [
        SystemPermissions.EVENTS_UPDATE,
      ])
    ) {
      return events;
    }
    const member = await this.memberRepo.findByUserAndChapter(
      viewerId,
      chapterId,
    );
    const memberRoleIds = member?.role_ids ?? [];
    return events.filter((event) =>
      hasRequiredRole(event.required_role_ids, memberRoleIds),
    );
  }

  async create(input: CreateEventInput): Promise<CreateEventResult> {
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

    // A role-targeted event must not be broadcast as a chat card. #1463 made
    // `required_role_ids` gate read access — list, detail, ICS, search and the
    // event notifications all restrict a targeted event to members holding one
    // of its roles — but the `kind:"event"` card bypassed all of it: it embeds
    // name / start / end / location / point_value into a message row that
    // Realtime fans out to every reader of the channel, so an ineligible
    // member saw in chat exactly what `GET /v1/events/:id` 404s to hide.
    // (The activity feed was open the same way and is closed alongside this —
    // see `ActivityFeedService.eventItems`.)
    //
    // Refusing is the only option the current architecture actually supports.
    // The card is a *snapshot*, not a live window — the renderer reads the
    // embedded payload and never re-reads the event (its only refetch is the
    // `events:update`-gated attendance roster, whose holders are exempt from
    // the role gate anyway; see
    // `apps/web/components/chat/renderers/event-card.tsx`), so the details are
    // already in the row before any client-side check could run. Redacting
    // per viewer would mean the server withholding payload fields per
    // recipient, which one broadcast row cannot do. And there is no channel to
    // scope it to instead: channels gate on `required_permissions` (permission
    // strings), events on `required_role_ids` (RBAC role ids), so "post it
    // only in a channel gated to these roles" is not expressible.
    //
    // This costs no shipped behavior: `/event` cannot set `required_role_ids`
    // (`dispatchEvent` in `packages/chat-core/src/dispatch.ts` sends no such
    // key and the parser has no syntax for one), so only a direct
    // `POST /v1/events` reaches this branch. Thrown before the repo write, so
    // a refused create leaves no event row behind. An empty array is
    // untargeted per `spec/behavior/events.md` § `required_role_ids` wire
    // semantics and is deliberately allowed through.
    //
    // Either chat key alone is refused, not just the pair. Neither half posts
    // a card on its own today (the mismatch is warned about below), but
    // accepting one piecemeal would make the guard depend on which key a
    // caller happened to omit.
    if (
      (input.required_role_ids?.length ?? 0) > 0 &&
      (input.channel_id || input.client_message_id)
    ) {
      throw new BadRequestException(
        'A role-targeted event cannot post a chat card: the card would show the ' +
          'event to everyone in the channel, including members its ' +
          'required_role_ids exclude. Create it without channel_id/client_message_id.',
      );
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
      await this.series.generateRecurringInstances(parent);
    }

    await this.announcements.notifyEventCreated(input.chapter_id, parent);

    // The `/event` slash command asks us to surface an interactive event card
    // in chat. The card is server-originated (a client cannot forge
    // `kind:"event"` — see ChatService.SERVER_ONLY_KINDS) and best-effort: the
    // event row is the source of truth, so a failed post is logged and never
    // rolls the event back — but the outcome is now REPORTED rather than
    // swallowed (#1717). `undefined` means no card was attempted (a dashboard
    // create, or a half-pair of chat keys), which is reported as an ABSENT
    // field rather than a `false` that would claim a card failed when none
    // was ever due.
    const cardPosted = await this.announcements.tryPostEventCard(input, parent);

    return cardPosted === undefined
      ? parent
      : { ...parent, card_posted: cardPosted };
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
      return this.series.updateSeries(id, chapterId, input);
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

    await this.announcements.notifyEventUpdated(chapterId, updated, input);

    return updated;
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
      await this.series.deleteSeries(target, chapterId);
      return;
    }

    await this.series.handOffSeriesHead(target, chapterId);

    await this.eventRepo.delete(id, chapterId);
  }

  async generateIcs(
    eventId: string,
    chapterId: string,
    viewerId?: string,
  ): Promise<string> {
    const event = await this.findById(eventId, chapterId, viewerId);

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

    // Only a series *parent* carries the rule. A materialized child is a real
    // row with its own id and its own attendance, so it exports as the single
    // event it is — giving it a RECURRENCE-ID would mean re-using the parent's
    // UID and presenting to the calendar as an override of a series the member
    // may never have imported. An unrecognized rule falls through to a plain
    // VEVENT rather than failing the download, matching
    // `EventSeriesService.occurrenceCountFor`.
    if (event.parent_event_id === null) {
      const rrule = toRRuleLine(event.recurrence_rule);
      if (rrule) lines.push(rrule);
    }

    lines.push(`UID:${event.id}@frapp.live`, 'END:VEVENT', 'END:VCALENDAR');

    return lines.join('\r\n');
  }
}
