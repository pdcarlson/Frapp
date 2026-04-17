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
import {
  AdjustPointsDto,
  ListPointTransactionsQueryDto,
  PointsWindowQueryDto,
} from '../dtos/points.dto';
import { SystemPermissions } from '../../domain/constants/permissions';

@ApiTags('Points')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
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

  @Get('transactions')
  @RequirePermissions(SystemPermissions.POINTS_VIEW_ALL)
  @ApiOperation({
    summary: 'List chapter-wide point transactions',
    description:
      'Backs the Points admin Audit tab. Filter by user, category, flagged state; paginate via a cursor (`before` ISO8601). Returns newest-first, capped at `limit` (default 50, max 200).',
  })
  async listTransactions(
    @CurrentChapterId() chapterId: string,
    @Query() query: ListPointTransactionsQueryDto,
  ) {
    return this.pointsService.listTransactions(chapterId, {
      userId: query.user_id,
      category: query.category,
      flagged:
        query.flagged === undefined ? undefined : query.flagged === 'true',
      before: query.before,
      limit: query.limit,
    });
  }

  @Get('members/:userId')
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
