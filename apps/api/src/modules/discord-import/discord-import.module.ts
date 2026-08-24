import { Module } from '@nestjs/common';
import { DiscordImportController } from '../../interface/controllers/discord-import.controller';
import { DiscordConnectionController } from '../../interface/controllers/discord-connection.controller';
import { DiscordImportService } from '../../application/services/discord-import.service';
import { DiscordOAuthService } from '../../application/services/discord-oauth.service';
import { DiscordImportWorkerService } from '../discord-import-worker/discord-import-worker.service';
import { DiscordExportWorkerService } from '../discord-import-worker/discord-export-worker.service';
import { SupabaseDiscordImportRepository } from '../../infrastructure/supabase/repositories/supabase-discord-import.repository';
import { SupabaseDiscordConnectionRepository } from '../../infrastructure/supabase/repositories/supabase-discord-connection.repository';
import { SupabaseChatChannelRepository } from '../../infrastructure/supabase/repositories/supabase-chat-channel.repository';
import { SupabaseStorageService } from '../../infrastructure/storage/supabase-storage.service';
import { DiscordBotGatewayService } from '../../infrastructure/discord/discord-bot-gateway.service';
import { DiscordOAuthClientService } from '../../infrastructure/discord/discord-oauth-client.service';
import { DISCORD_IMPORT_REPOSITORY } from '../../domain/repositories/discord-import.repository.interface';
import { DISCORD_CONNECTION_REPOSITORY } from '../../domain/repositories/discord-connection.repository.interface';
import { CHAT_CHANNEL_REPOSITORY } from '../../domain/repositories/chat.repository.interface';
import { STORAGE_PROVIDER } from '../../domain/adapters/storage.interface';
import {
  DISCORD_BOT_GATEWAY,
  DISCORD_OAUTH_CLIENT,
} from '../../domain/adapters/discord.interface';

/**
 * The Discord archive importer: admin routes, the connect flow, and the worker.
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
  controllers: [DiscordImportController, DiscordConnectionController],
  providers: [
    DiscordImportService,
    DiscordOAuthService,
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
      provide: CHAT_CHANNEL_REPOSITORY,
      useClass: SupabaseChatChannelRepository,
    },
    { provide: STORAGE_PROVIDER, useClass: SupabaseStorageService },
    { provide: DISCORD_BOT_GATEWAY, useClass: DiscordBotGatewayService },
    { provide: DISCORD_OAUTH_CLIENT, useClass: DiscordOAuthClientService },
  ],
  exports: [DiscordImportService, DiscordOAuthService],
})
export class DiscordImportModule {}
