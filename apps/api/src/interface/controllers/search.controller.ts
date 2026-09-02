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
import { ThrottleExpensiveRead } from '../decorators/throttle-profiles.decorator';
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
  @ThrottleExpensiveRead()
  @ApiOperation({
    summary: 'Cross-domain search (backwork, events, members, messages)',
  })
  @ApiQuery({ name: 'q', required: true, description: 'Search query' })
  @ApiQuery({
    name: 'channelId',
    required: false,
    description:
      'Narrow the search to one chat channel. This is the single-channel form ' +
      'of search specified in spec/behavior/chat/README.md: only the `messages` ' +
      'source runs and `backwork`, `events` and `members` come back empty. The ' +
      'channel is still resolved through the caller’s accessible-channel set, ' +
      'so an unreadable or unknown id returns no matches rather than an error.',
  })
  async search(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Query('q') query: string,
    @Res({ passthrough: true }) res: Response,
    @Query('channelId') channelId?: string,
  ) {
    const { results, timedOut, timedOutSources } =
      await this.searchService.searchWithinBudget(
        chapterId,
        userId,
        query ?? '',
        channelId?.trim() || undefined,
      );
    if (timedOut) {
      res.setHeader('x-search-timeout', '1');
      // Which sections are incomplete, so a client can say "still searching
      // messages" instead of rendering an empty list as "no matches". The
      // boolean header stays for callers that already read it; the budget is
      // per-source now, so `1` means "at least one section is short", not
      // "everything came back empty".
      res.setHeader('x-search-timeout-sources', timedOutSources.join(','));
    }
    return results;
  }
}
