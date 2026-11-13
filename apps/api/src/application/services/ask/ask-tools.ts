import { Injectable } from '@nestjs/common';
import { eventAttendanceFor } from '@repo/validation';
import { SystemPermissions } from '#domain/constants/permissions';
import { TaskStatus } from '#domain/entities/task.entity';
import { localDateIn } from '#domain/utils/zoned-time';
import { EventService } from '../event.service';
import { FinancialInvoiceService } from '../financial-invoice.service';
import { MemberService } from '../member.service';
import { PointsService } from '../points.service';
import { RbacService } from '../rbac.service';
import { TaskService } from '../task.service';
import { nameInLine, oneLine } from './ask-lines';
import type { AskTool, AskToolContext, AskToolResult } from './ask-tool';

/**
 * The live reads Ask ships with (#450). Each mirrors one existing route and
 * calls the service that route calls; `ask-tool.ts` has the rules.
 *
 * Attendance is not here yet: there is no read of one member's attendance
 * across events, only per event, and Ask does not add queries of its own.
 *
 * Every opening suggestion (#4700, `ask-suggestions.service.ts`) is tied to
 * one of these, so Frapp never suggests a question it has no way to answer.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** A roster longer than this is cut, with a line saying so. */
const ROSTER_LIMIT = 400;
const EVENTS_BACK_DAYS = 30;
const EVENTS_AHEAD_DAYS = 120;
const EVENTS_LIMIT = 60;
const DUES_LIMIT = 20;
const TRANSACTIONS_LIMIT = 10;
const LEADERBOARD_LIMIT = 25;
/** How many of the asker's unconfirmed tasks are read, and how many shown. */
const MY_TASKS_READ = 100;
const MY_TASKS_LIMIT = 40;

/** "Sunday, November 15, 2026 at 7:00 PM", in the asker's zone. Never abbreviated. */
function longDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso));
}

/**
 * "Sunday, November 15, 2026 at 7:00 PM to 8:00 PM": the day is said once
 * when an event starts and ends on the same day in the asker's zone, as a
 * person would say it. Across midnight both ends carry their day.
 */
function longRange(start: string, end: string, timeZone: string): string {
  const day = (iso: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(iso));
  if (day(start) !== day(end)) {
    return `${longDateTime(start, timeZone)} to ${longDateTime(end, timeZone)}`;
  }
  const endTime = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(new Date(end));
  return `${longDateTime(start, timeZone)} to ${endTime}`;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "Saturday, November 14, 2026". A task's day with its weekday, because
 * "which is due first" and "is it this weekend" are asked by the day.
 */
function longDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: DATE_ONLY.test(iso) ? 'UTC' : timeZone,
  }).format(new Date(iso));
}

/**
 * "December 1, 2026". A calendar date with no time (an invoice's due date)
 * is that day everywhere, so it is not moved into the asker's zone.
 */
function longDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: DATE_ONLY.test(iso) ? 'UTC' : timeZone,
  }).format(new Date(iso));
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function result(chapterId: string, lines: string[]): AskToolResult | null {
  return lines.length > 0 ? { chapterId, text: lines.join('\n') } : null;
}

/** Who is in the chapter and which roles each member holds. No contact details. */
@Injectable()
export class RosterAskTool implements AskTool {
  readonly name = 'roster';
  readonly description =
    'Who is in the chapter and which roles and offices each member holds (for example who the treasurer is, or who is on a committee).';
  readonly kind = 'roster' as const;
  readonly title = 'Roster';
  readonly page = 'members' as const;
  readonly permission = SystemPermissions.MEMBERS_VIEW;
  readonly module = null;
  readonly effect = 'read' as const;

  constructor(
    private readonly members: MemberService,
    private readonly rbac: RbacService,
  ) {}

  async run({ chapterId }: AskToolContext): Promise<AskToolResult | null> {
    const [profiles, roles] = await Promise.all([
      this.members.findProfilesByChapter(chapterId),
      this.rbac.findByChapter(chapterId),
    ]);
    const roleName = new Map(roles.map((role) => [role.id, role.name]));
    const lines = profiles
      // Only the name and the roles: a profile also carries email, city and
      // employer, which never reach a model (`ai.md` § Live structured data).
      .map((profile) => {
        const held = [
          ...new Set([...profile.role_ids, ...(profile.custom_role_ids ?? [])]),
        ]
          .map((id) => roleName.get(id))
          .filter((name): name is string => Boolean(name));
        return `${nameInLine(profile.display_name)}: ${
          held.length > 0 ? held.map(oneLine).join(', ') : 'no role'
        }`;
      })
      .sort((a, b) => a.localeCompare(b));
    const shown = lines.slice(0, ROSTER_LIMIT);
    if (lines.length > shown.length) {
      shown.push(
        `${lines.length - shown.length} more members are not listed here.`,
      );
    }
    return result(chapterId, shown);
  }
}

