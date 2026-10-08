import { ServiceUnavailableException } from '@nestjs/common';
import { DiscordNotConfiguredError } from '#domain/adapters/discord.interface';
import type { DiscordImport } from '#domain/entities/discord-import.entity';
import {
  CHAPTER,
  FOREIGN_CHANNEL,
  GUILD,
  IMPORT_ID,
  OWN_CHANNEL,
  botChannel,
  createDiscordImportFixture,
  job,
  type DiscordImportFixture,
} from '#test/helpers/discord-import-service.fixture';

// Moved out of `discord-import.service.spec.ts` with the methods (#3271). The
// fixture wires the real `DiscordImportService` beside this service, so a case
// can map channels and then start the import against the same row.

let repo: DiscordImportFixture['repo'];
let channelRepo: DiscordImportFixture['channelRepo'];
let bot: DiscordImportFixture['bot'];
let channelMapping: DiscordImportFixture['channelMapping'];

async function build(current: DiscordImport = job()) {
  ({ repo, channelRepo, bot, channelMapping } =
    await createDiscordImportFixture(current));
}

describe('DiscordImportChannelMappingService — channel mapping', () => {
  it('refuses a merge with no target chosen', async () => {
    // "Ask, never guess": chat_channels has no unique (chapter_id, name), so a
    // same-name match is never an answer.
    await build();
    await expect(
      channelMapping.setChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: '1',
          discord_channel_name: 'general',
          mapping_action: 'use_existing',
        },
      ]),
    ).rejects.toThrow(/Pick a Frapp channel/);
  });

  it('refuses a target channel from another chapter', async () => {
    // The highest-consequence input on this surface. `chat_messages` has no
    // `chapter_id`, so its FK accepts any channel in the product — and the
    // purge scopes its delete by the import's chapter, so history written into
    // another chapter could never be removed.
    await build();
    await expect(
      channelMapping.setChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: '1',
          discord_channel_name: 'general',
          mapping_action: 'use_existing',
          target_channel_id: FOREIGN_CHANNEL,
        },
      ]),
    ).rejects.toThrow(/not one of this chapter/);
  });

  it('accepts a target channel that belongs to this chapter', async () => {
    await build();
    const rows = await channelMapping.setChannelMapping(IMPORT_ID, CHAPTER, [
      {
        discord_channel_id: '1',
        discord_channel_name: 'general',
        mapping_action: 'use_existing',
        target_channel_id: OWN_CHANNEL,
      },
    ]);

    expect(rows[0].target_channel_id).toBe(OWN_CHANNEL);
    expect(channelRepo.findById).toHaveBeenCalledWith(OWN_CHANNEL, CHAPTER);
  });

  it('refuses a direct message or group DM as a target (#2856)', async () => {
    await build();
    for (const type of ['DM', 'GROUP_DM']) {
      channelRepo.findById.mockResolvedValueOnce({
        id: OWN_CHANNEL,
        chapter_id: CHAPTER,
        name: 'officers',
        type,
      });
      await expect(
        channelMapping.setChannelMapping(IMPORT_ID, CHAPTER, [
          {
            discord_channel_id: '1',
            discord_channel_name: 'officers',
            mapping_action: 'use_existing',
            target_channel_id: OWN_CHANNEL,
          },
        ]),
      ).rejects.toThrow(/can't be imported into a direct message/);
    }
  });

  it('refuses a new channel with no name', async () => {
    await build();
    await expect(
      channelMapping.setChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: '1',
          discord_channel_name: 'general',
          mapping_action: 'create_new',
          new_channel_name: '   ',
          new_channel_visibility: 'chapter',
        },
      ]),
    ).rejects.toThrow(/Name the new channel/);
  });

  it('drops a target sent with a new channel, as the bot path does (#2856)', async () => {
    // A create_new row's target is the channel the import creates for it,
    // which like-named rows then share; a client-sent id there would be an
    // unvalidated channel those rows could be sent into.
    await build();
    const rows = await channelMapping.setChannelMapping(IMPORT_ID, CHAPTER, [
      {
        discord_channel_id: '1',
        discord_channel_name: 'general',
        mapping_action: 'create_new',
        new_channel_name: 'general',
        new_channel_visibility: 'chapter',
        target_channel_id: FOREIGN_CHANNEL,
      },
    ]);

    expect(rows[0].target_channel_id).toBeNull();
  });

  it('marks a skipped channel skipped rather than pending', async () => {
    await build();
    const rows = await channelMapping.setChannelMapping(IMPORT_ID, CHAPTER, [
      {
        discord_channel_id: '1',
        discord_channel_name: 'general',
        mapping_action: 'skip',
      },
    ]);
    expect(rows[0].status).toBe('skipped');
  });
});

