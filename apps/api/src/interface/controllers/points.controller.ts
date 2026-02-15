import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { PointsService } from '../../application/services/points.service';
import { UserService } from '../../application/services/user.service';
import { AdjustPointsDto } from '../dtos/point.dto';
import { ClerkAuthGuard } from '../guards/clerk-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import type { RequestWithUser } from '../auth.types';

@ApiTags('points')
@Controller('points')
@UseGuards(ClerkAuthGuard, ChapterGuard)
@ApiBearerAuth()
@ApiHeader({ name: 'x-chapter-id', required: true })
export class PointsController {
  constructor(
    private readonly pointsService: PointsService,
    private readonly userService: UserService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user point balance and history' })
  async getMyPoints(@Req() req: RequestWithUser) {
    const clerkId = req.user.sub;
    const user = await this.userService.findByClerkId(clerkId);

    const balance = await this.pointsService.getBalance(user.id);
    const history = await this.pointsService.getTransactionHistory(user.id);

    return {
      balance,
      history,
    };
  }

  @Get('leaderboard')
  @ApiOperation({ summary: 'Get chapter leaderboard' })
  async getLeaderboard(
    @Req() req: RequestWithUser,
    @Query('limit') limit?: number,
  ) {
    const chapterId = req.headers['x-chapter-id'] as string;
    return this.pointsService.getLeaderboard(chapterId, limit);
  }

  @Post('adjust')
  @ApiOperation({ summary: 'Manually adjust points (Admin Only - TODO: RBAC)' })
  async adjustPoints(
    @Req() req: RequestWithUser,
    @Body() dto: AdjustPointsDto,
  ) {
    const chapterId = req.headers['x-chapter-id'] as string;
    // TODO: Verify that req.user has Admin role in this chapter

    return this.pointsService.awardPoints(
      dto.userId,
      chapterId,
      dto.amount,
      dto.category,
      dto.description,
      dto.metadata,
    );
  }
}
