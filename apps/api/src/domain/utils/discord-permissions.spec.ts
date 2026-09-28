import {
  ADMINISTRATOR,
  READ_MESSAGE_HISTORY,
  VIEW_CHANNEL,
  basePermissions,
  canReadHistory,
  channelPermissions,
  parseOverwrites,
  openToEveryone,
  readerRoleIds,
  type DiscordPermissionOverwrite,
  type DiscordRolePermissions,
} from './discord-permissions';

const GUILD = '100000000000000001';
const BROTHER = '200000000000000002';
const CABINET = '300000000000000003';
const FRAPP_ROLE = '400000000000000004';
const BOT = '500000000000000005';

const READ = String(VIEW_CHANNEL | READ_MESSAGE_HISTORY);
const VIEW = String(VIEW_CHANNEL);

/** The Tau Nu shape: @everyone sees nothing; roles grant it per channel. */
const roles: DiscordRolePermissions[] = [
  { id: GUILD, permissions: READ },
  { id: BROTHER, permissions: '0' },
  { id: CABINET, permissions: '0' },
  // The managed role Discord creates for the bot at install (permissions=66560).
  { id: FRAPP_ROLE, permissions: READ },
];

const everyoneDenied: DiscordPermissionOverwrite = {
  id: GUILD,
  type: 0,
  allow: '0',
  deny: VIEW,
};
const allow = (id: string, bits = READ): DiscordPermissionOverwrite => ({
  id,
  type: 0,
  allow: bits,
  deny: '0',
});

function botCanRead(
  overwrites: DiscordPermissionOverwrite[],
  roleIds: string[] = [FRAPP_ROLE],
): boolean {
  const subject = { userId: BOT, roleIds };
  const base = basePermissions(GUILD, roles, subject);
  return canReadHistory(channelPermissions(base, GUILD, overwrites, subject));
}

