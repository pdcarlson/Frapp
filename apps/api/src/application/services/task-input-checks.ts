import { BadRequestException } from '@nestjs/common';
import {
  TASK_SUBTASK_TITLE_MAX_LENGTH,
  TASK_SUBTASKS_MAX,
} from '@repo/validation';

/**
 * The checks a new task's fields get wherever a task is made: a task, a
 * group's copies, or a task up for grabs (2026-11-18), so the three can't
 * drift apart.
 */

/** `due_date` as a day that parses; 400 otherwise. */
export function checkedDueDate(dueDate: string): string {
  if (Number.isNaN(new Date(dueDate).getTime())) {
    throw new BadRequestException('due_date must be a valid date');
  }
  return dueDate;
}

/**
 * `due_at` as stored, or null for a task with no time. `due_date` is the day
 * of `due_at` in the creator's zone, which the server does not know, but no
 * zone is more than 14 hours from UTC: a pair further apart than that is a
 * client bug, refused rather than stored as a task due on two days.
 */
export function checkedDueAt(
  dueDate: string,
  dueAt: string | null | undefined,
): string | null {
  if (!dueAt) return null;
  const at = Date.parse(dueAt);
  if (Number.isNaN(at)) {
    throw new BadRequestException('due_at must be a valid date and time');
  }
  const dayStart = Date.parse(`${dueDate.slice(0, 10)}T00:00:00Z`);
  const hour = 60 * 60 * 1000;
  if (at < dayStart - 14 * hour || at >= dayStart + 38 * hour) {
    throw new BadRequestException('due_at must fall on due_date');
  }
  return new Date(at).toISOString();
}

/** Subtask titles trimmed, with blanks dropped; refuses too many or too long. */
export function checkedSubtaskTitles(titles: string[]): string[] {
  const clean = titles.map((title) => title.trim()).filter(Boolean);
  if (clean.length === 0 && titles.length > 0) {
    throw new BadRequestException('A subtask needs a title');
  }
  if (clean.length > TASK_SUBTASKS_MAX) {
    throw new BadRequestException(
      `A task can have up to ${TASK_SUBTASKS_MAX} subtasks`,
    );
  }
  if (clean.some((title) => title.length > TASK_SUBTASK_TITLE_MAX_LENGTH)) {
    throw new BadRequestException(
      `A subtask can be up to ${TASK_SUBTASK_TITLE_MAX_LENGTH} characters`,
    );
  }
  return clean;
}
