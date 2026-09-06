import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  Redirect,
  UseGuards,
  Version,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { DiscordOAuthService } from '../../application/services/discord-oauth.service';
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
  BeginDiscordConnectDto,
  BeginDiscordConnectResponseDto,
  ConfirmDiscordConnectDto,
  DiscordAvailabilityDto,
  DiscordConnectionDto,
} from '../dtos/discord-connection.dto';

/**
 * Connecting a chapter's Discord server to Signet.
 *
 * Gated on `channels:manage`, matching `DiscordImportController` — the same
 * authority that already covers creating channels and writing history into
 * them. Reads included: which Discord server a chapter has linked is chapter
 * data, and a `@Get` without a permission decorator leaks it just as surely as
 * a write would corrupt it.
 *
 * **The callback is the one exception and it cannot be otherwise.** Discord
 * redirects the admin's browser to it as a top-level navigation: no bearer
 * token, no `x-chapter-id`, no session this API can see. Its authorization is
 * therefore the single-use `state` row — which names the chapter — plus two
 * facts read back from Discord itself (which guild the bot landed in, and
 * whether the authorizing human has Manage Server there). See
 * `DiscordOAuthService` for why neither is taken from the query string.
 */
@ApiTags('Discord Connection')
@Controller('discord')
export class DiscordConnectionController {
  constructor(private readonly oauthService: DiscordOAuthService) {}

  @Get('availability')
  @ApiBearerAuth()
  @UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({
    summary: 'Whether the bot path is configured in this environment',
    description:
      'The wizard offers "Connect Discord" only when this is true, and always offers the export-upload path regardless.',
  })
  @ApiOkResponse({ type: DiscordAvailabilityDto })
  availability(): DiscordAvailabilityDto {
    return { available: this.oauthService.isAvailable() };
  }

  @Get('connection')
  @ApiBearerAuth()
  @UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'This chapter’s linked Discord server, if any' })
  @ApiOkResponse({ type: DiscordConnectionDto })
  getConnection(@CurrentChapterId() chapterId: string) {
    return this.oauthService.getConnection(chapterId);
  }

  @Post('connect')
  @ApiBearerAuth()
  @UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({
    summary: 'Start the "Add to Server" handshake',
    description:
      'Mints a single-use state bound to this chapter and returns the Discord authorize URL to send the admin to. No credential is returned and none is ever asked for: the only thing this flow stores per chapter is a guild id.',
  })
  @ApiOkResponse({ type: BeginDiscordConnectResponseDto })
  beginConnect(
    @CurrentChapterId() chapterId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: BeginDiscordConnectDto,
  ) {
    return this.oauthService.beginConnect(
      chapterId,
      user.id,
      dto.return_path ?? null,
    );
  }

  @Post('connect/confirm')
  @ApiBearerAuth()
  @UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({
    summary: 'Activate the Discord server the callback parked',
    description:
      'The OAuth callback does not link anything by itself: it parks what Discord told it and hands the browser a one-time token. This route is what binds the server, and it binds it only to the chapter this request is scoped to — so an authorization completed by somebody else, for a chapter they are not in, activates nothing.',
  })
  @ApiOkResponse({ type: DiscordConnectionDto })
  confirmConnect(
    @CurrentChapterId() chapterId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: ConfirmDiscordConnectDto,
  ) {
    return this.oauthService.confirmConnection(
      chapterId,
      user.id,
      dto.handshake,
    );
  }

  @Delete('connection')
  @ApiBearerAuth()
  @UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({
    summary: 'Unlink this chapter’s Discord server',
    description:
      'Forgets the guild id, so no further import can read that server. Already-imported history is untouched — deleting that is what the per-import purge is for. Remove the bot from the Discord server separately if you want its access gone as well.',
  })
  disconnect(@CurrentChapterId() chapterId: string) {
    return this.oauthService.disconnect(chapterId);
  }

  /**
   * Discord's redirect target.
   *
   * `@Version('1')` is spelled out even though URI versioning already defaults
   * to it, because this path is ALSO registered by hand in the Discord
   * Developer Portal: it is a published integration surface, not an internal
   * one. The registered URI has to keep working when a `/v2` appears, and this
   * line is what will make somebody think about that before it breaks.
   *
   * Excluded from the OpenAPI contract: it is a browser redirect target, not
   * something any SDK consumer calls, and generating a typed client method for
   * it would invite exactly that.
   */
  @Get('connect/callback')
  @Version('1')
  @Redirect()
  @ApiExcludeEndpoint()
  async callback(
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
    @Query('error_description') errorDescription?: string,
  ) {
    const outcome = await this.oauthService.handleCallback({
      code,
      state,
      error,
      error_description: errorDescription,
    });
    // 302 rather than the @Redirect default of 302→301 caching. A permanently
    // cached OAuth callback would be a genuinely confusing bug: the browser
    // would stop asking the API and replay the last outcome forever.
    return { url: outcome.returnUrl, statusCode: 302 };
  }
}