describe('DiscordImportChannelMappingService — discovering a guild', () => {
  it('records every discovered channel as skip, so nothing imports unasked', async () => {
    await build(job({ source: 'bot' }));
    bot.discoverChannels.mockResolvedValue({
      channels: [
        {
          id: '900000000000000001',
          name: 'general',
          guildId: GUILD,
          categoryName: 'Text',
          parentChannelId: null,
          isThread: false,
        },
      ],
      warnings: [],
      roles: [{ id: '3', name: 'Exec' }],
    });

    const result = await channelMapping.discoverBotChannels(IMPORT_ID, CHAPTER);

    expect(bot.discoverChannels).toHaveBeenCalledWith(GUILD);
    expect(repo.replaceChannels).toHaveBeenCalledWith(IMPORT_ID, CHAPTER, [
      expect.objectContaining({ mapping_action: 'skip', status: 'skipped' }),
    ]);
    expect(result.roles).toEqual([
      { discord_role_id: '3', discord_role_name: 'Exec' },
    ]);
  });

  it('orders a thread directly after its parent, which the walk depends on', async () => {
    await build(job({ source: 'bot' }));
    bot.discoverChannels.mockResolvedValue({
      channels: [
        {
          id: 'c1',
          name: 'general',
          guildId: GUILD,
          categoryName: null,
          parentChannelId: null,
          isThread: false,
        },
        {
          id: 'c2',
          name: 'random',
          guildId: GUILD,
          categoryName: null,
          parentChannelId: null,
          isThread: false,
        },
        {
          id: 't1',
          name: 'general › planning',
          guildId: GUILD,
          categoryName: 'general',
          parentChannelId: 'c1',
          isThread: true,
        },
      ],
      warnings: [],
      roles: [],
    });

    await channelMapping.discoverBotChannels(IMPORT_ID, CHAPTER);

    const rows = repo.replaceChannels.mock.calls[0][2] as {
      discord_channel_id: string;
      position: number;
    }[];
    // A parent must be walked before the threads that inherit its destination.
    expect(rows.map((row) => row.discord_channel_id)).toEqual([
      'c1',
      't1',
      'c2',
    ]);
    expect(rows.map((row) => row.position)).toEqual([0, 1, 2]);
  });

  it('surfaces what could not be enumerated instead of dropping it silently', async () => {
    await build(job({ source: 'bot' }));
    bot.discoverChannels.mockResolvedValue({
      channels: [],
      warnings: ['Private archived threads in #general could not be read'],
      roles: [],
    });

    const result = await channelMapping.discoverBotChannels(IMPORT_ID, CHAPTER);

    expect(result.warnings).toHaveLength(1);
    expect(repo.update).toHaveBeenCalledWith(
      IMPORT_ID,
      CHAPTER,
      expect.objectContaining({ guild_id: GUILD }),
    );
  });

  it('503s when the bot is not configured, carrying the gateway error as cause', async () => {
    await build(job({ source: 'bot' }));
    const notConfigured = new DiscordNotConfiguredError(
      'DISCORD_BOT_TOKEN is not set',
    );
    bot.discoverChannels.mockRejectedValue(notConfigured);

    const thrown = await channelMapping
      .discoverBotChannels(IMPORT_ID, CHAPTER)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ServiceUnavailableException);
    expect((thrown as Error).message).not.toContain('DISCORD_BOT_TOKEN');
    // Sentry reads the gateway's own error off `cause` (#2131).
    expect((thrown as Error).cause).toBe(notConfigured);
  });

  it('refuses to scan on behalf of an upload import', async () => {
    await build(job({ source: 'upload' }));
    await expect(
      channelMapping.discoverBotChannels(IMPORT_ID, CHAPTER),
    ).rejects.toThrow(/nothing to discover/);
    expect(bot.discoverChannels).not.toHaveBeenCalled();
  });

  it('refuses when the chapter reconnected to a different server', async () => {
    await build(job({ source: 'bot', guild_id: 'old-guild' }));
    await expect(
      channelMapping.discoverBotChannels(IMPORT_ID, CHAPTER),
    ).rejects.toThrow(/different Discord server/);
    expect(bot.discoverChannels).not.toHaveBeenCalled();
  });
});

