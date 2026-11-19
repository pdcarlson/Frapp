import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { InviteService } from '../../application/services/invite.service';
import { InviteFunnelService } from '../../application/services/invite-funnel.service';
import { ThrottlePublicTokenRead } from '../decorators/throttle-profiles.decorator';
import {
  InviteDetailsResponseDto,
  InviteFunnelStepDto,
  PreviewInviteDto,
} from '../dtos/invite.dto';
import { requestApp, requestAppVersion } from '../http/request-app';
import type { RequestContext } from '../types/request-context.types';

/**
 * The invite routes that need no account (#5625): the card an invite link
 * opens on, before anyone signs in, so a new member sees which chapter they're
 * joining and who sent the link before they make an account.
 *
 * A controller of its own because `InviteController` guards every route at
 * the class level, and one unguarded handler there would be the exception a
 * later edit misses. Its routes answer for the token alone. `details` reads
 * the card, and `funnel` records the card's analytics steps (#5663). The token
 * is the credential: whoever holds a live one could join with it, so the card tells
 * them nothing joining wouldn't. It answers for a dead link too, so the screen
 * can still name the chapter and the sender to ask for a new one.
 *
 * A POST so the token rides in the body, not in a URL that access logs keep,
 * as `POST /v1/invites/preview` does. Counted per address
 * (`ThrottlePublicTokenRead`), generously, because a pledge class opens the
 * chapter link together on one campus network.
 */
@ApiTags('Invites')
@Controller('invites')
export class InviteDetailsController {
  constructor(
    private readonly inviteService: InviteService,
    private readonly funnel: InviteFunnelService,
  ) {}

  @Post('details')
  @HttpCode(HttpStatus.OK)
  @ThrottlePublicTokenRead()
  @ApiOperation({
    summary:
      "An invite link's chapter, sender, role and whether it still works, with no account needed",
  })
  @ApiOkResponse({ type: InviteDetailsResponseDto })
  @ApiNotFoundResponse({
    description: 'No such invite, or its chapter is gone',
  })
  async details(
    @Body() dto: PreviewInviteDto,
  ): Promise<InviteDetailsResponseDto> {
    return this.inviteService.details(dto.token);
  }

  /**
   * A step of the invite card funnel (#5663), from a card with or without a
   * signed-in visitor. The token is the proof of which chapter's opt-out
   * applies, which is why this rides the invite and not
   * `POST /v1/analytics/events` (which needs an account). Always 204, for an
   * unknown token too, so it tells a guesser nothing the details route
   * doesn't. Throttled like it, 120 a minute per address, on its own
   * counter.
   */
  @Post('funnel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ThrottlePublicTokenRead()
  @ApiOperation({
    summary:
      'Record a step of the invite card funnel (card viewed, sign-in started, and so on), with no account needed',
  })
  @ApiNoContentResponse()
  async funnelStep(
    @Body() dto: InviteFunnelStepDto,
    @Req() request: RequestContext,
  ): Promise<void> {
    await this.funnel.recordStep(dto.token, dto.visit_id, dto, {
      app: requestApp(request),
      appVersion: requestAppVersion(request),
    });
  }
}
