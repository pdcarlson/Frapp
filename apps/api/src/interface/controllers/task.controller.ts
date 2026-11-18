import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  InternalServerErrorException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { TaskService } from '../../application/services/task.service';
import { TaskSeriesService } from '../../application/services/task-series.service';
import { RbacService } from '../../application/services/rbac.service';
import { OpenTaskService } from '../../application/services/open-task.service';
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
import {
  ListTasksQueryDto,
  CreateTaskDto,
  CreateTaskResponseDto,
  CreateTaskSubtaskDto,
  DeleteTaskQueryDto,
  TaskGroupSummaryDto,
  TaskSeriesSummaryDto,
  TaskSubtaskDto,
  UpdateTaskDto,
  UpdateTaskSubtaskDto,
  UpdateTaskStatusDto,
  RejectTaskCompletionDto,
  RequestTaskPhotoUploadUrlDto,
  TaskPhotoUploadUrlResponseDto,
  TaskPhotoUrlResponseDto,
} from '../dtos/task.dto';
import { OpenTaskDto } from '../dtos/open-task.dto';
import { ThrottleFanOutWrite } from '../decorators/throttle-profiles.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import { VerifySessionLocally } from '../decorators/session-check.decorator';

@ApiTags('Tasks')
@ApiBearerAuth()
// Task reads declare no response schema; the clients type a task's `series`
// summary (#5119) and `group` summary (#4295 step 3) from these.
@ApiExtraModels(TaskSeriesSummaryDto, TaskGroupSummaryDto)
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@RequireModule('tasks')
@Controller('tasks')
export class TaskController {
  constructor(
    private readonly taskService: TaskService,
    private readonly taskSeriesService: TaskSeriesService,
    private readonly rbacService: RbacService,
    private readonly openTaskService: OpenTaskService,
  ) {}

