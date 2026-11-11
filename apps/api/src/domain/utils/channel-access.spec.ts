import {
  accessHolderFromRoles,
  canAccessChannel,
  channelAllowsThreads,
  EMPTY_ACCESS_HOLDER,
  isAlumniPostableChannel,
  needsAccessHolder,
  type ChannelAccessHolder,
  type ChannelAccessRecord,
} from './channel-access';

const EXEC_TIER = '00000000-0000-4000-8000-0000000000e1';
const MEMBERS_TIER = '00000000-0000-4000-8000-0000000000e3';
const PRESIDENT = '00000000-0000-4000-8000-000000000001';
const TREASURER = '00000000-0000-4000-8000-000000000002';
const BROTHER = '00000000-0000-4000-8000-000000000005';
const ALUMNI = '00000000-0000-4000-8000-000000000007';
const PLEDGE_CLASS = '00000000-0000-4000-8000-000000000009';

const roles = {
  president: {
    id: PRESIDENT,
    tier_id: EXEC_TIER,
    permissions: ['*'],
    system_key: 'PRESIDENT',
  },
  treasurer: {
    id: TREASURER,
    tier_id: EXEC_TIER,
    permissions: ['members:view'],
    system_key: 'TREASURER',
  },
  brother: {
    id: BROTHER,
    tier_id: MEMBERS_TIER,
    permissions: ['members:view'],
    system_key: 'MEMBER',
  },
  alumni: {
    id: ALUMNI,
    tier_id: null,
    permissions: ['members:view', 'alumni:post'],
    system_key: 'ALUMNI',
  },
  pledgeClass: {
    id: PLEDGE_CLASS,
    tier_id: null,
    permissions: ['members:view'],
    system_key: null,
  },
};

const holding = (...held: (typeof roles)[keyof typeof roles][]) =>
  accessHolderFromRoles(held);

const channel = (
  overrides: Partial<ChannelAccessRecord> = {},
): ChannelAccessRecord => ({
  type: 'PUBLIC',
  member_ids: null,
  who_can_see: null,
  who_can_post: null,
  ...overrides,
});

const check = (
  record: ChannelAccessRecord,
  holder: ChannelAccessHolder,
  operation?: 'read' | 'post' | 'vote' | 'thread',
  extra: { userId?: string; isChapterMember?: boolean } = {},
) =>
  canAccessChannel({
    channel: record,
    userId: extra.userId ?? 'user-1',
    isChapterMember: extra.isChapterMember ?? true,
    holder,
    operation,
  });

const execOnly = channel({
  type: 'ROLE_GATED',
  who_can_see: [`tier:${EXEC_TIER}`],
});
const announcements = channel({ who_can_post: [`tier:${EXEC_TIER}`] });

describe('accessHolderFromRoles', () => {
  it('holds each role and the tier it sits in', () => {
    const holder = holding(roles.treasurer, roles.pledgeClass);
    expect([...holder.entries].sort()).toEqual(
      [`role:${TREASURER}`, `tier:${EXEC_TIER}`, `role:${PLEDGE_CLASS}`].sort(),
    );
    expect(holder.wildcard).toBe(false);
    expect(holder.alumniEntries).toBeNull();
  });

  it('marks the wildcard and the Alumni role', () => {
    expect(holding(roles.president).wildcard).toBe(true);
    expect([...(holding(roles.alumni).alumniEntries ?? [])]).toEqual([
      `role:${ALUMNI}`,
    ]);
  });

  // A channel that names the Alumni role's tier is alumni-writable too
  // (`isAlumniPostableChannel`), so the tier is one of the alumni entries.
  it("counts the Alumni role's tier as an alumni entry", () => {
    const alumniTier = '00000000-0000-4000-8000-00000000a1a1';
    const holder = holding({ ...roles.alumni, tier_id: alumniTier });
    expect([...(holder.alumniEntries ?? [])].sort()).toEqual(
      [`role:${ALUMNI}`, `tier:${alumniTier}`].sort(),
    );
    expect(
      check(
        channel({ type: 'ROLE_GATED', who_can_see: [`tier:${alumniTier}`] }),
        holder,
        'post',
      ),
    ).toBe(true);
  });
});

