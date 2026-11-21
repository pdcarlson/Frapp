import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { FALLBACK_TIME_ZONE, isSupportedTimeZone } from '@repo/validation';
import { SystemPermissions } from '#domain/constants/permissions';
import { TIME_ZONE_HEADER } from '#domain/constants/time-zone-header';
import { MemberNudgeService } from '../../application/services/member-nudge/member-nudge.service';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { ThrottleFanOutWrite } from '../decorators/throttle-profiles.decorator';
import {
  DismissMemberNudgeDto,
  MemberNudgeCurrentDto,
  MemberNudgeSettingsDto,
  UpdateMemberNudgeSettingsDto,
} from '../dtos/member-nudge.dto';
import { AiEnabledGuard } from '../guards/ai-enabled.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';

/**
 * Member nudges (#4781, `spec/behavior/ai.md` § Nudges): the one card on a
 * member's Activity that the AI writes about one of their own tasks.
 *
 * `AiEnabledGuard` first, so a server with `AI_ENABLED` off answers 404
 * `ai.not_available`. Then the member, their chapter and `ai:use`. Every
 * route acts on the caller's own card and nobody else's: there is no route
 * that names another member.
 */
@ApiTags('AI')
@ApiBearerAuth()
@UseGuards(AiEnabledGuard, SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.AI_USE)
@Controller('nudges')
export class MemberNudgeController {
  constructor(private readonly nudges: MemberNudgeService) {}

  @Post('current')
  @HttpCode(200)
  @ThrottleFanOutWrite()
  @ApiOperation({
    summary: "The caller's card for Activity, if one is due",
    description:
      'Returns the one card to show, or null. A POST because it may write a new card, which costs a model call, so it must never be cached or prefetched. A card already showing is returned as it is, after checking it against the task as it stands. Answers null, never an error, when AI is off for the chapter or the member has not said yes: a card is an extra, and its absence needs no explaining.',
  })
  @ApiOkResponse({ type: MemberNudgeCurrentDto })
  @ApiNotFoundResponse({
    description: 'AI is off on this server (`ai.not_available`).',
  })
  async current(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Headers(TIME_ZONE_HEADER) timeZoneHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MemberNudgeCurrentDto> {
    // A member who left the page: stop the model call and its spend. The
    // response's `close`, as Ask listens for.
    const abort = new AbortController();
    response.on('close', () => abort.abort());
    if (response.destroyed) abort.abort();

    const nudge = await this.nudges.current({
      chapterId,
      userId,
      timeZone: isSupportedTimeZone(timeZoneHeader)
        ? timeZoneHeader
        : FALLBACK_TIME_ZONE,
      signal: abort.signal,
    });
    return { nudge };
  }

  @Post(':id/seen')
  @HttpCode(204)
  @ApiOperation({ summary: 'Record that the card was on screen' })
  @ApiNoContentResponse()
  async seen(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.nudges.seen(chapterId, userId, id);
  }

  @Post(':id/dismiss')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Close the card',
    description:
      "Closes the caller's showing card and deletes its words. The same task is not raised again for the same reason.",
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({
    description: 'No such card is showing for the caller.',
  })
  async dismiss(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DismissMemberNudgeDto,
  ): Promise<void> {
    await this.nudges.dismiss(chapterId, userId, id, dto.reason);
  }

  @Get('settings')
  @ApiOperation({ summary: "The caller's own switch for these cards" })
  @ApiOkResponse({ type: MemberNudgeSettingsDto })
  async settings(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<MemberNudgeSettingsDto> {
    return this.nudges.settings(chapterId, userId);
  }

  @Put('settings')
  @ApiOperation({
    summary: 'Turn the cards on or off for the caller',
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
