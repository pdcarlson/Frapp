import { TestingModule } from '@nestjs/testing';
import { createUnguardedTestingModule } from '#test/helpers/guard-stubs.factory';
import { DiscordImportController } from './discord-import.controller';
import { DiscordImportService } from '../../application/services/discord-import.service';
import { RbacService } from '../../application/services/rbac.service';
import { SystemPermissions } from '#domain/constants/permissions';

const CHAPTER = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';
const IMPORT_ID = '44444444-4444-4444-8444-444444444444';

/**
 * The two routes that can create roles and grant permissions (#2818). The
 * import itself is gated on `channels:manage`; `roles:manage` is resolved in
 * the handler for the CALLER, and the service decides whether the request
 * needs it. A wrong user, a wrong permission, or a hard-coded answer here
 * would let `channels:manage` alone create roles.
 */
describe('DiscordImportController — roles:manage is resolved for the caller (#2818)', () => {
  let controller: DiscordImportController;
  let importService: {
    setRoleMapping: jest.Mock;
    start: jest.Mock;
  };
  let rbacService: { memberHasAnyPermission: jest.Mock };

  beforeEach(async () => {
    importService = {
      setRoleMapping: jest.fn(async () => ({ id: IMPORT_ID })),
      start: jest.fn(async () => ({ id: IMPORT_ID })),
    };
    rbacService = { memberHasAnyPermission: jest.fn() };

    const module: TestingModule = await createUnguardedTestingModule({
      controllers: [DiscordImportController],
      providers: [
        { provide: DiscordImportService, useValue: importService },
        { provide: RbacService, useValue: rbacService },
      ],
    }).compile();
    controller = module.get(DiscordImportController);
  });

  it.each([true, false])(
    'passes whether the caller holds roles:manage (%s) to the role mapping',
    async (holds) => {
      rbacService.memberHasAnyPermission.mockResolvedValue(holds);
      const roles = [
        {
          discord_role_id: '1',
          discord_role_name: 'Rush Chair',
          action: 'new' as const,
          new_role_name: 'Rush Chair',
        },
      ];

      await controller.setRoleMapping(IMPORT_ID, CHAPTER, USER, { roles });

      expect(rbacService.memberHasAnyPermission).toHaveBeenCalledWith(
        CHAPTER,
        USER,
        [SystemPermissions.ROLES_MANAGE],
      );
      expect(importService.setRoleMapping).toHaveBeenCalledWith(
        IMPORT_ID,
        CHAPTER,
        roles,
        holds,
      );
    },
  );

  it('passes a date cutoff through to start (#2858)', async () => {
    rbacService.memberHasAnyPermission.mockResolvedValue(true);
    await controller.start(
      IMPORT_ID,
      { messages_after: '2024-06-01T00:00:00.000Z' },
      CHAPTER,
      USER,
    );
    expect(importService.start).toHaveBeenCalledWith(
      IMPORT_ID,
      CHAPTER,
      USER,
      true,
      { messagesAfter: '2024-06-01T00:00:00.000Z' },
    );
  });

  it.each([true, false])(
    'passes whether the caller holds roles:manage (%s) to start',
    async (holds) => {
      rbacService.memberHasAnyPermission.mockResolvedValue(holds);

      await controller.start(IMPORT_ID, {}, CHAPTER, USER);

      expect(rbacService.memberHasAnyPermission).toHaveBeenCalledWith(
        CHAPTER,
        USER,
        [SystemPermissions.ROLES_MANAGE],
      );
      expect(importService.start).toHaveBeenCalledWith(
        IMPORT_ID,
        CHAPTER,
        USER,
        holds,
        { messagesAfter: undefined },
      );
    },
  );
});

/**
 * Every route that returns an import returns the view, never the row (#2860).
 * The service hands back the whole `discord_imports` row, worker lease and
 * all; a handler that returned it as is would put `lock_token` back in the
 * browser, and the contract would still say it doesn't.
 */
describe('DiscordImportController — no route returns the worker lease (#2860)', () => {
  let controller: DiscordImportController;

  const leakyRow = {
    id: IMPORT_ID,
    status: 'running',
    source: 'bot',
    guild_name: 'Alpha Beta Discord',
    lock_token: 'LOCK_TOKEN_SECRET',
    locked_by: 'REPLICA_ID_SECRET',
    lease_expires_at: '2026-10-01T03:00:00.000Z',
    attempt_count: 2,
    cursor_part_index: 1,
    storage_prefix: 'chapters/STORAGE_PREFIX_SECRET',
    guild_id: 'GUILD_SNOWFLAKE_SECRET',
  };
  const withProgress = { ...leakyRow, channels_total: 3, channels_done: 1 };

  beforeEach(async () => {
    const module: TestingModule = await createUnguardedTestingModule({
      controllers: [DiscordImportController],
      providers: [
        {
          provide: DiscordImportService,
          useValue: {
            create: jest.fn(async () => leakyRow),
            list: jest.fn(async () => [withProgress]),
            get: jest.fn(async () => withProgress),
            setRoleMapping: jest.fn(async () => leakyRow),
            start: jest.fn(async () => leakyRow),
            cancel: jest.fn(async () => leakyRow),
            clear: jest.fn(async () => leakyRow),
            requestPurge: jest.fn(async () => leakyRow),
          },
        },
        {
          provide: RbacService,
          useValue: { memberHasAnyPermission: jest.fn(async () => true) },
        },
      ],
    }).compile();
    controller = module.get(DiscordImportController);
  });

  const routes: [string, () => Promise<unknown>][] = [
    [
      'POST /',
      () =>
        controller.create(
          CHAPTER,
          { id: USER },
          { consent_acknowledged: true, source: 'bot' },
        ),
    ],
    ['GET /', () => controller.list(CHAPTER)],
    ['GET /:id', () => controller.get(IMPORT_ID, CHAPTER)],
    [
      'PUT /:id/roles',
      () => controller.setRoleMapping(IMPORT_ID, CHAPTER, USER, { roles: [] }),
    ],
    ['POST /:id/start', () => controller.start(IMPORT_ID, {}, CHAPTER, USER)],
    ['POST /:id/cancel', () => controller.cancel(IMPORT_ID, CHAPTER)],
    ['POST /:id/clear', () => controller.clear(IMPORT_ID, CHAPTER)],
    ['DELETE /:id', () => controller.purge(IMPORT_ID, CHAPTER)],
  ];

  it.each(routes)(
    '%s returns none of the worker internals',
    async (_route, call) => {
      const serialized = JSON.stringify(await call());

      for (const secret of [
        'lock_token',
        'LOCK_TOKEN_SECRET',
        'REPLICA_ID_SECRET',
        'lease_expires_at',
        'attempt_count',
        'cursor_part_index',
        'STORAGE_PREFIX_SECRET',
        'GUILD_SNOWFLAKE_SECRET',
      ]) {
        expect(serialized).not.toContain(secret);
      }
      // Still the import: the projection drops internals, not the payload.
      expect(serialized).toContain(IMPORT_ID);
    },
  );

  it('keeps the progress counts on list and detail', async () => {
    await expect(controller.get(IMPORT_ID, CHAPTER)).resolves.toMatchObject({
      channels_total: 3,
      channels_done: 1,
    });
    await expect(controller.list(CHAPTER)).resolves.toEqual([
      expect.objectContaining({ channels_total: 3, channels_done: 1 }),
    ]);
  });
});
