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
 * storage. The bot path authenticates with one GLOBAL Signet token that no
 * chapter ever sees; what a chapter contributes is a guild id, established by
 * the OAuth flow in `DiscordConnectionController` and read here only through
 * `chapter_id`.
 */
@ApiTags('Discord Import')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard)
@Controller('discord-imports')
export class DiscordImportController {
  constructor(private readonly importService: DiscordImportService) {}

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
      'Poll this while an import is running: `imported_messages` / `total_messages` and per-channel status.',
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
    summary: 'Map each Discord channel onto a Signet channel',
    description:
      'Every channel needs an explicit choice — create new, merge into an existing one, or skip.',
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
    summary: 'Record the Discord role → Signet role worksheet',
    description:
      'Informational only. Nothing reads this to grant a permission and the importer never assigns a role; everyone imports as a name on a message, and the admin promotes people by hand afterwards.',
  })
  setRoleMapping(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
    @Body() dto: SetDiscordRoleMappingDto,
  ) {
    return this.importService.setRoleMapping(id, chapterId, dto.roles);
  }

  @Post(':id/discover')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({
    summary: 'Scan the connected Discord server (bot imports only)',
    description:
      'Lists every channel and thread the bot can read and records them against this import, all set to `skip` until mapped. Also returns the guild’s roles for the worksheet, and any warnings about what could not be enumerated.',
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
      'Send a decision for each top-level channel the scan found. Threads are not addressable — each one follows its parent’s decision, because the admin was asked about the parent and a thread is part of that conversation. A channel the scan did not return is rejected rather than added.',
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
