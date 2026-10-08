import { Module } from '@nestjs/common';
import { DiscordImportController } from '../../interface/controllers/discord-import.controller';
import { DiscordConnectionController } from '../../interface/controllers/discord-connection.controller';
import { DiscordAuthorLinkController } from '../../interface/controllers/discord-author-link.controller';
import { DiscordImportService } from '../../application/services/discord-import.service';
import { DiscordImportChannelMappingService } from '../../application/services/discord-import-channel-mapping.service';
import { DiscordImportRoleMappingService } from '../../application/services/discord-import-role-mapping.service';
import { DiscordOAuthService } from '../../application/services/discord-oauth.service';
import { DiscordAuthorLinkService } from '../../application/services/discord-author-link.service';
import { DiscordImportWorkerService } from '../../application/workers/discord-import-worker.service';
import { DiscordExportWorkerService } from '../../application/workers/discord-export-worker.service';
import { SupabaseDiscordImportRepository } from '../../infrastructure/supabase/repositories/supabase-discord-import.repository';
import { SupabaseDiscordConnectionRepository } from '../../infrastructure/supabase/repositories/supabase-discord-connection.repository';
import { SupabaseDiscordAuthorLinkRepository } from '../../infrastructure/supabase/repositories/supabase-discord-author-link.repository';
import { SupabaseChatChannelRepository } from '../../infrastructure/supabase/repositories/supabase-chat-channel.repository';
import { SupabaseChatMessageReportRepository } from '../../infrastructure/supabase/repositories/supabase-chat-message-report.repository';
import { SupabaseStorageService } from '../../infrastructure/storage/supabase-storage.service';
import { SupabaseArchiveMediaCopier } from '../../infrastructure/storage/supabase-archive-media-copier.service';
import { DiscordBotGatewayService } from '../../infrastructure/discord/discord-bot-gateway.service';
import { DiscordOAuthClientService } from '../../infrastructure/discord/discord-oauth-client.service';
import { RbacModule } from '../rbac/rbac.module';
import { ChannelCacheModule } from '../chat-push-worker/channel-cache.module';
import { DISCORD_IMPORT_REPOSITORY } from '#domain/repositories/discord-import.repository.interface';
import { DISCORD_CONNECTION_REPOSITORY } from '#domain/repositories/discord-connection.repository.interface';
import { DISCORD_AUTHOR_LINK_REPOSITORY } from '#domain/repositories/discord-author-link.repository.interface';
import { CHAT_CHANNEL_REPOSITORY } from '#domain/repositories/chat.repository.interface';
import { CHAT_MESSAGE_REPORT_REPOSITORY } from '#domain/repositories/chat-moderation.repository.interface';
import { STORAGE_PROVIDER } from '#domain/adapters/storage.interface';
import { ARCHIVE_MEDIA_COPIER } from '#domain/adapters/archive-media-copier.interface';
import {
  DISCORD_BOT_GATEWAY,
  DISCORD_OAUTH_CLIENT,
} from '#domain/adapters/discord.interface';

/**
 * The Discord archive importer: admin routes, the connect flow, the worker,
 * and members linking their own Discord account to their imported history
 * (#2878), which shares the connect flow's one registered callback URL.
 *
 * Registers `STORAGE_PROVIDER` itself, as every storage-using module here does
 * — there is no central storage module in this repo.
 *
 * The worker lives in a sibling directory but is provided here so the `@Cron`
 * is registered exactly once. It reuses `CHAT_CHANNEL_REPOSITORY` rather than
 * restating channel creation, so an imported channel is created through the
 * same path as any other.
 *
 * `DiscordExportWorkerService` deliberately carries **no** `@Cron` of its own.
 * `DiscordImportWorkerService` claims every runnable job whatever its source
 * and delegates the fetch; a second scheduled sweeper would be two things
 * racing for one lease over a distinction that is a property of the job row,
 * not a reason for a second queue.
 *
 * The two Discord adapters bind here rather than in a shared module because
 * this is the only feature that talks to Discord. Both no-op cleanly when their
 * secrets are unset — the API boots without a Discord application configured,
 * and the DiscordChatExporter upload path is unaffected by their absence.
 */
@Module({
  // RbacModule → RbacService: the role step needs `roles:manage` resolved,
  // and starting an import creates roles and grants their read permissions
  // through the same service Settings → Roles uses (#2818).
  // ChannelCacheModule → ChannelCacheService: the purge deletes the channels
  // an import created and left empty, and evicts them as `ChatService` does
  // when an officer deletes one (#2905).
  imports: [RbacModule, ChannelCacheModule],
  controllers: [
    DiscordImportController,
    DiscordConnectionController,
    DiscordAuthorLinkController,
  ],
  providers: [
    DiscordImportService,
    DiscordImportChannelMappingService,
    DiscordImportRoleMappingService,
    DiscordOAuthService,
    DiscordAuthorLinkService,
    DiscordImportWorkerService,
    DiscordExportWorkerService,
    {
      provide: DISCORD_IMPORT_REPOSITORY,
      useClass: SupabaseDiscordImportRepository,
    },
    {
      provide: DISCORD_CONNECTION_REPOSITORY,
      useClass: SupabaseDiscordConnectionRepository,
    },
    {
      provide: DISCORD_AUTHOR_LINK_REPOSITORY,
      useClass: SupabaseDiscordAuthorLinkRepository,
    },
    {
      provide: CHAT_CHANNEL_REPOSITORY,
      useClass: SupabaseChatChannelRepository,
    },
    // The purge keeps what an open chat report holds (#2481).
    {
      provide: CHAT_MESSAGE_REPORT_REPOSITORY,
      useClass: SupabaseChatMessageReportRepository,
    },
    { provide: STORAGE_PROVIDER, useClass: SupabaseStorageService },
    { provide: ARCHIVE_MEDIA_COPIER, useClass: SupabaseArchiveMediaCopier },
    { provide: DISCORD_BOT_GATEWAY, useClass: DiscordBotGatewayService },
    { provide: DISCORD_OAUTH_CLIENT, useClass: DiscordOAuthClientService },
  ],
})
export class DiscordImportModule {}
