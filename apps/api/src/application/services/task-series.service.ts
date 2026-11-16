import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TASK_REPOSITORY } from '#domain/repositories/task.repository.interface';
import type { ITaskRepository } from '#domain/repositories/task.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import {
  TaskStatus,
  type Task,
  type TaskSeries,
  type TaskView,
} from '#domain/entities/task.entity';
import { nextTaskRepeatDate, type TaskRepeatRule } from '@repo/validation';
import { TaskService, type UpdateTaskInput } from './task.service';
import {
  copyDueInstant,
  readTaskRule,
  seriesDueTime,
} from './task-series-schedule';

/** An edit of "All upcoming tasks" (#5119): a task edit plus the rule. */
export interface UpdateTaskSeriesInput extends UpdateTaskInput {
  /** A new rule, or null to end the series. Omitted leaves it. */
  recurrence_rule?: string | null;
}

/** What deleting "All upcoming tasks" did (#5119). */
export interface DeleteTaskSeriesResult {
  /** The series' open copy, when it was untouched and so deleted. */
  deleted_task_id: string | null;
}

/**
 * The "All upcoming tasks" scope of a repeating task's edit and delete
 * (#5119; spec/behavior/tasks.md § Repeating tasks). "This task only" is an
 * ordinary task edit or delete, through `TaskService`.
 *
 * A series' **open copy** is its latest one: the copy still to come, which
 * the sweep made when the copy before it fell due. "All upcoming tasks"
 * changes the template the next copies are made from and that open copy,
 * unless it is already marked done. Earlier copies, done or overdue, are a
 * record and never change through the series.
 */
