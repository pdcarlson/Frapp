import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ActivityService } from '../../application/services/activity.service';
import { ActivityLinkService } from '../../application/services/activity-link.service';
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
import { ActivityDto, SetActivityLinkStateDto } from '../dtos/activity.dto';

// No `@RequireModule`: the page spans modules, so no one key gates it. Each
// section checks its own module and its own permission in the service, and a
// module that is off contributes nothing. `MEMBERS_VIEW` is the page's own
// gate; a section whose module asks for more (Backwork) checks that too.
@ApiTags('Activity')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@Controller('activity')
export class ActivityController {
  constructor(
    private readonly activityService: ActivityService,
    private readonly linkService: ActivityLinkService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get what needs the caller and what they made',
    description:
      'The Activity page’s read (`spec/behavior/activity.md`). `needs_you`: the caller’s open tasks, finished tasks they can confirm, service entries they can approve, and open polls they can read and haven’t voted on. `coming_up`: their upcoming events, with whether check-in is open. `made_by_you`: their poll cards, the events they made that invite them and have not closed, the tasks they assigned and the files they uploaded. `links`: sign-up links (forms, sheets, booking pages) posted in the last 30 days in channels they can read that an officer has not left out of Activity, minus their own, blocked members’, removed ones and ones they marked Done or Hidden. A read-only aggregation: every row comes from its own module under that module’s rule for who may see it, a module the chapter has off contributes nothing, and a poll is listed only from a channel the caller can read in chat. Not `GET /v1/activity-feed`, which is a feed of what happened in the chapter.',
  })
  @ApiOkResponse({ type: ActivityDto })
  async getActivity(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @CurrentEnabledModules() enabledModules: Record<string, boolean> | null,
  ): Promise<ActivityView> {
    return this.activityService.getActivity(chapterId, userId, enabledModules);
  }

  @Put('links/:id/state')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Mark a link on Activity Done or Hidden for the caller',
    description:
      'Per member, idempotent; either replaces the other. 404 for a link the caller can’t read (its channel isn’t in their chat list) as for one that doesn’t exist. `spec/behavior/activity.md` § Links.',
  })
  @ApiNoContentResponse()
  async setLinkState(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) linkId: string,
    @Body() dto: SetActivityLinkStateDto,
  ): Promise<void> {
    await this.linkService.setState(chapterId, userId, linkId, dto.state);
  }

  @Delete('links/:id/state')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Clear the caller’s Done or Hidden on a link, so it shows again',
    description:
      'Idempotent. 404 for a link the caller can’t read, as for one that doesn’t exist.',
  })
  @ApiNoContentResponse()
  async clearLinkState(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) linkId: string,
  ): Promise<void> {
    await this.linkService.clearState(chapterId, userId, linkId);
  }

  @Put('links/:id/removed')
  @HttpCode(204)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({
    summary: 'Remove a link from everyone’s Activity (channels:manage)',
    description:
      'For a link that slipped through from a channel that should be left out of Activity. The message stays in chat. Idempotent.',
  })
  @ApiNoContentResponse()
  async removeLink(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) linkId: string,
  ): Promise<void> {
    await this.linkService.setRemoved(chapterId, linkId, userId);
  }

  @Delete('links/:id/removed')
  @HttpCode(204)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({
    summary:
      'Undo an officer’s remove, so a link shows on Activity again (channels:manage)',
  })
  @ApiNoContentResponse()
  async restoreLink(
    @CurrentChapterId() chapterId: string,
    @Param('id', ParseUUIDPipe) linkId: string,
  ): Promise<void> {
    await this.linkService.setRemoved(chapterId, linkId, null);
  }
}
