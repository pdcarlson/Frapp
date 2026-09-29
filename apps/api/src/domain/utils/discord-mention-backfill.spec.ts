import type { DiscordImportChannel } from '../entities/discord-import.entity';
import {
  mentionBackfillBlocker,
  nameStoredTokens,
} from './discord-mention-backfill';

const USER = '264512362768236544';
const ROLE = '750151182395244584';

function row(overrides: Partial<DiscordImportChannel>): DiscordImportChannel {
  return {
    id: 'row',
    import_id: 'imp',
    discord_channel_id: '800000000000000001',
    discord_channel_name: 'rush',
    discord_category: null,
    mapping_action: 'create_new',
    target_channel_id: 'frapp-rush',
    new_channel_name: null,
    new_channel_is_read_only: false,
    message_count: 0,
    imported_count: 0,
    status: 'completed',
    error: null,
    cursor_before_snowflake: null,
    parent_discord_channel_id: null,
    position: 0,
    readable: true,
    private_in_discord: false,
    new_channel_type: 'PUBLIC',
    new_channel_required_permissions: null,
    discord_reader_role_ids: null,
    new_channel_same_as_discord: false,
    ...overrides,
  };
}

describe('mentionBackfillBlocker', () => {
  it('lets a stopped import with every channel made through', () => {
    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      expect(
        mentionBackfillBlocker({ id: 'imp', status }, [row({})], false),
      ).toBeNull();
    }
  });

  it('refuses an import the worker may still be writing, or one already purged', () => {
    for (const status of [
      'draft',
      'ready',
      'running',
      'purging',
      'purged',
    ] as const) {
      expect(
        mentionBackfillBlocker({ id: 'imp', status }, [row({})], true),
      ).not.toBeNull();
    }
  });

  it('refuses while a new channel is missing, since its mentions would never link', () => {
    const channels = [row({ target_channel_id: null, status: 'pending' })];
    const failed = mentionBackfillBlocker(
      { id: 'imp', status: 'failed' },
      channels,
      false,
    );
    expect(failed).toContain('#rush');
    // A failed import can be restarted, which makes the channel.
    expect(failed).toContain('Restart the import first');
    const cancelled = mentionBackfillBlocker(
      { id: 'imp', status: 'cancelled' },
      channels,
      false,
    );
    expect(cancelled).toContain('#rush');
    // A cancelled one cannot, so restarting is not offered.
    expect(cancelled).not.toContain('Restart');
    expect(cancelled).toContain('--allow-unlinked');
    // Unless the operator accepts it for an import that will not finish.
    expect(
      mentionBackfillBlocker(
        { id: 'imp', status: 'cancelled' },
        channels,
        true,
      ),
    ).toBeNull();
  });

  it('never refuses a completed import for a channel nothing will make', () => {
    // An upload completes past a part it could not read; that part's channel
    // stays pending with no target.
    const channels = [row({ target_channel_id: null, status: 'pending' })];
    expect(
      mentionBackfillBlocker(
        { id: 'imp', status: 'completed' },
        channels,
        false,
      ),
    ).toBeNull();
  });

  it('does not wait on rows that never get a channel of their own', () => {
    const channels = [
      row({ mapping_action: 'skip', target_channel_id: null }),
      row({ target_channel_id: null, status: 'skipped' }),
      row({ target_channel_id: null, parent_discord_channel_id: '1' }),
    ];
    expect(
      mentionBackfillBlocker({ id: 'imp', status: 'failed' }, channels, false),
    ).toBeNull();
  });
});

describe('nameStoredTokens', () => {
  const lookups = () => ({
    userName: jest.fn(async (id: string) =>
      id === USER ? 'Nirav Banerji' : null,
    ),
    roleName: (id: string) => (id === ROLE ? 'Brothers' : null),
    channel: () => null,
  });

  it('names users by the name their own messages recorded, and roles by the mapping', async () => {
    const updates = await nameStoredTokens(
      [{ id: 'm1', content: `<@&${ROLE}> ping <@${USER}> and <@1>` }],
      lookups(),
    );
    expect(updates).toEqual([
      { id: 'm1', content: '@Brothers ping @Nirav Banerji and @unknown-user' },
    ]);
  });

  it('leaves out rows with nothing to name, so a second run changes nothing', async () => {
    const updates = await nameStoredTokens(
      [
        { id: 'm1', content: 'a < b' },
        { id: 'm2', content: `\`<@${USER}>\`` },
      ],
      lookups(),
    );
    expect(updates).toEqual([]);
  });

  it('looks each user up once, however many rows mention them', async () => {
    const lookup = lookups();
    await nameStoredTokens(
      [
        { id: 'm1', content: `<@${USER}>` },
        { id: 'm2', content: `<@!${USER}> <@${USER}>` },
      ],
      lookup,
    );
    expect(lookup.userName).toHaveBeenCalledTimes(1);
  });
});
