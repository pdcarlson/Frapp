import { canAccessChannel } from '@repo/validation';

describe('canAccessChannel', () => {
  const base = {
    userId: 'user-1',
    isChapterMember: true,
    permissions: [] as string[],
  };

  it('denies anyone who is not a member of the owning chapter', () => {
    expect(
      canAccessChannel({
        ...base,
        isChapterMember: false,
        channel: {
          type: 'PUBLIC',
          member_ids: null,
          required_permissions: null,
        },
      }),
    ).toBe(false);
  });

  it('allows any chapter member into a PUBLIC channel', () => {
    expect(
      canAccessChannel({
        ...base,
        channel: {
          type: 'PUBLIC',
          member_ids: null,
          required_permissions: null,
        },
      }),
    ).toBe(true);
  });

  describe.each(['PRIVATE', 'DM', 'GROUP_DM'] as const)(
    '%s channel',
    (type) => {
      it('allows a listed participant', () => {
        expect(
          canAccessChannel({
            ...base,
            channel: {
              type,
              member_ids: ['user-1', 'user-2'],
              required_permissions: null,
            },
          }),
        ).toBe(true);
      });

      it('denies a non-participant', () => {
        expect(
          canAccessChannel({
            ...base,
            channel: {
              type,
              member_ids: ['user-2'],
              required_permissions: null,
            },
          }),
        ).toBe(false);
      });

      it('denies when the member list is null/empty', () => {
        expect(
          canAccessChannel({
            ...base,
            channel: { type, member_ids: null, required_permissions: null },
          }),
        ).toBe(false);
      });
    },
  );

  describe('ROLE_GATED channel', () => {
    it('allows when the caller holds a required permission', () => {
      expect(
        canAccessChannel({
          ...base,
          permissions: ['alumni:view'],
          channel: {
            type: 'ROLE_GATED',
            member_ids: null,
            required_permissions: ['alumni:view'],
          },
        }),
      ).toBe(true);
    });

    it('allows the wildcard permission', () => {
      expect(
        canAccessChannel({
          ...base,
          permissions: ['*'],
          channel: {
            type: 'ROLE_GATED',
            member_ids: null,
            required_permissions: ['alumni:view'],
          },
        }),
      ).toBe(true);
    });

    it('denies when the caller lacks the required permission', () => {
      expect(
        canAccessChannel({
          ...base,
          permissions: ['events:create'],
          channel: {
            type: 'ROLE_GATED',
            member_ids: null,
            required_permissions: ['alumni:view'],
          },
        }),
      ).toBe(false);
    });

    // FRA-321: these two previously returned true, which made a ROLE_GATED
    // channel that gates on nothing functionally PUBLIC — and, because the
    // alumni post rule keyed on channel type, alumni-postable as well.
    it('denies a member when the requirement list is empty', () => {
      expect(
        canAccessChannel({
          ...base,
          channel: {
            type: 'ROLE_GATED',
            member_ids: null,
            required_permissions: [],
          },
        }),
      ).toBe(false);
    });

    it('denies a member when required_permissions is null', () => {
      expect(
        canAccessChannel({
          ...base,
          channel: {
            type: 'ROLE_GATED',
            member_ids: null,
            required_permissions: null,
          },
        }),
      ).toBe(false);
    });

    it('still allows the wildcard through an empty requirement list', () => {
      expect(
        canAccessChannel({
          ...base,
          permissions: ['*'],
          channel: {
            type: 'ROLE_GATED',
            member_ids: null,
            required_permissions: [],
          },
        }),
      ).toBe(true);
    });
  });

  it('denies an unknown channel type (guarded default, never falls open)', () => {
    expect(
      canAccessChannel({
        ...base,
        permissions: ['*'],
        channel: {
          type: 'SOMETHING_NEW',
          member_ids: ['user-1'],
          required_permissions: ['*'],
        },
      }),
    ).toBe(false);
  });

  describe('operation: "post" on a read-only channel', () => {
    const readOnly = {
      type: 'PUBLIC' as const,
      member_ids: null,
      required_permissions: null,
      is_read_only: true,
    };

    it('reads are unaffected by the read-only flag', () => {
      expect(
        canAccessChannel({ ...base, channel: readOnly, operation: 'read' }),
      ).toBe(true);
    });

    it('denies a post without announcements:post', () => {
      expect(
        canAccessChannel({ ...base, channel: readOnly, operation: 'post' }),
      ).toBe(false);
    });

    it('allows a post with announcements:post', () => {
      expect(
        canAccessChannel({
          ...base,
          permissions: ['announcements:post'],
          channel: readOnly,
          operation: 'post',
        }),
      ).toBe(true);
    });

    it('allows a post with the wildcard', () => {
      expect(
        canAccessChannel({
          ...base,
          permissions: ['*'],
          channel: readOnly,
          operation: 'post',
        }),
      ).toBe(true);
    });

    it('non-read-only channels accept posts from any chapter member', () => {
      expect(
        canAccessChannel({
          ...base,
          channel: {
            type: 'PUBLIC',
            member_ids: null,
            required_permissions: null,
            is_read_only: false,
          },
          operation: 'post',
        }),
      ).toBe(true);
    });

    it('defaults operation to "read" when omitted (backward-compat)', () => {
      expect(canAccessChannel({ ...base, channel: readOnly })).toBe(true);
    });
  });

  // Alumni keep read access everywhere they can see, but may only write in the
  // alumni channel and direct conversations. See spec/behavior/alumni.md.
  describe('isAlumni posting restrictions', () => {
    const alumni = { ...base, isAlumni: true };

    it.each(['PUBLIC', 'PRIVATE'] as const)(
      'denies an alumni post in an operational %s channel',
      (type) => {
        expect(
          canAccessChannel({
            ...alumni,
            channel: {
              type,
              member_ids: ['user-1'],
              required_permissions: null,
              is_read_only: false,
            },
            operation: 'post',
          }),
        ).toBe(false);
      },
    );

    it.each(['PUBLIC', 'PRIVATE'] as const)(
      'still allows an alumni member to read a %s channel',
      (type) => {
        expect(
          canAccessChannel({
            ...alumni,
            channel: {
              type,
              member_ids: ['user-1'],
              required_permissions: null,
              is_read_only: false,
            },
            operation: 'read',
          }),
        ).toBe(true);
      },
    );

    it.each(['DM', 'GROUP_DM'] as const)(
      'allows an alumni post in a %s channel',
      (type) => {
        expect(
          canAccessChannel({
            ...alumni,
            channel: {
              type,
              member_ids: ['user-1'],
              required_permissions: null,
              is_read_only: false,
            },
            operation: 'post',
          }),
        ).toBe(true);
      },
    );

    // FRA-321: the seeded #alumni channel. `alumni:post` in the *channel's*
    // requirement list is what makes it alumni-writable.
    it('allows an alumni post in a ROLE_GATED channel requiring alumni:post', () => {
      expect(
        canAccessChannel({
          ...alumni,
          permissions: ['members:view', 'alumni:post'],
          channel: {
            type: 'ROLE_GATED',
            member_ids: null,
            required_permissions: ['members:view', 'alumni:post'],
            is_read_only: false,
          },
          operation: 'post',
        }),
      ).toBe(true);
    });

    // The regression this issue was filed for: a chapter's #exec-board gated on
    // members:view — the Alumni role's own permission — used to be postable
    // purely because its type was ROLE_GATED.
    it('denies an alumni post in a ROLE_GATED channel that does not require alumni:post', () => {
      expect(
        canAccessChannel({
          ...alumni,
          permissions: ['members:view', 'alumni:post'],
          channel: {
            type: 'ROLE_GATED',
            member_ids: null,
            required_permissions: ['members:view'],
            is_read_only: false,
          },
          operation: 'post',
        }),
      ).toBe(false);
    });

    it('still lets an alumni read a ROLE_GATED channel it may not post in', () => {
      expect(
        canAccessChannel({
          ...alumni,
          permissions: ['members:view', 'alumni:post'],
          channel: {
            type: 'ROLE_GATED',
            member_ids: null,
            required_permissions: ['members:view'],
            is_read_only: false,
          },
          operation: 'read',
        }),
      ).toBe(true);
    });

    it('exempts votes from the alumni rule in a ROLE_GATED channel', () => {
      expect(
        canAccessChannel({
          ...alumni,
          permissions: ['members:view', 'alumni:post'],
          channel: {
            type: 'ROLE_GATED',
            member_ids: null,
            required_permissions: ['members:view'],
            is_read_only: false,
          },
          operation: 'vote',
        }),
      ).toBe(true);
    });

    it('still applies the read-only gate inside an alumni-postable channel', () => {
      expect(
        canAccessChannel({
          ...alumni,
          permissions: ['members:view', 'alumni:post'],
          channel: {
            type: 'ROLE_GATED',
            member_ids: null,
            required_permissions: ['members:view', 'alumni:post'],
            is_read_only: true,
          },
          operation: 'post',
        }),
      ).toBe(false);
    });

    it('lets a wildcard holder bypass the alumni restriction', () => {
      expect(
        canAccessChannel({
          ...alumni,
          permissions: ['*'],
          channel: {
            type: 'PUBLIC',
            member_ids: null,
            required_permissions: null,
            is_read_only: false,
          },
          operation: 'post',
        }),
      ).toBe(true);
    });

    it('does not affect active members (isAlumni omitted)', () => {
      expect(
        canAccessChannel({
          ...base,
          channel: {
            type: 'PUBLIC',
            member_ids: null,
            required_permissions: null,
            is_read_only: false,
          },
          operation: 'post',
        }),
      ).toBe(true);
    });
  });
});
