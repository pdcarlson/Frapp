import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SystemPermissions } from '#domain/constants/permissions';
import { TaskStatus, type TaskView } from '#domain/entities/task.entity';
import { MemberService } from '../../../member.service';
import { TaskService } from '../../../task.service';
import type {
  AgentReadTool,
  AgentToolContext,
  AgentToolResult,
} from '../agent-tool';
import {
  count,
  dayArg,
  fitRows,
  found,
  holds,
  listSourceId,
  liveSource,
  longDay,
  matchPerson,
  nothing,
  People,
  quoted,
  todayLine,
  wordsArg,
} from './chapter-tool-kit';
import {
  awaitsConfirm,
  dueDay,
  dueFirst,
  isPastDue,
  latestFinishFirst,
  whenDue,
} from './task-lines';

/** How many unfinished tasks are read; a chapter with more is told so. */
const READ_LIMIT = 300;
const DONE_LIMIT = 40;
const SHOWN_LIMIT = 60;
const OWNERS_LIMIT = 25;

const input = z.object({
  assignee: wordsArg(
    "Only tasks assigned to the member with this name. Empty for everyone's.",
  ),
  status: z
    .enum(['unfinished', 'past_due', 'waiting_for_confirmation', 'done'])
    .default('unfinished')
    .describe(
      'unfinished: every task not yet confirmed. past_due: only those past their due day. waiting_for_confirmation: marked done by the assignee and waiting for an officer to confirm. done: the most recently confirmed tasks.',
    ),
  due_before: dayArg(
    'Only tasks due on or before this day, YYYY-MM-DD. Empty for any due day.',
  ),
});
type Args = z.infer<typeof input>;

/**
 * Everyone's tasks, for a member who manages tasks: `GET /v1/tasks` as a
 * `tasks:manage` holder reads it. The totals a question usually wants (how
 * many are past due, who owns them, what is waiting on a confirm) are
 * counted here and written as their own lines.
 */
@Injectable()
export class ChapterTasksAgentTool implements AgentReadTool<Args> {
  readonly name = 'chapter_tasks';
  readonly description =
    "Tasks across the whole chapter, for a member who manages tasks: what is unfinished or past due and who owns it, one member's tasks, and what is waiting for an officer to confirm (including what the asking member can confirm). Gives the counts as well as the list.";
  readonly permission = SystemPermissions.TASKS_MANAGE;
  readonly module = 'tasks';
  readonly effect = 'read' as const;
  readonly input = input;
  readonly reading = "Reading the chapter's tasks";

  constructor(
    private readonly tasks: TaskService,
    private readonly members: MemberService,
  ) {}

