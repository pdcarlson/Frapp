import { BadRequestException } from '@nestjs/common';
import type { ChatChannel } from '#domain/entities/chat.entity';
import { ChatNotificationPreferenceService } from './chat-notification-preference.service';
import {
  baseChannel,
  createChatServiceFixture,
  type ChatServiceFixture,
} from '#test/helpers/chat-service.fixture';

// Moved out of `chat.service.spec.ts` with the methods (#1380).
describe('ChatNotificationPreferenceService', () => {
  let notificationPreferences: ChatNotificationPreferenceService;
  let mockChannelRepo: ChatServiceFixture['mockChannelRepo'];
  let mockChatNotificationPrefs: ChatServiceFixture['mockChatNotificationPrefs'];

  beforeEach(async () => {
    ({ notificationPreferences, mockChannelRepo, mockChatNotificationPrefs } =
      await createChatServiceFixture());
  });

  describe('setChannelNotificationLevel', () => {
    it('upserts the level for the caller and the given channel', async () => {
      mockChatNotificationPrefs.upsertChannelLevel.mockResolvedValue({
        user_id: 'user-1',
        chapter_id: 'ch-1',
        scope: 'channel',
        scope_id: 'ch-chan-1',
        scope_kind: null,
        level: 'off',
      });

      const result = await notificationPreferences.setChannelNotificationLevel(
        'ch-chan-1',
        'ch-1',
        'user-1',
        'off',
      );

      expect(mockChatNotificationPrefs.upsertChannelLevel).toHaveBeenCalledWith(
        'user-1',
        'ch-1',
        'ch-chan-1',
        'off',
      );
      expect(result).toEqual({ channel_id: 'ch-chan-1', level: 'off' });
    });

    /**
     * The security property of this endpoint. `chat_channels` has RLS enabled
     * with no policies (#1009) and the API holds the `service_role` key, so
     * this application-layer check is the only thing preventing a caller from
     * writing a preference row about a channel they cannot read — which would
     * confirm that channel id exists.
     */
    it('refuses to write a preference for a channel the caller cannot access', async () => {
      mockChannelRepo.findById.mockResolvedValue({
        ...baseChannel,
        id: 'ch-private',
        type: 'PRIVATE',
        member_ids: ['someone-else'],
      });

      await expect(
        notificationPreferences.setChannelNotificationLevel(
          'ch-private',
          'ch-1',
          'user-1',
          'off',
        ),
      ).rejects.toThrow();

      expect(
        mockChatNotificationPrefs.upsertChannelLevel,
      ).not.toHaveBeenCalled();
    });

    it('refuses for a channel that does not exist in the chapter', async () => {
      mockChannelRepo.findById.mockResolvedValue(null);

      await expect(
        notificationPreferences.setChannelNotificationLevel(
          'ch-missing',
          'ch-1',
          'user-1',
          'all',
        ),
      ).rejects.toThrow();

      expect(
        mockChatNotificationPrefs.upsertChannelLevel,
      ).not.toHaveBeenCalled();
    });
  });

  describe('getChannelNotificationPreferences', () => {
    const announcements: ChatChannel = {
      ...baseChannel,
      id: 'ch-ann',
      name: 'announcements',
      // As seeded: the announcements default needs a read-only PUBLIC channel.
      is_read_only: true,
    };
    const audit: ChatChannel = {
      ...baseChannel,
      id: 'ch-audit',
      name: 'chapter-audit',
    };

    /**
     * The endpoint answers "what will this channel actually do", not "what rows
     * exist". Returning only stored rows made the web control assume `mentions`
     * everywhere, which is wrong for the two channels `DEFAULT_CHANNELS` seeds
     * into every chapter — and the popover then swallowed the corrective click
     * because the option it showed as current already looked selected.
     */
    it('resolves every accessible channel to its effective level, not just stored rows', async () => {
      mockChatNotificationPrefs.findChannelPreferencesForUser.mockResolvedValue(
        [],
      );
      mockChannelRepo.findByChapter.mockResolvedValue([
        baseChannel,
        announcements,
        audit,
      ]);

      const result =
        await notificationPreferences.getChannelNotificationPreferences(
          'ch-1',
          'user-1',
        );

      expect(result).toEqual([
        // `baseChannel` is #general, which defaults to `all` (#2771).
        { channel_id: 'ch-chan-1', level: 'all' },
        { channel_id: 'ch-ann', level: 'all' },
        { channel_id: 'ch-audit', level: 'off' },
      ]);
    });

    it('lets a stored row override the channel default', async () => {
      mockChatNotificationPrefs.findChannelPreferencesForUser.mockResolvedValue(
        [
          {
            user_id: 'user-1',
            chapter_id: 'ch-1',
            scope: 'channel',
            scope_id: 'ch-ann',
            scope_kind: null,
            level: 'off',
          },
        ],
      );
      mockChannelRepo.findByChapter.mockResolvedValue([
        baseChannel,
        announcements,
      ]);

      const result =
        await notificationPreferences.getChannelNotificationPreferences(
          'ch-1',
          'user-1',
        );

      // `announcements` defaults to `all`; the stored `off` must win.
      expect(result).toEqual([
        // `baseChannel` is #general, which defaults to `all` (#2771).
        { channel_id: 'ch-chan-1', level: 'all' },
        { channel_id: 'ch-ann', level: 'off' },
      ]);
    });

    /**
     * The negative control for the authorization filter.
     *
     * This deliberately models a channel that **exists in the chapter and is
     * unreadable**, not one that has been deleted. An earlier version of this
     * test omitted the channel from `findByChapter` entirely, which made it
     * invisible before the read predicate ever ran — so it would still have
     * passed if the predicate were downgraded to plain chapter scoping, and it
     * did not test the thing the service comment and the spec both justify the
     * filter with ("a preference row survives losing access to its channel").
     *
     * `ch-secret` is PRIVATE with a `member_ids` the caller is not in, so only
     * `canAccessChannel` excludes it. Negative-controlled: replacing
     * `filterAccessibleChannels` with a chapter-only filter fails this test.
     */
    it('excludes a channel that exists in the chapter but the caller cannot read', async () => {
      const secret: ChatChannel = {
        ...baseChannel,
        id: 'ch-secret',
        name: 'exec-only',
        type: 'PRIVATE',
        member_ids: ['someone-else'],
      };
      mockChatNotificationPrefs.findChannelPreferencesForUser.mockResolvedValue(
        [
          {
            user_id: 'user-1',
            chapter_id: 'ch-1',
            scope: 'channel',
            scope_id: 'ch-secret',
            scope_kind: null,
            level: 'off',
          },
        ],
      );
      mockChannelRepo.findByChapter.mockResolvedValue([baseChannel, secret]);

      const result =
        await notificationPreferences.getChannelNotificationPreferences(
          'ch-1',
          'user-1',
        );

      expect(result).toEqual([{ channel_id: 'ch-chan-1', level: 'all' }]);
      expect(result.some((r) => r.channel_id === 'ch-secret')).toBe(false);
    });

    it('returns an empty list when the caller can read no channels', async () => {
      mockChatNotificationPrefs.findChannelPreferencesForUser.mockResolvedValue(
        [],
      );
      mockChannelRepo.findByChapter.mockResolvedValue([]);

      await expect(
        notificationPreferences.getChannelNotificationPreferences(
          'ch-1',
          'user-1',
        ),
      ).resolves.toEqual([]);
    });

    /**
     * Regression for the defect #500 introduced: making the kind arm writable
     * broke an assumption this endpoint had silently relied on. It read only
     * `scope='channel'` rows, so a kind override — impossible to store before
     * #500 — left it reporting the pre-#500 answer while the worker applied
     * the override. The mute UI would show every channel unmuted while nothing
     * was being delivered, which is the exact disagreement this endpoint
     * resolves defaults server-side to prevent.
     */
    it('honours a kind override for channels with no channel-scoped row', async () => {
      mockChatNotificationPrefs.findChannelPreferencesForUser.mockResolvedValue(
        [],
      );
      mockChatNotificationPrefs.findKindPreferencesForUser.mockResolvedValue([
        {
          user_id: 'user-1',
          chapter_id: 'ch-1',
          scope: 'kind',
          scope_id: null,
          scope_kind: 'text',
          level: 'off',
        },
      ]);
      mockChannelRepo.findByChapter.mockResolvedValue([baseChannel]);

      const result =
        await notificationPreferences.getChannelNotificationPreferences(
          'ch-1',
          'user-1',
        );

      expect(result).toEqual([{ channel_id: baseChannel.id, level: 'off' }]);
    });

    /** Precedence is channel-pref ▶ kind-pref ▶ default, not the reverse. */
    it('lets a channel-scoped row outrank a kind override', async () => {
      mockChatNotificationPrefs.findChannelPreferencesForUser.mockResolvedValue(
        [
          {
            user_id: 'user-1',
            chapter_id: 'ch-1',
            scope: 'channel',
            scope_id: baseChannel.id,
            scope_kind: null,
            level: 'all',
          },
        ],
      );
      mockChatNotificationPrefs.findKindPreferencesForUser.mockResolvedValue([
        {
          user_id: 'user-1',
          chapter_id: 'ch-1',
          scope: 'kind',
          scope_id: null,
          scope_kind: 'text',
          level: 'off',
        },
      ]);
      mockChannelRepo.findByChapter.mockResolvedValue([baseChannel]);

      const result =
        await notificationPreferences.getChannelNotificationPreferences(
          'ch-1',
          'user-1',
        );

      expect(result).toEqual([{ channel_id: baseChannel.id, level: 'all' }]);
    });
  });

  describe('setKindNotificationLevel', () => {
    it('upserts the level for the caller and the given kind', async () => {
      mockChatNotificationPrefs.upsertKindLevel.mockResolvedValue({
        user_id: 'user-1',
        chapter_id: 'ch-1',
        scope: 'kind',
        scope_id: null,
        scope_kind: 'system_audit',
        level: 'all',
      });

      const result = await notificationPreferences.setKindNotificationLevel(
        'ch-1',
        'user-1',
        'system_audit',
        'all',
      );

      expect(mockChatNotificationPrefs.upsertKindLevel).toHaveBeenCalledWith(
        'user-1',
        'ch-1',
        'system_audit',
        'all',
      );
      expect(result).toEqual({ kind: 'system_audit', level: 'all' });
    });

    /**
     * `imported` is refused specifically, not merely absent from the list.
     * `ChatPushWorkerService.handleMessage` returns on that kind before it
     * loads the roster and `decidePush` refuses it ahead of the mention
     * override, so a stored row could never be consulted — accepting the
     * write would persist a setting that silently does nothing.
     */
    it('refuses `imported`, the one kind with no opt-in', async () => {
      await expect(
        notificationPreferences.setKindNotificationLevel(
          'ch-1',
          'user-1',
          'imported',
          'all',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockChatNotificationPrefs.upsertKindLevel).not.toHaveBeenCalled();
    });

    /**
     * `chat_messages.kind` carries no CHECK constraint (it is `text not null
     * default 'text'`), so without this guard the database would happily
     * store a preference for an invented kind that matches no message ever.
     */
    it('refuses a kind that is not a known chat message kind', async () => {
      await expect(
        notificationPreferences.setKindNotificationLevel(
          'ch-1',
          'user-1',
          'sytsem_audit',
          'off',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockChatNotificationPrefs.upsertKindLevel).not.toHaveBeenCalled();
    });

    it('keys the row on the authenticated user, never a caller-supplied id', async () => {
      mockChatNotificationPrefs.upsertKindLevel.mockResolvedValue({
        user_id: 'user-1',
        chapter_id: 'ch-1',
        scope: 'kind',
        scope_id: null,
        scope_kind: 'poll',
        level: 'off',
      });

      await notificationPreferences.setKindNotificationLevel(
        'ch-1',
        'user-1',
        'poll',
        'off',
      );

      const [userIdArg] =
        mockChatNotificationPrefs.upsertKindLevel.mock.calls[0];
      expect(userIdArg).toBe('user-1');
    });
  });

  describe('getKindNotificationPreferences', () => {
    it('returns the stored override for a kind the caller has set', async () => {
      mockChatNotificationPrefs.findKindPreferencesForUser.mockResolvedValue([
        {
          user_id: 'user-1',
          chapter_id: 'ch-1',
          scope: 'kind',
          scope_id: null,
          scope_kind: 'poll',
          level: 'off',
        },
      ]);

      const result =
        await notificationPreferences.getKindNotificationPreferences(
          'ch-1',
          'user-1',
        );

      expect(result).toContainEqual({ kind: 'poll', level: 'off' });
    });

    /**
     * The endpoint reports overrides, not effective levels. Filling in a
     * default here would be a fabrication: what a kind falls back to depends
     * on the channel a message lands in, so there is no chapter-wide default
     * to state. Reporting `mentions` for `announcement` would also be wrong
     * for the seeded `#announcements` channel, which resolves `all`.
     */
    it('reports null, not a fabricated default, for an unset kind', async () => {
      mockChatNotificationPrefs.findKindPreferencesForUser.mockResolvedValue(
        [],
      );

      const result =
        await notificationPreferences.getKindNotificationPreferences(
          'ch-1',
          'user-1',
        );

      expect(result).toContainEqual({ kind: 'text', level: null });
      expect(result).toContainEqual({ kind: 'announcement', level: null });
      expect(result).toContainEqual({ kind: 'system_audit', level: null });
      expect(result.every((r) => r.level === null)).toBe(true);
    });

    /**
     * Neither may be presented as changeable: `imported` because the worker
     * refuses it before any preference is read, `loading` because it is an
     * internal placeholder rather than a category a member receives.
     */
    it('never lists `imported` or `loading`', async () => {
      const result =
        await notificationPreferences.getKindNotificationPreferences(
          'ch-1',
          'user-1',
        );

      const kinds = result.map((r) => r.kind);
      expect(kinds).not.toContain('imported');
      expect(kinds).not.toContain('loading');
      expect(result).not.toHaveLength(0);
    });

    it('surfaces a repository failure rather than reporting every kind as unset', async () => {
      mockChatNotificationPrefs.findKindPreferencesForUser.mockRejectedValue(
        new Error('db down'),
      );

      await expect(
        notificationPreferences.getKindNotificationPreferences(
          'ch-1',
          'user-1',
        ),
      ).rejects.toThrow('db down');
    });
  });

  describe('clearKindNotificationLevel', () => {
    it('deletes the override, scoped to the caller and chapter', async () => {
      mockChatNotificationPrefs.deleteKindLevel.mockResolvedValue(undefined);

      const result = await notificationPreferences.clearKindNotificationLevel(
        'ch-1',
        'user-1',
        'poll',
      );

      expect(mockChatNotificationPrefs.deleteKindLevel).toHaveBeenCalledWith(
        'user-1',
        'ch-1',
        'poll',
      );
      expect(result).toEqual({ kind: 'poll', level: null });
    });

    it('validates the kind, so a typo cannot silently delete nothing', async () => {
      await expect(
        notificationPreferences.clearKindNotificationLevel(
          'ch-1',
          'user-1',
          'sytsem_audit',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockChatNotificationPrefs.deleteKindLevel).not.toHaveBeenCalled();
    });

    /**
     * Deliberately NOT symmetric with the setter, which refuses these. A row
     * for a kind that has since left the settable set is exactly the state
     * this route exists to clear: refusing it here would strand the row,
     * unreachable by both routes, while the worker went on consulting it.
     */
    it('clears a kind that is no longer settable, so no row is ever stranded', async () => {
      mockChatNotificationPrefs.deleteKindLevel.mockResolvedValue(undefined);

      await expect(
        notificationPreferences.clearKindNotificationLevel(
          'ch-1',
          'user-1',
          'loading',
        ),
      ).resolves.toEqual({ kind: 'loading', level: null });

      expect(mockChatNotificationPrefs.deleteKindLevel).toHaveBeenCalledWith(
        'user-1',
        'ch-1',
        'loading',
      );
    });

    it('still refuses a string that is not a message kind at all', async () => {
      await expect(
        notificationPreferences.clearKindNotificationLevel(
          'ch-1',
          'user-1',
          'not_a_kind',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockChatNotificationPrefs.deleteKindLevel).not.toHaveBeenCalled();
    });
  });
});
