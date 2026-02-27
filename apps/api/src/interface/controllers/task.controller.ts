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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TaskService } from '../../application/services/task.service';
import { RbacService } from '../../application/services/rbac.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import {
  CreateTaskDto,
  UpdateTaskStatusDto,
  RejectTaskCompletionDto,
} from '../dtos/task.dto';
import { SystemPermissions } from '../../domain/constants/permissions';

@ApiTags('Tasks')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard)
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
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.TASKS_MANAGE)
  @ApiOperation({ summary: 'Create a task' })
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
    });
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update task status (assignee or admin)' })
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
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.TASKS_MANAGE)
  @ApiOperation({ summary: 'Confirm task completion and award points' })
  async confirmCompletion(
    @CurrentChapterId() chapterId: string,
    @Param('id') id: string,
  ) {
    return this.taskService.confirmCompletion(id, chapterId);
  }

  @Post(':id/reject')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.TASKS_MANAGE)
  @ApiOperation({ summary: 'Reject task completion (revert to IN_PROGRESS)' })
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
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.TASKS_MANAGE)
  @ApiOperation({ summary: 'Delete a task' })
  async delete(@CurrentChapterId() chapterId: string, @Param('id') id: string) {
    await this.taskService.delete(id, chapterId);
    return { success: true };
  }
}
