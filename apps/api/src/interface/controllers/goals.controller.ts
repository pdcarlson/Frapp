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
} from '../dtos/goals.dto';

// Goals live beside the rules on each module's settings page, so they share
// that page's gates: reading them is `chapter-config:view`, changing them is
// `chapter-config:manage`. A member reads only their own goal, inside
// `GET /v1/activity/standing`.
@ApiTags('Goals')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.CHAPTER_CONFIG_VIEW)
@Controller('goals')
export class GoalsController {
  constructor(private readonly goalService: ChapterGoalService) {}

  @Get()
  @ApiOperation({
    summary: "The chapter's goals for points, service hours and study hours",
  })
  @ApiOkResponse({ type: ChapterGoalsDto })
  async getGoals(@CurrentChapterId() chapterId: string): Promise<ChapterGoals> {
    return this.goalService.getGoals(chapterId);
  }

  @Put(':metric')
  @RequirePermissions(SystemPermissions.CHAPTER_CONFIG_MANAGE)
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
