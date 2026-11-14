/**
 * The term chapter's records as the one-shot Ask's reads return them: the
 * five reads the beta ships (`ask-tools.ts`; dues are off for the beta),
 * each already run for one asker, under the product's tool name and the
 * product's description, which is what the planner picks by.
 *
 * This is the baseline's view of the chapter. None of these reads takes an
 * argument, so nothing here can answer "what is overdue across the chapter"
 * or "who came on Saturday": that is the gap the loop's tools (#4898) close,
 * and the real-question set is meant to show it.
 *
 * The names and descriptions are copied, not imported: `ask-tools.ts` goes
 * away when the loop replaces the one-shot Ask, and the baseline has to keep
 * running as it was scored.
 */
import { TERM_REQUIREMENT, type TermChapter } from '../synthetic-chapter/term';
import type { ToolResult } from './types';

const day = (iso: string): string =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: /^\d{4}-\d{2}-\d{2}$/.test(iso) ? 'UTC' : 'America/New_York',
  }).format(new Date(iso));

const dayAndTime = (iso: string): string =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  }).format(new Date(iso));

const STATUS_WORDS = {
  open: 'Not done yet',
  awaiting_approval: 'Waiting for an officer to confirm',
  sent_back: 'Sent back',
  done: 'Done',
} as const;

export function termReadsFor(
  chapter: TermChapter,
  askerId: string,
  now: Date,
): ToolResult[] {
  const today = now.toISOString().slice(0, 10);
  const name = (id: string): string =>
    chapter.members.find((person) => person.id === id)?.name ?? 'A member';
  const read = (
    toolName: string,
    description: string,
    lines: string[],
  ): ToolResult[] =>
    lines.length === 0
      ? []
      : [
          {
            toolName,
            description,
            chapterId: chapter.chapterId,
            content: lines.join('\n'),
          },
        ];

  const mine = chapter.tasks.filter(
    (task) => task.assigneeId === askerId && task.status !== 'done',
  );
  const standings = Object.entries(chapter.points)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 25);

  return [
    ...read(
      'roster',
      'Who is in the chapter and which roles and offices each member holds (for example who the treasurer is, or who is on a committee).',
      chapter.members.map((person) => `${person.name}: ${person.role}`),
    ),
    ...read(
      'events',
      'The chapter calendar: upcoming and recent events with their date, time, place, whether the member must attend and the points each is worth.',
      chapter.events.map(
        (event) =>
          `${event.name}: ${dayAndTime(event.start)}, ${event.place}. ${
            event.required ? 'Required' : 'Optional'
          }. ${event.points} points.`,
      ),
    ),
    ...read(
      'my_points',
      "The asking member's own points: their balance and their most recent point changes.",
      askerId in chapter.points
        ? [
            `Points this term: ${chapter.points[askerId]}.`,
            `The chapter asks for ${TERM_REQUIREMENT.points} points by ${day(TERM_REQUIREMENT.by)}.`,
          ]
        : [],
    ),
    ...read(
      'points_leaderboard',
      "The chapter's points standings this semester: who has the most points.",
      standings.map(
        ([id, points], index) => `${index + 1}. ${name(id)}: ${points} points`,
      ),
    ),
    ...read(
      'my_tasks',
      "The asking member's own tasks: what is assigned to them, when each is due, and whether it is past due, sent back or waiting for an officer to confirm.",
      mine.map(
        (task) =>
          `${task.title}. Due ${day(task.due)}${
            task.due < today && task.status === 'open' ? ' (past due)' : ''
          }. ${STATUS_WORDS[task.status]}.`,
      ),
    ),
  ];
}