describe('DiscordImportChannelMappingService — what the scan saw, and who may read what (#2787)', () => {
  it("records the bot's access and the channel's privacy from the scan", async () => {
    await build(job({ source: 'bot' }));
    bot.discoverChannels.mockResolvedValue({
      channels: [
        {
          id: 'c1',
          name: 'cabinet',
          guildId: GUILD,
          categoryName: 'Exec',
          parentChannelId: null,
          isThread: false,
          holdsOnlyThreads: false,
          readable: false,
          privateInDiscord: true,
        },
      ],
      warnings: [],
      roles: [],
    });

    await channelMapping.discoverBotChannels(IMPORT_ID, CHAPTER);

    expect(repo.replaceChannels).toHaveBeenCalledWith(IMPORT_ID, CHAPTER, [
      expect.objectContaining({
        readable: false,
        private_in_discord: true,
        new_channel_type: 'PUBLIC',
        new_channel_required_permissions: null,
      }),
    ]);
  });

  it('REFUSES to import a channel the bot cannot read', async () => {
    await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([
      botChannel({ discord_channel_name: 'cabinet', readable: false }),
    ]);
    await expect(
      channelMapping.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: '900000000000000001',
          discord_channel_name: 'cabinet',
          mapping_action: 'create_new',
          new_channel_name: 'cabinet',
          new_channel_visibility: 'chapter',
        },
      ]),
    ).rejects.toThrow(/cannot read #cabinet/);
    expect(repo.replaceChannels).not.toHaveBeenCalled();
  });

  it('refuses a merge with no target chosen, as the upload route does', async () => {
    // The database no longer backs this up: a merge row may lose its target
    // when an officer deletes the channel (#2922), so the route is the rule.
    await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([botChannel()]);
    await expect(
      channelMapping.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: '900000000000000001',
          discord_channel_name: 'general',
          mapping_action: 'use_existing',
        },
      ]),
    ).rejects.toThrow(/Pick a Frapp channel for #general/);
    expect(repo.replaceChannels).not.toHaveBeenCalled();
  });

  it('REFUSES to merge a channel the bot cannot read, not only to create one', async () => {
    await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([
      botChannel({ discord_channel_name: 'cabinet', readable: false }),
    ]);
    await expect(
      channelMapping.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: '900000000000000001',
          discord_channel_name: 'cabinet',
          mapping_action: 'use_existing',
          target_channel_id: OWN_CHANNEL,
        },
      ]),
    ).rejects.toThrow(/cannot read #cabinet/);
    expect(repo.replaceChannels).not.toHaveBeenCalled();
  });

  it('still lets an unreadable channel be skipped', async () => {
    await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([botChannel({ readable: false })]);
    await channelMapping.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
      {
        discord_channel_id: '900000000000000001',
        discord_channel_name: 'general',
        mapping_action: 'skip',
      },
    ]);
    expect(repo.replaceChannels).toHaveBeenCalled();
  });

  it('REFUSES to create a channel that was private in Discord without an explicit visibility', async () => {
    // The default would be PUBLIC: #cabinet readable by every member.
    await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([
      botChannel({ discord_channel_name: 'cabinet', private_in_discord: true }),
    ]);
    await expect(
      channelMapping.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: '900000000000000001',
          discord_channel_name: 'cabinet',
          mapping_action: 'create_new',
          new_channel_name: 'cabinet',
        },
      ]),
    ).rejects.toThrow(/private in Discord/);
  });

  it('reads a null visibility as not chosen, not as a choice of the whole chapter', async () => {
    // `@IsOptional` lets null through validation; it must not slip past here.
    await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([
      botChannel({ discord_channel_name: 'cabinet', private_in_discord: true }),
    ]);
    await expect(
      channelMapping.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: '900000000000000001',
          discord_channel_name: 'cabinet',
          mapping_action: 'create_new',
          new_channel_name: 'cabinet',
          new_channel_visibility: null,
        },
      ]),
    ).rejects.toThrow(/private in Discord/);
    expect(repo.replaceChannels).not.toHaveBeenCalled();
  });

  it('treats a channel whose privacy the scan could not read as private', async () => {
    // The roles read that answers "private?" can fail on its own; unknown must
    // not fall to the public default.
    await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([
      botChannel({ discord_channel_name: 'exec', private_in_discord: null }),
    ]);
    const decision = {
      discord_channel_id: '900000000000000001',
      discord_channel_name: 'exec',
      mapping_action: 'create_new' as const,
      new_channel_name: 'exec',
    };
    await expect(
      channelMapping.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
        decision,
      ]),
    ).rejects.toThrow(/could not tell whether #exec is private/);

    await channelMapping.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
      { ...decision, new_channel_visibility: 'chapter' },
    ]);
    expect(repo.replaceChannels).toHaveBeenCalled();
  });

  it('treats a channel holding a private thread as private, because the thread lands in it', async () => {
    await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([
      botChannel({ discord_channel_id: 'c1', discord_channel_name: 'general' }),
      botChannel({
        id: 'm-thread',
        discord_channel_id: 't1',
        parent_discord_channel_id: 'c1',
        private_in_discord: true,
      }),
    ]);
    await expect(
      channelMapping.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: 'c1',
          discord_channel_name: 'general',
          mapping_action: 'create_new',
          new_channel_name: 'general',
        },
      ]),
    ).rejects.toThrow(/#general holds private threads/);
  });

  it('lets a channel the scan saw was public take the whole-chapter default, ordinary threads and all', async () => {
    await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([
      botChannel(),
      // A public thread: only a PRIVATE one makes its channel need a choice.
      botChannel({
        id: 'm-thread',
        discord_channel_id: 't1',
        parent_discord_channel_id: '900000000000000001',
        private_in_discord: false,
      }),
    ]);
    await channelMapping.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
      {
        discord_channel_id: '900000000000000001',
        discord_channel_name: 'general',
        mapping_action: 'create_new',
        new_channel_name: 'general',
      },
    ]);
    const rows = repo.replaceChannels.mock.calls[0][2] as Record<
      string,
      unknown
    >[];
    expect(rows[0]).toMatchObject({ new_channel_type: 'PUBLIC' });
  });

  it('creates it public when the admin says so explicitly', async () => {
    await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([
      botChannel({ private_in_discord: true }),
    ]);
    await channelMapping.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
      {
        discord_channel_id: '900000000000000001',
        discord_channel_name: 'general',
        mapping_action: 'create_new',
        new_channel_name: 'general',
        new_channel_visibility: 'chapter',
      },
    ]);
    const rows = repo.replaceChannels.mock.calls[0][2] as Record<
      string,
      unknown
    >[];
    expect(rows[0]).toMatchObject({
      new_channel_type: 'PUBLIC',
      new_channel_required_permissions: null,
      private_in_discord: true,
    });
  });

  it('records a restricted channel as ROLE_GATED, and its threads inherit it', async () => {
    await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([
      botChannel({ discord_channel_id: 'c1', private_in_discord: true }),
      botChannel({
        id: 'm-thread',
        discord_channel_id: 't1',
        parent_discord_channel_id: 'c1',
        private_in_discord: true,
      }),
    ]);
    await channelMapping.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
      {
        discord_channel_id: 'c1',
        discord_channel_name: 'cabinet',
        mapping_action: 'create_new',
        new_channel_name: 'cabinet',
        new_channel_visibility: 'restricted',
        new_channel_required_permissions: [
          ' chapter-config:manage ',
          'chapter-config:manage',
          'billing:view',
        ],
      },
    ]);
    const rows = repo.replaceChannels.mock.calls[0][2] as Record<
      string,
      unknown
    >[];
    const shape = {
      new_channel_type: 'ROLE_GATED',
      new_channel_required_permissions: [
        'chapter-config:manage',
        'billing:view',
      ],
    };
    expect(rows[0]).toMatchObject(shape);
    expect(rows[1]).toMatchObject(shape);
  });

  it('REFUSES a restricted channel that names no permission', async () => {
    // Chat's own rule (FRA-321): a ROLE_GATED channel gating on nothing is
    // readable by no one but a President.
    await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([botChannel()]);
    await expect(
      channelMapping.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: '900000000000000001',
          discord_channel_name: 'general',
          mapping_action: 'create_new',
          new_channel_name: 'general',
          new_channel_visibility: 'restricted',
          new_channel_required_permissions: ['  '],
        },
      ]),
    ).rejects.toThrow(/at least one permission/);
  });

  it('REFUSES a new channel from an export with no visibility, since an export says nothing about privacy', async () => {
    await build(job({ source: 'upload' }));
    await expect(
      channelMapping.setChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: 'u1',
          discord_channel_name: 'cabinet',
          mapping_action: 'create_new',
          new_channel_name: 'cabinet',
          new_channel_visibility: null,
        },
      ]),
    ).rejects.toThrow(/An export does not say whether #cabinet was private/);
    // The web client omits the key rather than sending null.
    await expect(
      channelMapping.setChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: 'u1',
          discord_channel_name: 'cabinet',
          mapping_action: 'create_new',
          new_channel_name: 'cabinet',
        },
      ]),
    ).rejects.toThrow(/An export does not say whether #cabinet was private/);
    expect(repo.replaceChannels).not.toHaveBeenCalled();
  });

  it('creates a channel from an export public or restricted as its admin chose', async () => {
    await build(job({ source: 'upload' }));
    await channelMapping.setChannelMapping(IMPORT_ID, CHAPTER, [
      {
        discord_channel_id: 'u1',
        discord_channel_name: 'general',
        mapping_action: 'create_new',
        new_channel_name: 'general',
        new_channel_visibility: 'chapter',
      },
      {
        discord_channel_id: 'u2',
        discord_channel_name: 'cabinet',
        mapping_action: 'create_new',
        new_channel_name: 'cabinet',
        new_channel_visibility: 'restricted',
        new_channel_required_permissions: ['chapter-config:manage'],
      },
    ]);
    const rows = repo.replaceChannels.mock.calls[0][2] as Record<
      string,
      unknown
    >[];
    expect(rows[0]).toMatchObject({
      new_channel_type: 'PUBLIC',
      readable: null,
      private_in_discord: null,
    });
    expect(rows[1]).toMatchObject({ new_channel_type: 'ROLE_GATED' });
  });
});

