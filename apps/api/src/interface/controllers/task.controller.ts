import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { TaskService } from '../../application/services/task.service';
import { RbacService } from '../../application/services/rbac.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { RequireModule } from '../decorators/module.decorator';
import {
  FeatureEvent,
  type FeatureEventInput,
} from '../decorators/feature-event.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { clampListLimit } from '#domain/constants/list-query-limits';
import { parseBooleanQueryParam } from '../utils/query-boolean';
import {
  ListTasksQueryDto,
  CreateTaskDto,
  CreateTaskResponseDto,
  CreateTaskSubtaskDto,
  TaskSubtaskDto,
  UpdateTaskDto,
  UpdateTaskSubtaskDto,
  UpdateTaskStatusDto,
  RejectTaskCompletionDto,
} from '../dtos/task.dto';
import { SystemPermissions } from '#domain/constants/permissions';

@ApiTags('Tasks')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@RequireModule('tasks')
@Controller('tasks')
export class TaskController {
  constructor(
    private readonly taskService: TaskService,
    private readonly rbacService: RbacService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List tasks (own or all for admins)',
    description:
      'Newest first, by `created_at` then `id`. Send `limit` (and, for the next page, `before` and `before_id` from the last task received) to page; a page shorter than `limit` is the last. With neither, every task is returned, as before paging existed.',
  })
  async list(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Query() query: ListTasksQueryDto,
  ) {
    const isAdmin = await this.rbacService.memberHasAnyPermission(
      chapterId,
      userId,
      [SystemPermissions.TASKS_MANAGE],
    );
    const paged = query.limit !== undefined || query.before !== undefined;
    return this.taskService.list(chapterId, userId, isAdmin, {
      confirmed: parseBooleanQueryParam(query.confirmed),
      ...(query.before && query.before_id
        ? { after: { created_at: query.before, id: query.before_id } }
        : {}),
      ...(paged ? { limit: clampListLimit(query.limit) } : {}),
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get task by id' })
  async getOne(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    const task = await this.taskService.findById(id, chapterId);
    const isAdmin = await this.rbacService.memberHasAnyPermission(
      chapterId,
      userId,
      [SystemPermissions.TASKS_MANAGE],
    );
    if (task.assignee_id !== userId && !isAdmin) {
      throw new ForbiddenException('Access denied to this task');
    }
    return task;
  }

  @Post()
  @RequirePermissions(SystemPermissions.TASKS_MANAGE)
  @ApiOperation({ summary: 'Create a task' })
  @ApiCreatedResponse({ type: CreateTaskResponseDto })
  // The created row carries both the assignee and the creator (the acting
  // user), so self-assignment is a comparison of the two, not an id sent.
  @FeatureEvent(
    'task-created',
    ({
      body,
      result,
    }: FeatureEventInput<CreateTaskDto, CreateTaskResponseDto>) => ({
      assigned_to_self: result.assignee_id === result.created_by,
      has_due_time: !!result.due_at,
      has_subtasks: (body?.subtasks?.length ?? 0) > 0,
      has_point_reward: (result.point_reward ?? 0) > 0,
      posted_to_chat: result.card_posted === true,
    }),
  )
  async create(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') createdBy: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.taskService.create({
      chapter_id: chapterId,
      title: dto.title,
      description: dto.description ?? null,
      assignee_id: dto.assignee_id,
      created_by: createdBy,
      due_date: dto.due_date,
      due_at: dto.due_at ?? null,
      subtasks: dto.subtasks,
      point_reward: dto.point_reward ?? null,
      channel_id: dto.channel_id,
      client_message_id: dto.client_message_id,
    });
  }

  @Patch(':id')
  @RequirePermissions(SystemPermissions.TASKS_MANAGE)
  @ApiOperation({
    summary:
      'Edit a task: title, description, assignee, due date and time, points (#4296). Refused once confirmed.',
  })
  async update(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.taskService.update(id, chapterId, userId, dto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update task status (assignee or admin)' })
  // `as_admin` is not derivable here: the describer sees neither the acting
  // user nor the handler's `isAdmin`, and the result is the task alone.
  @FeatureEvent(
    'task-status-changed',
    ({ body }: FeatureEventInput<UpdateTaskStatusDto>) => ({
      status: body.status,
    }),
  )
  async updateStatus(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTaskStatusDto,
  ) {
    const isAdmin = await this.rbacService.memberHasAnyPermission(
      chapterId,
      userId,
      [SystemPermissions.TASKS_MANAGE],
    );
    return this.taskService.updateStatus(
      id,
      chapterId,
      userId,
      isAdmin,
      dto.status,
    );
  }

  @Post(':id/confirm')
  @RequirePermissions(SystemPermissions.TASKS_MANAGE)
  @ApiOperation({ summary: 'Confirm task completion and award points' })
  @FeatureEvent('task-completion-confirmed')
  async confirmCompletion(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.taskService.confirmCompletion(id, chapterId, userId);
  }

  @Post(':id/reject')
  @RequirePermissions(SystemPermissions.TASKS_MANAGE)
  @ApiOperation({ summary: 'Reject task completion (revert to IN_PROGRESS)' })
  @FeatureEvent('task-completion-rejected')
  async rejectCompletion(
    @CurrentChapterId() chapterId: string,
    @Param('id') id: string,
    @Body() dto: RejectTaskCompletionDto,
  ) {
    return this.taskService.rejectCompletion(
      id,
      chapterId,
      dto.comment ?? null,
    );
  }

  @Post(':id/subtasks')
  @RequirePermissions(SystemPermissions.TASKS_MANAGE)
  @ApiOperation({ summary: 'Add a subtask to the end of a task (#4003)' })
  @ApiCreatedResponse({ type: TaskSubtaskDto })
  async addSubtask(
    @CurrentChapterId() chapterId: string,
    @Param('id') id: string,
    @Body() dto: CreateTaskSubtaskDto,
  ): Promise<TaskSubtaskDto> {
    return this.taskService.addSubtask(id, chapterId, dto.title);
  }

  @Patch(':id/subtasks/:subtaskId')
  @ApiOperation({
    summary: 'Check off or uncheck a subtask (assignee or admin, #4003)',
  })
  @ApiOkResponse({ type: TaskSubtaskDto })
  async updateSubtask(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Param('subtaskId') subtaskId: string,
    @Body() dto: UpdateTaskSubtaskDto,
  ): Promise<TaskSubtaskDto> {
    const isAdmin = await this.rbacService.memberHasAnyPermission(
      chapterId,
      userId,
      [SystemPermissions.TASKS_MANAGE],
    );
    return this.taskService.setSubtaskDone(
      id,
      subtaskId,
      chapterId,
      userId,
      isAdmin,
      dto.done,
    );
  }

  @Delete(':id/subtasks/:subtaskId')
  @RequirePermissions(SystemPermissions.TASKS_MANAGE)
  @ApiOperation({ summary: 'Remove a subtask (#4003)' })
  async deleteSubtask(
    @CurrentChapterId() chapterId: string,
    @Param('id') id: string,
    @Param('subtaskId') subtaskId: string,
  ) {
    await this.taskService.deleteSubtask(id, subtaskId, chapterId);
    return { success: true };
  }

  @Delete(':id')
  @RequirePermissions(SystemPermissions.TASKS_MANAGE)
  @ApiOperation({ summary: 'Delete a task' })
  async delete(@CurrentChapterId() chapterId: string, @Param('id') id: string) {
    await this.taskService.delete(id, chapterId);
    return { success: true };
  }
}