/** The events the asker can see, a month back and four months ahead. */
@Injectable()
export class EventsAskTool implements AskTool {
  readonly name = 'events';
  readonly description =
    'The chapter calendar: upcoming and recent events with their date, time, place, whether the member must attend and the points each is worth.';
  readonly kind = 'events' as const;
  readonly title = 'Events';
  readonly page = 'events' as const;
  readonly permission = SystemPermissions.MEMBERS_VIEW;
  readonly module = 'events';
  readonly effect = 'read' as const;

  constructor(
    private readonly events: EventService,
    private readonly members: MemberService,
  ) {}

  async run({
    chapterId,
    userId,
    now,
    timeZone,
  }: AskToolContext): Promise<AskToolResult | null> {
    const [events, member] = await Promise.all([
      // The same read as `GET /v1/events`: narrowed to what this member may see.
      this.events.findByChapter(chapterId, userId, {
        endsAfter: new Date(
          now.getTime() - EVENTS_BACK_DAYS * DAY_MS,
        ).toISOString(),
        startsBefore: new Date(
          now.getTime() + EVENTS_AHEAD_DAYS * DAY_MS,
        ).toISOString(),
      }),
      this.members.findByUserAndChapter(userId, chapterId),
    ]);
    // What is coming matters most, so it is kept first and shown first:
    // every event from today on, nearest first, then the most recent past
    // ones in what is left, newest first, each saying it has happened. A
    // meeting that repeats has last week's line too, and "when is chapter
    // meeting on Sunday" means the next one (#4700).
    const nowIso = now.toISOString();
    const sorted = [...events].sort((a, b) =>
      a.start_time.localeCompare(b.start_time),
    );
    const upcoming = sorted
      .filter((event) => event.end_time >= nowIso)
      .slice(0, EVENTS_LIMIT);
    const past = sorted.filter((event) => event.end_time < nowIso);
    const kept = [
      ...upcoming,
      ...past
        .slice(Math.max(0, past.length - (EVENTS_LIMIT - upcoming.length)))
        .reverse(),
    ];
    const cut = sorted.length - kept.length;
    const lines = kept.map((event) => {
      const attendance = eventAttendanceFor(event, member.role_ids ?? []);
      const over = event.end_time < nowIso;
      // One sentence carries what "when and where is it" asks for: the
      // name, whether it is over, the time and the place. The place is as
      // an officer typed it. The check-in zone's coordinates are never
      // read: no location reaches a model.
      const parts = [
        `${oneLine(event.name)}${over ? ' (already happened)' : ''}: ${longRange(event.start_time, event.end_time, timeZone)}${event.location ? `, at ${oneLine(event.location)}` : ''}`,
        attendance.status === 'required'
          ? over
            ? 'You were required to attend'
            : 'You are required to attend'
          : attendance.status === 'optional'
            ? 'Optional for you'
            : over
              ? 'You were not invited'
              : 'You are not invited',
        event.point_value > 0 ? `Worth ${event.point_value} points` : null,
        event.description ? `About: ${oneLine(event.description)}` : null,
      ];
      return `${parts.filter(Boolean).join('. ')}.`;
    });
    if (lines.length === 0) return null;
    if (cut > 0) {
      lines.push(
        `${cut} more events in this period are not listed here. The Events page has all of them.`,
      );
    }
    return result(chapterId, [
      `Today is ${longDate(now.toISOString(), timeZone)}. Times are in ${timeZone}.`,
      ...lines,
    ]);
  }
}

/** The asker's own points: balance and the latest changes. */
@Injectable()
export class MyPointsAskTool implements AskTool {
  readonly name = 'my_points';
  readonly description =
    "The asking member's own points: their balance and their most recent point changes.";
  readonly kind = 'points' as const;
  readonly title = 'Your points';
  readonly page = 'points' as const;
  readonly permission = SystemPermissions.MEMBERS_VIEW;
  readonly module = 'points';
  readonly effect = 'read' as const;

  constructor(private readonly points: PointsService) {}