describe('Discord channel permissions', () => {
  it('reads a channel with no overwrites', () => {
    expect(botCanRead([])).toBe(true);
    expect(openToEveryone(GUILD, roles, [])).toBe(true);
  });

  it('cannot read a channel @everyone is denied, even with View Channels on its own role', () => {
    // The staging finding: the bot's managed role grants View Channels at the
    // guild level, but a channel-level @everyone deny still hides the channel,
    // because only a channel-level allow on a held role overrides it.
    expect(botCanRead([everyoneDenied, allow(BROTHER)])).toBe(false);
    expect(openToEveryone(GUILD, roles, [everyoneDenied])).toBe(false);
  });

  it('reads it once the bot holds a role the channel allows', () => {
    expect(
      botCanRead([everyoneDenied, allow(BROTHER)], [FRAPP_ROLE, BROTHER]),
    ).toBe(true);
  });

  it('applies role overwrites together: an allow on one held role beats a deny on another', () => {
    const overwrites = [
      everyoneDenied,
      { id: CABINET, type: 0, allow: '0', deny: VIEW },
      allow(BROTHER),
    ];
    expect(botCanRead(overwrites, [FRAPP_ROLE, BROTHER, CABINET])).toBe(true);
  });

  it('lets a member overwrite decide last', () => {
    const memberDeny = { id: BOT, type: 1, allow: '0', deny: VIEW };
    expect(botCanRead([allow(BROTHER), memberDeny], [BROTHER])).toBe(false);
    const memberAllow = { id: BOT, type: 1, allow: READ, deny: '0' };
    expect(botCanRead([everyoneDenied, memberAllow])).toBe(true);
  });

  it('needs Read Message History as well as View Channels', () => {
    const noHistory = {
      id: GUILD,
      type: 0,
      allow: '0',
      deny: String(READ_MESSAGE_HISTORY),
    };
    expect(botCanRead([noHistory])).toBe(false);
    // @everyone sees the channel but not its backlog, and the backlog is what
    // an import copies: private.
    expect(openToEveryone(GUILD, roles, [noHistory])).toBe(false);
  });

  it('calls a channel private when any role or member is denied it, even if @everyone can read it', () => {
    // The "hide it from pledges" shape: Frapp has no deny, so a chapter-wide
    // import would show #brothers to exactly the members Discord hid it from.
    const PLEDGE = '600000000000000006';
    expect(
      openToEveryone(GUILD, roles, [
        { id: PLEDGE, type: 0, allow: '0', deny: VIEW },
      ]),
    ).toBe(false);
    expect(
      openToEveryone(GUILD, roles, [
        { id: BOT, type: 1, allow: '0', deny: String(READ_MESSAGE_HISTORY) },
      ]),
    ).toBe(false);
    // An allow only widens the audience; a deny of something else hides nothing.
    expect(
      openToEveryone(GUILD, roles, [
        allow(BROTHER),
        { id: PLEDGE, type: 0, allow: '0', deny: String(1n << 11n) },
      ]),
    ).toBe(true);
  });

  it('treats Administrator as every permission, overwrites included', () => {
    const adminRoles = [
      ...roles,
      { id: CABINET, permissions: String(ADMINISTRATOR) },
    ];
    const subject = { userId: BOT, roleIds: [CABINET] };
    const base = basePermissions(GUILD, adminRoles, subject);
    expect(
      canReadHistory(
        channelPermissions(base, GUILD, [everyoneDenied], subject),
      ),
    ).toBe(true);
  });

  it('keeps the high bits: permissions past 2^53 are not rounded away', () => {
    const high = (1n << 50n) | VIEW_CHANNEL | READ_MESSAGE_HISTORY;
    const subject = { userId: BOT, roleIds: [] };
    expect(
      canReadHistory(
        basePermissions(
          GUILD,
          [{ id: GUILD, permissions: String(high) }],
          subject,
        ),
      ),
    ).toBe(true);
  });

  it('reads an unparseable bitfield as nothing', () => {
    const subject = { userId: BOT, roleIds: [] };
    expect(
      basePermissions(GUILD, [{ id: GUILD, permissions: 'lots' }], subject),
    ).toBe(0n);
  });

  it('names the roles that could read a channel, each on its own (#2818)', () => {
    const PLEDGE = '600000000000000006';
    const withPledge = [...roles, { id: PLEDGE, permissions: '0' }];
    const candidates = [CABINET, BROTHER, PLEDGE, GUILD];
    // The Tau Nu shape: only the roles the channel allows.
    expect(
      readerRoleIds(
        GUILD,
        withPledge,
        [everyoneDenied, allow(BROTHER)],
        candidates,
      ),
    ).toEqual([BROTHER]);
    // "Hide it from pledges": @everyone reads it, so every role but the
    // denied one reads it only by inheriting, colour roles included. None is
    // an audience to copy.
    expect(
      readerRoleIds(
        GUILD,
        withPledge,
        [{ id: PLEDGE, type: 0, allow: '0', deny: VIEW }],
        candidates,
      ),
    ).toEqual([]);
    // Administrator reads through every overwrite.
    expect(
      readerRoleIds(
        GUILD,
        [...withPledge, { id: CABINET, permissions: String(ADMINISTRATOR) }],
        [everyoneDenied, allow(BROTHER)],
        candidates,
      ),
    ).toEqual([CABINET, BROTHER]);
  });

  it('parses overwrites and drops malformed ones', () => {
    expect(
      parseOverwrites([
        { id: GUILD, type: 0, allow: '0', deny: VIEW },
        { id: BOT, type: 1 },
        { id: 7, type: 0 },
        { id: 'x', type: 2 },
        null,
      ]),
    ).toEqual([
      { id: GUILD, type: 0, allow: '0', deny: VIEW },
      { id: BOT, type: 1, allow: '0', deny: '0' },
    ]);
    expect(parseOverwrites(undefined)).toEqual([]);
  });
});
