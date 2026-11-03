import { Test } from '@nestjs/testing';
import { DISCORD_IMPORT_REPOSITORY } from '#domain/repositories/discord-import.repository.interface';
import { CHAT_CHANNEL_REPOSITORY } from '#domain/repositories/chat.repository.interface';
import { STORAGE_PROVIDER } from '#domain/adapters/storage.interface';
import { DISCORD_BOT_GATEWAY } from '#domain/adapters/discord.interface';
import type { DiscordImport } from '#domain/entities/discord-import.entity';
import { DiscordImportService } from '../../src/application/services/discord-import.service';
import { DiscordImportChannelMappingService } from '../../src/application/services/discord-import-channel-mapping.service';
import { DiscordImportRoleMappingService } from '../../src/application/services/discord-import-role-mapping.service';
import { DiscordOAuthService } from '../../src/application/services/discord-oauth.service';
import { RbacService } from '../../src/application/services/rbac.service';

/**
 * The shared fixture for the Discord import service specs (#3271): one Nest
 * testing module wiring `DiscordImportService`,
 * `DiscordImportChannelMappingService` and `DiscordImportRoleMappingService`
 * over the same mocked repositories, as `DiscordImportModule` wires them. A
 * case that maps channels and then starts the import sees one import row
 * through all three.
 */
export const CHAPTER = '11111111-1111-4111-8111-111111111111';
export const USER = '33333333-3333-4333-8333-333333333333';
export const IMPORT_ID = '44444444-4444-4444-8444-444444444444';
export const GUILD = '800000000000000001';

/** A channel that exists in this chapter, and nothing else. */
export const OWN_CHANNEL = '66666666-6666-4666-8666-666666666666';
export const FOREIGN_CHANNEL = '77777777-7777-4777-8777-777777777777';

export function job(overrides: Partial<DiscordImport> = {}): DiscordImport {
  return {
    id: IMPORT_ID,
    chapter_id: CHAPTER,
    created_by: USER,
    status: 'draft',
    source: 'upload',
    guild_id: null,
    guild_name: null,
    consent_acknowledged_at: '2026-08-24T12:00:00Z',
    role_mapping: [],
    storage_prefix: `chapters/${CHAPTER}/chat-archive/imports/${IMPORT_ID}`,
    total_messages: 0,
    imported_messages: 0,
    messages_skipped: 0,
    attachments_imported: 0,
    attachments_skipped: 0,
    parts_total: 0,
    cursor_part_index: 0,
    cursor_message_index: 0,
    cursor_part_message_count: 0,
    warnings: [],
    error: null,
    lock_token: null,
    locked_by: null,
    lease_expires_at: null,
    attempt_count: 0,
    created_at: '2026-08-24T12:00:00Z',
    updated_at: '2026-08-24T12:00:00Z',
    completed_at: null,
    purged_at: null,
    purged_messages: 0,
    cleared_at: null,
    messages_after: null,
    ...overrides,
  };
}

/** A channel row as the bot scan records it: skipped until the admin answers. */
export function botChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mapping-1',
    import_id: IMPORT_ID,
    discord_channel_id: '900000000000000001',
    discord_channel_name: 'general',
    discord_category: null,
    mapping_action: 'skip' as const,
    target_channel_id: null,
    new_channel_name: null,
    new_channel_is_read_only: true,
    message_count: 0,
    imported_count: 0,
    status: 'skipped' as const,
    error: null,
    cursor_before_snowflake: null,
    parent_discord_channel_id: null,
    position: 0,
    readable: true,
    private_in_discord: false,
    new_channel_type: 'PUBLIC' as const,
    new_channel_required_permissions: null,
    discord_reader_role_ids: null,
    new_channel_same_as_discord: false,
    ...overrides,
  };
}