@Injectable()
export class TaskSeriesService {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepo: ITaskRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    private readonly taskService: TaskService,
  ) {}

  /**
   * Edit a copy's series: the template, the rule, and the open copy.
   *
   * - A new rule counts from the open copy's day, so its `COUNT` includes
   *   that copy; `null` ends the series after it.
   * - A new rule or time of day re-steps the next copy's day and moment.
   * - The open copy takes the edit as a task edit does (a new assignee
   *   starts it over, a moved due releases its reminders), unless it is
   *   marked done. Its day moves only when it is the task being edited and
   *   `due_date` is sent.
   * - Reference photos aren't part of a series; sent here they go on the
   *   edited task alone, when it is the open copy.
   */
  async update(
    taskId: string,
    chapterId: string,
    actorId: string,
    input: UpdateTaskSeriesInput,
  ): Promise<TaskView> {
    const { task, series } = await this.liveSeriesOf(taskId, chapterId);
    const oldRule = this.ruleOf(series);
    const open = await this.taskRepo.findLatestSeriesCopy(chapterId, series.id);

    const patch: Partial<TaskSeries> = {};
    if (input.title !== undefined) {
      const title = input.title?.trim();
      if (!title) throw new BadRequestException('A task needs a title');
      if (title !== series.title) patch.title = title;
    }
    if (input.description !== undefined) {
      const description = input.description?.trim() || null;
      if (description !== series.description) patch.description = description;
    }
    if (input.point_reward !== undefined) {
      const reward = input.point_reward || null;
      if (reward !== series.point_reward) patch.point_reward = reward;
    }
    if (
      input.proof_kind !== undefined &&
      input.proof_kind !== series.proof_kind
    ) {
      patch.proof_kind = input.proof_kind;
    }
    if (
      input.assignee_id !== undefined &&
      input.assignee_id !== series.assignee_id
    ) {
      if (!input.assignee_id) {
        throw new BadRequestException('A task needs an assignee');
      }
      const member = await this.memberRepo.findByUserAndChapter(
        input.assignee_id,
        chapterId,
      );
      if (!member) {
        throw new BadRequestException(
          'Assignee must be a member of the chapter',
        );
      }
      patch.assignee_id = input.assignee_id;
    }

    let rule: TaskRepeatRule = oldRule;
    let ending = false;
    if (input.recurrence_rule === null) {
      ending = true;
    } else if (
      input.recurrence_rule !== undefined &&
      input.recurrence_rule !== series.recurrence_rule
    ) {
      const parsed = readTaskRule(input.recurrence_rule);
      if (!parsed) {
        throw new BadRequestException("That repeat rule can't be read");
      }
      rule = parsed;
      patch.recurrence_rule = input.recurrence_rule;
    }

    let dueTime = series.due_time;
    if (input.due_at !== undefined) {
      dueTime = seriesDueTime(input.due_at, rule);
      if (dueTime !== series.due_time) patch.due_time = dueTime;
    }

    // The open copy's day: where a new rule counts from and the next copy is
    // stepped from.
    const openDay = (
      open?.occurrence_date ??
      open?.due_date ??
      series.next_due_date
    ).slice(0, 10);
    if (ending) {
      patch.ended_at = new Date().toISOString();
    } else if ('recurrence_rule' in patch || 'due_time' in patch) {
      const first =
        'recurrence_rule' in patch
          ? openDay
          : series.first_due_date.slice(0, 10);
      if ('recurrence_rule' in patch) patch.first_due_date = first;
      const next = nextTaskRepeatDate(rule, first, openDay);
      if (next) {
        patch.next_due_date = next;
        patch.latest_due_at = copyDueInstant(
          openDay,
          dueTime,
          rule,
        ).toISOString();
      } else {
        // The new rule's end leaves nothing after the open copy.
        patch.ended_at = new Date().toISOString();
      }
    }

    if (Object.keys(patch).length > 0) {
      const written = await this.taskRepo.updateSeriesIfNext(
        chapterId,
        series.id,
        series.next_due_date,
        patch,
      );
      if (!written) {
        throw new ConflictException(
          'This task repeated while you were editing it. Open it again and retry',
        );
      }
    }

    const editedIsOpen = open?.id === task.id;
    if (open && this.isOpenForEdit(open)) {
      const copyInput: UpdateTaskInput = {
        title: input.title,
        description: input.description,
        assignee_id: input.assignee_id,
        point_reward: input.point_reward,
        proof_kind: input.proof_kind,
      };
      if (editedIsOpen && input.due_date !== undefined) {
        copyInput.due_date = input.due_date;
        copyInput.due_at = input.due_at;
      } else if ('due_time' in patch) {
        copyInput.due_date = open.due_date;
        copyInput.due_at = dueTime
          ? copyDueInstant(
              open.due_date.slice(0, 10),
              dueTime,
              rule,
            ).toISOString()
          : null;
      }
      if (editedIsOpen && input.reference_photo_paths !== undefined) {
        copyInput.reference_photo_paths = input.reference_photo_paths;
      }
      const updated = await this.taskService.update(
        open.id,
        chapterId,
        actorId,
        copyInput,
      );
      if (editedIsOpen) return updated;
    }
    return this.taskService.findById(task.id, chapterId);
  }

  /**
   * Delete "All upcoming tasks": end the series, and delete its open copy
   * when no one has started it (to do, no proof, no step checked). Every
   * other copy stays, done or not. A series already ended is only the
   * second half.
   */
  async delete(
    taskId: string,
    chapterId: string,
    attempt = 0,
  ): Promise<DeleteTaskSeriesResult> {
    const task = await this.taskRepo.findById(taskId, chapterId);
    if (!task) throw new NotFoundException('Task not found');
    if (!task.series_id) {
      throw new BadRequestException("This task doesn't repeat");
    }
    const [series] = await this.taskRepo.findSeries(chapterId, [
      task.series_id,
    ]);
    if (series && series.ended_at === null) {
      const ended = await this.taskRepo.updateSeriesIfNext(
        chapterId,
        series.id,
        series.next_due_date,
        { ended_at: new Date().toISOString() },
      );
      if (!ended) {
        // The sweep made a copy between the read and the write: read the
        // series again and end it from there.
        if (attempt >= 2) {
          throw new ConflictException(
            'This task repeated while you were deleting it. Try again',
          );
        }
        return this.delete(taskId, chapterId, attempt + 1);
      }
    }

    const open = await this.taskRepo.findLatestSeriesCopy(
      chapterId,
      task.series_id,
    );
    if (!open || !(await this.isUntouched(chapterId, open))) {
      return { deleted_task_id: null };
    }
    await this.taskService.delete(open.id, chapterId);
    return { deleted_task_id: open.id };
  }

  /** The task and its series, refusing a task that doesn't repeat now. */
  private async liveSeriesOf(
    taskId: string,
    chapterId: string,
  ): Promise<{ task: Task; series: TaskSeries }> {
    const task = await this.taskRepo.findById(taskId, chapterId);
    if (!task) throw new NotFoundException('Task not found');
    if (!task.series_id) {
      throw new BadRequestException("This task doesn't repeat");
    }
    const [series] = await this.taskRepo.findSeries(chapterId, [
      task.series_id,
    ]);
    if (!series || series.ended_at !== null) {
      throw new BadRequestException(
        'This task has stopped repeating, so only this task can change',
      );
    }
    return { task, series };
  }

  private ruleOf(series: TaskSeries): TaskRepeatRule {
    const rule = readTaskRule(series.recurrence_rule);
    if (!rule) {
      // Every stored rule was checked on write; this is a corrupt row.
      throw new BadRequestException("This task's repeat rule can't be read");
    }
    return rule;
  }

  /** "All upcoming tasks" reaches the open copy until it is marked done. */
  private isOpenForEdit(copy: Task): boolean {
    return copy.status !== TaskStatus.COMPLETED && !copy.points_awarded;
  }

  private async isUntouched(chapterId: string, copy: Task): Promise<boolean> {
    if (
      copy.status !== TaskStatus.TODO ||
      copy.completed_at !== null ||
      copy.points_awarded ||
      copy.proof_link !== null
    ) {
      return false;
    }
    const [photos, checked] = await Promise.all([
      this.taskRepo.findPhotos(chapterId, [copy.id]),
      this.taskRepo.hasCheckedSubtask(chapterId, copy.id),
    ]);
    return !checked && !photos.some((photo) => photo.kind === 'proof');
  }
}
