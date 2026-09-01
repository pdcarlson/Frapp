import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ActivityFeedService } from '../../application/services/activity-feed.service';
import type { ActivityFeedItem } from '../../application/services/activity-feed.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '../../domain/constants/permissions';
import {
  ActivityFeedItemDto,
  ListActivityFeedQueryDto,
} from '../dtos/activity-feed.dto';

// No `@RequireModule` — every domain this feed reads from (events, points,
// members, chat, backwork) is either always-on or, for backwork, itself
// read-unrestricted by module state (`RequireModule`'s own doc: "Reads are
// always allowed"). `MEMBERS_VIEW` is the one gate every domain shares.
@ApiTags('Activity Feed')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@Controller('activity-feed')
export class ActivityFeedController {
  constructor(private readonly activityFeedService: ActivityFeedService) {}

  @Get()
  @ApiOperation({
    summary: 'Get the chapter activity feed',
    description:
      'Normalized, newest-first rows aggregated from events, the caller’s own point changes, backwork uploads (only when the caller can view Backwork), new members, and the announcements channel. Read-only aggregation — no separate feed table (`spec/behavior/activity-feed.md`).',
  })
  @ApiOkResponse({ type: ActivityFeedItemDto, isArray: true })
  async getFeed(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Query() query: ListActivityFeedQueryDto,
  ): Promise<ActivityFeedItem[]> {
    return this.activityFeedService.getFeed(chapterId, userId, query.limit);
  }
}
