import { ForbiddenException } from '@nestjs/common';
import type { DiscordImport } from '#domain/entities/discord-import.entity';
import {
  CHAPTER,
  GUILD,
  IMPORT_ID,
  OWN_CHANNEL,
  USER,
  botChannel,
  createDiscordImportFixture,
  job,
  type DiscordImportFixture,
} from '#test/helpers/discord-import-service.fixture';

// Moved out of `discord-import.service.spec.ts` with the methods (#3271).
// `provisionRoles` runs inside `DiscordImportService.start`, so the starting
// cases below drive it through `start`, as the route does.

let repo: DiscordImportFixture['repo'];
let channelRepo: DiscordImportFixture['channelRepo'];
let bot: DiscordImportFixture['bot'];
let rbac: DiscordImportFixture['rbac'];
let service: DiscordImportFixture['service'];
let channelMapping: DiscordImportFixture['channelMapping'];
let roleMapping: DiscordImportFixture['roleMapping'];

async function build(current: DiscordImport = job()) {
  ({ repo, channelRepo, bot, rbac, service, channelMapping, roleMapping } =
    await createDiscordImportFixture(current));
  return service;
}

describe('DiscordImportRoleMappingService — a started import is fixed', () => {
  it.each(['running', 'completed', 'purging'] as const)(
    'refuses to save the role step on a %s import',
    async (status) => {
      await build(job({ status }));
      await expect(
        roleMapping.setRoleMapping(IMPORT_ID, CHAPTER, [], true),
      ).rejects.toThrow(/can no longer be changed/);
      expect(repo.update).not.toHaveBeenCalled();
    },
  );
});

