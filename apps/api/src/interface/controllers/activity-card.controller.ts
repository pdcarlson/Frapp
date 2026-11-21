import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { FALLBACK_TIME_ZONE, isSupportedTimeZone } from '@repo/validation';
import { SystemPermissions } from '#domain/constants/permissions';
import { TIME_ZONE_HEADER } from '#domain/constants/time-zone-header';
import { ActivityCardService } from '../../application/services/activity-card.service';
import type { MemberNudgeCardResult } from '../../application/services/member-nudge/member-nudge.service';
import { MemberNudgeService } from '../../application/services/member-nudge/member-nudge.service';
import {
  CurrentChapterId,
  CurrentEnabledModules,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { ThrottleFanOutWrite } from '../decorators/throttle-profiles.decorator';
import {
  ActivityNudgeDismissDto,
  ActivityNudgeCardDto,
  ActivityNudgeSeenDto,
} from '../dtos/activity-card.dto';
import {
  MemberNudgeSettingsDto,
  UpdateMemberNudgeSettingsDto,
} from '../dtos/member-nudge.dto';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';

/**
 * The card at the top of a member's Activity (#5464, `spec/behavior/ai.md`
 * § Nudges). Unlike `POST /v1/nudges/current`, which only a member with AI
 * on can call, this one has no AI guard: a card shows whether or not AI is
 * available, and AI only adds a sentence. Activity's own gate
 * (`members:view`) is its gate. Every route acts on the caller's own card.
 */
@ApiTags('Activity')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@Controller('activity/card')
export class ActivityCardController {
  constructor(
    private readonly cards: ActivityCardService,
    private readonly nudges: MemberNudgeService,
  ) {}

  @Post()
  @HttpCode(200)
  @ThrottleFanOutWrite()
  @ApiOperation({
    summary: "The caller's card for Activity, and its tray",
    description:
      "The one most useful thing waiting on the caller (an event today or tomorrow they haven't checked in to, an unread @mention, a task of theirs, an open sign-up, an unread announcement, an officer's queue, new minutes, a study goal behind), and up to three more for the tray. A POST because it may raise a new card, which may cost a model call. `line` is null whenever AI is off for the caller or the server: the card shows either way. Times are written in the `X-Time-Zone` zone.",
  })
  @ApiOkResponse({ type: ActivityNudgeCardDto })
  async card(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @CurrentEnabledModules() enabledModules: Record<string, boolean> | null,
    @Headers(TIME_ZONE_HEADER) timeZoneHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MemberNudgeCardResult> {
    // A member who left the page: stop the model call and its spend.
    const abort = new AbortController();
    response.on('close', () => abort.abort());
    if (response.destroyed) abort.abort();
    return this.cards.card({
      chapterId,
      userId,
      enabledModules,
      timeZone: isSupportedTimeZone(timeZoneHeader)
        ? timeZoneHeader
        : FALLBACK_TIME_ZONE,
      signal: abort.signal,
    });
  }

  @Post('seen')
  @HttpCode(204)
  @ApiOperation({ summary: 'Record that the card was on screen' })
  @ApiNoContentResponse()
  async seen(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ActivityNudgeSeenDto,
  ): Promise<void> {
    await this.nudges.seen(chapterId, userId, dto.id);
  }

  @Post('dismiss')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Wave a card or tray item off',
    description:
      'The caller does not want this one: it is not raised again. A mention or announcement comes back only when something new is posted in its channel. Answers 204 whether or not there was anything to close.',
  })
  @ApiNoContentResponse()
  async dismiss(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ActivityNudgeDismissDto,
  ): Promise<void> {
    await this.nudges.dismissSubject(chapterId, userId, dto);
  }

  @Get('settings')
  @ApiOperation({
    summary: "The caller's own switch for the card",
    description:
      'The same switch as `GET /v1/nudges/settings`, without its AI gate: the card shows without AI, so every member can turn it off.',
  })
  @ApiOkResponse({ type: MemberNudgeSettingsDto })
  async settings(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<MemberNudgeSettingsDto> {
    return this.nudges.settings(chapterId, userId);
  }

  @Put('settings')
  @ApiOperation({
    summary: 'Turn the card on or off for the caller',
    description: 'Off also closes the card that is showing.',
  })
  @ApiOkResponse({ type: MemberNudgeSettingsDto })
  async updateSettings(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateMemberNudgeSettingsDto,
  ): Promise<MemberNudgeSettingsDto> {
    return this.nudges.setEnabled(chapterId, userId, dto.enabled);
  }
}