describe('DiscordImportChannelMappingService — mapping a discovered guild', () => {
  it('REJECTS a decision for a channel the scan never returned', async () => {
    // The bot can see the whole server; the import may only touch what the
    // scan recorded. A caller naming an arbitrary channel is the shape of a
    // cross-tenant read, so it is refused rather than inserted.
    await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([botChannel()]);

    await expect(
      channelMapping.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: '999999999999999999',
          discord_channel_name: 'somebody-elses-channel',
          mapping_action: 'create_new',
          new_channel_name: 'Sneaky',
        },
      ]),
    ).rejects.toThrow(/not one of the channels found/);
    expect(repo.replaceChannels).not.toHaveBeenCalled();
  });

  it('REJECTS a target channel belonging to another chapter', async () => {
    // The #1242 bug, on the new path. `chat_messages` has no `chapter_id`, so
    // its FK accepts any channel in the product and the purge could never
    // remove what landed elsewhere.
    await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([botChannel()]);

    await expect(
      channelMapping.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: '900000000000000001',
          discord_channel_name: 'general',
          mapping_action: 'use_existing',
          target_channel_id: FOREIGN_CHANNEL,
        },
      ]),
    ).rejects.toThrow(/not one of this chapter's channels/);
    expect(repo.replaceChannels).not.toHaveBeenCalled();
  });

  it('gives a thread its parent’s decision, and never its own', async () => {
    await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([
      botChannel({ id: 'm-parent', discord_channel_id: 'c1', position: 0 }),
      botChannel({
        id: 'm-thread',
        discord_channel_id: 't1',
        discord_channel_name: 'general › planning',
        parent_discord_channel_id: 'c1',
        position: 1,
      }),
    ]);

    await channelMapping.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
      {
        discord_channel_id: 'c1',
        discord_channel_name: 'general',
        mapping_action: 'use_existing',
        target_channel_id: OWN_CHANNEL,
      },
    ]);

    const rows = repo.replaceChannels.mock.calls[0][2] as {
      discord_channel_id: string;
      mapping_action: string;
      target_channel_id: string | null;
    }[];
    expect(rows).toEqual([
      expect.objectContaining({
        discord_channel_id: 'c1',
        mapping_action: 'use_existing',
        target_channel_id: OWN_CHANNEL,
      }),
      expect.objectContaining({
        discord_channel_id: 't1',
        mapping_action: 'use_existing',
        target_channel_id: OWN_CHANNEL,
      }),
    ]);
  });

  it('DROPS a target_channel_id sent under an action that does not name one', async () => {
    // `assertDecisionResolvable` validates `target_channel_id` only for
    // `use_existing`. Persisting it under `create_new` or `skip` would write an
    // unchecked `chat_channels` id onto the row and onto every thread that
    // inherits it — and `chat_messages` has no `chapter_id`, so its FK accepts
    // a channel from any chapter in the product.
    await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([
      botChannel({ discord_channel_id: 'c1' }),
    ]);

    await channelMapping.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, [
      {
        discord_channel_id: 'c1',
        discord_channel_name: 'general',
        mapping_action: 'create_new',
        new_channel_name: 'General',
        target_channel_id: FOREIGN_CHANNEL,
      },
    ]);

    const rows = repo.replaceChannels.mock.calls[0][2] as {
      target_channel_id: string | null;
    }[];
    expect(rows[0]?.target_channel_id).toBeNull();
  });

  it('leaves an unanswered channel — and its threads — skipped', async () => {
    await build(job({ source: 'bot' }));
    repo.findChannels.mockResolvedValue([
      botChannel({ id: 'm-parent', discord_channel_id: 'c1' }),
      botChannel({
        id: 'm-thread',
        discord_channel_id: 't1',
        parent_discord_channel_id: 'c1',
      }),
    ]);

    await channelMapping.applyDiscoveredChannelMapping(IMPORT_ID, CHAPTER, []);

    const rows = repo.replaceChannels.mock.calls[0][2] as {
      mapping_action: string;
      status: string;
    }[];
    expect(rows.every((row) => row.mapping_action === 'skip')).toBe(true);
    expect(rows.every((row) => row.status === 'skipped')).toBe(true);
  });
});

