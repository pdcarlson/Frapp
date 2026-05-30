import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { SearchService } from '../../application/services/search.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { FreeTier } from '../decorators/subscription.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '../../domain/constants/permissions';

@ApiTags('Search')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@FreeTier()
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Cross-domain search (backwork, events, members, messages)',
  })
  @ApiQuery({ name: 'q', required: true, description: 'Search query' })
  async search(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Query('q') query: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { results, timedOut } = await this.searchService.searchWithinBudget(
      chapterId,
      userId,
      query ?? '',
    );
    if (timedOut) {
      res.setHeader('x-search-timeout', '1');
    }
    return results;
  }
}
