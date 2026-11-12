import { Injectable } from '@nestjs/common';
import {
  POINTS_ADJUSTMENT_MAX,
  POINTS_REASON_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
  isModuleEnabled,
} from '@repo/validation';
import { SystemPermissions, WILDCARD } from '#domain/constants/permissions';
import type { Event } from '#domain/entities/event.entity';
import {
  localDateIn,
  parseLocalDate,
  parseLocalTime,
  zonedTimeToUtc,
} from '#domain/utils/zoned-time';
import { POINTS_SUGGESTION_MAX_MEMBERS } from '../ai-suggestion-points-kind';
import { AttendanceService } from '../attendance.service';
import { EventService } from '../event.service';
import { ActPeopleResolver } from './act-people';
import {
  NEW_EVENT_SUGGESTION_NAME_MAX_LENGTH,
  NEW_EVENT_SUGGESTION_TEXT_MAX_LENGTH,
} from '../ai-suggestion-new-event-kind';
import type { ActPlan } from './act-prompt';
import type {
  ActDraft,
  ActEventChoice,
  ActNote,
  ActTool,
  ActToolContext,
} from './act-tool';

/**
 * The changes the acting agent ships with (#718): points, a task, an event.
 * Each mirrors one existing route; `act-tool.ts` has the rules.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** How far back "the event everyone came to" is looked for. */
const ATTENDED_EVENT_BACK_DAYS = 14;
/** Events offered when which one is not clear. */
const EVENT_CHOICES_MAX = 8;
const EVENT_NAME_MAX_LENGTH = NEW_EVENT_SUGGESTION_NAME_MAX_LENGTH;
const TEXT_MAX_LENGTH = NEW_EVENT_SUGGESTION_TEXT_MAX_LENGTH;

function clean(value: string | null | undefined, max: number): string | null {
  const flat = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > max ? flat.slice(0, max).trimEnd() : flat;
}

/** A title as a title: "book the bus" reads "Book the bus" on the card. */
function titled(value: string | null): string | null {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && word !== 'the');
}

/** "chapter" fits "Chapter Meeting"; "formal" fits "Winter Formal". */
function eventNamed(typed: string, event: Event): boolean {
  const want = words(typed);
  const have = words(event.name);
  return (
    want.length > 0 &&
    want.every((word) =>
      have.some((other) => other.startsWith(word) || word.startsWith(other)),
    )
  );
}

function holds(context: ActToolContext, permission: string): boolean {
  return (
    context.heldPermissions.has(WILDCARD) ||
    context.heldPermissions.has(permission)
  );
}

function choice(event: Event): ActEventChoice {
  return { id: event.id, name: event.name, start_time: event.start_time };
}

/** Members who came: present, or late. Excused and absent did not. */
const CAME = new Set(['PRESENT', 'LATE']);

/**
 * Give or take away points for members: named ones, the holders of a role,
 * or everyone who came to an event. Mirrors `POST /v1/points/adjust`.
 */
@Injectable()
export class GivePointsActTool implements ActTool {
  readonly name = 'give_points';
  readonly description =
    'Give points to, or take points away from, one or more members. Uses amount, title (the reason, in a few words) and either people, or everyone_who_attended with event_name and date.';
  readonly permission = SystemPermissions.POINTS_ADJUST;
  readonly module = 'points';
  readonly effect = 'propose' as const;
  readonly kind = 'points' as const;

  constructor(
    private readonly people: ActPeopleResolver,
    private readonly events: EventService,
    private readonly attendance: AttendanceService,
  ) {}

  async draft(plan: ActPlan, context: ActToolContext): Promise<ActDraft> {
    const amount = plan.amount;
    if (
      amount === null ||
      !Number.isInteger(amount) ||
      amount === 0 ||
      Math.abs(amount) > POINTS_ADJUSTMENT_MAX
    ) {
      return { status: 'unclear', missing: 'amount' };
    }
    const reason = titled(
      clean(plan.title ?? plan.details, POINTS_REASON_MAX_LENGTH),
    );

    if (plan.everyone_who_attended) {
      if (!this.maySeeAttendance(context)) {
        return { status: 'unclear', missing: 'attendance_access' };
      }
      const found = await this.findAttendedEvent(plan, context);
      if (!found.event) {
        return {
          status: 'needs_event',
          amount,
          // Named after the event once it is picked.
          reason: reason ?? '',
          events: found.choices,
        };
      }
      return this.draftForEvent(found.event, amount, reason, context);
    }

    if (plan.people.length === 0)
      return { status: 'unclear', missing: 'people' };
    if (!reason) return { status: 'unclear', missing: 'reason' };
    const resolved = await this.people.resolve(plan.people, context, {
      roles: true,
    });
    return this.finish(
      amount,
      reason,
      resolved.userIds,
      resolved.notes,
      null,
      context,
    );
  }

