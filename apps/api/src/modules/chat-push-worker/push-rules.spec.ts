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

  it('off pref skips even with a mention', () => {
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
    ).toBe('skip-level');
  });
});