  async run(args: Args, context: AgentToolContext): Promise<AgentToolResult> {
    const { chapterId, userId, timeZone } = context;
    // Offered only to a `tasks:manage` holder; checked again here so the
    // chapter-wide read can never run for anyone else.
    if (!holds(context, SystemPermissions.TASKS_MANAGE)) {
      return nothing(context, 'This member cannot see other members’ tasks.');
    }
    const done = args.status === 'done';
    const [all, roster] = await Promise.all([
      this.tasks.list(chapterId, userId, true, {
        confirmed: done,
        limit: done ? DONE_LIMIT : READ_LIMIT,
      }),
      this.members.findRosterByChapter(chapterId),
    ]);
    const people = new People(roster);

    let kept = all;
    const notes: string[] = [];
    if (args.assignee) {
      const owners = matchPerson(
        roster,
        (entry) => entry.display_name,
        args.assignee,
      );
      if (owners.length === 0) {
        return nothing(
          context,
          'No member matches that name. The find_member tool looks a person up.',
        );
      }
      if (owners.length > 1) {
        notes.push(
          `${owners.length} members match that name, so the tasks of all of them are listed.`,
        );
      }
      const ids = new Set(owners.map((owner) => owner.user_id));
      kept = kept.filter((task) => ids.has(task.assignee_id));
    }
    if (args.due_before) {
      kept = kept.filter((task) => dueDay(task, timeZone) <= args.due_before);
    }
    if (args.status === 'past_due') kept = kept.filter(isPastDue);
    if (args.status === 'waiting_for_confirmation') {
      kept = kept.filter(awaitsConfirm);
    }
    if (!done && all.length >= READ_LIMIT) {
      notes.push(
        `Only the newest ${READ_LIMIT} unfinished tasks are read, so the counts may be short.`,
      );
    }
    if (kept.length === 0) {
      return nothing(context, ['No task fits that.', ...notes].join(' '));
    }

    const sourceId = listSourceId(
      this.name,
      args.status,
      args.assignee,
      args.due_before,
    );
    if (done) {
      // The read is newest created first; the list is latest finish first.
      const rows = [...kept].sort(latestFinishFirst).map((task) => {
        const parts = [
          `${quoted(task.title)}: done by ${people.name(task.assignee_id)}${task.confirmed_at ? `, finished on ${longDay(task.confirmed_at, timeZone)}` : ''}`,
          task.point_reward ? `Worth ${task.point_reward} points` : null,
        ];
        return `${parts.filter(Boolean).join('. ')}.`;
      });
      const summary = [
        todayLine(context),
        `${count(rows.length, 'finished task')}, the latest finish first.`,
      ];
      const shown = fitRows(summary, rows, DONE_LIMIT);
      return found(
        context,
        liveSource({
          id: sourceId,
          kind: 'tasks',
          title: 'Chapter tasks',
          detail: 'Finished',
          page: 'tasks',
          lines: [...summary, ...shown],
        }),
        people,
        all.length >= DONE_LIMIT
          ? `Only the ${DONE_LIMIT} most recently created finished tasks are read, so an older task finished lately may be missing.`
          : null,
      );
    }

    const narrowed = Boolean(
      args.assignee || args.due_before || args.status !== 'unfinished',
    );
    const pastDue = kept.filter(isPastDue);
    const waiting = kept.filter(awaitsConfirm);
    // Nobody confirms their own task (`TaskService.confirmCompletion`), so
    // what waits on the asker is everyone's but theirs.
    const forAsker = waiting.filter((task) => task.assignee_id !== userId);
    const summary = [
      todayLine(context),
      // A narrowed read says so: its count is not the chapter's.
      narrowed
        ? `Unfinished tasks that fit what was asked: ${kept.length}.`
        : `Unfinished tasks: ${kept.length}.`,
      `Past due: ${pastDue.length}.`,
      `Marked done and waiting for an officer to confirm: ${waiting.length}.`,
      `Of those, the member asking can confirm ${forAsker.length}.`,
      ...this.ownerLines(kept, people, narrowed),
    ];
    // Past due first, longest overdue at the top; then what is waiting on a
    // confirm; then the rest by due day.
    const order = (task: TaskView) =>
      isPastDue(task) ? 0 : awaitsConfirm(task) ? 1 : 2;
    const byDue = dueFirst(timeZone);
    const rows = [...kept]
      .sort((a, b) => order(a) - order(b) || byDue(a, b))
      .map((task) => {
        const parts = [
          `${quoted(task.title)}: assigned to ${people.name(task.assignee_id)}, due ${whenDue(task, timeZone)}`,
          awaitsConfirm(task)
            ? `Marked done${task.completed_at ? ` on ${longDay(task.completed_at, timeZone)}` : ''} and waiting for an officer to confirm`
            : isPastDue(task)
              ? 'Past due'
              : task.stored_status === TaskStatus.IN_PROGRESS
                ? 'Started'
                : 'Not started',
          !awaitsConfirm(task) && task.sent_back_at ? 'Sent back once' : null,
          task.point_reward ? `Worth ${task.point_reward} points` : null,
        ];
        return `${parts.filter(Boolean).join('. ')}.`;
      });
    const shown = fitRows(summary, rows, SHOWN_LIMIT);
    const cut = rows.length - shown.length;
    const cutLine =
      cut > 0
        ? `${count(cut, 'more task')} not listed here. The counts above include them. The Tasks page has all of them.`
        : null;
    if (cutLine) notes.push(`Showing ${shown.length} of ${rows.length} tasks.`);
    return found(
      context,
      liveSource({
        id: sourceId,
        kind: 'tasks',
        title: 'Chapter tasks',
        page: 'tasks',
        lines: [...summary, ...shown, ...(cutLine ? [cutLine] : [])],
      }),
      people,
      notes.length > 0 ? notes.join(' ') : null,
    );
  }

  /** One line per owner, the most past due first: "who is behind" without adding up. */
  private ownerLines(
    tasks: readonly TaskView[],
    people: People,
    narrowed: boolean,
  ): string[] {
    const owners = new Map<string, { open: number; pastDue: number }>();
    for (const task of tasks) {
      const owner = owners.get(task.assignee_id) ?? { open: 0, pastDue: 0 };
      owner.open += 1;
      if (isPastDue(task)) owner.pastDue += 1;
      owners.set(task.assignee_id, owner);
    }
    if (owners.size < 2) return [];
    const ranked = [...owners].sort(
      ([, a], [, b]) => b.pastDue - a.pastDue || b.open - a.open,
    );
    const lines = ranked
      .slice(0, OWNERS_LIMIT)
      .map(
        ([id, owner]) =>
          `${people.name(id)} has ${owner.open} ${narrowed ? 'of these' : 'unfinished'}, ${owner.pastDue} past due.`,
      );
    if (ranked.length > OWNERS_LIMIT) {
      lines.push(
        `${count(ranked.length - OWNERS_LIMIT, 'more member')} with ${narrowed ? 'tasks that fit' : 'unfinished tasks'} not counted one by one here.`,
      );
    }
    return [`Members with unfinished tasks: ${owners.size}.`, ...lines];
  }
}
