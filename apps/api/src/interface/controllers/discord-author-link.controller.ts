import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { DiscordAuthorLinkService } from '../../application/services/discord-author-link.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  BeginDiscordAuthorLinkResponseDto,
  ConfirmDiscordAuthorLinkDto,
  ConfirmDiscordAuthorLinkResponseDto,
  DiscordAuthorLinkDto,
  DiscordAuthorLinkEntryDto,
  UnlinkDiscordAuthorResponseDto,
} from '../dtos/discord-author-link.dto';

/**
 * A member linking their own Discord account, so the chapter's imported
 * Discord history they wrote shows as theirs (#2878).
 *
 * `members:view`, the member baseline the block list also uses: every route
 * here is about the caller's own account in the chapter the request is scoped
 * to, and no route takes another member's id. There is deliberately no
 * officer route that links anyone (spec/behavior/chat/README.md § Imported
 * archive messages).
 *
 * The Discord callback is not here. Both Discord flows share
 * `GET /v1/discord/connect/callback`, the one URI registered in Discord's
 * Developer Portal, and it dispatches on the handshake's purpose.
 */
@ApiTags('Discord Author Links')
@ApiBearerAuth()
@Controller('discord')
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
export class DiscordAuthorLinkController {
  constructor(private readonly linkService: DiscordAuthorLinkService) {}

  @Get('author-link')
  @ApiOperation({
    summary: 'Your linked Discord account in this chapter, if any',
  })
  @ApiOkResponse({ type: DiscordAuthorLinkDto })
  getMine(
    @CurrentChapterId() chapterId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.linkService.getMine(chapterId, user.id);
  }

  @Post('author-link/start')
  @ApiOperation({
    summary: 'Start linking your Discord account',
    description:
      'Mints a single-use handshake bound to you and this chapter and returns the Discord authorize URL, which asks for `identify` only. Discord returns the browser to `/profile` with a one-time token that `POST /v1/discord/author-link/confirm` spends.',
  })
  @ApiOkResponse({ type: BeginDiscordAuthorLinkResponseDto })
  begin(
    @CurrentChapterId() chapterId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.linkService.begin(chapterId, user.id);
  }

  @Post('author-link/confirm')
  @ApiOperation({
    summary: 'Link the Discord account the callback parked',
    description:
      'Links the account only for the member who started the handshake, in this chapter, and attributes that Discord author’s imported messages here to them. 409 when the account is already linked to another member of the chapter. Linking a different account replaces your previous link.',
  })
  @ApiOkResponse({ type: ConfirmDiscordAuthorLinkResponseDto })
  confirm(
    @CurrentChapterId() chapterId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: ConfirmDiscordAuthorLinkDto,
  ) {
    return this.linkService.confirm(chapterId, user.id, dto.handshake);
  }

  @Delete('author-link')
  @ApiOperation({
    summary: 'Unlink your Discord account in this chapter',
    description:
      'Your imported messages here go back to their Discord name. Messages you deleted stay deleted.',
  })
  @ApiOkResponse({ type: UnlinkDiscordAuthorResponseDto })
  unlink(
    @CurrentChapterId() chapterId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.linkService.unlink(chapterId, user.id);
  }

  @Get('author-links')
  @ApiOperation({
    summary: 'Which Discord accounts members of this chapter have linked',
    description:
      'The Discord id → member map, so a Discord user mention in imported text can link to the member. This chapter only.',
  })
  @ApiOkResponse({ type: DiscordAuthorLinkEntryDto, isArray: true })
  listLinks(@CurrentChapterId() chapterId: string) {
    return this.linkService.listLinks(chapterId);
  }
}
