import {
  decidePush,
  defaultLevelFor,
  resolveLevel,
  type PushRuleChannel,
} from './push-rules';
import type { ChatNotificationPreferenceRow } from './chat-notification-preference.repository';

/** A PUBLIC channel with this name and id `ch-1`, overridable per case. */
const ch = (
  name: string,
  over: Partial<PushRuleChannel> = {},
): PushRuleChannel => ({
  id: 'ch-1',
  name,
  type: 'PUBLIC',
  is_read_only: false,
  default_notification_level: null,
  ...over,
});

describe('defaultLevelFor', () => {
  it('announcements → all', () => {
    expect(
      defaultLevelFor(ch('announcements', { is_read_only: true }), 'text'),
    ).toBe('all');
  });
  it('chapter-audit → off', () => {
    expect(defaultLevelFor(ch('chapter-audit'), 'text')).toBe('off');
  });
  it('system_audit kind → off regardless of channel', () => {
    expect(defaultLevelFor(ch('random'), 'system_audit')).toBe('off');
  });
  it('#general → all (the owner decision on #2771)', () => {
    expect(defaultLevelFor(ch('general'), 'text')).toBe('all');
  });
  it('every other channel → mentions', () => {
    expect(defaultLevelFor(ch('random'), 'text')).toBe('mentions');
  });
});

describe('resolveLevel', () => {
  const prefs = (rows: Partial<ChatNotificationPreferenceRow>[]) =>
    rows.map((r) => ({
      user_id: 'u',
      chapter_id: 'c',
      scope: 'channel',
      scope_id: null,
      scope_kind: null,
      level: 'all',
      ...r,
    }));

  it('channel-specific pref beats kind beats default', () => {
    const r = resolveLevel(
      ch('random'),
      'text',
      prefs([{ scope: 'channel', scope_id: 'ch-1', level: 'off' }]),
    );
    expect(r).toBe('off');
  });

  it('kind pref applies when channel pref is absent', () => {
    const r = resolveLevel(
      ch('random'),
      'text',
      prefs([{ scope: 'kind', scope_kind: 'text', level: 'all' }]),
    );
    expect(r).toBe('all');
  });

  it('falls back to default when both arms are absent', () => {
    expect(resolveLevel(ch('random'), 'text', [])).toBe('mentions');
  });
});

describe('decidePush', () => {
  it('skips presence even if level=all', () => {
    expect(
      decidePush({
        channel: ch('announcements', { is_read_only: true }),
        messageKind: 'announcement',
        recipientIsPresent: true,
        hasMention: false,
        preferences: [],
      }),
    ).toBe('skip-presence');
  });

  it('sends on default announcements level', () => {
    expect(
      decidePush({
        channel: ch('announcements', { is_read_only: true }),
        messageKind: 'announcement',
        recipientIsPresent: false,
        hasMention: false,
        preferences: [],
      }),
    ).toBe('send');
  });

  it('mentions level requires hasMention', () => {
    expect(
      decidePush({
        channel: ch('random'),
        messageKind: 'text',
        recipientIsPresent: false,
        hasMention: false,
        preferences: [],
      }),
    ).toBe('skip-level');
    expect(
      decidePush({
        channel: ch('random'),
        messageKind: 'text',
        recipientIsPresent: false,
        hasMention: true,
        preferences: [],
      }),
    ).toBe('send');
  });

  it('system_audit kind is suppressed unless explicitly opted-in', () => {
    expect(
      decidePush({
        channel: ch('chapter-audit'),
        messageKind: 'system_audit',
        recipientIsPresent: false,
        hasMention: true,
        preferences: [],
      }),
    ).toBe('skip-level');
    expect(
      decidePush({
        channel: ch('chapter-audit'),
        messageKind: 'system_audit',
        recipientIsPresent: false,
        hasMention: false,
        preferences: [
          {
            user_id: 'u',
            chapter_id: 'c',
            scope: 'kind',
            scope_id: null,
            scope_kind: 'system_audit',
            level: 'all',
          },
        ],
      }),
    ).toBe('send');
  });

  it('channel off pref still pushes on a mention (mute override)', () => {
    expect(
      decidePush({
        channel: ch('random'),
        messageKind: 'text',
        recipientIsPresent: false,
        hasMention: true,
        preferences: [
          {
            user_id: 'u',
            chapter_id: 'c',
            scope: 'channel',
            scope_id: 'ch-1',
            scope_kind: null,
            level: 'off',
          },
        ],
      }),
    ).toBe('send');
  });

  it('channel off pref skips when there is no mention', () => {
    expect(
      decidePush({
        channel: ch('random'),
        messageKind: 'text',
        recipientIsPresent: false,
        hasMention: false,
        preferences: [
          {
            user_id: 'u',
            chapter_id: 'c',
            scope: 'channel',
            scope_id: 'ch-1',
            scope_kind: null,
            level: 'off',
          },
        ],
      }),
    ).toBe('skip-level');
  });

  describe('imported archive messages', () => {
    // Importing a chapter's Discord history must not page the roster once per
    // historical message. Unlike `system_audit`, whose `off` is a default a
    // member can opt out of, this refusal has no escape hatch.

    it('never sends, whatever the channel default would be', () => {
      expect(
        decidePush({
          channel: ch('announcements', { is_read_only: true }),
          messageKind: 'imported',
          recipientIsPresent: false,
          hasMention: false,
          preferences: [],
        }),
      ).toBe('skip-level');
    });

    it('is not lifted by a mention', () => {
      // The load-bearing case. Imported bodies are years of prose full of
      // `@name` tokens, and a mention overrides a muted channel's `off` — so a
      // kind-level default alone would not hold.
      expect(
        decidePush({
          channel: ch('random'),
          messageKind: 'imported',
          recipientIsPresent: false,
          hasMention: true,
          preferences: [],
        }),
      ).toBe('skip-level');
    });

    it('is not lifted by an explicit all-level preference', () => {
      expect(
        decidePush({
          channel: ch('random'),
          messageKind: 'imported',
          recipientIsPresent: false,
          hasMention: false,
          preferences: [
            {
              user_id: 'u',
              chapter_id: 'c',
              scope: 'kind',
              scope_id: null,
              scope_kind: 'imported',
              level: 'all',
            },
            {
              user_id: 'u',
              chapter_id: 'c',
              scope: 'channel',
              scope_id: 'ch-1',
              scope_kind: null,
              level: 'all',
            },
          ],
        }),
      ).toBe('skip-level');
    });

    it('resolves to an off level, so anything reading a level agrees', () => {
      expect(
        defaultLevelFor(
          ch('announcements', { is_read_only: true }),
          'imported',
        ),
      ).toBe('off');
    });
  });
});

