import {
  Body,
  Controller,
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
import { SystemPermissions } from '#domain/constants/permissions';
import { AnalyticsService } from '../../application/services/analytics.service';
import { AskPostService } from '../../application/services/ask-post/ask-post.service';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { ThrottleExpensiveWrite } from '../decorators/throttle-profiles.decorator';
import { AskPostDto, AskPostOutcomeDto } from '../dtos/ask-post.dto';
import { AiEnabledGuard } from '../guards/ai-enabled.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { requestApp, requestAppVersion } from '../http/request-app';
import type { RequestContext } from '../types/request-context.types';

/**
 * An answer its asker posted to a channel, counted with whether it carried a
 * warning (`spec/behavior/observability.md` § AI question events). No text,
 * no channel and no source names.
 */
export const ASK_ANSWER_POSTED_EVENT = 'ai-answer-posted';

/**
 * Post an Ask Frapp answer to a channel (#4713, `spec/behavior/ai.md`
 * § Posting an answer to the channel). The same guards as asking: `AiEnabledGuard` first, so a
 * server with `AI_ENABLED` off answers 404 `ai.not_available`, then `ai:use`.
 * The channel is authorized in the service, for posting.
 */
@ApiTags('AI')
@ApiBearerAuth()
@UseGuards(AiEnabledGuard, SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.AI_USE)
@Controller('ai/ask/posts')
export class AskPostController {
  constructor(
    private readonly posts: AskPostService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Post()
  @HttpCode(200)
  @ThrottleExpensiveWrite()
  @ApiOperation({
    summary:
      'Post an Ask Frapp answer to a channel, or ask what posting would warn about',
    description:
      'The answer comes from the receipt the server sealed into it for the caller, so only an answer Frapp sent can be posted, and only by the member it was sent to. Before anything is written, everything the answer drew on is checked against everyone who can read the channel; `restricted` lists what not all of them could open. With `confirm` false nothing is written. With `confirm` true the answer is posted, by the Frapp sender, only when `acknowledged` names every entry of `restricted`; otherwise `posted` is false and the current list comes back. A posted answer notifies nobody. Posting the same answer to the same channel twice writes one row; the second call is refused.',
  })
  @ApiOkResponse({ type: AskPostOutcomeDto })
  @ApiBadRequestResponse({
    description:
      'The receipt was not issued to the caller for an answer (`ai.ask.post.receipt_invalid`), is older than a day or from before answers could be posted (`ai.ask.post.too_old`), is not an answer (`ai.ask.post.not_an_answer`), the answer read chat messages (`ai.ask.post.read_chat`) or followed earlier questions (`ai.ask.post.follow_up`), or it is already in this channel (`ai.ask.post.already_posted`).',
  })
  @ApiForbiddenResponse({
    description:
      'The caller cannot post in this channel, Ask is off for the chapter (`ai.chapter_off`), or the caller has not turned Frapp AI on (`ai.consent.required`).',
  })
  @ApiNotFoundResponse({
    description:
      'AI is off on this server (`ai.not_available`), or the channel does not exist.',
  })
  async post(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: AskPostDto,
    @Req() request: Pick<RequestContext, 'headers'>,
  ): Promise<AskPostOutcomeDto> {
    const outcome = await this.posts.post({
      chapterId,
      userId,
      channelId: dto.channel_id,
      receipt: dto.receipt,
      confirm: dto.confirm,
      acknowledged: dto.acknowledged ?? [],
      now: new Date(),
    });
    if (outcome.posted) {
      // Never awaited and never in the post's way.
      this.analytics
        .track(ASK_ANSWER_POSTED_EVENT, userId, {
          chapterId,
          properties: { warned: outcome.restricted.length > 0 },
          app: requestApp(request),
          appVersion: requestAppVersion(request),
        })
        .catch(() => undefined);
    }
    return outcome;
  }
}