describe('canAccessChannel', () => {
  it('denies anyone who is not a member of the owning chapter', () => {
    expect(
      check(channel(), holding(roles.president), 'read', {
        isChapterMember: false,
      }),
    ).toBe(false);
  });

  describe('who can see', () => {
    it('null lets every member read', () => {
      expect(check(channel(), EMPTY_ACCESS_HOLDER)).toBe(true);
    });

    it('a list lets in a holder of a named tier', () => {
      expect(check(execOnly, holding(roles.treasurer))).toBe(true);
      expect(check(execOnly, holding(roles.brother))).toBe(false);
    });

    it('a list lets in a holder of a named role, outside any tier', () => {
      const pledges = channel({
        type: 'ROLE_GATED',
        who_can_see: [`role:${PLEDGE_CLASS}`, `tier:${EXEC_TIER}`],
      });
      expect(check(pledges, holding(roles.brother, roles.pledgeClass))).toBe(
        true,
      );
      expect(check(pledges, holding(roles.brother))).toBe(false);
    });

    it('the wildcard passes any list, an empty one included', () => {
      expect(check(execOnly, holding(roles.president))).toBe(true);
      expect(
        check(
          channel({ type: 'ROLE_GATED', who_can_see: [] }),
          holding(roles.president),
        ),
      ).toBe(true);
      expect(
        check(
          channel({ type: 'ROLE_GATED', who_can_see: [] }),
          holding(roles.treasurer),
        ),
      ).toBe(false);
    });
  });

  describe.each(['PRIVATE', 'DM', 'GROUP_DM'] as const)(
    '%s channel',
    (type) => {
      it('allows a listed participant and no one else', () => {
        expect(
          check(
            channel({ type, member_ids: ['user-1', 'user-2'] }),
            EMPTY_ACCESS_HOLDER,
          ),
        ).toBe(true);
        expect(
          check(channel({ type, member_ids: ['user-2'] }), EMPTY_ACCESS_HOLDER),
        ).toBe(false);
      });

      it('gives the wildcard no way in', () => {
        expect(
          check(channel({ type, member_ids: null }), holding(roles.president)),
        ).toBe(false);
      });
    },
  );

  it('denies an unknown channel type (guarded default, never falls open)', () => {
    expect(
      check(channel({ type: 'SOMETHING_NEW' }), holding(roles.president)),
    ).toBe(false);
  });

  describe('who can post', () => {
    it('null lets everyone who can see post', () => {
      expect(check(channel(), EMPTY_ACCESS_HOLDER, 'post')).toBe(true);
      expect(check(execOnly, holding(roles.treasurer), 'post')).toBe(true);
    });

    it('a list lets only its holders post, and reads are unaffected', () => {
      expect(check(announcements, holding(roles.brother))).toBe(true);
      expect(check(announcements, holding(roles.brother), 'post')).toBe(false);
      expect(check(announcements, holding(roles.treasurer), 'post')).toBe(true);
      expect(check(announcements, holding(roles.president), 'post')).toBe(true);
    });

    // Migration 20261111230000 gives a private channel made read-only before
    // #3722 the roles that could post there; its members still decide reads.
    it('a read-only private channel lets only its listed members post', () => {
      const locked = channel({
        type: 'PRIVATE',
        member_ids: ['user-1'],
        who_can_post: [`tier:${EXEC_TIER}`],
      });
      expect(check(locked, holding(roles.brother))).toBe(true);
      expect(check(locked, holding(roles.brother), 'post')).toBe(false);
      expect(check(locked, holding(roles.treasurer), 'post')).toBe(true);
      expect(check(locked, holding(roles.brother), 'thread')).toBe(true);
      expect(
        check(
          channel({ type: 'PRIVATE', member_ids: ['user-1'] }),
          EMPTY_ACCESS_HOLDER,
          'post',
        ),
      ).toBe(true);
      expect(needsAccessHolder(locked, 'vote')).toBe(true);
    });

    it('a poster who cannot see the channel still cannot post', () => {
      const odd = channel({
        type: 'ROLE_GATED',
        who_can_see: [`tier:${EXEC_TIER}`],
        who_can_post: [`tier:${MEMBERS_TIER}`],
      });
      expect(check(odd, holding(roles.brother), 'post')).toBe(false);
    });

    it('decides a vote as it decides a post', () => {
      expect(check(announcements, holding(roles.brother), 'vote')).toBe(false);
      expect(check(announcements, holding(roles.treasurer), 'vote')).toBe(true);
    });

    it('lets any reader write in a message thread', () => {
      expect(check(announcements, holding(roles.brother), 'thread')).toBe(true);
    });

    it('defaults the operation to read', () => {
      expect(check(announcements, holding(roles.brother))).toBe(true);
    });
  });

  describe('the audit log channel', () => {
    const audit = channel({ is_audit_log: true, who_can_post: [] });

    it('every member can read it', () => {
      expect(check(audit, EMPTY_ACCESS_HOLDER)).toBe(true);
    });

    it.each(['post', 'vote', 'thread'] as const)(
      'refuses a %s even from the wildcard and with no post list',
      (operation) => {
        expect(
          check(
            { ...audit, who_can_post: null },
            holding(roles.president),
            operation,
          ),
        ).toBe(false);
      },
    );
  });

  describe('archived channel (#348)', () => {
    const archived = channel({
      type: 'GROUP_DM',
      member_ids: ['user-1'],
      archived_at: '2026-01-01T00:00:00Z',
    });

    it('still lets a remaining member read it', () => {
      expect(check(archived, EMPTY_ACCESS_HOLDER)).toBe(true);
    });

    it.each(['post', 'vote', 'thread'] as const)(
      'refuses a %s from anyone',
      (operation) => {
        expect(check(archived, holding(roles.president), operation)).toBe(
          false,
        );
      },
    );
  });

  describe('the Alumni rule', () => {
    const alumniChannel = channel({
      type: 'ROLE_GATED',
      who_can_see: [`tier:${MEMBERS_TIER}`, `role:${ALUMNI}`],
    });

    it('lets alumni read where they can see, but not post in #general', () => {
      expect(check(channel(), holding(roles.alumni))).toBe(true);
      expect(check(channel(), holding(roles.alumni), 'post')).toBe(false);
      expect(check(channel(), holding(roles.alumni), 'thread')).toBe(false);
    });

    it('lets alumni post where who can see names them and anyone who sees may post', () => {
      expect(check(alumniChannel, holding(roles.alumni), 'post')).toBe(true);
    });

    it('lets alumni post where who can post names them', () => {
      const alumniAnnouncements = channel({
        who_can_post: [`role:${ALUMNI}`],
      });
      expect(check(alumniAnnouncements, holding(roles.alumni), 'post')).toBe(
        true,
      );
    });

    it('refuses alumni where who can post leaves them out, even if who can see names them', () => {
      const readOnlyForAlumni = channel({
        ...alumniChannel,
        who_can_post: [`tier:${MEMBERS_TIER}`],
      });
      expect(check(readOnlyForAlumni, holding(roles.alumni))).toBe(true);
      expect(check(readOnlyForAlumni, holding(roles.alumni), 'post')).toBe(
        false,
      );
    });

    it('applies to an alumnus who also holds an active role', () => {
      expect(
        check(channel(), holding(roles.alumni, roles.brother), 'post'),
      ).toBe(false);
    });

    it('lets alumni post in DMs and group DMs, not in a private channel', () => {
      const members = { member_ids: ['user-1'] };
      expect(
        check(
          channel({ type: 'DM', ...members }),
          holding(roles.alumni),
          'post',
        ),
      ).toBe(true);
      expect(
        check(
          channel({ type: 'GROUP_DM', ...members }),
          holding(roles.alumni),
          'post',
        ),
      ).toBe(true);
      expect(
        check(
          channel({ type: 'PRIVATE', ...members }),
          holding(roles.alumni),
          'post',
        ),
      ).toBe(false);
    });

    it('exempts votes', () => {
      expect(check(channel(), holding(roles.alumni), 'vote')).toBe(true);
    });

    it('lets the wildcard bypass it', () => {
      expect(
        check(channel(), holding(roles.alumni, roles.president), 'post'),
      ).toBe(true);
    });
  });
});