  /**
   * The follow-up to `needs_event`: the member picked which event. No model
   * is involved; the amount and the reason are what the first answer carried
   * back, and they are validated again like any proposal.
   */
  async draftFromEvent(
    input: { eventId: string; amount: number; reason: string | null },
    context: ActToolContext,
  ): Promise<ActDraft> {
    if (
      !Number.isInteger(input.amount) ||
      input.amount === 0 ||
      Math.abs(input.amount) > POINTS_ADJUSTMENT_MAX
    ) {
      return { status: 'unclear', missing: 'amount' };
    }
    if (!this.maySeeAttendance(context)) {
      return { status: 'unclear', missing: 'attendance_access' };
    }
    // The same read as `GET /v1/events/:id`: an event of another chapter, or
    // one this member cannot see, is not found.
    const event = await this.events.findById(
      input.eventId,
      context.chapterId,
      context.userId,
    );
    return this.draftForEvent(
      event,
      input.amount,
      clean(input.reason, POINTS_REASON_MAX_LENGTH),
      context,
    );
  }

  /** `GET /v1/events/:eventId/attendance` needs `events:update` and the module. */
  private maySeeAttendance(context: ActToolContext): boolean {
    return (
      holds(context, SystemPermissions.EVENTS_UPDATE) &&
      isModuleEnabled(context.enabledModules, 'events')
    );
  }

  private async draftForEvent(
    event: Event,
    amount: number,
    reason: string | null,
    context: ActToolContext,
  ): Promise<ActDraft> {
    const rows = await this.attendance.getAttendance(
      event.id,
      context.chapterId,
    );
    const came = [
      ...new Set(
        rows.filter((row) => CAME.has(row.status)).map((row) => row.user_id),
      ),
    ];
    if (came.length === 0)
      return { status: 'unclear', missing: 'nobody_attended' };
    return this.finish(
      amount,
      reason ??
        clean(`Attended ${event.name}`, POINTS_REASON_MAX_LENGTH) ??
        'Attended',
      came,
      [],
      event,
      context,
    );
  }

  private finish(
    amount: number,
    reason: string,
    userIds: readonly string[],
    notes: readonly ActNote[],
    event: Event | null,
    context: ActToolContext,
  ): ActDraft {
    // Nobody adjusts their own points (`PointsService.adjustPoints`), so the
    // officer is taken out here and the card says so.
    const targets = userIds.filter((id) => id !== context.userId);
    const out: ActNote[] = [...notes];
    if (targets.length < userIds.length) out.push({ type: 'self_left_out' });
    if (targets.length > POINTS_SUGGESTION_MAX_MEMBERS) {
      return { status: 'unclear', missing: 'too_many_members' };
    }
    const open = out.some(
      (note) =>
        note.type === 'unmatched_name' || note.type === 'ambiguous_name',
    );
    // Nobody at all, and nothing for the officer to fix on the card.
    if (targets.length === 0 && !open) {
      return { status: 'unclear', missing: 'people' };
    }
    return {
      status: 'draft',
      payload: {
        amount,
        reason,
        target_user_ids: targets,
        event_id: event?.id ?? null,
        event_name: event?.name ?? null,
        event_start_time: event?.start_time ?? null,
      },
      notes: out,
    };
  }

  /**
   * The event "everyone who came" refers to, among the events this member
   * can see that have started in the last two weeks. Picked only when what
   * was said leaves one candidate; otherwise the member chooses.
   */
  private async findAttendedEvent(
    plan: ActPlan,
    context: ActToolContext,
  ): Promise<{ event: Event | null; choices: ActEventChoice[] }> {
    const nowIso = context.now.toISOString();
    const events = (
      await this.events.findByChapter(context.chapterId, context.userId, {
        endsAfter: new Date(
          context.now.getTime() - ATTENDED_EVENT_BACK_DAYS * DAY_MS,
        ).toISOString(),
        startsBefore: nowIso,
      })
    )
      .filter((event) => event.start_time <= nowIso)
      .sort((a, b) => b.start_time.localeCompare(a.start_time));

    const date = parseLocalDate(plan.date) ? plan.date : null;
    const name = clean(plan.event_name, EVENT_NAME_MAX_LENGTH);
    const onDate = date
      ? events.filter(
          (event) =>
            localDateIn(new Date(event.start_time), context.timeZone) === date,
        )
      : events;
    const named = name
      ? onDate.filter((event) => eventNamed(name, event))
      : onDate;

    if ((date || name) && named.length === 1) {
      return { event: named[0], choices: [] };
    }
    // A day was named, no event was, and one event was on it: "everyone who
    // came tonight" is that event. A name that matches nothing is never
    // swapped for whatever else was on that day; the member picks.
    if (date && !name && onDate.length === 1) {
      return { event: onDate[0], choices: [] };
    }
    const pool = named.length > 0 ? named : onDate.length > 0 ? onDate : events;
    return {
      event: null,
      choices: pool.slice(0, EVENT_CHOICES_MAX).map(choice),
    };
  }
}

