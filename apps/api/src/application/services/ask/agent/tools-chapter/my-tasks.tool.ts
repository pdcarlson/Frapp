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
  fitRows,
  found,
  listSourceId,
  liveSource,
  longDay,
  nothing,
  People,
  quoted,
  todayLine,
} from './chapter-tool-kit';
import { awaitsConfirm, dueFirst, isPastDue, whenDue } from './task-lines';

/** How many of the asker's tasks are read, and how many shown. */
const READ_LIMIT = 100;
const SHOWN_LIMIT = 40;
const DONE_LIMIT = 20;

const input = z.object({
  status: z
    .enum(['unfinished', 'done'])
    .default('unfinished')
    .describe(
      'unfinished: what the member still has to do, plus what they marked done that an officer has not confirmed yet. done: their most recently finished tasks.',
    ),
});
type Args = z.infer<typeof input>;

/**
 * The asker's own tasks: `GET /v1/tasks` as a member without `tasks:manage`
 * reads it. An officer asking about "my tasks" gets theirs too, not the
 * chapter's; `chapter_tasks` is the tool for everyone's.
 */
@Injectable()
export class MyTasksAgentTool implements AgentReadTool<Args> {
  readonly name = 'my_tasks';
  readonly description =
    "The asking member's own tasks: what is assigned to them, who assigned it, when each is due, and whether it is past due, sent back or waiting for an officer to confirm. Use it for what they need to do, and before suggesting a task so it is not one they already have.";
  readonly permission = SystemPermissions.MEMBERS_VIEW;
  readonly module = 'tasks';
  readonly effect = 'read' as const;
  readonly input = input;
  readonly reading = 'Reading your tasks';

  constructor(
    private readonly tasks: TaskService,
    private readonly members: MemberService,
  ) {}

  async run(args: Args, context: AgentToolContext): Promise<AgentToolResult> {
    const { chapterId, userId, timeZone } = context;
    const done = args.status === 'done';
    // `false` keeps the read to the asker whoever they are.
    const [mine, roster] = await Promise.all([
      this.tasks.list(chapterId, userId, false, {
        confirmed: done,
        limit: done ? DONE_LIMIT : READ_LIMIT,
      }),
      this.members.findRosterByChapter(chapterId),
    ]);
    if (mine.length === 0) {
      return nothing(
        context,
        done
          ? 'This member has no finished tasks.'
          : 'This member has no unfinished tasks.',
      );
    }
    const people = new People(roster);
    const assignedBy = (task: TaskView) =>
      task.created_by && task.created_by !== userId
        ? `Assigned by ${people.name(task.created_by)}`
        : null;

    if (done) {
      const rows = mine.map((task) => {
        const parts = [
          `${quoted(task.title)}: finished${task.confirmed_at ? ` on ${longDay(task.confirmed_at, timeZone)}` : ''}`,
          assignedBy(task),
          task.point_reward ? `Worth ${task.point_reward} points` : null,
        ];
        return `${parts.filter(Boolean).join('. ')}.`;
      });
      const summary = [
        todayLine(context),
        `Your ${count(rows.length, 'most recently finished task')}, newest first.`,
      ];
      const shown = fitRows(summary, rows, DONE_LIMIT);
      return found(
        context,
        liveSource({
          id: listSourceId(this.name, 'done'),
          kind: 'tasks',
          title: 'Your tasks',
          detail: 'Finished',
          page: 'tasks',
          lines: [...summary, ...shown],
        }),
        people,
        mine.length >= DONE_LIMIT
          ? `Only the newest ${DONE_LIMIT} finished tasks are read.`
          : null,
      );
    }

    const open = mine
      .filter((task) => !awaitsConfirm(task))
      .sort(dueFirst(timeZone));
    const waiting = mine.filter(awaitsConfirm);
    const pastDue = open.filter(isPastDue).length;
    const rows = [...open, ...waiting].map((task) => {
      const steps = task.subtasks ?? [];
      const parts = [
        `${quoted(task.title)}: due ${whenDue(task, timeZone)}`,
        awaitsConfirm(task)
          ? 'You marked it done and it is waiting for an officer to confirm'
          : isPastDue(task)
            ? 'It is past due'
            : task.stored_status === TaskStatus.IN_PROGRESS
              ? 'You have started it'
              : 'Not started',
        !awaitsConfirm(task) && task.sent_back_at
          ? `An officer sent it back${task.sent_back_reason ? `, saying ${quoted(task.sent_back_reason)}` : ''}`
          : null,
        assignedBy(task),
        steps.length > 0
          ? `${steps.filter((step) => step.done_at).length} of ${steps.length} steps checked off`
          : null,
        task.point_reward ? `Worth ${task.point_reward} points` : null,
        task.description ? `About: ${quoted(task.description)}` : null,
      ];
      return `${parts.filter(Boolean).join('. ')}.`;
    });
    const summary = [
      todayLine(context),
      `You have ${count(open.length, 'open task')}.`,
      `Past due: ${pastDue}.`,
      `Marked done and waiting for an officer to confirm: ${waiting.length}.`,
      // Said outright, so "which is due first" is read and not worked out
      // from a list of dates.
      ...(open.length > 1
        ? [
            `The one due first is ${quoted(open[0].title)}, due ${whenDue(open[0], timeZone)}.`,
          ]
        : []),
    ];
    const shown = fitRows(summary, rows, SHOWN_LIMIT);
    const cut = rows.length - shown.length;
    const cutLine =
      cut > 0
        ? `${count(cut, 'more task')} of yours not listed here. The Tasks page has all of them.`
        : null;
    const notes = [
      cutLine ? `Showing ${shown.length} of ${rows.length} tasks.` : null,
      mine.length >= READ_LIMIT
        ? `Only the newest ${READ_LIMIT} unfinished tasks are read, so the counts may be short.`
        : null,
    ].filter(Boolean);
    return found(
      context,
      liveSource({
        id: listSourceId(this.name),
        kind: 'tasks',
        title: 'Your tasks',
        page: 'tasks',
        lines: [...summary, ...shown, ...(cutLine ? [cutLine] : [])],
      }),
      people,
      notes.length > 0 ? notes.join(' ') : null,
    );
  }
}
