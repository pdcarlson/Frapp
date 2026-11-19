import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { InviteService } from '../../application/services/invite.service';
import { ThrottlePublicTokenRead } from '../decorators/throttle-profiles.decorator';
import { InviteDetailsResponseDto, PreviewInviteDto } from '../dtos/invite.dto';

/**
 * The one invite route that needs no account (#5625): the card an invite link
 * opens on, before anyone signs in, so a new member sees which chapter they're
 * joining and who sent the link before they make an account.
 *
 * A controller of its own because `InviteController` guards every route at
 * the class level, and one unguarded handler there would be the exception a
 * later edit misses. Its one route answers for the token alone, which is the
 * credential: whoever holds a live one could join with it, so the card tells
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
  constructor(private readonly inviteService: InviteService) {}

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
}