describe('DiscordImportChannelMappingService — the upload mapping route refuses a bot import', () => {
  it('REFUSES, so it cannot be used to name channels the scan never returned', async () => {
    // `applyDiscoveredChannelMapping` enforces that discovery's set is the only
    // set the worker reads. This route builds the set from whatever the caller
    // sends, so without the guard it is the way around that invariant — and the
    // worker's guild-mismatch error, read back off the job row, would become an
    // oracle for which Discord servers other chapters have connected.
    await build(job({ source: 'bot' }));

    await expect(
      channelMapping.setChannelMapping(IMPORT_ID, CHAPTER, [
        {
          discord_channel_id: '999999999999999999',
          discord_channel_name: 'someone-elses-channel',
          mapping_action: 'create_new',
          new_channel_name: 'Sneaky',
        },
      ]),
    ).rejects.toThrow(/scanned-channel route/);
    expect(repo.replaceChannels).not.toHaveBeenCalled();
  });

  it('still serves an upload import unchanged', async () => {
    await build(job({ source: 'upload' }));
    await channelMapping.setChannelMapping(IMPORT_ID, CHAPTER, [
      {
        discord_channel_id: 'c1',
        discord_channel_name: 'general',
        mapping_action: 'skip',
      },
    ]);
    expect(repo.replaceChannels).toHaveBeenCalled();
  });
});