export async function createDiscordImportFixture(
  current: DiscordImport = job(),
) {
  const repo: Record<string, jest.Mock> = {
    create: jest.fn(async () => current),
    findById: jest.fn(async () => current),
    findByChapter: jest.fn(async () => [current]),
    update: jest.fn(async (_id, _chapter, patch) => ({ ...current, ...patch })),
    replaceChannels: jest.fn(async (_id, _chapter, rows) => rows),
    findChannels: jest.fn(async () => []),
    countChannels: jest.fn(async () => ({ total: 0, done: 0 })),
    findChannelProgress: jest.fn(async () => ({
      counts: { pending: 0, running: 0, completed: 0, failed: 0, skipped: 0 },
      running: [],
      recent: [],
      failed: [],
    })),
    markCleared: jest.fn(async () => ({ ...current, cleared_at: 'now' })),
    updateChannel: jest.fn(),
    // Registration enforces the archive ceilings itself now, so the default
    // admits everything and the quota tests make it throw. That mirrors the
    // real contract: the service never decides, it translates.
    registerFiles: jest.fn(async (_chapterId, _importId, rows) =>
      rows.map((row: Record<string, unknown>, i: number) => ({
        ...row,
        id: `file-${i}`,
        uploaded_at: null,
        created_at: '2026-08-24T12:00:00Z',
      })),
    ),
    findFiles: jest.fn(async () => []),
    markFilesUploaded: jest.fn(async () => 1),
    claimNextRunnable: jest.fn(),
    renewLease: jest.fn(),
    releaseLease: jest.fn(),
    findExistingExternalIds: jest.fn(),
    insertMessages: jest.fn(),
    insertAttachments: jest.fn(),
    deleteImportedMessages: jest.fn(),
  };
  const storage: Record<string, jest.Mock> = {
    getSignedUploadUrl: jest.fn(async () => 'https://signed.example/put'),
    downloadFile: jest.fn(),
    listFiles: jest.fn(),
    deleteFiles: jest.fn(),
    getSignedDownloadUrl: jest.fn(),
    uploadFile: jest.fn(),
    deleteFile: jest.fn(),
    listObjects: jest.fn(),
    listFolders: jest.fn(),
  };
  const bot: Record<string, jest.Mock> = {
    isConfigured: jest.fn(() => true),
    discoverChannels: jest.fn(),
    verifyChannelInGuild: jest.fn(),
    fetchMessagePage: jest.fn(),
  };
  const oauthService: Record<string, jest.Mock> = {
    requireGuildId: jest.fn(async () => GUILD),
    isAvailable: jest.fn(() => true),
  };
  const channelRepo: Record<string, jest.Mock> = {
    // Chapter-scoped by construction, like the real repository.
    findById: jest.fn(async (id: string, chapterId: string) =>
      id === OWN_CHANNEL && chapterId === CHAPTER
        ? { id, chapter_id: chapterId, name: 'general' }
        : null,
    ),
    create: jest.fn(),
    findRoleGates: jest.fn(async () => []),
  };
  const rbac: Record<string, jest.Mock> = {
    findByChapter: jest.fn(async () => []),
    create: jest.fn(),
    update: jest.fn(),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      DiscordImportService,
      DiscordImportChannelMappingService,
      DiscordImportRoleMappingService,
      { provide: DISCORD_IMPORT_REPOSITORY, useValue: repo },
      { provide: STORAGE_PROVIDER, useValue: storage },
      { provide: CHAT_CHANNEL_REPOSITORY, useValue: channelRepo },
      // The bot path's collaborators. An upload-path case never reaches
      // them; a bot-path case stubs what it needs.
      { provide: DISCORD_BOT_GATEWAY, useValue: bot },
      { provide: DiscordOAuthService, useValue: oauthService },
      { provide: RbacService, useValue: rbac },
    ],
  }).compile();
  return {
    repo,
    storage,
    channelRepo,
    bot,
    oauthService,
    rbac,
    service: moduleRef.get(DiscordImportService),
    channelMapping: moduleRef.get(DiscordImportChannelMappingService),
    roleMapping: moduleRef.get(DiscordImportRoleMappingService),
  };
}

export type DiscordImportFixture = Awaited<
  ReturnType<typeof createDiscordImportFixture>
>;