  async run({
    chapterId,
    userId,
    timeZone,
  }: AskToolContext): Promise<AskToolResult | null> {
    const [all, semester] = await Promise.all([
      this.points.getUserSummary(chapterId, userId, 'all'),
      this.points.getUserSummary(chapterId, userId, 'semester'),
    ]);
    return result(chapterId, [
      `Your points this semester: ${semester.balance}.`,
      `Your points all time: ${all.balance}.`,
      ...[...all.transactions]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, TRANSACTIONS_LIMIT)
        .map(
          (txn) =>
            `${longDate(txn.created_at, timeZone)}: ${txn.amount > 0 ? '+' : ''}${txn.amount} points, ${oneLine(txn.description) || txn.category.toLowerCase()}.`,
        ),
    ]);
  }
}

/** This semester's standings, as the Points page shows them to every member. */
@Injectable()
export class PointsLeaderboardAskTool implements AskTool {
  readonly name = 'points_leaderboard';
  readonly description =
    "The chapter's points standings this semester: who has the most points.";
  readonly kind = 'points' as const;
  readonly title = 'Points standings';
  readonly page = 'points' as const;
  readonly permission = SystemPermissions.MEMBERS_VIEW;
  readonly module = 'points';
  readonly effect = 'read' as const;

  constructor(
    private readonly points: PointsService,
    private readonly members: MemberService,
  ) {}

  async run({ chapterId }: AskToolContext): Promise<AskToolResult | null> {
    const [board, roster] = await Promise.all([
      this.points.getLeaderboard(chapterId, 'semester'),
      this.members.findRosterByChapter(chapterId),
    ]);
    const nameOf = new Map(
      roster.map((entry) => [entry.user_id, entry.display_name]),
    );
    // Ranked as the Points page ranks (`spec/behavior/points.md`
    // § Leaderboard): equal totals share a place (1, 1, 3), and a member who
    // has left keeps their row, so nobody below them moves up.
    let place = 0;
    const lines = board.slice(0, LEADERBOARD_LIMIT).map((row, index) => {
      if (index === 0 || row.total !== board[index - 1].total) {
        place = index + 1;
      }
      const name = nameOf.has(row.user_id)
        ? nameInLine(nameOf.get(row.user_id))
        : 'A former member';
      return `Place ${place}: ${name}, ${row.total} points this semester.`;
    });
    return result(chapterId, lines);
  }
}

/** The asker's own dues: what is open, what is paid, and when each is due. */
@Injectable()
export class MyDuesAskTool implements AskTool {
  readonly name = 'my_dues';
  readonly description =
    "The asking member's own dues and invoices: amounts, due dates and whether each is paid.";
  readonly kind = 'dues' as const;
  readonly title = 'Your dues';
  readonly page = 'dues' as const;
  readonly permission = SystemPermissions.MEMBERS_VIEW;
  // Off for every chapter during the beta (`BETA_OFF_MODULES`), so this tool
  // is not offered until dues come back.
  readonly module = 'dues';
  readonly effect = 'read' as const;

  constructor(private readonly invoices: FinancialInvoiceService) {}

  async run({
    chapterId,
    userId,
    timeZone,
  }: AskToolContext): Promise<AskToolResult | null> {
    const invoices = await this.invoices.findByUser(userId, chapterId);
    const lines = duesInvoicesForAsk(invoices).map((invoice) =>
      invoice.status === 'PAID'
        ? `${oneLine(invoice.title)}: ${dollars(invoice.amount)}, paid${invoice.paid_at ? ` on ${longDate(invoice.paid_at, timeZone)}` : ''}.`
        : `${oneLine(invoice.title)}: ${dollars(invoice.amount)}, not paid, due ${longDate(invoice.due_date, timeZone)}.`,
    );
    return result(chapterId, lines);
  }
}

/**
 * The invoices Ask reads for a member: what their own Dues page shows, the
 * latest twenty. A draft is the treasurer's unfinished work, and a void one
 * was withdrawn; the page shows neither. The opening suggestion picks from
 * this same list, so it never names an invoice the answer cannot see.
 */
export function duesInvoicesForAsk<
  T extends { status: string; due_date: string },
>(invoices: readonly T[]): T[] {
  return invoices
    .filter((invoice) => invoice.status === 'OPEN' || invoice.status === 'PAID')
    .sort((a, b) => b.due_date.localeCompare(a.due_date))
    .slice(0, DUES_LIMIT);
}

