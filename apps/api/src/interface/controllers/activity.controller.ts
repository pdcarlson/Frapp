import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ActivityService } from '../../application/services/activity.service';
import type { ActivityView } from '../../application/services/activity.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import {
  CurrentChapterId,
  CurrentEnabledModules,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import { ActivityDto } from '../dtos/activity.dto';

// No `@RequireModule`: the page spans modules, so no one key gates it. Each
// section checks its own module (and its own permission) in the service, and
// a module that is off contributes nothing. `MEMBERS_VIEW` is the baseline
// every module's own read already requires.
@ApiTags('Activity')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@Controller('activity')
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Get()
  @ApiOperation({
    summary: 'Get what needs the caller and what they made',
    description:
      'The Activity page’s read (`spec/behavior/activity.md`). `needs_you`: the caller’s open tasks, finished tasks they can confirm, service entries they can approve, and open polls they can read and haven’t voted on. `coming_up`: their upcoming events, with whether check-in is open. `made_by_you`: their poll cards, the tasks they assigned and the files they uploaded. A read-only aggregation: every row comes from its own module under that module’s rule for who may see it, a module the chapter has off contributes nothing, and a poll is listed only from a channel the caller can read in chat. Not `GET /v1/activity-feed`, which is a feed of what happened in the chapter.',
  })
  @ApiOkResponse({ type: ActivityDto })
  async getActivity(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @CurrentEnabledModules() enabledModules: Record<string, boolean> | null,
  ): Promise<ActivityView> {
    return this.activityService.getActivity(chapterId, userId, enabledModules);
  }
}
