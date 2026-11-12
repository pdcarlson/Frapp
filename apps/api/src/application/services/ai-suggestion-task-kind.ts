import { BadRequestException, Injectable } from '@nestjs/common';
import {
  TASK_SUBTASK_TITLE_MAX_LENGTH,
  TASK_SUBTASKS_MAX,
  TASK_TITLE_MAX_LENGTH,
} from '@repo/validation';
import { SystemPermissions } from '#domain/constants/permissions';
import type { AiSuggestionPayload } from '#domain/entities/ai-suggestion.entity';
import type { AiSuggestionKindHandler } from './ai-suggestion-kinds';
import { TaskService } from './task.service';

/** A drafted description longer than this is cut, not refused. */
export const TASK_SUGGESTION_DESCRIPTION_MAX_LENGTH = 2000;

/** How long a suggested task waits for an officer (spec: ai.md § Suggestions). */
export const TASK_SUGGESTION_EXPIRY_DAYS = 14;

/**
 * A suggested task, as stored and as listed. Never carries points
 * (`spec/behavior/meetings.md` § Suggested tasks): "give Jake 50 points" said
 * in a meeting is not an instruction, and the officer adds points by hand.
 */
export interface TaskSuggestionPayload {
  title: string;
  description: string | null;
  /** Set only when a name or a role was said or written for it. */
  assignee_id: string | null;
  /** YYYY-MM-DD, when a day was named. */
  due_date: string | null;
  /** The moment it is due, when a time of day was named. */
  due_at: string | null;
  subtasks: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max).trimEnd() : trimmed;
}

function uuidOrNull(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

function dateOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !DATE.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
    ? null
    : value;
}

function instantOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

function subtaskList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item, TASK_SUBTASK_TITLE_MAX_LENGTH))
    .filter((item): item is string => item !== null)
    .slice(0, TASK_SUBTASKS_MAX);
}

/** Reads a stored payload back; the shape `normalizeProposal` wrote. */
export function readTaskPayload(
  payload: AiSuggestionPayload,
): TaskSuggestionPayload {
  return {
    title: typeof payload.title === 'string' ? payload.title : '',
    description:
      typeof payload.description === 'string' ? payload.description : null,
    assignee_id: uuidOrNull(payload.assignee_id),
    due_date: dateOrNull(payload.due_date),
    due_at: instantOrNull(payload.due_at),
    subtasks: subtaskList(payload.subtasks),
  };
}

function toPayload(task: TaskSuggestionPayload): AiSuggestionPayload {
  return { ...task };
}

/**
 * Suggested tasks (#4313 is the first producer: tasks from minutes). Accepting
 * one creates the task through {@link TaskService.create} as the officer who
 * accepted, so it is their task exactly as if they had typed it: the assignee
 * gets the usual assignment push, and no chat card is posted.
 */
@Injectable()
export class TaskSuggestionKind implements AiSuggestionKindHandler {
  readonly kind = 'task' as const;
  readonly requiredPermission = SystemPermissions.TASKS_MANAGE;
  readonly module = 'tasks';
  readonly expiresAfterDays = TASK_SUGGESTION_EXPIRY_DAYS;
  readonly pushCategory = 'tasks';

  constructor(private readonly tasks: TaskService) {}

  describeBatch(count: number): string {
    return count === 1
      ? '1 suggested task to review'
      : `${count} suggested tasks to review`;
  }

  normalizeProposal(raw: unknown): AiSuggestionPayload | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const input = raw as Record<string, unknown>;
    const title = text(input.title, TASK_TITLE_MAX_LENGTH);
    if (!title) return null;
    const dueDate = dateOrNull(input.due_date);
    return toPayload({
      title,
      description: text(
        input.description,
        TASK_SUGGESTION_DESCRIPTION_MAX_LENGTH,
      ),
      assignee_id: uuidOrNull(input.assignee_id),
      due_date: dueDate,
      // A time needs its day; the task service checks they agree on accept.
      due_at: dueDate ? instantOrNull(input.due_at) : null,
      subtasks: subtaskList(input.subtasks),
    });
  }

  applyEdits(
    payload: AiSuggestionPayload,
    edits: Record<string, unknown>,
  ): AiSuggestionPayload {
    const next = readTaskPayload(payload);
    // Present means sent: a DTO instance can carry declared-but-unset fields
    // as `undefined`, so `in` would read every field as an edit.
    const has = (key: string) => edits[key] !== undefined;
    if (has('title')) {
      const title = text(edits.title, TASK_TITLE_MAX_LENGTH);
      if (!title) throw new BadRequestException('A task needs a title.');
      next.title = title;
    }
    if (has('description')) {
      next.description =
        edits.description === null
          ? null
          : text(edits.description, TASK_SUGGESTION_DESCRIPTION_MAX_LENGTH);
    }
    if (has('assignee_id')) next.assignee_id = uuidOrNull(edits.assignee_id);
    if (has('due_date')) {
      next.due_date = dateOrNull(edits.due_date);
      // A new day without a new time drops the old time rather than keep a
      // moment that may fall on another day.
      if (!has('due_at')) next.due_at = null;
    }
    if (has('due_at')) next.due_at = instantOrNull(edits.due_at);
    if (has('subtasks')) next.subtasks = subtaskList(edits.subtasks);
    return toPayload(next);
  }

  assertAcceptable(payload: AiSuggestionPayload): void {
    const task = readTaskPayload(payload);
    if (!task.title) {
      throw new BadRequestException({
        code: 'ai.suggestion.incomplete',
        message: 'A task needs a title.',
      });
    }
    if (!task.assignee_id) {
      throw new BadRequestException({
        code: 'ai.suggestion.incomplete',
        message: 'Pick who this task is for.',
      });
    }
    if (!task.due_date) {
      throw new BadRequestException({
        code: 'ai.suggestion.incomplete',
        message: 'Pick a due date.',
      });
    }
  }

  async commit(input: {
    chapterId: string;
    userId: string;
    payload: AiSuggestionPayload;
  }): Promise<{ resultId: string }> {
    const task = readTaskPayload(input.payload);
    // `assertAcceptable` ran before the claim; these narrow the types.
    if (!task.assignee_id || !task.due_date) {
      throw new BadRequestException({
        code: 'ai.suggestion.incomplete',
        message: 'Pick who this task is for and when it is due.',
      });
    }
    const created = await this.tasks.create({
      chapter_id: input.chapterId,
      title: task.title,
      description: task.description,
      assignee_id: task.assignee_id,
      created_by: input.userId,
      due_date: task.due_date,
      due_at: task.due_at,
      subtasks: task.subtasks,
      // Never points, and never a chat card (no `channel_id`).
      point_reward: null,
    });
    return { resultId: created.id };
  }
}
