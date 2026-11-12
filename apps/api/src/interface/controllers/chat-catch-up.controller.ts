import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { FALLBACK_TIME_ZONE, isSupportedTimeZone } from '@repo/validation';
import { SystemPermissions } from '#domain/constants/permissions';
import { TIME_ZONE_HEADER } from '#domain/constants/time-zone-header';
import { ChatCatchUpService } from '../../application/services/chat-catch-up/chat-catch-up.service';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { ThrottleFanOutWrite } from '../decorators/throttle-profiles.decorator';
import {
  ChatCatchUpDto,
  ChatCatchUpRequestDto,
} from '../dtos/chat-catch-up.dto';
import { AiEnabledGuard } from '../guards/ai-enabled.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';

/**
 * Catch me up (#3946, `spec/behavior/ai.md` § Catch me up): the short
 * version of a channel's new messages, or of one thread, for the member who
 * asks.
 *
 * `AiEnabledGuard` first, so a server with `AI_ENABLED` off answers 404
 * `ai.not_available`. Then the member, their chapter and `ai:use`. Whether
 * the member can open the channel, the chapter's switches and the member's
 * answer on the AI sheet are the service's checks.
 *
 * A POST because it costs a model call and must never be cached or
 * prefetched; it changes nothing and stores nothing.
 */
@ApiTags('AI')
@ApiBearerAuth()
@UseGuards(AiEnabledGuard, SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.AI_USE)
@Controller('ai/catch-up')
export class ChatCatchUpController {
  constructor(private readonly catchUpService: ChatCatchUpService) {}

  @Post()
  @HttpCode(200)
  @ThrottleFanOutWrite()
  @ApiOperation({
    summary: "Summarize a channel's new messages, or one thread",
    description:
      'Runs only when a member asks, for that member, and is not stored. Reads only messages whose authors agreed to AI reading their messages while the chapter has channel messages turned on as a source; `left_out_messages` counts the rest. Every point names the message it rests on with a quote the server found in it. Never reads a direct message or a group DM.',
  })
  @ApiOkResponse({ type: ChatCatchUpDto })
  @ApiBadRequestResponse({
    description:
      'Not exactly one of `thread_root_id`, `since` and `unread`, or the channel is a direct message (`ai.catch_up.not_a_channel`).',
  })
  @ApiForbiddenResponse({
    description:
      'The caller cannot open the channel, has not said yes on the AI sheet (`ai.consent.required`), or the president has summaries turned off (`ai.chapter_off`).',
  })
  @ApiNotFoundResponse({
    description:
      'AI is off on this server (`ai.not_available`), or the channel or thread does not exist in this chapter.',
  })
  async catchUp(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Headers(TIME_ZONE_HEADER) timeZoneHeader: string | undefined,
    @Body() dto: ChatCatchUpRequestDto,
    @Req() request: Request,
  ): Promise<ChatCatchUpDto> {
    const given = [dto.thread_root_id, dto.since, dto.unread].filter(
      (part) => part !== undefined,
    );
    if (given.length !== 1) {
      throw new BadRequestException(
        'Give exactly one of thread_root_id, since and unread.',
      );
    }

    // A member who closed the panel: stop the model call and its spend.
    const abort = new AbortController();
    request.on('close', () => {
      if (!request.complete || request.destroyed) abort.abort();
    });

    return this.catchUpService.catchUp({
      chapterId,
      userId,
      channelId: dto.channel_id,
      ...(dto.thread_root_id === undefined
        ? {}
        : { threadRootId: dto.thread_root_id }),
      ...(dto.since === undefined ? {} : { since: dto.since }),
      ...(dto.unread === undefined
        ? {}
        : { unread: { count: dto.unread.count, asOf: dto.unread.as_of } }),
      timeZone: isSupportedTimeZone(timeZoneHeader)
        ? timeZoneHeader
        : FALLBACK_TIME_ZONE,
      signal: abort.signal,
    });
  }
}
