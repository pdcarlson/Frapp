import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ChapterGoalService } from '../../application/services/chapter-goal.service';
import type { ChapterGoals } from '../../application/services/chapter-goal.service';
import type { GoalSet } from '#domain/entities/chapter-goal.entity';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  ChapterGoalsDto,
  GoalMetricParamDto,
  GoalSetDto,
  MyGoalsDto,
} from '../dtos/goals.dto';

// Goals live beside the rules on each module's settings page, so they share
// that page's gates: reading them all is `chapter-config:view`, changing them
// is `chapter-config:manage`. A member reads only their own goal: in
// `GET /v1/activity/standing`, or alone at `GET /v1/goals/mine`.
@ApiTags('Goals')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@Controller('goals')
export class GoalsController {
  constructor(private readonly goalService: ChapterGoalService) {}

  @Get()
  @RequirePermissions(SystemPermissions.CHAPTER_CONFIG_VIEW)
  @ApiOperation({
    summary: "The chapter's goals for points, service hours and study hours",
  })
  @ApiOkResponse({ type: ChapterGoalsDto })
  async getGoals(@CurrentChapterId() chapterId: string): Promise<ChapterGoals> {
    return this.goalService.getGoals(chapterId);
  }

  @Get('mine')
  @RequirePermissions(SystemPermissions.MEMBERS_VIEW)
  @ApiOperation({
    summary:
      "The caller's own goal on each measure (points, service and study minutes), null where none",
  })
  @ApiOkResponse({ type: MyGoalsDto })
  async getMyGoals(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<MyGoalsDto> {
    return this.goalService.goalsForUser(chapterId, userId);
  }

  @Put(':metric')
  @RequirePermissions(
    SystemPermissions.CHAPTER_CONFIG_VIEW,
    SystemPermissions.CHAPTER_CONFIG_MANAGE,
  )
  @ApiOperation({ summary: "Replace one measure's goals" })
  @ApiOkResponse({ type: GoalSetDto })
  @ApiBadRequestResponse({
    description:
      'A target out of range, a role named twice, or a role not in this chapter.',
  })
  async setGoals(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param() params: GoalMetricParamDto,
    @Body() body: GoalSetDto,
  ): Promise<GoalSet> {
    return this.goalService.setGoals(chapterId, params.metric, body, userId);
  }
}
