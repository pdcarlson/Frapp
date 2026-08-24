import { Module } from '@nestjs/common';
import { DiscordImportController } from '../../interface/controllers/discord-import.controller';
import { DiscordImportService } from '../../application/services/discord-import.service';
import { DiscordImportWorkerService } from '../discord-import-worker/discord-import-worker.service';
import { SupabaseDiscordImportRepository } from '../../infrastructure/supabase/repositories/supabase-discord-import.repository';
import { SupabaseChatChannelRepository } from '../../infrastructure/supabase/repositories/supabase-chat-channel.repository';
import { SupabaseStorageService } from '../../infrastructure/storage/supabase-storage.service';
import { DISCORD_IMPORT_REPOSITORY } from '../../domain/repositories/discord-import.repository.interface';
import { CHAT_CHANNEL_REPOSITORY } from '../../domain/repositories/chat.repository.interface';
import { STORAGE_PROVIDER } from '../../domain/adapters/storage.interface';

/**
 * The Discord archive importer: admin routes plus the worker that runs them.
 *
 * Registers `STORAGE_PROVIDER` itself, as every storage-using module here does
 * — there is no central storage module in this repo.
 *
 * The worker lives in a sibling directory but is provided here so the `@Cron`
 * is registered exactly once. It reuses `CHAT_CHANNEL_REPOSITORY` rather than
 * restating channel creation, so an imported channel is created through the
 * same path as any other.
 */
@Module({
  controllers: [DiscordImportController],
  providers: [
    DiscordImportService,
    DiscordImportWorkerService,
    { provide: DISCORD_IMPORT_REPOSITORY, useClass: SupabaseDiscordImportRepository },
    { provide: CHAT_CHANNEL_REPOSITORY, useClass: SupabaseChatChannelRepository },
    { provide: STORAGE_PROVIDER, useClass: SupabaseStorageService },
  ],
  exports: [DiscordImportService],
})
export class DiscordImportModule {}
