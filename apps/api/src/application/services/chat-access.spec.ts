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

    it('allows any member when no permission is required', () => {
      expect(
        canAccessChannel({
          ...base,
          channel: {
            type: 'ROLE_GATED',
            member_ids: null,
            required_permissions: [],
          },
        }),
      ).toBe(true);
    });

    it('allows any member when required_permissions is null', () => {
      expect(
        canAccessChannel({
          ...base,
          channel: {
            type: 'ROLE_GATED',
            member_ids: null,
            required_permissions: null,
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
});
