import { BadRequestException, Injectable } from '@nestjs/common';
import {
  TASK_AUDIENCE_EVERYONE,
  TASK_AUDIENCE_SOMEONE,
  TASK_PEOPLE_MAX,
  TASK_SUBTASK_TITLE_MAX_LENGTH,
  TASK_SUBTASKS_MAX,
  TASK_SUGGESTION_AUDIENCES,
  TASK_TITLE_MAX_LENGTH,
  type TaskSuggestionAudience,
} from '@repo/validation';
import { SystemPermissions } from '#domain/constants/permissions';
import type { AiSuggestionPayload } from '#domain/entities/ai-suggestion.entity';
import type { AiSuggestionKindHandler } from './ai-suggestion-kinds';
import { TaskService } from './task.service';
import { OpenTaskService } from './open-task.service';
import type { TaskAudienceTarget } from './task-audience.service';

/** A drafted description longer than this is cut, not refused. */
export const TASK_SUGGESTION_DESCRIPTION_MAX_LENGTH = 2000;

/** How long a suggested task waits for an officer (spec: ai.md § Suggestions). */
const TASK_SUGGESTION_EXPIRY_DAYS = 14;

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
  /**
   * Several people (2026-11-18): with no `audience`, each gets their own
   * copy; with `audience: "someone"`, one of them claims it. Never set with
   * `assignee_id`, and never a list of one (that is `assignee_id`).
   */
  assignee_ids: string[] | null;
  /**
   * A task for a group instead of one person: `everyone` gives each member
   * of it their own copy (#4295 step 3); `someone` posts one task up for
   * grabs that one of them claims (2026-11-18). The group is the chapter,
   * or `audience_role_id`'s holders, or `audience_group_id`'s members, or
   * (for `someone`) `assignee_ids`. Never set with `assignee_id`.
   */
  audience: TaskSuggestionAudience | null;
  /** With `audience`: only this role's holders. */
  audience_role_id: string | null;
  /** With `audience`: only this chapter group's members. */
  audience_group_id: string | null;
  /** YYYY-MM-DD, when a day was named. */
  due_date: string | null;
  /** The moment it is due, when a time of day was named. */
  due_at: string | null;
  subtasks: string[];
  /**
   * Set only on a "this time last year" suggestion (#3930): the day last
   * year's task, its source, was due. The screen words the row from it.
   */
  last_year_on?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max).trimEnd() : trimmed;
}

function audienceOrNull(value: unknown): TaskSuggestionAudience | null {
  return typeof value === 'string' &&
    (TASK_SUGGESTION_AUDIENCES as readonly string[]).includes(value)
    ? (value as TaskSuggestionAudience)
    : null;
}

/** The valid user ids in a list, each once, at most `TASK_PEOPLE_MAX`. */
function uuidList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((item) => uuidOrNull(item))
        .filter((item): item is string => item !== null),
    ),
  ].slice(0, TASK_PEOPLE_MAX);
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

/** Longer than any ISO 8601 instant, so a model's essay is not one. */
const INSTANT_MAX_LENGTH = 40;

function instantOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > INSTANT_MAX_LENGTH) {
    return null;
  }
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
    ...who(payload),
    due_date: dateOrNull(payload.due_date),
    due_at: instantOrNull(payload.due_at),
    subtasks: subtaskList(payload.subtasks),
    ...lastYearOn(payload.last_year_on),
  };
}

/** The fields that say who a suggested task is for. */
type TaskSuggestionWho = Pick<
  TaskSuggestionPayload,
  | 'assignee_id'
  | 'assignee_ids'
  | 'audience'
  | 'audience_role_id'
  | 'audience_group_id'
>;

const WHO_KEYS = [
  'assignee_id',
  'assignee_ids',
  'audience',
  'audience_role_id',
  'audience_group_id',
] as const;

const NOBODY: TaskSuggestionWho = {
  assignee_id: null,
  assignee_ids: null,
  audience: null,
  audience_role_id: null,
  audience_group_id: null,
};

/**
 * One answer to "who", read from whatever fields are set. A group wins over
 * people, and people over one person, as the wider ask: `audience` with a
 * role, else a group, else (for `someone`) the listed people, else the
 * chapter; then several people, a copy each; then one person.
 */
