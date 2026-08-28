import { decidePush, defaultLevelFor, resolveLevel } from './push-rules';
import type { ChatNotificationPreferenceRow } from './chat-notification-preference.repository';

describe('defaultLevelFor', () => {
  it('announcements → all', () => {
    expect(defaultLevelFor('announcements', 'text')).toBe('all');
  });
  it('chapter-audit → off', () => {
    expect(defaultLevelFor('chapter-audit', 'text')).toBe('off');
  });
  it('system_audit kind → off regardless of channel', () => {
    expect(defaultLevelFor('general', 'system_audit')).toBe('off');
  });
  it('every other channel → mentions', () => {
    expect(defaultLevelFor('general', 'text')).toBe('mentions');
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
      'general',
      'ch-1',
      'text',
      prefs([{ scope: 'channel', scope_id: 'ch-1', level: 'off' }]),
    );
    expect(r).toBe('off');
  });

  it('kind pref applies when channel pref is absent', () => {
    const r = resolveLevel(
      'general',
      'ch-1',
      'text',
      prefs([{ scope: 'kind', scope_kind: 'text', level: 'all' }]),
    );
    expect(r).toBe('all');
  });

  it('falls back to default when both arms are absent', () => {
    expect(resolveLevel('general', 'ch-1', 'text', [])).toBe('mentions');
  });
});

describe('decidePush', () => {
  it('skips presence even if level=all', () => {
    expect(
      decidePush(
        {
          channelName: 'announcements',
          messageKind: 'announcement',
          recipientIsPresent: true,
          hasMention: false,
          preferences: [],
        },
        'ch-1',
      ),
    ).toBe('skip-presence');
  });

  it('sends on default announcements level', () => {
    expect(
      decidePush(
        {
          channelName: 'announcements',
          messageKind: 'announcement',
          recipientIsPresent: false,
          hasMention: false,
          preferences: [],
        },
        'ch-1',
      ),
    ).toBe('send');
  });

  it('mentions level requires hasMention', () => {
    expect(
      decidePush(
        {
          channelName: 'general',
          messageKind: 'text',
          recipientIsPresent: false,
          hasMention: false,
          preferences: [],
        },
        'ch-1',
      ),
    ).toBe('skip-level');
    expect(
      decidePush(
        {
          channelName: 'general',
          messageKind: 'text',
          recipientIsPresent: false,
          hasMention: true,
          preferences: [],
        },
        'ch-1',
      ),
    ).toBe('send');
  });

  it('system_audit kind is suppressed unless explicitly opted-in', () => {
    expect(
      decidePush(
        {
          channelName: 'chapter-audit',
          messageKind: 'system_audit',
          recipientIsPresent: false,
          hasMention: true,
          preferences: [],
        },
        'ch-1',
      ),
    ).toBe('skip-level');
    expect(
      decidePush(
        {
          channelName: 'chapter-audit',
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
        },
        'ch-1',
      ),
    ).toBe('send');
  });

  it('channel off pref still pushes on a mention (mute override)', () => {
    expect(
      decidePush(
        {
          channelName: 'general',
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
        },
        'ch-1',
      ),
    ).toBe('send');
  });

  it('channel off pref skips when there is no mention', () => {
    expect(
      decidePush(
        {
          channelName: 'general',
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
        },
        'ch-1',
      ),
    ).toBe('skip-level');
  });

  describe('imported archive messages', () => {
    // Importing a chapter's Discord history must not page the roster once per
    // historical message. Unlike `system_audit`, whose `off` is a default a
    // member can opt out of, this refusal has no escape hatch.

    it('never sends, whatever the channel default would be', () => {
      expect(
        decidePush(
          {
            channelName: 'announcements',
            messageKind: 'imported',
            recipientIsPresent: false,
            hasMention: false,
            preferences: [],
          },
          'ch-1',
        ),
      ).toBe('skip-level');
    });

    it('is not lifted by a mention', () => {
      // The load-bearing case. Imported bodies are years of prose full of
      // `@name` tokens, and a mention overrides a muted channel's `off` — so a
      // kind-level default alone would not hold.
      expect(
        decidePush(
          {
            channelName: 'general',
            messageKind: 'imported',
            recipientIsPresent: false,
            hasMention: true,
            preferences: [],
          },
          'ch-1',
        ),
      ).toBe('skip-level');
    });

    it('is not lifted by an explicit all-level preference', () => {
      expect(
        decidePush(
          {
            channelName: 'general',
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
          },
          'ch-1',
        ),
      ).toBe('skip-level');
    });

    it('resolves to an off level, so anything reading a level agrees', () => {
      expect(defaultLevelFor('announcements', 'imported')).toBe('off');
    });
  });
});
