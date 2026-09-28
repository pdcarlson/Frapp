import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { DiscordImportService } from '../../application/services/discord-import.service';
import { RbacService } from '../../application/services/rbac.service';
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
  ConfirmDiscordUploadsDto,
  CreateDiscordImportDto,
  DiscordDiscoveryResponseDto,
  DiscordUploadTicketDto,
  RequestDiscordUploadUrlsDto,
  SetDiscordChannelMappingDto,
  SetDiscordRoleMappingDto,
} from '../dtos/discord-import.dto';

/**
 * Discord archive import, admin-facing.
 *
 * Gated on `channels:manage` throughout — including the reads. That permission
 * already authorises creating, editing and deleting channels and moderating any
 * message in them, which is precisely the authority an import exercises: it
 * creates channels, writes history into them, and can delete all of it again.
 * Minting a new permission string would have meant touching every seeded role's
 * permission set for no additional containment.
 *
 * No route here takes or returns a Discord credential, on either path. The
 * upload path never touches Discord at all — the admin runs
 * DiscordChatExporter themselves and the browser uploads the result straight to
 * storage. The bot path authenticates with one GLOBAL Frapp token that no
 * chapter ever sees; what a chapter contributes is a guild id, established by
 * the OAuth flow in `DiscordConnectionController` and read here only through
 * `chapter_id`.
 */
@ApiTags('Discord Import')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard)
@Controller('discord-imports')
export class DiscordImportController {
  constructor(
    private readonly importService: DiscordImportService,
    private readonly rbacService: RbacService,
  ) {}

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({
    summary: 'Start a Discord archive import',
    description:
      'Requires the consent acknowledgement. Returns the import to upload an export against.',
  })
  create(
    @CurrentChapterId() chapterId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateDiscordImportDto,
  ) {
    return this.importService.create(chapterId, user.id, {
      consent_acknowledged: dto.consent_acknowledged,
      guild_name: dto.guild_name ?? null,
      source: dto.source ?? 'upload',
    });
  }

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'List this chapter’s Discord imports' })
  list(@CurrentChapterId() chapterId: string) {
    return this.importService.list(chapterId);
  }

  @Get(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({
    summary: 'Import detail and progress',
    description:
      "Poll this while an import is running. An upload's progress is `imported_messages` / `total_messages`; its total grows a part at a time, as each export part is opened. A bot import's total grows with every page it reads from Discord, so its progress is `channels_done` / `channels_total`: the channel and thread rows being imported, and how many of those are finished (imported, or skipped because Discord no longer showed them to the bot). Both are null for an upload, and for a bot import that is not queued, running, failed or cancelled.",
  })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
  ) {
    return this.importService.get(id, chapterId);
  }

  @Get(':id/channels')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Channel mapping and per-channel progress' })
  getChannels(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
  ) {
    return this.importService.getChannels(id, chapterId);
  }

  @Get(':id/files')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({
    summary: 'Uploaded file manifest',
    description:
      'Rows with a null `uploaded_at` are what an interrupted upload still needs to send.',
  })
  getFiles(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
  ) {
    return this.importService.getFiles(id, chapterId);
  }

  @Post(':id/upload-urls')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({
    summary: 'Mint signed upload URLs for a batch of export files',
    description:
      'The browser PUTs directly to storage, so no export byte passes through the API.',
  })
  @ApiOkResponse({ type: [DiscordUploadTicketDto] })
  requestUploadUrls(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
    @Body() dto: RequestDiscordUploadUrlsDto,
  ) {
    return this.importService.requestUploadUrls(id, chapterId, dto.files);
  }

  @Post(':id/uploads/confirm')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Mark uploaded files as landed' })
  confirmUploads(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
    @Body() dto: ConfirmDiscordUploadsDto,
  ) {
    return this.importService.confirmUploads(id, chapterId, dto.storage_paths);
  }

  @Put(':id/channels')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({
    summary: 'Map each Discord channel onto a Frapp channel',
    description:
      'Every channel needs an explicit choice — create new, merge into an existing one, or skip. A new channel also needs `new_channel_visibility`: an export does not say which channels were private in Discord.',
  })
  setChannelMapping(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
    @Body() dto: SetDiscordChannelMappingDto,
  ) {
    return this.importService.setChannelMapping(id, chapterId, dto.channels);
  }

  @Put(':id/roles')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({
    summary: 'Map each Discord role to a Frapp role',
    description:
      'Each Discord role becomes an existing Frapp role, a new role, or nothing (#2818). The mapping decides who reads the channels imported "Same as Discord"; starting the import creates the new roles and grants each role the read permission of the channels gated on it. It never assigns anyone to a role. Mapping anything other than `ignore` also needs `roles:manage`, since it creates roles and grants permissions.',
  })
  async setRoleMapping(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: SetDiscordRoleMappingDto,
  ) {
    // Resolved here rather than with @RequirePermissions: an all-Ignore
    // mapping creates and grants nothing, so it stays open to anyone who can
    // run the import.
    const canManageRoles = await this.rbacService.memberHasAnyPermission(
      chapterId,
      userId,
      [SystemPermissions.ROLES_MANAGE],
    );
    return this.importService.setRoleMapping(
      id,
      chapterId,
      dto.roles,
      canManageRoles,
    );
  }

  @Post(':id/discover')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({
    summary: 'Scan the connected Discord server (bot imports only)',
    description:
      'Lists every channel in the server, and the threads of each channel the bot can read, and records them against this import, all set to `skip` until mapped. Each channel carries whether the bot can read it and whether it was private in Discord. Also returns the guild’s roles for the role step (every role but `@everyone` and the managed bot and booster roles) and, on each private channel, which of them could read it; and any warnings about what could not be read.',
  })
  @ApiOkResponse({ type: DiscordDiscoveryResponseDto })
  discover(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
  ) {
    return this.importService.discoverBotChannels(id, chapterId);
  }

  @Put(':id/discovered-channels')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({
    summary: 'Map the scanned Discord channels (bot imports only)',
    description:
      'Send a decision for each top-level channel the scan found. Threads are not addressable — each one follows its parent’s decision, because the admin was asked about the parent and a thread is part of that conversation. A channel the scan did not return is rejected rather than added. A channel the bot cannot read can only be skipped, and a new channel needs `new_channel_visibility` unless the scan saw it was public in Discord and holding no private thread.',
  })
  setDiscoveredChannelMapping(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
    @Body() dto: SetDiscordChannelMappingDto,
  ) {
    return this.importService.applyDiscoveredChannelMapping(
      id,
      chapterId,
      dto.channels,
    );
  }

  @Post(':id/start')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({
    summary: 'Queue the import',
    description:
      'The background worker picks it up within a minute and reports progress on the detail route.',
  })
  start(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
  ) {
    return this.importService.start(id, chapterId);
  }

  @Post(':id/cancel')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Stop a queued or running import' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
  ) {
    return this.importService.cancel(id, chapterId);
  }

  @Post(':id/clear')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({
    summary: 'Take a deleted import off the list',
    description:
      'Hides a purged (deleted) import’s record from the list. 409 for an import in any other status: the list is where an import is deleted from, so one that still holds what it brought in stays listed until it is deleted.',
  })
  clear(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
  ) {
    return this.importService.clear(id, chapterId);
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({
    summary: 'Delete an import and everything it brought in',
    description:
      'Removes the imported messages, their attachments, and the uploaded archive objects. The job row survives as the record that it happened.',
  })
  purge(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
  ) {
    return this.importService.requestPurge(id, chapterId);
  }
}