describe('DiscordImportRoleMappingService — Discord roles gate private channels (#2818)', () => {
  const EXEC_ROLE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const MEMBER_ROLE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const OTHER_CHAPTER_ROLE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const D_EXEC = '910000000000000001';
  const D_RUSH = '910000000000000002';
  const D_PLEDGE = '910000000000000003';
  const D_BROTHER = '910000000000000004';

  function role(overrides: Record<string, unknown>) {
    return {
      chapter_id: CHAPTER,
      system_key: null,
      permissions: [],
      is_system: false,
      display_order: 3,
      color: null,
      created_at: '2026-09-28T00:00:00Z',
      ...overrides,
    };
  }

  /**
   * `RbacService.create` as the import sees it: the role exists, then
   * `onCreated` runs, then the audit row would be written.
   */
  const createsRole =
    (id = 'new-role-1') =>
    async (
      _chapter: string,
      _user: string,
      data: Record<string, unknown>,
      onCreated?: (created: Record<string, unknown>) => Promise<void>,
    ) => {
      const created = { ...role({ id }), ...data };
      await onCreated?.(created);
      return created;
    };

  const chapterRoles = () => [
    role({ id: EXEC_ROLE, name: 'Exec', permissions: ['members:view'] }),
    role({
      id: MEMBER_ROLE,
      name: 'Member',
      system_key: 'MEMBER',
      is_system: true,
      display_order: 5,
      permissions: ['members:view'],
    }),
  ];

  /** The mapping as the role step saves it: Exec, a new Rush Chair, Pledge ignored. */
  const savedMapping = () => [
    {
      discord_role_id: D_EXEC,
      discord_role_name: 'Exec',
      action: 'existing' as const,
      frapp_role_id: EXEC_ROLE,
      new_role_name: null,
      read_permission: 'channels:read:exec',
    },
    {
      discord_role_id: D_RUSH,
      discord_role_name: 'Rush Chair',
      action: 'new' as const,
      frapp_role_id: null,
      new_role_name: 'Rush Chair',
      read_permission: 'channels:read:rush-chair',
    },
    {
      discord_role_id: D_PLEDGE,
      discord_role_name: 'Pledge',
      action: 'ignore' as const,
      frapp_role_id: null,
      new_role_name: null,
      read_permission: null,
    },
  ];

  describe('saving the role step', () => {
    it('refuses to map anything without permission to manage roles, and writes nothing', async () => {
      // Starting the import creates roles and grants permissions, which
      // Settings -> Roles needs roles:manage for; channels:manage alone must
      // not reach it through the importer.
      await build(job({ source: 'bot' }));
      await expect(
        roleMapping.setRoleMapping(
          IMPORT_ID,
          CHAPTER,
          [
            {
              discord_role_id: D_RUSH,
              discord_role_name: 'Rush Chair',
              action: 'new',
              new_role_name: 'Rush Chair',
            },
          ],
          false,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('lets an all-Ignore mapping through without it, and grants nothing', async () => {
      await build(job({ source: 'bot' }));
      await roleMapping.setRoleMapping(
        IMPORT_ID,
        CHAPTER,
        [
          {
            discord_role_id: D_PLEDGE,
            discord_role_name: 'Pledge',
            action: 'ignore',
            // Ignored is ignored, whatever else the caller sends.
            frapp_role_id: EXEC_ROLE,
          },
        ],
        false,
      );
      expect(repo.update).toHaveBeenCalledWith(IMPORT_ID, CHAPTER, {
        role_mapping: [
          {
            discord_role_id: D_PLEDGE,
            discord_role_name: 'Pledge',
            action: 'ignore',
            frapp_role_id: null,
            new_role_name: null,
            read_permission: null,
          },
        ],
      });
      expect(rbac.create).not.toHaveBeenCalled();
      expect(rbac.update).not.toHaveBeenCalled();
    });

    it("refuses a role that is not one of this chapter's", async () => {
      await build(job({ source: 'bot' }));
      rbac.findByChapter.mockResolvedValue(chapterRoles());
      await expect(
        roleMapping.setRoleMapping(
          IMPORT_ID,
          CHAPTER,
          [
            {
              discord_role_id: D_EXEC,
              discord_role_name: 'Exec',
              action: 'existing',
              frapp_role_id: OTHER_CHAPTER_ROLE,
            },
          ],
          true,
        ),
      ).rejects.toThrow(/not one of this chapter's roles/);
      expect(rbac.findByChapter).toHaveBeenCalledWith(CHAPTER);
    });

    it('refuses a new role whose name is taken, ignoring case, and says to map to it', async () => {
      await build(job({ source: 'bot' }));
      rbac.findByChapter.mockResolvedValue(chapterRoles());
      await expect(
        roleMapping.setRoleMapping(
          IMPORT_ID,
          CHAPTER,
          [
            {
              discord_role_id: D_EXEC,
              discord_role_name: 'exec',
              action: 'new',
              new_role_name: ' EXEC ',
            },
          ],
          true,
        ),
      ).rejects.toThrow(/A role named "Exec" already exists/);
    });

    it('gives each Frapp role one read permission of its own, and never takes one from the caller', async () => {
      await build(job({ source: 'bot' }));
      rbac.findByChapter.mockResolvedValue([
        // Exec already holds the permission an earlier import gave it alone,
        // so it keeps it rather than collecting a second one.
        role({
          id: EXEC_ROLE,
          name: 'Exec',
          permissions: ['members:view', 'channels:read:exec-board'],
        }),
        // Two roles hold `channels:read:member`, so it gates more than one
        // role and is not Member's to reuse; the next free string is.
        role({
          id: MEMBER_ROLE,
          name: 'Member',
          permissions: ['channels:read:member'],
        }),
        role({
          id: OTHER_CHAPTER_ROLE,
          name: 'Alumni',
          permissions: ['channels:read:member', 'channels:read:rush-chair'],
        }),
      ]);
      await roleMapping.setRoleMapping(
        IMPORT_ID,
        CHAPTER,
        [
          {
            discord_role_id: D_EXEC,
            discord_role_name: 'Exec',
            action: 'existing',
            frapp_role_id: EXEC_ROLE,
          },
          {
            discord_role_id: D_BROTHER,
            discord_role_name: 'Brother',
            action: 'existing',
            frapp_role_id: MEMBER_ROLE,
          },
          {
            discord_role_id: D_PLEDGE,
            discord_role_name: 'Active',
            action: 'existing',
            frapp_role_id: MEMBER_ROLE,
          },
          {
            discord_role_id: D_RUSH,
            discord_role_name: 'Rush Chair',
            action: 'new',
            new_role_name: 'Rush Chair',
          },
        ],
        true,
      );
      const [, , patch] = repo.update.mock.calls[0];
      expect(
        patch.role_mapping.map(
          (entry: { read_permission: string | null }) => entry.read_permission,
        ),
      ).toEqual([
        'channels:read:exec-board',
        'channels:read:member-2',
        'channels:read:member-2',
        'channels:read:rush-chair-2',
      ]);
      // Saving creates and grants nothing; starting does.
      expect(rbac.create).not.toHaveBeenCalled();
      expect(rbac.update).not.toHaveBeenCalled();
    });
  });

  describe('saving the role step: strings already spoken for', () => {
    const newRush = [
      {
        discord_role_id: D_RUSH,
        discord_role_name: 'Rush Chair',
        action: 'new' as const,
        new_role_name: 'Rush Chair',
      },
    ];
    const savedPermission = () =>
      repo.update.mock.calls[0][2].role_mapping[0].read_permission;

    it('never reissues a string that still gates a channel, though no role holds it', async () => {
      // An earlier import's #rush is gated on channels:read:rush-chair, and
      // the role that held it has since been deleted.
      await build(job({ source: 'bot' }));
      rbac.findByChapter.mockResolvedValue(chapterRoles());
      channelRepo.findRoleGates.mockResolvedValue([
        { id: 'old-rush', required_permissions: ['channels:read:rush-chair'] },
      ]);
      await roleMapping.setRoleMapping(IMPORT_ID, CHAPTER, newRush, true);
      expect(savedPermission()).toBe('channels:read:rush-chair-2');
    });

    it("never reissues a string another import's saved mapping already gave out", async () => {
      await build(job({ source: 'bot' }));
      rbac.findByChapter.mockResolvedValue(chapterRoles());
      repo.findByChapter.mockResolvedValue([
        job({ source: 'bot' }),
        job({
          id: 'other-import',
          source: 'bot',
          role_mapping: [
            {
              ...savedMapping()[1],
              discord_role_id: 'someone-else',
            },
          ],
        }),
      ]);
      await roleMapping.setRoleMapping(IMPORT_ID, CHAPTER, newRush, true);
      expect(savedPermission()).toBe('channels:read:rush-chair-2');
    });

    it('keeps pointing at the role an earlier, failed start of this import created', async () => {
      await build(
        job({
          source: 'bot',
          status: 'failed',
          role_mapping: [{ ...savedMapping()[1], frapp_role_id: 'rush-role' }],
        }),
      );
      rbac.findByChapter.mockResolvedValue([
        ...chapterRoles(),
        role({
          id: 'rush-role',
          name: 'Rush Chair',
          permissions: ['channels:read:rush-chair'],
        }),
      ]);
      await roleMapping.setRoleMapping(IMPORT_ID, CHAPTER, newRush, true);
      expect(repo.update.mock.calls[0][2].role_mapping[0]).toMatchObject({
        action: 'new',
        frapp_role_id: 'rush-role',
        read_permission: 'channels:read:rush-chair',
      });
    });
  });

  describe('mapping a channel "Same as Discord"', () => {
    const privateChannel = (overrides: Record<string, unknown> = {}) =>
      botChannel({
        discord_channel_id: '900000000000000002',
        discord_channel_name: 'exec',
        private_in_discord: true,
        discord_reader_role_ids: [D_EXEC, D_RUSH, D_PLEDGE],
        ...overrides,
      });
    const sameAsDiscord = {
      discord_channel_id: '900000000000000002',
      discord_channel_name: 'exec',
      mapping_action: 'create_new' as const,
      new_channel_name: 'exec',
      new_channel_visibility: 'discord' as const,
      // Sent, and ignored: the API works the gate out itself.
      new_channel_required_permissions: ['billing:manage'],
    };

    it('gates it on the mapped readers, leaves the ignored one out, and carries it to its threads', async () => {
      await build(job({ source: 'bot', role_mapping: savedMapping() }));
      repo.findChannels.mockResolvedValue([
        privateChannel(),
        privateChannel({
          id: 'mapping-2',
          discord_channel_id: '900000000000000003',
          discord_channel_name: 'exec › dues',
          parent_discord_channel_id: '900000000000000002',
          discord_reader_role_ids: null,
        }),
      ]);

      await channelMapping.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
        sameAsDiscord,
      ]);

      const [, , rows] = repo.replaceChannels.mock.calls[0];
      for (const row of rows) {
        expect(row).toMatchObject({
          mapping_action: 'create_new',
          new_channel_type: 'ROLE_GATED',
          new_channel_required_permissions: [
            'channels:read:exec',
            'channels:read:rush-chair',
          ],
          new_channel_same_as_discord: true,
        });
      }
      // The scan's fact is carried across the re-map, never taken from the caller.
      expect(rows[0].discord_reader_role_ids).toEqual([
        D_EXEC,
        D_RUSH,
        D_PLEDGE,
      ]);
    });

    it('refuses it when none of the readers is mapped', async () => {
      await build(job({ source: 'bot', role_mapping: savedMapping() }));
      repo.findChannels.mockResolvedValue([
        privateChannel({ discord_reader_role_ids: [D_PLEDGE] }),
      ]);
      await expect(
        channelMapping.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
          sameAsDiscord,
        ]),
      ).rejects.toThrow(/None of the Discord roles that could read #exec/);
      expect(repo.replaceChannels).not.toHaveBeenCalled();
    });

    it('refuses it for a channel the scan did not see was private', async () => {
      await build(job({ source: 'bot', role_mapping: savedMapping() }));
      repo.findChannels.mockResolvedValue([
        privateChannel({
          private_in_discord: null,
          discord_reader_role_ids: null,
        }),
      ]);
      await expect(
        channelMapping.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
          sameAsDiscord,
        ]),
      ).rejects.toThrow(/cannot be "Same as Discord"/);
    });

    it('refuses it on an uploaded export, which carries no roles', async () => {
      await build(job({ source: 'upload' }));
      await expect(
        channelMapping.setChannelMapping(IMPORT_ID, CHAPTER, [sameAsDiscord]),
      ).rejects.toThrow(/cannot be "Same as Discord"/);
      expect(repo.replaceChannels).not.toHaveBeenCalled();
    });
  });

  describe('starting the import', () => {
    const gated = (overrides: Record<string, unknown> = {}) =>
      botChannel({
        discord_channel_name: 'exec',
        mapping_action: 'create_new',
        status: 'pending',
        new_channel_name: 'exec',
        private_in_discord: true,
        discord_reader_role_ids: [D_EXEC, D_RUSH, D_PLEDGE],
        new_channel_type: 'ROLE_GATED',
        new_channel_required_permissions: [
          'channels:read:exec',
          'channels:read:rush-chair',
        ],
        new_channel_same_as_discord: true,
        ...overrides,
      });

    it('creates the new roles with only their read gate, grants existing roles theirs, and assigns nobody', async () => {
      const svc = await build(
        job({ source: 'bot', guild_id: GUILD, role_mapping: savedMapping() }),
      );
      repo.findChannels.mockResolvedValue([gated()]);
      rbac.findByChapter.mockResolvedValue(chapterRoles());
      rbac.create.mockImplementation(createsRole());
      rbac.update.mockImplementation(async (id, _chapter, _user, data) => ({
        ...role({ id }),
        ...data,
      }));

      await svc.start(IMPORT_ID, CHAPTER, USER, true);

      expect(rbac.create).toHaveBeenCalledTimes(1);
      expect(rbac.create).toHaveBeenCalledWith(
        CHAPTER,
        USER,
        {
          name: 'Rush Chair',
          permissions: ['channels:read:rush-chair'],
          // After every existing role, so it lists below the seeded ones.
          display_order: 6,
          color: null,
        },
        expect.any(Function),
      );
      expect(rbac.update).toHaveBeenCalledTimes(1);
      expect(rbac.update).toHaveBeenCalledWith(EXEC_ROLE, CHAPTER, USER, {
        permissions: ['members:view', 'channels:read:exec'],
      });
      const [, , patch] = repo.update.mock.calls.at(-1);
      expect(patch.status).toBe('ready');
      expect(
        patch.role_mapping.find(
          (entry: { discord_role_id: string }) =>
            entry.discord_role_id === D_RUSH,
        ),
      ).toMatchObject({ action: 'new', frapp_role_id: 'new-role-1' });
    });

    // The role's audit row is written after the role exists and can fail
    // (#1599). The id must already be on the import by then, or the retry
    // refuses the role this import just made as someone else's (#2599).
    it("records a new role's id before its audit write, so a start that fails there resumes onto it", async () => {
      const svc = await build(
        job({ source: 'bot', guild_id: GUILD, role_mapping: savedMapping() }),
      );
      repo.findChannels.mockResolvedValue([gated()]);
      rbac.findByChapter.mockResolvedValue(chapterRoles());
      rbac.create.mockImplementation(
        async (
          chapter: string,
          user: string,
          data: Record<string, unknown>,
          onCreated?: (created: Record<string, unknown>) => Promise<void>,
        ) => {
          await createsRole()(chapter, user, data, onCreated);
          throw new Error('audit insert failed');
        },
      );

      await expect(svc.start(IMPORT_ID, CHAPTER, USER, true)).rejects.toThrow(
        'audit insert failed',
      );
      const [, , recorded] = repo.update.mock.calls.at(-1);
      expect(recorded.status).toBeUndefined();
      expect(
        recorded.role_mapping.find(
          (entry: { discord_role_id: string }) =>
            entry.discord_role_id === D_RUSH,
        ),
      ).toMatchObject({ action: 'new', frapp_role_id: 'new-role-1' });

      // The retry reads the mapping the failed start left behind.
      const retry = await build(
        job({
          source: 'bot',
          guild_id: GUILD,
          role_mapping: recorded.role_mapping,
        }),
      );
      repo.findChannels.mockResolvedValue([gated()]);
      rbac.findByChapter.mockResolvedValue([
        ...chapterRoles(),
        role({
          id: 'new-role-1',
          name: 'Rush Chair',
          permissions: ['channels:read:rush-chair'],
        }),
      ]);
      rbac.update.mockImplementation(async (id, _chapter, _user, data) => ({
        ...role({ id }),
        ...data,
      }));

      await retry.start(IMPORT_ID, CHAPTER, USER, true);

      expect(rbac.create).not.toHaveBeenCalled();
      expect(rbac.update).toHaveBeenCalledWith(EXEC_ROLE, CHAPTER, USER, {
        permissions: ['members:view', 'channels:read:exec'],
      });
      const [, , patch] = repo.update.mock.calls.at(-1);
      expect(patch.status).toBe('ready');
    });

    it('creates a new role that gates nothing with no permissions at all', async () => {
      const svc = await build(
        job({ source: 'bot', guild_id: GUILD, role_mapping: savedMapping() }),
      );
      repo.findChannels.mockResolvedValue([
        gated({
          discord_reader_role_ids: [D_EXEC],
          new_channel_required_permissions: ['channels:read:exec'],
        }),
      ]);
      rbac.findByChapter.mockResolvedValue(chapterRoles());
      rbac.create.mockImplementation(createsRole());
      rbac.update.mockImplementation(async (id, _chapter, _user, data) => ({
        ...role({ id }),
        ...data,
      }));

      await svc.start(IMPORT_ID, CHAPTER, USER, true);

      expect(rbac.create).toHaveBeenCalledWith(
        CHAPTER,
        USER,
        expect.objectContaining({ name: 'Rush Chair', permissions: [] }),
        expect.any(Function),
      );
    });

    it("refuses, rather than adopts, a role someone added under a new role's name since", async () => {
      // Saving would have refused the clash; adopting it at start would give
      // its members the imported channels without anyone choosing that.
      const svc = await build(
        job({ source: 'bot', guild_id: GUILD, role_mapping: savedMapping() }),
      );
      repo.findChannels.mockResolvedValue([gated()]);
      rbac.findByChapter.mockResolvedValue([
        ...chapterRoles(),
        role({ id: 'someone-elses', name: 'rush chair', permissions: [] }),
      ]);

      await expect(svc.start(IMPORT_ID, CHAPTER, USER, true)).rejects.toThrow(
        /A role named "rush chair" was added since the roles were mapped/,
      );
      expect(rbac.create).not.toHaveBeenCalled();
      expect(rbac.update).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('needs roles:manage to grant a read permission to an existing role, even when it creates none', async () => {
      const grantOnly = savedMapping().map((entry) =>
        entry.discord_role_id === D_RUSH
          ? {
              ...entry,
              action: 'ignore' as const,
              new_role_name: null,
              read_permission: null,
            }
          : entry,
      );
      const svc = await build(
        job({ source: 'bot', guild_id: GUILD, role_mapping: grantOnly }),
      );
      repo.findChannels.mockResolvedValue([
        gated({
          discord_reader_role_ids: [D_EXEC],
          new_channel_required_permissions: ['channels:read:exec'],
        }),
      ]);
      rbac.findByChapter.mockResolvedValue(chapterRoles());

      await expect(
        svc.start(IMPORT_ID, CHAPTER, USER, false),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(rbac.update).not.toHaveBeenCalled();
    });

    it('checks the gate of a channel this import merges into, which it did not create', async () => {
      const svc = await build(
        job({ source: 'bot', guild_id: GUILD, role_mapping: savedMapping() }),
      );
      repo.findChannels.mockResolvedValue([
        gated(),
        botChannel({
          id: 'row-board',
          discord_channel_id: '900000000000000007',
          mapping_action: 'use_existing',
          status: 'pending',
          target_channel_id: 'board',
        }),
      ]);
      rbac.findByChapter.mockResolvedValue(chapterRoles());
      // #board's role was deleted; its gate is left on the string.
      channelRepo.findRoleGates.mockResolvedValue([
        { id: 'board', required_permissions: ['channels:read:rush-chair'] },
      ]);

      await expect(svc.start(IMPORT_ID, CHAPTER, USER, true)).rejects.toThrow(
        /channels:read:rush-chair is already in use/,
      );
      expect(rbac.create).not.toHaveBeenCalled();
    });

    it('refuses a channel whose gate no longer matches the role mapping, before creating anything', async () => {
      // Rush Chair was set to Ignore after the channels were mapped.
      const mapping = savedMapping().map((entry) =>
        entry.discord_role_id === D_RUSH
          ? {
              ...entry,
              action: 'ignore' as const,
              new_role_name: null,
              read_permission: null,
            }
          : entry,
      );
      const svc = await build(
        job({ source: 'bot', guild_id: GUILD, role_mapping: mapping }),
      );
      repo.findChannels.mockResolvedValue([gated()]);

      await expect(svc.start(IMPORT_ID, CHAPTER, USER, true)).rejects.toThrow(
        /role mapping changed after #exec was mapped/,
      );
      expect(rbac.create).not.toHaveBeenCalled();
      expect(rbac.update).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });

    const provisionable = () => {
      rbac.findByChapter.mockResolvedValue(chapterRoles());
      rbac.create.mockImplementation(createsRole());
      rbac.update.mockImplementation(async (id, _chapter, _user, data) => ({
        ...role({ id }),
        ...data,
      }));
    };

    it('refuses, before writing anything, a read permission another role now holds', async () => {
      const svc = await build(
        job({ source: 'bot', guild_id: GUILD, role_mapping: savedMapping() }),
      );
      repo.findChannels.mockResolvedValue([gated()]);
      provisionable();
      rbac.findByChapter.mockResolvedValue([
        ...chapterRoles(),
        role({
          id: 'alumni',
          name: 'Alumni',
          permissions: ['channels:read:exec'],
        }),
      ]);
      await expect(svc.start(IMPORT_ID, CHAPTER, USER, true)).rejects.toThrow(
        /channels:read:exec is already in use/,
      );
      expect(rbac.create).not.toHaveBeenCalled();
      expect(rbac.update).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('refuses to grant a string that already gates a channel this import did not create', async () => {
      const svc = await build(
        job({ source: 'bot', guild_id: GUILD, role_mapping: savedMapping() }),
      );
      repo.findChannels.mockResolvedValue([gated()]);
      provisionable();
      channelRepo.findRoleGates.mockResolvedValue([
        { id: 'old-exec', required_permissions: ['channels:read:exec'] },
      ]);
      await expect(svc.start(IMPORT_ID, CHAPTER, USER, true)).rejects.toThrow(
        /channels:read:exec is already in use/,
      );
      expect(rbac.create).not.toHaveBeenCalled();
    });

    it('is not put off by the gate of a channel this import already created', async () => {
      // A resumed import: #exec exists (and is gated) from the first run,
      // #rush is still to come.
      const svc = await build(
        job({ source: 'bot', guild_id: GUILD, role_mapping: savedMapping() }),
      );
      repo.findChannels.mockResolvedValue([
        gated({ id: 'row-exec', target_channel_id: 'created-exec' }),
        gated({
          id: 'row-rush',
          discord_channel_id: '900000000000000009',
          discord_channel_name: 'rush',
        }),
      ]);
      provisionable();
      channelRepo.findRoleGates.mockResolvedValue([
        {
          id: 'created-exec',
          required_permissions: [
            'channels:read:exec',
            'channels:read:rush-chair',
          ],
        },
      ]);
      await svc.start(IMPORT_ID, CHAPTER, USER, true);
      expect(rbac.create).toHaveBeenCalledTimes(1);
    });

    it('needs roles:manage from whoever starts it when it creates or grants, and says so', async () => {
      const svc = await build(
        job({ source: 'bot', guild_id: GUILD, role_mapping: savedMapping() }),
      );
      repo.findChannels.mockResolvedValue([gated()]);
      provisionable();
      await expect(
        svc.start(IMPORT_ID, CHAPTER, USER, false),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(rbac.create).not.toHaveBeenCalled();
      expect(rbac.update).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('needs nothing more when every role and grant is already in place', async () => {
      const svc = await build(
        job({
          source: 'bot',
          guild_id: GUILD,
          role_mapping: savedMapping().map((entry) =>
            entry.discord_role_id === D_RUSH
              ? { ...entry, frapp_role_id: 'rush-role' }
              : entry,
          ),
        }),
      );
      repo.findChannels.mockResolvedValue([gated()]);
      rbac.findByChapter.mockResolvedValue([
        role({
          id: EXEC_ROLE,
          name: 'Exec',
          permissions: ['channels:read:exec'],
        }),
        role({
          id: 'rush-role',
          name: 'Rush Chair',
          permissions: ['channels:read:rush-chair'],
        }),
      ]);
      await svc.start(IMPORT_ID, CHAPTER, USER, false);
      expect(repo.update).toHaveBeenCalledWith(
        IMPORT_ID,
        CHAPTER,
        expect.objectContaining({ status: 'ready' }),
      );
    });

    it('records each new role on the import as soon as it exists, so a failed start still points at it', async () => {
      const svc = await build(
        job({ source: 'bot', guild_id: GUILD, role_mapping: savedMapping() }),
      );
      repo.findChannels.mockResolvedValue([gated()]);
      provisionable();
      rbac.update.mockRejectedValue(new Error('roles table unavailable'));

      await expect(svc.start(IMPORT_ID, CHAPTER, USER, true)).rejects.toThrow(
        'roles table unavailable',
      );
      expect(repo.update).toHaveBeenCalledTimes(1);
      const [, , patch] = repo.update.mock.calls[0];
      expect(patch.status).toBeUndefined();
      expect(
        patch.role_mapping.find(
          (entry: { discord_role_id: string }) =>
            entry.discord_role_id === D_RUSH,
        ),
      ).toMatchObject({ frapp_role_id: 'new-role-1' });
    });

    it('does not re-check a channel already created, whose gate is already set', async () => {
      // Resuming after the role step was saved again: #exec's Frapp channel
      // exists, so its old gate is history, not a mismatch.
      const svc = await build(
        job({ source: 'bot', guild_id: GUILD, role_mapping: savedMapping() }),
      );
      repo.findChannels.mockResolvedValue([
        gated({
          target_channel_id: 'created-exec',
          new_channel_required_permissions: ['channels:read:old'],
        }),
        gated({
          id: 'row-done',
          discord_channel_id: '900000000000000008',
          status: 'completed',
          new_channel_required_permissions: ['channels:read:old'],
        }),
      ]);
      provisionable();
      await svc.start(IMPORT_ID, CHAPTER, USER, true);
      expect(repo.update).toHaveBeenCalledWith(
        IMPORT_ID,
        CHAPTER,
        expect.objectContaining({ status: 'ready' }),
      );
    });

    it('reads a mapping saved before #2818 as granting nothing', async () => {
      const svc = await build(
        job({
          source: 'bot',
          guild_id: GUILD,
          role_mapping: [
            {
              discord_role_id: D_EXEC,
              discord_role_name: 'Exec',
              signet_role_key: 'PRESIDENT',
            },
          ] as never,
        }),
      );
      repo.findChannels.mockResolvedValue([
        botChannel({
          mapping_action: 'use_existing',
          target_channel_id: OWN_CHANNEL,
        }),
      ]);

      await svc.start(IMPORT_ID, CHAPTER, USER, true);

      expect(rbac.findByChapter).not.toHaveBeenCalled();
      expect(rbac.create).not.toHaveBeenCalled();
      expect(rbac.update).not.toHaveBeenCalled();
    });
  });
});