describe('officer-set channel defaults and DMs (#2771)', () => {
  it('a stored channel default beats the built-in one', () => {
    expect(
      defaultLevelFor(
        ch('general', { default_notification_level: 'off' }),
        'text',
      ),
    ).toBe('off');
    expect(
      defaultLevelFor(
        ch('random', { default_notification_level: 'all' }),
        'text',
      ),
    ).toBe('all');
  });

  it('a stored default never lifts audit or imported rows', () => {
    const loud = ch('chapter-audit', { default_notification_level: 'all' });
    expect(defaultLevelFor(loud, 'system_audit')).toBe('off');
    expect(defaultLevelFor(loud, 'imported')).toBe('off');
  });

  it('a DM and a group DM default to all, whatever is stored', () => {
    expect(defaultLevelFor(ch('dm-a-b', { type: 'DM' }), 'text')).toBe('all');
    expect(
      defaultLevelFor(
        ch('Rush chairs', {
          type: 'GROUP_DM',
          default_notification_level: 'off',
        }),
        'text',
      ),
    ).toBe('all');
  });

  it("a member's own channel level beats the officer default", () => {
    const social = ch('social', { default_notification_level: 'all' });
    expect(
      resolveLevel(social, 'text', [
        {
          user_id: 'u',
          chapter_id: 'c',
          scope: 'channel',
          scope_id: 'ch-1',
          scope_kind: null,
          level: 'mentions',
        },
      ]),
    ).toBe('mentions');
  });

  it('a text kind row cannot silence DMs', () => {
    const textMentions: ChatNotificationPreferenceRow = {
      user_id: 'u',
      chapter_id: 'c',
      scope: 'kind',
      scope_id: null,
      scope_kind: 'text',
      level: 'mentions',
    };
    expect(
      resolveLevel(ch('dm-a-b', { type: 'DM' }), 'text', [textMentions]),
    ).toBe('all');
    // It still governs ordinary channels, as before.
    expect(resolveLevel(ch('general'), 'text', [textMentions])).toBe(
      'mentions',
    );
  });

  it('a system_audit message in a DM pushes nobody by default', () => {
    expect(resolveLevel(ch('dm-a-b', { type: 'DM' }), 'system_audit', [])).toBe(
      'off',
    );
  });

  it('a system_audit opt-in still reaches a DM, since it makes it louder', () => {
    expect(
      resolveLevel(ch('dm-a-b', { type: 'DM' }), 'system_audit', [
        {
          user_id: 'u',
          chapter_id: 'c',
          scope: 'kind',
          scope_id: null,
          scope_kind: 'system_audit',
          level: 'all',
        },
      ]),
    ).toBe('all');
  });

  it('a kind off row cannot quiet a group DM either', () => {
    expect(
      resolveLevel(ch('Rush', { type: 'GROUP_DM' }), 'text', [
        {
          user_id: 'u',
          chapter_id: 'c',
          scope: 'kind',
          scope_id: null,
          scope_kind: 'text',
          level: 'off',
        },
      ]),
    ).toBe('all');
  });
});
