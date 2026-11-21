import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { OpenTaskService } from '../../application/services/open-task.service';
import type { TaskAudienceTarget } from '../../application/services/task-audience.service';
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
  AssignOpenTaskDto,
  CreateOpenTaskDto,
  OpenTaskDto,
  UpdateOpenTaskDto,
} from '../dtos/open-task.dto';
import { SystemPermissions } from '#domain/constants/permissions';

/** Who may claim a new posting, from the body's scope fields. */
function targetOf(dto: CreateOpenTaskDto): TaskAudienceTarget {
  const given = [dto.role_id, dto.group_id, dto.tier_id, dto.user_ids].filter(
    (value) => value != null,
  );
  if (given.length > 1) {
    throw new BadRequestException(
      'Send at most one of role_id, group_id, tier_id and user_ids',
    );
  }
  if (dto.role_id) return { kind: 'role', id: dto.role_id };
  if (dto.group_id) return { kind: 'group', id: dto.group_id };
  if (dto.tier_id) return { kind: 'tier', id: dto.tier_id };
  if (dto.user_ids) return { kind: 'people', userIds: dto.user_ids };
  return { kind: 'chapter' };
}

/**
 * Tasks up for grabs (Paul, 2026-11-18; `spec/behavior/tasks.md` § Up for
 * grabs). Reading and claiming need `members:view`, as reading your own
 * tasks does; posting, editing, deleting and handing one to someone need
 * `tasks:manage`, as creating a task does. Giving a claimed task back is
 * `POST /v1/tasks/:id/release`.
 */
@ApiTags('Tasks')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@RequireModule('tasks')
@Controller('open-tasks')
export class OpenTaskController {
  constructor(
    private readonly openTasks: OpenTaskService,
    private readonly rbacService: RbacService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List tasks up for grabs',
    description:
      'The open postings the caller may claim now, oldest due first. A `tasks:manage` holder gets every open posting, with `viewer_can_claim` saying which they may claim themselves.',
  })
  @ApiOkResponse({ type: [OpenTaskDto] })
  async list(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<OpenTaskDto[]> {
    const isManager = await this.rbacService.memberHasAnyPermission(
      chapterId,
      userId,
      [SystemPermissions.TASKS_MANAGE],
    );
    return this.openTasks.list(chapterId, userId, isManager);
  }

  @Post()
  @RequirePermissions(SystemPermissions.TASKS_MANAGE)
  @ApiOperation({
    summary: 'Post a task up for grabs',
    description:
      'One task that someone in the chapter, a role, a chapter group or a list of people claims. Everyone who may claim it, but the poster, gets a push ("Up for grabs: …") in the Tasks category.',
  })
  @ApiCreatedResponse({ type: OpenTaskDto })
  @FeatureEvent(
    'open-task-created',
    ({ result }: FeatureEventInput<CreateOpenTaskDto, OpenTaskDto>) => ({
      scope: result.scope,
      eligible_count: result.eligible_count,
      has_due_time: !!result.due_at,
      has_point_reward: (result.point_reward ?? 0) > 0,
      has_subtasks: result.subtask_titles.length > 0,
      proof_kind: result.proof_kind,
    }),
  )
  async create(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateOpenTaskDto,
  ): Promise<OpenTaskDto> {
    return this.openTasks.create({
      chapter_id: chapterId,
      created_by: userId,
      title: dto.title,
      description: dto.description ?? null,
      due_date: dto.due_date,
      due_at: dto.due_at ?? null,
      point_reward: dto.point_reward ?? null,
      proof_kind: dto.proof_kind,
      subtasks: dto.subtasks,
      target: targetOf(dto),
    });
  }

  @Patch(':id')
  @RequirePermissions(SystemPermissions.TASKS_MANAGE)
  @ApiOperation({
    summary: 'Edit a task up for grabs while it is open (409 once claimed)',
  })
  @ApiOkResponse({ type: OpenTaskDto })
  async update(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOpenTaskDto,
  ): Promise<OpenTaskDto> {
    return this.openTasks.update(chapterId, id, userId, dto);
  }

  @Delete(':id')
  @RequirePermissions(SystemPermissions.TASKS_MANAGE)
  @ApiOperation({
    summary: 'Delete a task up for grabs while it is open (409 once claimed)',
  })
  async delete(
    @CurrentChapterId() chapterId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.openTasks.delete(chapterId, id);
    return { success: true };
  }

  @Post(':id/claim')
  @ApiOperation({
    summary: 'Claim a task up for grabs',
    description:
      'The caller takes it, when they may claim it now (403 otherwise). Answers the new task as `GET /v1/tasks/:id` reads it, with `open_task_id` set. 409 "Someone already claimed this" when another claim got there first. The poster is told, unless they claimed it.',
  })
  @FeatureEvent('open-task-claimed', () => ({ assigned_by_officer: false }))
  async claim(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.openTasks.claim(chapterId, id, userId);
  }

  @Post(':id/assign')
  @RequirePermissions(SystemPermissions.TASKS_MANAGE)
  @ApiOperation({
    summary: 'Hand a task up for grabs to one member',
    description:
      'Any active member, whether or not they could claim it. They get the usual assignment push. Answers the new task as `GET /v1/tasks/:id` reads it; 409 once someone has claimed it.',
  })
  @FeatureEvent('open-task-claimed', () => ({ assigned_by_officer: true }))
  async assign(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignOpenTaskDto,
  ) {
    return this.openTasks.assign(chapterId, id, userId, dto.assignee_id);
  }
}
