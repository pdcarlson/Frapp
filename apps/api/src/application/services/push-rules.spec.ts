import {
  decidePush,
  defaultLevelFor,
  resolveLevel,
  resolveLevelWithSource,
  type PushRuleChannel,
} from './push-rules';
import type { ChatNotificationPreferenceRow } from '#domain/repositories/chat-notification-preference.repository.interface';

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
    rows.map((r): ChatNotificationPreferenceRow => ({
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
  describe('thread replies (#3785)', () => {
    const base = {
      channel: ch('general'),
      messageKind: 'text',
      recipientIsPresent: false,
      preferences: [] as ChatNotificationPreferenceRow[],
    };

    it('skips a member who does not follow the thread', () => {
      expect(
        decidePush({
          ...base,
          hasMention: false,
          thread: { followState: null },
        }),
      ).toBe('skip-thread');
    });

    it('skips a member who muted the thread', () => {
      expect(
        decidePush({
          ...base,
          hasMention: false,
          thread: { followState: 'muted' },
        }),
      ).toBe('skip-thread');
    });

    it('lets an @mention through a muted thread', () => {
      expect(
        decidePush({
          ...base,
          hasMention: true,
          thread: { followState: 'muted' },
        }),
      ).toBe('send');
    });

    it('never pushes a follower more than the channel level allows', () => {
      const off: ChatNotificationPreferenceRow = {
        user_id: 'u',
        chapter_id: 'c',
        scope: 'channel',
        scope_id: 'general',
        scope_kind: null,
        level: 'off',
      };
      expect(
        decidePush({
          ...base,
          channel: { ...ch('general'), id: 'general' },
          preferences: [off],
          hasMention: false,
          thread: { followState: 'following' },
        }),
      ).toBe('skip-level');
    });

    it('pushes a follower when the channel level allows', () => {
      expect(
        decidePush({
          ...base,
          hasMention: false,
          thread: { followState: 'following' },
        }),
      ).toBe('send');
    });
  });

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

  it('an audit mirror never pushes, whatever the member opted into', () => {
    const optIns: ChatNotificationPreferenceRow[] = [
      {
        user_id: 'u',
        chapter_id: 'c',
        scope: 'channel',
        scope_id: 'ch-1',
        scope_kind: null,
        level: 'all',
      },
      {
        user_id: 'u',
        chapter_id: 'c',
        scope: 'kind',
        scope_id: null,
        scope_kind: 'system_audit',
        level: 'all',
      },
    ];
    const input = {
      channel: ch('chapter-audit'),
      messageKind: 'system_audit',
      recipientIsPresent: false,
      hasMention: false,
      preferences: optIns,
    };
    expect(decidePush({ ...input, isAuditMirror: true })).toBe('skip-level');
    // The same opt-ins still reach a server notice (no mirror flag).
    expect(decidePush(input)).toBe('send');
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

describe('resolveLevel: the chapter-wide "Mentions and DMs only" row (#3840)', () => {
  const chapterRow: ChatNotificationPreferenceRow = {
    user_id: 'u',
    chapter_id: 'c',
    scope: 'chapter',
    scope_id: null,
    scope_kind: null,
    level: 'mentions',
  };

  it('lowers #general from all to mentions', () => {
    expect(resolveLevelWithSource(ch('general'), 'text', [chapterRow])).toEqual(
      { level: 'mentions', source: 'chapter' },
    );
  });

  it('leaves an ordinary channel already at mentions on its own default', () => {
    expect(resolveLevelWithSource(ch('random'), 'text', [chapterRow])).toEqual({
      level: 'mentions',
      source: 'default',
    });
  });

  it("lowers an officer's all default", () => {
    expect(
      resolveLevel(ch('rush', { default_notification_level: 'all' }), 'text', [
        chapterRow,
      ]),
    ).toBe('mentions');
  });

  it('never raises a quieter default (#chapter-audit, system_audit)', () => {
    expect(resolveLevel(ch('chapter-audit'), 'text', [chapterRow])).toBe('off');
    expect(resolveLevel(ch('general'), 'system_audit', [chapterRow])).toBe(
      'off',
    );
  });

  it('leaves the announcements channel at all', () => {
    expect(
      resolveLevel(ch('announcements', { is_read_only: true }), 'text', [
        chapterRow,
      ]),
    ).toBe('all');
  });

  it('leaves DMs and group DMs at all', () => {
    expect(resolveLevel(ch('dm', { type: 'DM' }), 'text', [chapterRow])).toBe(
      'all',
    );
    expect(
      resolveLevel(ch('group', { type: 'GROUP_DM' }), 'text', [chapterRow]),
    ).toBe('all');
  });

  it("loses to the member's own channel choice", () => {
    expect(
      resolveLevelWithSource(ch('general'), 'text', [
        chapterRow,
        { ...chapterRow, scope: 'channel', scope_id: 'ch-1', level: 'all' },
      ]),
    ).toEqual({ level: 'all', source: 'channel' });
  });

  it("loses to the member's kind override", () => {
    expect(
      resolveLevel(ch('general'), 'text', [
        chapterRow,
        { ...chapterRow, scope: 'kind', scope_kind: 'text', level: 'all' },
      ]),
    ).toBe('all');
  });

  it('still lets a mention through', () => {
    expect(
      decidePush({
        channel: ch('general'),
        messageKind: 'text',
        recipientIsPresent: false,
        hasMention: true,
        preferences: [chapterRow],
      }),
    ).toBe('send');
    expect(
      decidePush({
        channel: ch('general'),
        messageKind: 'text',
        recipientIsPresent: false,
        hasMention: false,
        preferences: [chapterRow],
      }),
    ).toBe('skip-level');
  });
});
