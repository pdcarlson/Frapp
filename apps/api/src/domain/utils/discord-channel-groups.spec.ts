import {
  channelGroupKey,
  planChannelGroups,
  rowsNeedingGroup,
} from './discord-channel-groups';

type Row = Parameters<typeof rowsNeedingGroup>[0][number];

function row(overrides: Partial<Row> = {}): Row {
  return {
    mapping_action: 'create_new',
    new_channel_name: 'general',
    new_channel_type: 'PUBLIC',
    new_channel_is_read_only: true,
    new_channel_required_permissions: null,
    new_channel_group: 'Committees',
    new_channel_category_id: null,
    target_channel_id: null,
    discord_category_position: null,
    ...overrides,
  };
}

describe('channelGroupKey', () => {
  it('compares names trimmed and in any case', () => {
    expect(channelGroupKey('  Committees ')).toBe(
      channelGroupKey('committees'),
    );
  });
});

describe('rowsNeedingGroup', () => {
  it('keeps only new channels that name a group, have none resolved, and have no channel yet', () => {
    const wanted = row();
    const rows = [
      wanted,
      row({ mapping_action: 'use_existing' }),
      row({ mapping_action: 'skip' }),
      row({ new_channel_group: null }),
      row({ new_channel_group: '   ' }),
      row({ new_channel_category_id: 'group-1' }),
      // The channel already exists: a restart leaves it where it landed.
      row({ new_channel_name: 'made', target_channel_id: 'channel-1' }),
    ];

    expect(rowsNeedingGroup(rows)).toEqual([wanted]);
  });

  it('leaves out a row that will share a channel another row already made, as a thread does', () => {
    // A thread's row never gets a target of its own: it lands in its
    // parent's channel. On a restart after an officer deleted the group, it
    // must not bring the group back empty.
    const parent = row({ target_channel_id: 'channel-1' });
    const thread = row();
    const elsewhere = row({ new_channel_name: 'minutes' });
    // Same name, another group: a channel of its own, so it still needs one.
    const otherGroup = row({ new_channel_group: 'Social' });

    expect(rowsNeedingGroup([parent, thread, elsewhere, otherGroup])).toEqual([
      elsewhere,
      otherGroup,
    ]);
  });
});

describe('planChannelGroups', () => {
  it("joins the chapter's group of the same name, in any case, instead of making a second", () => {
    const plan = planChannelGroups(
      [row({ new_channel_group: 'committees ' })],
      [{ id: 'group-1', name: 'Committees', display_order: 0 }],
    );

    expect(plan.create).toEqual([]);
    expect(plan.existing.get('committees')).toBe('group-1');
  });

  it("matches the first of two like-named groups in the chapter's order, as given", () => {
    // Tied display orders keep the order the repository read them in.
    const plan = planChannelGroups(
      [row()],
      [
        { id: 'group-z', name: 'Committees', display_order: 1 },
        { id: 'group-a', name: 'committees', display_order: 1 },
      ],
    );

    expect(plan.existing.get('committees')).toBe('group-z');
  });

  it("makes the rest after the chapter's own groups, in Discord's category order", () => {
    const plan = planChannelGroups(
      [
        row({ new_channel_group: 'Secret', discord_category_position: 9 }),
        row({ new_channel_group: 'Generic', discord_category_position: 2 }),
        row({
          new_channel_group: 'Notifications',
          discord_category_position: 0,
        }),
        // A second channel of a group; its lower position wins.
        row({ new_channel_group: 'secret', discord_category_position: 5 }),
      ],
      [
        { id: 'group-1', name: 'Officers', display_order: 3 },
        { id: 'group-2', name: 'Social', display_order: 7 },
      ],
    );

    expect(plan.create).toEqual([
      { key: 'notifications', name: 'Notifications', display_order: 8 },
      { key: 'generic', name: 'Generic', display_order: 9 },
      { key: 'secret', name: 'Secret', display_order: 10 },
    ]);
  });

  it('orders groups with no Discord position after the positioned ones, then by name', () => {
    const plan = planChannelGroups(
      [
        row({ new_channel_group: 'Trees' }),
        row({ new_channel_group: 'Other', discord_category_position: 40 }),
        row({ new_channel_group: 'Groups' }),
      ],
      [],
    );

    expect(
      plan.create.map((group) => [group.name, group.display_order]),
    ).toEqual([
      ['Other', 0],
      ['Groups', 1],
      ['Trees', 2],
    ]);
  });

  it('places a group by the lowest position any of its rows carries', () => {
    const plan = planChannelGroups(
      [
        row({ new_channel_group: 'Social', discord_category_position: 9 }),
        row({ new_channel_group: 'Generic', discord_category_position: 5 }),
        row({ new_channel_group: 'social', discord_category_position: 1 }),
      ],
      [],
    );

    expect(plan.create.map((group) => group.name)).toEqual([
      'Social',
      'Generic',
    ]);
  });

  it('names a new group by the first spelling a row uses', () => {
    const plan = planChannelGroups(
      [
        row({ new_channel_group: ' Important Topics ' }),
        row({ new_channel_group: 'important topics' }),
      ],
      [],
    );

    expect(plan.create).toEqual([
      { key: 'important topics', name: 'Important Topics', display_order: 0 },
    ]);
  });
});
