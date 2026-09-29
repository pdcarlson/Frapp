import { newChannelMergeKey } from './discord-channel-merge';

describe('newChannelMergeKey (#2856)', () => {
  const row = (
    overrides: Partial<Parameters<typeof newChannelMergeKey>[0]> = {},
  ): Parameters<typeof newChannelMergeKey>[0] => ({
    mapping_action: 'create_new',
    new_channel_name: 'general',
    new_channel_type: 'PUBLIC',
    new_channel_is_read_only: true,
    new_channel_required_permissions: null,
    ...overrides,
  });

  it('compares names the way the wizard does', () => {
    expect(newChannelMergeKey(row({ new_channel_name: ' #General ' }))).toBe(
      newChannelMergeKey(row()),
    );
    expect(
      newChannelMergeKey(row({ new_channel_name: 'general-chat' })),
    ).not.toBe(newChannelMergeKey(row()));
  });

  it('keeps apart rows that differ in who reads the channel or how', () => {
    const gated = row({
      new_channel_type: 'ROLE_GATED',
      new_channel_required_permissions: ['channels:read:b', 'channels:read:a'],
    });
    expect(newChannelMergeKey(gated)).not.toBe(newChannelMergeKey(row()));
    expect(
      newChannelMergeKey(
        row({
          new_channel_type: 'ROLE_GATED',
          new_channel_required_permissions: ['channels:read:a'],
        }),
      ),
    ).not.toBe(newChannelMergeKey(gated));
    // Permission order is not a difference.
    expect(
      newChannelMergeKey(
        row({
          new_channel_type: 'ROLE_GATED',
          new_channel_required_permissions: [
            'channels:read:a',
            'channels:read:b',
          ],
        }),
      ),
    ).toBe(newChannelMergeKey(gated));
    expect(
      newChannelMergeKey(row({ new_channel_is_read_only: false })),
    ).not.toBe(newChannelMergeKey(row()));
  });

  it('is null for a row that creates nothing', () => {
    expect(
      newChannelMergeKey(row({ mapping_action: 'use_existing' })),
    ).toBeNull();
    expect(newChannelMergeKey(row({ mapping_action: 'skip' }))).toBeNull();
    expect(newChannelMergeKey(row({ new_channel_name: ' # ' }))).toBeNull();
    expect(newChannelMergeKey(row({ new_channel_name: null }))).toBeNull();
  });
});
