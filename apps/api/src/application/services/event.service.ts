import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { EVENT_REPOSITORY } from '#domain/repositories/event.repository.interface';
import type { IEventRepository } from '#domain/repositories/event.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { Event } from '#domain/entities/event.entity';
import { RbacService } from './rbac.service';
import { EventSeriesService } from './event-series.service';
import { EventTypeService } from './event-type.service';
import {
  EventAnnouncementService,
  eventChangeOf,
} from './event-announcement.service';
import { SystemPermissions } from '#domain/constants/permissions';
import { isEventVisibleTo, isInvited } from './event-role-targeting';
import {
  DEFAULT_CHECK_IN_OPENS_MINUTES,
  eventLimitsAudience,
  eventOthersInvited,
} from '@repo/validation';
import { normalizeCheckInZone } from './event-input';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import type {
  CreateEventInput,
  CreateEventResult,
  EventMutationScope,
  UpdateEventInput,
} from './event-input';

/**
 * Event reads and single-row writes. Recurring-series writes
 * live in `EventSeriesService` and the pushes and chat card that follow a write
 * in `EventAnnouncementService` (#3270).
 */
@Injectable()
export class EventService {
  private readonly logger = new Logger(EventService.name);

  constructor(
    @Inject(EVENT_REPOSITORY) private readonly eventRepo: IEventRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    private readonly rbac: RbacService,
    private readonly series: EventSeriesService,
    private readonly announcements: EventAnnouncementService,
    private readonly eventTypes: EventTypeService,
  ) {}

