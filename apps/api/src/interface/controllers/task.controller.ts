import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
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
import {
  CreateTaskDto,
  CreateTaskResponseDto,
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
  @ApiOperation({ summary: 'List tasks (own or all for admins)' })
  async list(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    const isAdmin = await this.rbacService.memberHasAnyPermission(
      chapterId,
      userId,
      [SystemPermissions.TASKS_MANAGE],
    );
    return this.taskService.list(chapterId, userId, isAdmin);
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
    ({ result }: FeatureEventInput<CreateTaskDto, CreateTaskResponseDto>) => ({
      assigned_to_self: result.assignee_id === result.created_by,
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
      point_reward: dto.point_reward ?? null,
      channel_id: dto.channel_id,
      client_message_id: dto.client_message_id,
    });
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

  @Delete(':id')
  @RequirePermissions(SystemPermissions.TASKS_MANAGE)
  @ApiOperation({ summary: 'Delete a task' })
  async delete(@CurrentChapterId() chapterId: string, @Param('id') id: string) {
    await this.taskService.delete(id, chapterId);
    return { success: true };
  }
}