/** Create a task for a member. Mirrors `POST /v1/tasks`. */
@Injectable()
export class CreateTaskActTool implements ActTool {
  readonly name = 'create_task';
  readonly description =
    'Create a task for one member to do. Uses title, people (the one member it is for), date (the day it is due), start_time (the time it is due, when one was said) and details.';
  readonly permission = SystemPermissions.TASKS_MANAGE;
  readonly module = 'tasks';
  readonly effect = 'propose' as const;
  readonly kind = 'task' as const;

  constructor(private readonly people: ActPeopleResolver) {}

  async draft(plan: ActPlan, context: ActToolContext): Promise<ActDraft> {
    const title = titled(clean(plan.title, TASK_TITLE_MAX_LENGTH));
    if (!title) return { status: 'unclear', missing: 'title' };

    const resolved = await this.people.resolve(plan.people, context, {
      roles: false,
    });
    // A task has one owner. More than one name, or none that could be
    // placed, leaves "Who?" for the officer to pick on the card.
    const assigneeId =
      resolved.userIds.length === 1 ? resolved.userIds[0] : null;

    const dueDate = parseLocalDate(plan.date) ? plan.date : null;
    const dueAt =
      dueDate && parseLocalTime(plan.start_time)
        ? (zonedTimeToUtc(
            dueDate,
            plan.start_time ?? '',
            context.timeZone,
          )?.toISOString() ?? null)
        : null;
    return {
      status: 'draft',
      payload: {
        title,
        description: clean(plan.details, TEXT_MAX_LENGTH),
        assignee_id: assigneeId,
        due_date: dueDate,
        due_at: dueAt,
        subtasks: [],
      },
      notes: resolved.notes,
    };
  }
}

/** Put one event on the calendar. Mirrors `POST /v1/events`. */
@Injectable()
export class CreateEventActTool implements ActTool {
  readonly name = 'create_event';
  readonly description =
    'Put one event on the chapter calendar. Uses title (its name), date, start_time, end_time, location, details, required (whether members must attend) and amount (the points it is worth, when said).';
  readonly permission = SystemPermissions.EVENTS_CREATE;
  readonly module = 'events';
  readonly effect = 'propose' as const;
  readonly kind = 'new_event' as const;

  draft(plan: ActPlan, context: ActToolContext): Promise<ActDraft> {
    return Promise.resolve(this.draftSync(plan, context));
  }

  private draftSync(plan: ActPlan, context: ActToolContext): ActDraft {
    const name = titled(clean(plan.title, EVENT_NAME_MAX_LENGTH));
    if (!name) return { status: 'unclear', missing: 'title' };
    if (!plan.date || !parseLocalDate(plan.date)) {
      return { status: 'unclear', missing: 'date' };
    }
    const start = plan.start_time
      ? zonedTimeToUtc(plan.date, plan.start_time, context.timeZone)
      : null;
    if (!start) return { status: 'unclear', missing: 'time' };
    let end = plan.end_time
      ? zonedTimeToUtc(plan.date, plan.end_time, context.timeZone)
      : null;
    // No end said: an hour. An end before the start ("9 to 1") is the next day.
    if (!end) end = new Date(start.getTime() + HOUR_MS);
    else if (end <= start) end = new Date(end.getTime() + DAY_MS);

    const points =
      plan.amount !== null &&
      Number.isInteger(plan.amount) &&
      plan.amount >= 0 &&
      plan.amount <= POINTS_ADJUSTMENT_MAX
        ? plan.amount
        : null;
    return {
      status: 'draft',
      payload: {
        name,
        description: clean(plan.details, TEXT_MAX_LENGTH),
        location: clean(plan.location, TEXT_MAX_LENGTH),
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        point_value: points,
        is_mandatory: plan.required === true,
      },
      notes: [],
    };
  }
}
