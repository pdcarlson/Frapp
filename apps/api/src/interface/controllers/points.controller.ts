import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PointsService,
  PointsWindow,
} from '../../application/services/points.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { AdjustPointsDto, PointsWindowQueryDto } from '../dtos/points.dto';
import { SystemPermissions } from '../../domain/constants/permissions';

@ApiTags('Points')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard)
@Controller('points')
export class PointsController {
  constructor(private readonly pointsService: PointsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user point summary' })
  async getMe(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Query() query: PointsWindowQueryDto,
  ) {
    const window: PointsWindow = query.window ?? 'all';
    return this.pointsService.getUserSummary(chapterId, userId, window);
  }

  @Get('leaderboard')
  @ApiOperation({ summary: 'Get chapter leaderboard' })
  async getLeaderboard(
    @CurrentChapterId() chapterId: string,
    @Query() query: PointsWindowQueryDto,
  ) {
    const window: PointsWindow = query.window ?? 'all';
    return this.pointsService.getLeaderboard(chapterId, window);
  }

  @Get('members/:userId')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.POINTS_VIEW_ALL)
  @ApiOperation({ summary: 'Get point summary for a member' })
  async getMember(
    @CurrentChapterId() chapterId: string,
    @Param('userId') userId: string,
    @Query() query: PointsWindowQueryDto,
  ) {
    const window: PointsWindow = query.window ?? 'all';
    return this.pointsService.getUserSummary(chapterId, userId, window);
  }

  @Post('adjust')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.POINTS_ADJUST)
  @ApiOperation({ summary: 'Manually adjust member points' })
  async adjust(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') adminId: string,
    @Body() dto: AdjustPointsDto,
  ) {
    return this.pointsService.adjustPoints({
      chapterId,
      targetUserId: dto.target_user_id,
      adminUserId: adminId,
      amount: dto.amount,
      category: dto.category,
      reason: dto.reason,
    });
  }
}