/** The asker's own tasks that are not finished: what is open and when each is due. */
@Injectable()
export class MyTasksAskTool implements AskTool {
  readonly name = 'my_tasks';
  readonly description =
    "The asking member's own tasks: what is assigned to them, when each is due, and whether it is past due, sent back or waiting for an officer to confirm.";
  readonly kind = 'tasks' as const;
  readonly title = 'Your tasks';
  readonly page = 'tasks' as const;
  readonly permission = SystemPermissions.MEMBERS_VIEW;
  readonly module = 'tasks';
  readonly effect = 'read' as const;

  constructor(private readonly tasks: TaskService) {}

  async run({
    chapterId,
    userId,
    now,
    timeZone,
  }: AskToolContext): Promise<AskToolResult | null> {
    // The member's own list, as `GET /v1/tasks` reads it for someone without
    // `tasks:manage`. An officer asking about "my tasks" gets theirs too, not
    // the chapter's: `false` keeps the read to the asker whoever they are.
    const mine = await this.tasks.list(chapterId, userId, false, {
      confirmed: false,
      limit: MY_TASKS_READ,
    });
    // By the day the asker sees, then by the time on that day, with a task
    // that has no time after the timed ones (it is due by the end of the
    // day). `due_at` is an instant and `due_date` a calendar day, so the two
    // are never compared as strings: 8 PM Saturday in New York is already
    // Sunday in UTC.
    type Mine = (typeof mine)[number];
    const dueDay = (task: Mine) =>
      task.due_at
        ? localDateIn(new Date(task.due_at), timeZone)
        : task.due_date;
    const dueFirst = (a: Mine, b: Mine) =>
      dueDay(a).localeCompare(dueDay(b)) ||
      (a.due_at && b.due_at
        ? Date.parse(a.due_at) - Date.parse(b.due_at)
        : a.due_at
          ? -1
          : b.due_at
            ? 1
            : 0);
    const open = mine
      .filter((task) => task.stored_status !== TaskStatus.COMPLETED)
      .sort(dueFirst);
    const waiting = mine.filter(
      (task) => task.stored_status === TaskStatus.COMPLETED,
    );
    const kept = [...open, ...waiting].slice(0, MY_TASKS_LIMIT);
    if (kept.length === 0) return null;
    const whenDue = (task: (typeof mine)[number]) =>
      task.due_at
        ? longDateTime(task.due_at, timeZone)
        : longDay(task.due_date, timeZone);
    const lines = kept.map((task) => {
      const done = task.stored_status === TaskStatus.COMPLETED;
      const steps = task.subtasks ?? [];
      const parts = [
        `${oneLine(task.title)}: due ${whenDue(task)}`,
        done
          ? 'You marked it done and it is waiting for an officer to confirm'
          : task.status === TaskStatus.OVERDUE
            ? 'It is past due'
            : task.stored_status === TaskStatus.IN_PROGRESS
              ? 'You have started it'
              : 'Not started',
        !done && task.sent_back_at
          ? `An officer sent it back${task.sent_back_reason ? `: ${oneLine(task.sent_back_reason)}` : ''}`
          : null,
        steps.length > 0
          ? `${steps.filter((step) => step.done_at).length} of ${steps.length} steps checked off`
          : null,
        task.point_reward ? `Worth ${task.point_reward} points` : null,
        task.description ? `About: ${oneLine(task.description)}` : null,
      ];
      return `${parts.filter(Boolean).join('. ')}.`;
    });
    if (mine.length > kept.length) {
      lines.push(
        `${mine.length - kept.length} more of your tasks are not listed here. The Tasks page has all of them.`,
      );
    }
    return result(chapterId, [
      `Today is ${longDay(now.toISOString(), timeZone)}. Times are in ${timeZone}.`,
      `You have ${open.length} open ${open.length === 1 ? 'task' : 'tasks'}.`,
      // Said outright, so "which is due first" is read and not worked out
      // from a list of dates.
      ...(open.length > 1
        ? [
            `The one due first is ${oneLine(open[0].title)}, due ${whenDue(open[0])}.`,
          ]
        : []),
      ...lines,
    ]);
  }
}

/**
 * Every live-data tool Ask can be offered, in the order the planner reads
 * them. `AskModule` provides exactly this list as `ASK_TOOLS`, and
 * `ask-tools.spec.ts` holds each class in it to the rules a tool keeps, so a
 * tool added here is checked without a second list to remember.
 */
export const ASK_TOOL_CLASSES = [
  RosterAskTool,
  EventsAskTool,
  MyPointsAskTool,
  PointsLeaderboardAskTool,
  MyDuesAskTool,
  MyTasksAskTool,
] as const;