  @Get()
  @VerifySessionLocally()
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
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.readableTask(chapterId, userId, id);
  }

  /** The task, for its assignee or a `tasks:manage` holder; 403 otherwise. */
  private async readableTask(chapterId: string, userId: string, id: string) {
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

  @Post('photo-upload-url')
  @ThrottleFanOutWrite()
  @ApiOperation({
    summary:
      'Get a signed upload URL for a task photo: a reference photo or a proof photo (#4565)',
    description:
      'PUT the photo to `upload_url`, then send `storage_path` in `reference_photo_paths` on create or edit, or in `proof_photo_paths` with Mark done. JPEG, PNG, GIF or WebP, up to 25 MB.',
  })
  @ApiCreatedResponse({ type: TaskPhotoUploadUrlResponseDto })
  async requestPhotoUploadUrl(
    @CurrentChapterId() chapterId: string,
    @Body() dto: RequestTaskPhotoUploadUrlDto,
  ): Promise<TaskPhotoUploadUrlResponseDto> {
    const ticket = await this.taskService.requestPhotoUploadUrl({
      chapterId,
      filename: dto.filename,
      contentType: dto.content_type,
      sizeBytes: dto.size_bytes,
    });
    if (!ticket.signedUrl || !ticket.storagePath) {
      throw new InternalServerErrorException(
        'Storage did not return a signed upload URL or storage path.',
      );
    }
    return { upload_url: ticket.signedUrl, storage_path: ticket.storagePath };
  }

  @Get(':id/photos/:photoId/url')
  @ApiOperation({
    summary:
      "A short-lived link to one of a task's photos (assignee or tasks:manage, #4635)",
  })
  @ApiOkResponse({ type: TaskPhotoUrlResponseDto })
  async getPhotoUrl(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', new ParseUUIDPipe()) photoId: string,
  ): Promise<TaskPhotoUrlResponseDto> {
    const task = await this.readableTask(chapterId, userId, id);
    return this.taskService.getPhotoDownloadUrl(task.id, chapterId, photoId);
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
      assigned_to_self:
        !result.group && result.assignee_id === result.created_by,
      audience: result.group?.audience ?? 'person',
      group_size: result.group?.total ?? 1,
      has_due_time: !!result.due_at,
      has_subtasks: (body?.subtasks?.length ?? 0) > 0,
      has_point_reward: (result.point_reward ?? 0) > 0,
      has_reference_photo: (result.photos?.length ?? 0) > 0,
      proof_kind: result.proof_kind,
      posted_to_chat: result.card_posted === true,
      repeats: !!result.series_id,
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
      assignee_id: dto.assignee_id ?? null,
      assignee_ids: dto.assignee_ids ?? null,
      audience: dto.audience ?? null,
      audience_role_id: dto.audience_role_id ?? null,
      audience_group_id: dto.audience_group_id ?? null,
      created_by: createdBy,
      due_date: dto.due_date,
      due_at: dto.due_at ?? null,
      subtasks: dto.subtasks,
      point_reward: dto.point_reward ?? null,
      reference_photo_paths: dto.reference_photo_paths,
      proof_kind: dto.proof_kind,
      recurrence_rule: dto.recurrence_rule,
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
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    const { scope, recurrence_rule, ...edit } = dto;
    if (scope === 'group') {
      if (recurrence_rule !== undefined) {
        throw new BadRequestException(
          'A repeat rule changes only with scope "series"',
        );
      }
      return this.taskService.updateGroup(id, chapterId, userId, edit);
    }
    if (scope === 'series') {
      return this.taskSeriesService.update(id, chapterId, userId, {
        ...edit,
        recurrence_rule,
      });
    }
    if (recurrence_rule !== undefined) {
      throw new BadRequestException(
        'A repeat rule changes only with scope "series"',
      );
    }
    return this.taskService.update(id, chapterId, userId, edit);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update task status (assignee or admin)' })
  // `as_admin` is not derivable here: the describer sees neither the acting
  // user nor the handler's `isAdmin`, and the result is the task alone.
  @FeatureEvent(
    'task-status-changed',
    ({ body }: FeatureEventInput<UpdateTaskStatusDto>) => ({
      status: body.status,
      has_proof_photo: (body.proof_photo_paths?.length ?? 0) > 0,
      has_proof_link: !!body.proof_link,
      has_completion_note: !!body.completion_note,
    }),
  )
  async updateStatus(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
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
      {
        proof_photo_paths: dto.proof_photo_paths,
        proof_link: dto.proof_link,
        completion_note: dto.completion_note,
      },
    );
  }

  @Post(':id/confirm')
  @RequirePermissions(SystemPermissions.TASKS_MANAGE)
  @ApiOperation({ summary: 'Confirm task completion and award points' })
  @FeatureEvent('task-completion-confirmed')
  async confirmCompletion(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.taskService.confirmCompletion(id, chapterId, userId);
  }

  @Post(':id/reject')
  @RequirePermissions(SystemPermissions.TASKS_MANAGE)
  @ApiOperation({ summary: 'Reject task completion (revert to IN_PROGRESS)' })
  @FeatureEvent(
    'task-completion-rejected',
    ({ body }: FeatureEventInput<RejectTaskCompletionDto>) => ({
      asked_for_photo: body.require_photo === true,
    }),
  )
  async rejectCompletion(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectTaskCompletionDto,
  ) {
    return this.taskService.rejectCompletion(id, chapterId, dto.comment, {
      requirePhoto: dto.require_photo,
      actorUserId: userId,
    });
  }

  @Post(':id/release')
  @ApiOperation({
    summary: 'Give back a task claimed from Up for grabs',
    description:
      'Its assignee only (403 otherwise), before it is finished: marked done, paid or carrying proof is a 409. The task is deleted and its posting is open again; answers the posting. 404 for a task not taken from Up for grabs.',
  })
  @ApiCreatedResponse({ type: OpenTaskDto })
  async release(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OpenTaskDto> {
    return this.openTaskService.release(chapterId, id, userId);
  }

  @Post(':id/subtasks')
  @RequirePermissions(SystemPermissions.TASKS_MANAGE)
  @ApiOperation({ summary: 'Add a subtask to the end of a task (#4003)' })
  @ApiCreatedResponse({ type: TaskSubtaskDto })
  async addSubtask(
    @CurrentChapterId() chapterId: string,
    @Param('id', ParseUUIDPipe) id: string,
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
    @Param('id', ParseUUIDPipe) id: string,
    @Param('subtaskId', ParseUUIDPipe) subtaskId: string,
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
    @Param('id', ParseUUIDPipe) id: string,
    @Param('subtaskId', ParseUUIDPipe) subtaskId: string,
  ) {
    await this.taskService.deleteSubtask(id, subtaskId, chapterId);
    return { success: true };
  }

  @Delete(':id')
  @RequirePermissions(SystemPermissions.TASKS_MANAGE)
  @ApiOperation({
    summary:
      'Delete a task; with `scope=series`, stop a repeating task (#5119); with `scope=group`, delete everyone’s copy (#4295 step 3)',
  })
  async delete(
    @CurrentChapterId() chapterId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DeleteTaskQueryDto,
  ) {
    if (query.scope === 'series') {
      await this.taskSeriesService.delete(id, chapterId);
      return { success: true };
    }
    if (query.scope === 'group') {
      await this.taskService.deleteGroup(id, chapterId);
      return { success: true };
    }
    await this.taskService.delete(id, chapterId);
    return { success: true };
  }
}