describe('isAlumniPostableChannel', () => {
  const alumni = new Set([`role:${ALUMNI}`]);

  it('reads who can post first, then who can see', () => {
    expect(
      isAlumniPostableChannel(
        channel({ who_can_see: [`role:${ALUMNI}`], who_can_post: [] }),
        alumni,
      ),
    ).toBe(false);
    expect(
      isAlumniPostableChannel(
        channel({ who_can_see: [`role:${ALUMNI}`] }),
        alumni,
      ),
    ).toBe(true);
    expect(isAlumniPostableChannel(channel(), alumni)).toBe(false);
  });
});

describe('needsAccessHolder', () => {
  it('skips the lookup where no list or Alumni rule can decide', () => {
    expect(needsAccessHolder(channel(), 'read')).toBe(false);
    expect(needsAccessHolder(channel({ type: 'DM' }), 'post')).toBe(false);
    expect(needsAccessHolder(channel({ type: 'PRIVATE' }), 'read')).toBe(false);
    expect(needsAccessHolder(channel(), 'vote')).toBe(false);
  });

  it('asks for it where a list or the Alumni rule decides', () => {
    expect(needsAccessHolder(execOnly, 'read')).toBe(true);
    expect(needsAccessHolder(announcements, 'vote')).toBe(true);
    expect(needsAccessHolder(channel(), 'post')).toBe(true);
    expect(needsAccessHolder(channel(), 'thread')).toBe(true);
    expect(needsAccessHolder(channel({ type: 'PRIVATE' }), 'post')).toBe(true);
  });
});

describe('channelAllowsThreads', () => {
  it('allows channels and group DMs, read-only ones included', () => {
    expect(channelAllowsThreads({ type: 'PUBLIC' })).toBe(true);
    expect(channelAllowsThreads({ type: 'GROUP_DM' })).toBe(true);
  });

  it('refuses a 1:1 DM and the audit log', () => {
    expect(channelAllowsThreads({ type: 'DM' })).toBe(false);
    expect(channelAllowsThreads({ type: 'PUBLIC', is_audit_log: true })).toBe(
      false,
    );
  });
});