function who(input: Record<string, unknown>): TaskSuggestionWho {
  const audience = audienceOrNull(input.audience);
  const people = uuidList(input.assignee_ids);
  if (audience) {
    const roleId = uuidOrNull(input.audience_role_id);
    const groupId = roleId ? null : uuidOrNull(input.audience_group_id);
    const among =
      audience === TASK_AUDIENCE_SOMEONE && !roleId && !groupId ? people : [];
    // "Someone among" one person is that person's task.
    if (among.length === 1) return { ...NOBODY, assignee_id: among[0] };
    return {
      ...NOBODY,
      audience,
      audience_role_id: roleId,
      audience_group_id: groupId,
      assignee_ids: among.length > 1 ? among : null,
    };
  }
  if (people.length > 1) return { ...NOBODY, assignee_ids: people };
  return {
    ...NOBODY,
    assignee_id: people[0] ?? uuidOrNull(input.assignee_id),
  };
}

/** Whether a suggestion names anyone yet. */
function namesSomeone(task: TaskSuggestionWho): boolean {
  return !!(task.assignee_id || task.assignee_ids?.length || task.audience);
}

/** The target a group suggestion's fields name. */
function targetOf(task: TaskSuggestionWho): TaskAudienceTarget {
  if (task.audience_role_id) return { kind: 'role', id: task.audience_role_id };
  if (task.audience_group_id) {
    return { kind: 'group', id: task.audience_group_id };
  }
  if (task.assignee_ids?.length) {
    return { kind: 'people', userIds: task.assignee_ids };
  }
  return { kind: 'chapter' };
}

/** The key only when it holds a day, so other suggestions' payloads don't change. */
function lastYearOn(value: unknown): { last_year_on?: string } {
  const day = dateOrNull(value);
  return day ? { last_year_on: day } : {};
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

  constructor(
    private readonly tasks: TaskService,
    private readonly openTasks: OpenTaskService,
  ) {}

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
      ...who(input),
      due_date: dueDate,
      // A time needs its day; the task service checks they agree on accept.
      due_at: dueDate ? instantOrNull(input.due_at) : null,
      subtasks: subtaskList(input.subtasks),
      ...lastYearOn(input.last_year_on),
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
    // "Who?" holds one answer: an edit that sends any of its fields replaces
    // it with what those fields say, so picking a person clears a group and
    // picking a group clears the person. A build that sends only
    // `assignee_id` or only `audience` gets what it always did.
    if (WHO_KEYS.some(has)) {
      Object.assign(
        next,
        who(Object.fromEntries(WHO_KEYS.map((key) => [key, edits[key]]))),
      );
    }
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
    if (!namesSomeone(task)) {
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
    source?: { type: string; id: string };
  }): Promise<{ resultId: string }> {
    const task = readTaskPayload(input.payload);
    // `assertAcceptable` ran before the claim; these narrow the types.
    if (!namesSomeone(task) || !task.due_date) {
      throw new BadRequestException({
        code: 'ai.suggestion.incomplete',
        message: 'Pick who this task is for and when it is due.',
      });
    }
    // A task from minutes names them by id (#5562), so its screens read the
    // meeting's name as it is now.
    const meetingId = input.source?.type === 'meeting' ? input.source.id : null;
    // "Someone in…" posts one task up for grabs (2026-11-18); the result is
    // the posting's id.
    if (task.audience === TASK_AUDIENCE_SOMEONE) {
      const posting = await this.openTasks.create({
        chapter_id: input.chapterId,
        created_by: input.userId,
        title: task.title,
        description: task.description,
        due_date: task.due_date,
        due_at: task.due_at,
        subtasks: task.subtasks,
        point_reward: null,
        target: targetOf(task),
        ...(meetingId ? { meeting_id: meetingId } : {}),
      });
      return { resultId: posting.id };
    }
    const created = await this.tasks.create({
      chapter_id: input.chapterId,
      title: task.title,
      description: task.description,
      // A group suggestion makes the group task: a copy per member of it.
      // Every who-field is sent, as the task form sends them.
      ...(task.audience === TASK_AUDIENCE_EVERYONE
        ? {
            assignee_id: null,
            assignee_ids: null,
            audience: TASK_AUDIENCE_EVERYONE,
            audience_role_id: task.audience_role_id,
            audience_group_id: task.audience_group_id,
          }
        : {
            assignee_id: task.assignee_ids?.length ? null : task.assignee_id,
            assignee_ids: task.assignee_ids?.length ? task.assignee_ids : null,
            audience: null,
            audience_role_id: null,
            audience_group_id: null,
          }),
      created_by: input.userId,
      due_date: task.due_date,
      due_at: task.due_at,
      subtasks: task.subtasks,
      // Never points, and never a chat card (no `channel_id`).
      point_reward: null,
      ...(meetingId ? { meeting_id: meetingId } : {}),
    });
    return { resultId: created.id };
  }
}
