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

/**
 * Coerce the raw `channelId` query value to a single trimmed id, or `undefined`
 * for anything that is not one.
 *
 * `@Query()` hands back whatever `qs` parsed, which is **not** always a string:
 * `?channelId=a&channelId=b` yields an array and `?channelId[k]=v` an object,
 * and Nest's `ValidationPipe` does not coerce a `String` metatype. A bare
 * `.trim()` therefore threw `channelId.trim is not a function` and turned a
 * malformed read into a 500. Anything that is not a non-empty string is treated
 * as absent — the same chapter-wide search the parameter's omission gives —
 * rather than being rejected, because a duplicated query param is a client bug
 * that should degrade, not an attack that needs an error.
 */
function normalizeChannelId(raw: unknown): string | undefined {
  return typeof raw === 'string' ? raw.trim() || undefined : undefined;
}

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
    @Query('channelId') channelId?: unknown,
  ) {
    const { results, timedOut, timedOutSources } =
      await this.searchService.searchWithinBudget(
        chapterId,
        userId,
        query ?? '',
        normalizeChannelId(channelId),
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