  /**
   * `spec/behavior/events.md` § Attendance by role: an event is visible only
   * to the members it invites (`isInvited`; an event that leaves nobody out is
   * visible chapter-wide) — **or** to members who
   * hold `events:update` (which covers the wildcard President role too, per
   * `RbacService.memberHasAnyPermission`). Without that exemption, an officer
   * who can `PATCH`/`DELETE` any event but doesn't hold the specific targeted
   * role would lose read access to events they are authorized to manage — an
   * authorization gap in the wrong direction. `viewerId` is omitted by every
   * internal caller (`update`, which also hands the row it reads to
   * `EventSeriesService` for a series edit) — those routes are already
   * gated on `events:update`/`events:delete`, a stronger authorization than
   * read visibility, so they must not be narrowed by it. Only the read-only
   * routes (`list`/`getOne`) pass a viewer.
   */
  private async isVisibleToViewer(
    event: Event,
    chapterId: string,
    viewerId: string,
  ): Promise<boolean> {
    return isEventVisibleTo(event, chapterId, viewerId, {
      rbac: this.rbac,
      memberRepo: this.memberRepo,
    });
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

  async findByChapter(
    chapterId: string,
    viewerId?: string,
    window?: { endsAfter: string; startsBefore: string },
  ): Promise<Event[]> {
    const events = await this.eventRepo.findByChapter(chapterId, window);
    if (!viewerId) return events;
    return this.visibleOf(events, chapterId, viewerId);
  }

  /**
   * The events a member made that have not ended by `endsAfter`, earliest
   * start first, as many as `limit`. Narrowed by the same visibility rule as
   * the list: making an event grants no read of it, so a maker it leaves out
   * who holds no `events:update` does not get it through this read.
   */
  async findCreatedBy(
    chapterId: string,
    creatorId: string,
    endsAfter: string,
    limit: number,
  ): Promise<Event[]> {
    const events = await this.eventRepo.findCreatedBy(
      chapterId,
      creatorId,
      endsAfter,
      limit,
    );
    return this.visibleOf(events, chapterId, creatorId);
  }

  /** `events` narrowed to those `viewerId` may read (see `isVisibleToViewer`). */
  private async visibleOf(
    events: Event[],
    chapterId: string,
    viewerId: string,
  ): Promise<Event[]> {
    // Skip the permission/member lookups entirely for the common case — a
    // chapter with no role-targeted events — rather than paying for them on
    // every list call.
    const hasTargetedEvents = events.some(eventLimitsAudience);
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
    return events.filter((event) => isInvited(event, memberRoleIds));
  }

  async create(rawInput: CreateEventInput): Promise<CreateEventResult> {
    const { start_time, end_time } = rawInput;

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

    const setsRequirements = await this.canSetRequirements(rawInput);
    const input = setsRequirements ? rawInput : withoutRequirements(rawInput);

    // An event that leaves anyone out must not be broadcast as a chat card. #1463 made
    // `required_role_ids` gate read access — list, detail, search and the
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
    // a refused create leaves no event row behind. An event that invites
    // everyone, whatever it asks of some roles, posts its card as before.
    //
    // Either chat key alone is refused, not just the pair. Neither half posts
    // a card on its own today (the mismatch is warned about in
    // `EventAnnouncementService.tryPostEventCard`), but
    // accepting one piecemeal would make the guard depend on which key a
    // caller happened to omit.
    //
    // `others_invited` is stored as sent; omitted, it stays null and reads
    // with the older meaning of `required_role_ids` (`eventOthersInvited`).
    const others_invited = input.others_invited ?? null;
    const limitsAudience = eventLimitsAudience({
      others_invited,
      required_role_ids: input.required_role_ids,
      excluded_role_ids: input.excluded_role_ids,
    });
    if (limitsAudience && (input.channel_id || input.client_message_id)) {
      throw new BadRequestException(
        'An event that leaves anyone out cannot post a chat card: the card ' +
          'would show the event to everyone in the channel. Create it without ' +
          'channel_id/client_message_id.',
      );
    }

    // Before the write, so a stray id is a 400 rather than the composite
    // foreign key's 500.
    await this.eventTypes.assertBelongs(input.event_type_id, input.chapter_id);

    const parent = await this.eventRepo.create({
      chapter_id: input.chapter_id,
      name: input.name,
      description: input.description ?? null,
      location: input.location ?? null,
      start_time: input.start_time,
      end_time: input.end_time,
      // A member's is 0 already (`withoutRequirements`).
      point_value: input.point_value ?? 10,
      is_mandatory: input.is_mandatory ?? false,
      recurrence_rule: input.recurrence_rule ?? null,
      parent_event_id: null,
      required_role_ids: input.required_role_ids ?? null,
      optional_role_ids: input.optional_role_ids ?? null,
      excluded_role_ids: input.excluded_role_ids ?? null,
      others_invited,
      notes: input.notes ?? null,
      check_in_zone: normalizeCheckInZone(input.check_in_zone) ?? null,
      check_in_zone_name: input.check_in_zone_name ?? null,
      check_in_opens_minutes:
        input.check_in_opens_minutes ?? DEFAULT_CHECK_IN_OPENS_MINUTES,
      event_type_id: input.event_type_id ?? null,
      created_by: input.created_by ?? null,
    });

    if (parent.recurrence_rule) {
      // The occurrences go in as one insert. If it fails, take the whole
      // series back out: otherwise the request fails while a series head with
      // no occurrences stays behind, and a client retrying the 5xx creates a
      // second one (#3235). The rollback reads the parent's occurrences rather
      // than trusting the error, because an insert can commit and still report
      // a failure (a reset or timeout on the response), and deleting only the
      // parent would then leave every landed row as a standalone event
      // (`parent_event_id` is `on delete set null`). Occurrences go first, so a
      // failure partway leaves the series whole rather than orphaned.
      try {
        await this.series.generateRecurringInstances(parent);
      } catch (error) {
        try {
          const landed = await this.eventRepo.findChildren(
            parent.id,
            parent.chapter_id,
          );
          if (landed.length > 0) {
            await this.eventRepo.deleteMany(
              landed.map((row) => row.id),
              parent.chapter_id,
            );
          }
          await this.eventRepo.delete(parent.id, parent.chapter_id);
        } catch (cleanupError) {
          reportCaughtFailure(this.logger, {
            level: 'error',
            site: 'event-create-series-rollback',
            message: `Creating the occurrences of recurring event ${parent.id} failed, and so did taking the series back out. Check that event and its occurrences, and delete them by hand.`,
            error: cleanupError,
          });
        }
        throw error;
      }
    }

    await this.announcements.notifyEventCreated(
      input.chapter_id,
      parent,
      input.created_by,
    );

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

  /**
   * `spec/behavior/events.md` § Event Creation (#3709): any member with
   * `events:create` makes an event, but only an `events:update` holder (the
   * officers who edit any event and take attendance, and the President's
   * `*`) makes anyone required or attaches points. Editing an event already
   * takes `events:update`, so what a create may set never exceeds what its
   * maker could later edit in.
   *
   * A create with no maker (no caller passes none today) is held to the
   * member rule, so a new internal caller can't grant points by omission.
   */
  private async canSetRequirements(input: CreateEventInput): Promise<boolean> {
    if (!input.created_by) return false;
    return this.rbac.memberHasAnyPermission(
      input.chapter_id,
      input.created_by,
      [SystemPermissions.EVENTS_UPDATE],
    );
  }

  async update(
    id: string,
    chapterId: string,
    input: UpdateEventInput,
    scope: EventMutationScope = 'instance',
    actorId?: string,
  ): Promise<Event> {
    let existing: Event | null = null;
    if (input.start_time || input.end_time) {
      existing = await this.findById(id, chapterId);
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

    await this.eventTypes.assertBelongs(input.event_type_id, chapterId);

    const patch: UpdateEventInput = input;

    if (scope === 'series') {
      // Hand on the row already read rather than reading it twice.
      const target = existing ?? (await this.findById(id, chapterId));
      return this.series.updateSeries(target, chapterId, patch, actorId);
    }

    // The row as it was, to tell a real move from a round-tripped save
    // (`eventChangeOf`). Only an edit that names a time or place needs it.
    const before =
      existing ??
      (input.location !== undefined || input.recurrence_rule !== undefined
        ? await this.findById(id, chapterId)
        : null);

    const updated = await this.eventRepo.update(id, chapterId, {
      ...patch,
      // Spread first, then overwrite: `normalizeCheckInZone` returns `undefined`
      // for an absent key, which the repository's partial update ignores, so an
      // update that never mentions the zone leaves it untouched.
      ...(input.check_in_zone !== undefined
        ? { check_in_zone: normalizeCheckInZone(input.check_in_zone) }
        : {}),
    });

    await this.announcements.notifyEventUpdated(
      chapterId,
      updated,
      before ? eventChangeOf(before, patch) : null,
      actorId,
    );

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
}

/**
 * A create by a member who can't make anyone required or attach points
 * (#3709), as it is stored: worth 0 points, required for nobody, and open to
 * exactly the members the request invited.
 *
 * Lowered rather than refused. Every client sends a point value (the forms
 * and `/event` default to 10), and app builds already installed copy a
 * type's "required for everyone" into the form, so a refusal would leave a
 * member on one of them retrying a save that can never succeed. The current
 * forms hide points and stop a required choice before it is sent, so only an
 * older build or a hand-made request reaches this.
 *
 * - `is_mandatory` false: nobody is required by default.
 * - A required role becomes an optional one: still invited, never marked
 *   absent.
 * - `others_invited` is written out as the request meant it
 *   (`eventOthersInvited`), because a null with no required roles left would
 *   read as "everyone", and an event meant for some roles would open to the
 *   whole chapter.
 */
function withoutRequirements(input: CreateEventInput): CreateEventInput {
  const required = input.required_role_ids ?? [];
  const optional = [
    ...new Set([...(input.optional_role_ids ?? []), ...required]),
  ];
  return {
    ...input,
    point_value: 0,
    is_mandatory: false,
    required_role_ids: null,
    optional_role_ids: optional.length > 0 ? optional : null,
    others_invited: eventOthersInvited({
      others_invited: input.others_invited,
      required_role_ids: input.required_role_ids,
    }),
  };
}
