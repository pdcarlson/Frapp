import { Test } from '@nestjs/testing';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { NotificationService } from '../../application/services/notification.service';
import { ChatPushWorkerService } from './chat-push-worker.service';
import {
  ChatNotificationPreferenceRepository,
  type ChatNotificationPreferenceRow,
} from './chat-notification-preference.repository';
import { RbacService } from '../../application/services/rbac.service';
import { ChannelCacheService } from './channel-cache.service';

describe('ChatPushWorkerService', () => {
  let service: ChatPushWorkerService;
  let notifyUser: jest.Mock;
  let findByChapter: jest.Mock;
  let findForUsers: jest.Mock;
  let getEffectivePermissions: jest.Mock;

  const CHANNEL = {
    id: 'ch-1',
    chapter_id: 'chap-1',
    name: 'general',
    is_read_only: false,
    type: 'PUBLIC',
    member_ids: null,
    required_permissions: null,
  };

  const ANNOUNCEMENT_CHANNEL = {
    ...CHANNEL,
    id: 'ch-announce',
    name: 'announcements',
    is_read_only: true,
  };

  beforeEach(async () => {
    notifyUser = jest.fn().mockResolvedValue(undefined);
    findByChapter = jest.fn();
    findForUsers = jest.fn().mockResolvedValue(new Map());
    getEffectivePermissions = jest.fn().mockResolvedValue([]);

    const mod = await Test.createTestingModule({
      providers: [
        ChatPushWorkerService,
        ChannelCacheService,
        {
          provide: SUPABASE_CLIENT,
          useValue: {},
        },
        {
          provide: MEMBER_REPOSITORY,
          useValue: { findByChapter },
        },
        {
          provide: NotificationService,
          useValue: { notifyUser },
        },
        {
          provide: ChatNotificationPreferenceRepository,
          useValue: { findForUsers },
        },
        {
          provide: RbacService,
          useValue: { getEffectivePermissions },
        },
      ],
    }).compile();

    service = mod.get(ChatPushWorkerService);
  });

  function setMembers(userIds: string[]) {
    findByChapter.mockResolvedValue(userIds.map((id) => ({ user_id: id })));
  }

  it('does not push the sender on their own message', async () => {
    service.__setChannelForTest(CHANNEL);
    setMembers(['sender', 'recipient']);
    await service.handleMessage({
      id: 'm1',
      channel_id: CHANNEL.id,
      sender_id: 'sender',
      content: 'hello',
      kind: 'text',
      created_at: '',
    });
    expect(notifyUser).toHaveBeenCalledTimes(0); // mentions tier + no mention
  });

  it('pushes announcements to recipients with the default level', async () => {
    service.__setChannelForTest(ANNOUNCEMENT_CHANNEL);
    setMembers(['sender', 'a', 'b']);
    await service.handleMessage({
      id: 'm1',
      channel_id: ANNOUNCEMENT_CHANNEL.id,
      sender_id: 'sender',
      content: 'Big news',
      kind: 'announcement',
      created_at: '',
    });
    expect(notifyUser).toHaveBeenCalledTimes(2);
    expect(notifyUser).toHaveBeenCalledWith(
      'a',
      'chap-1',
      expect.objectContaining({
        title: 'New Announcement',
        priority: 'URGENT',
        category: 'announcements',
      }),
    );
  });

  // The title and priority have always treated any channel *named*
  // `announcements` as an announcement, but the category keyed on `kind`
  // alone — so an ordinary `text` message here went out titled "New
  // Announcement" at URGENT while labelled `category: 'chat'`. Harmless until
  // URGENT became exempt from the category preference gate (#1041): after
  // that, the mismatch let these escape a member's coarse Chat switch. Pinning
  // the three together is what stops that.
  it('labels an ordinary message in an announcements channel as an announcement, not chat', async () => {
    service.__setChannelForTest(ANNOUNCEMENT_CHANNEL);
    setMembers(['sender', 'a', 'b']);
    await service.handleMessage({
      id: 'm1',
      channel_id: ANNOUNCEMENT_CHANNEL.id,
      sender_id: 'sender',
      content: 'Reminder about Saturday',
      kind: 'text',
      created_at: '',
    });
    expect(notifyUser).toHaveBeenCalledWith(
      'a',
      'chap-1',
      expect.objectContaining({
        title: 'New Announcement',
        priority: 'URGENT',
        category: 'announcements',
      }),
    );
    expect(notifyUser).not.toHaveBeenCalledWith(
      'a',
      'chap-1',
      expect.objectContaining({ category: 'chat' }),
    );
  });

  // The positive control for the branch above: an ordinary channel must keep
  // `category: 'chat'` at NORMAL, so the shared predicate cannot be "fixed" by
  // simply labelling everything an announcement. Mentioned so the default
  // `mentions` tier lets the push through at all.
  it('still labels an ordinary channel message as chat at NORMAL', async () => {
    service.__setChannelForTest(CHANNEL);
    setMembers(['sender', 'a']);
    await service.handleMessage({
      id: 'm1',
      channel_id: CHANNEL.id,
      sender_id: 'sender',
      content: 'hello @a',
      kind: 'text',
      mentions: ['a'],
      created_at: '',
    });
    expect(notifyUser).toHaveBeenCalledWith(
      'a',
      'chap-1',
      expect.objectContaining({
        title: 'New message in #general',
        priority: 'NORMAL',
        category: 'chat',
      }),
    );
  });

  it('skips recipients currently in the channel (presence)', async () => {
    service.__setChannelForTest(ANNOUNCEMENT_CHANNEL);
    service.__setPresenceForTest(ANNOUNCEMENT_CHANNEL.id, ['a']);
    setMembers(['sender', 'a', 'b']);
    await service.handleMessage({
      id: 'm1',
      channel_id: ANNOUNCEMENT_CHANNEL.id,
      sender_id: 'sender',
      content: 'Big news',
      kind: 'announcement',
      created_at: '',
    });
    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith('b', 'chap-1', expect.any(Object));
  });

  it('honors a per-channel off preference', async () => {
    service.__setChannelForTest(ANNOUNCEMENT_CHANNEL);
    setMembers(['sender', 'a']);
    const pref: ChatNotificationPreferenceRow = {
      user_id: 'a',
      chapter_id: 'chap-1',
      scope: 'channel',
      scope_id: ANNOUNCEMENT_CHANNEL.id,
      scope_kind: null,
      level: 'off',
    };
    findForUsers.mockResolvedValue(new Map([['a', [pref]]]));
    await service.handleMessage({
      id: 'm1',
      channel_id: ANNOUNCEMENT_CHANNEL.id,
      sender_id: 'sender',
      content: 'Big news',
      kind: 'announcement',
      created_at: '',
    });
    expect(notifyUser).toHaveBeenCalledTimes(0);
  });

  /**
   * The point of #552: the preference lookup is made **once per message**, not
   * once per recipient. It used to be awaited inside the recipient loop, so a
   * 150-member channel issued ~150 queries per message on a Realtime path with
   * no backpressure.
   *
   * Asserting the call count alone would pass if the worker batched but asked
   * about the wrong people, so this also pins the argument: every recipient,
   * and the sender excluded.
   */
  it('reads preferences once per message regardless of recipient count', async () => {
    service.__setChannelForTest(CHANNEL);
    const recipients = Array.from({ length: 150 }, (_, i) => `user-${i}`);
    setMembers(['sender', ...recipients]);

    await service.handleMessage({
      id: 'm1',
      channel_id: CHANNEL.id,
      sender_id: 'sender',
      content: 'hello',
      kind: 'text',
      created_at: '',
    });

    expect(findForUsers).toHaveBeenCalledTimes(1);
    const [askedFor, chapterId] = findForUsers.mock.calls[0];
    expect([...askedFor].sort()).toEqual([...recipients].sort());
    expect(askedFor).not.toContain('sender');
    expect(chapterId).toBe('chap-1');
  });

  it('pushes a per-channel off recipient when they are @mentioned (mute override)', async () => {
    service.__setChannelForTest(CHANNEL);
    setMembers(['sender', 'a']);
    const pref: ChatNotificationPreferenceRow = {
      user_id: 'a',
      chapter_id: 'chap-1',
      scope: 'channel',
      scope_id: CHANNEL.id,
      scope_kind: null,
      level: 'off',
    };
    findForUsers.mockResolvedValue(new Map([['a', [pref]]]));
    // `mentions` is a `users.id[]` column on `chat_messages`, resolved by the
    // API at send time (C1 of #937).
    //
    // This test used to build `{ a: true }` and pass, because the worker read
    // the field through a structural cast typed as a map — but no row has ever
    // carried it, since the column did not exist. So the mute override was
    // green here and had never fired once in production. Use the real shape.
    const row = {
      id: 'm1',
      channel_id: CHANNEL.id,
      sender_id: 'sender',
      content: 'hey @a can you cover tonight?',
      kind: 'text',
      created_at: '',
      mentions: ['a'],
    };
    await service.handleMessage(row);
    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith('a', 'chap-1', expect.any(Object));
  });

  it('suppresses system_audit unless the user opted in', async () => {
    service.__setChannelForTest({
      ...CHANNEL,
      id: 'ch-audit',
      name: 'chapter-audit',
      is_read_only: true,
    });
    setMembers(['sender', 'a']);
    await service.handleMessage({
      id: 'm1',
      channel_id: 'ch-audit',
      sender_id: 'sender',
      content: 'config changed',
      kind: 'system_audit',
      created_at: '',
    });
    expect(notifyUser).toHaveBeenCalledTimes(0);
  });

  it('bundles a burst into a single push at the threshold', async () => {
    service.__setChannelForTest(ANNOUNCEMENT_CHANNEL);
    setMembers(['sender', 'a']);
    for (let i = 0; i < 4; i++) {
      await service.handleMessage({
        id: `m${i}`,
        channel_id: ANNOUNCEMENT_CHANNEL.id,
        sender_id: 'sender',
        content: `msg ${i}`,
        kind: 'announcement',
        created_at: '',
      });
    }
    // Push 1 + Push 2 + Bundled push = 3; the 4th is skipped (within bundle).
    expect(notifyUser).toHaveBeenCalledTimes(3);
    const bundledCall = notifyUser.mock.calls[2];
    expect(bundledCall[2]).toEqual(
      expect.objectContaining({
        body: '3 new messages',
        data: expect.objectContaining({ bundled: true, count: 3 }),
      }),
    );
  });
  it('does not push a private channel to a chapter member who is not in it', async () => {
    // The recipient list starts as the whole chapter roster, and `decidePush`
    // returns 'send' on a mention *before* the level check — so without a read
    // filter, mentioning a non-member in a DM would hand them a 200-character
    // preview of its body plus a persisted notification row, overriding even an
    // explicit `off`. This was inert until mentions resolved for real (C1).
    service.__setChannelForTest({
      id: 'dm-1',
      chapter_id: 'chap-1',
      name: 'alice-bob',
      is_read_only: false,
      type: 'DM',
      member_ids: ['alice', 'bob'],
      required_permissions: null,
    });
    setMembers(['alice', 'bob', 'carol']);
    findForUsers.mockResolvedValue(new Map());

    await service.handleMessage({
      id: 'm1',
      channel_id: 'dm-1',
      sender_id: 'alice',
      content: 'do not tell @carol we are cutting her',
      kind: 'text',
      created_at: '',
      mentions: ['carol'],
    });

    const notified = notifyUser.mock.calls.map((c) => c[0]);
    expect(notified).not.toContain('carol');
  });

  it('still pushes a DM to the other participant', async () => {
    // The filter must not silence the channel it is protecting.
    service.__setChannelForTest({
      id: 'dm-1',
      chapter_id: 'chap-1',
      name: 'alice-bob',
      is_read_only: false,
      type: 'DM',
      member_ids: ['alice', 'bob'],
      required_permissions: null,
    });
    setMembers(['alice', 'bob', 'carol']);

    await service.handleMessage({
      id: 'm1',
      channel_id: 'dm-1',
      sender_id: 'alice',
      content: 'hey @bob',
      kind: 'text',
      created_at: '',
      mentions: ['bob'],
    });

    expect(notifyUser.mock.calls.map((c) => c[0])).toEqual(['bob']);
  });

  it('gates a ROLE_GATED channel on the recipient holding the permission', async () => {
    service.__setChannelForTest({
      id: 'ch-exec',
      chapter_id: 'chap-1',
      name: 'exec',
      is_read_only: false,
      type: 'ROLE_GATED',
      member_ids: null,
      required_permissions: ['exec:view'],
    });
    setMembers(['sender', 'officer', 'pledge']);
    getEffectivePermissions.mockImplementation(async (_chap, uid) =>
      uid === 'officer' ? ['exec:view'] : [],
    );

    await service.handleMessage({
      id: 'm1',
      channel_id: 'ch-exec',
      sender_id: 'sender',
      content: 'heads up @pledge @officer',
      kind: 'text',
      created_at: '',
      mentions: ['pledge', 'officer'],
    });

    expect(notifyUser.mock.calls.map((c) => c[0])).toEqual(['officer']);
  });

  it('exits on an imported message before loading the chapter roster', async () => {
    // The early exit is deliberately upstream of `decidePush`, unlike the
    // `system_audit` one. `system_audit` is a row per admin action, so paying
    // for a channel resolve and a roster load before deciding costs nothing; an
    // import is thousands of rows arriving as fast as Postgres can write them,
    // through a Realtime handler with no backpressure. Asserting the roster was
    // never touched is what pins that ordering.
    service.__setChannelForTest(ANNOUNCEMENT_CHANNEL);
    setMembers(['sender', 'a', 'b']);

    await service.handleMessage({
      id: 'm-import-1',
      channel_id: ANNOUNCEMENT_CHANNEL.id,
      sender_id: null,
      content: 'a message from 2019',
      kind: 'imported',
      created_at: '2019-03-04T00:00:00.000Z',
    });

    expect(notifyUser).not.toHaveBeenCalled();
    expect(findByChapter).not.toHaveBeenCalled();
  });

  it('does not push an imported message that mentions a member', async () => {
    // Imported prose is full of `@name` tokens. A mention overrides a muted
    // channel, so this is the case that would page people about 2019.
    service.__setChannelForTest(CHANNEL);
    setMembers(['a', 'recipient']);

    await service.handleMessage({
      id: 'm-import-2',
      channel_id: CHANNEL.id,
      sender_id: null,
      content: 'hey @recipient are you coming',
      kind: 'imported',
      mentions: ['recipient'],
      created_at: '2019-03-04T00:00:00.000Z',
    });

    expect(notifyUser).not.toHaveBeenCalled();
  });

  describe('channel cache eviction race (#988)', () => {
    it('does not re-cache a channel read that resolves after a concurrent invalidate', async () => {
      // No `__setChannelForTest` here — the point is to exercise the real,
      // uncached `resolveChannel` DB-read path with a controllable Supabase
      // response, so `channelCache.set()` gets called for real rather than
      // being bypassed by a pre-seeded cache hit.
      let resolveSelect!: (value: {
        data: typeof CHANNEL;
        error: null;
      }) => void;
      const selectPromise = new Promise<{
        data: typeof CHANNEL;
        error: null;
      }>((resolve) => {
        resolveSelect = resolve;
      });
      const maybeSingle = jest.fn().mockReturnValue(selectPromise);
      const eq = jest.fn().mockReturnValue({ maybeSingle });
      const select = jest.fn().mockReturnValue({ eq });
      const from = jest.fn().mockReturnValue({ select });
      const channelStub = {
        subscribe: jest.fn(),
        presenceState: () => ({}),
      };

      const channelCache = new ChannelCacheService();
      const raceFindByChapter = jest.fn().mockResolvedValue([]); // empty roster: handleMessage returns right after resolveChannel

      const mod = await Test.createTestingModule({
        providers: [
          ChatPushWorkerService,
          { provide: ChannelCacheService, useValue: channelCache },
          {
            provide: SUPABASE_CLIENT,
            useValue: { from, channel: () => channelStub },
          },
          {
            provide: MEMBER_REPOSITORY,
            useValue: { findByChapter: raceFindByChapter },
          },
          {
            provide: NotificationService,
            useValue: { notifyUser: jest.fn().mockResolvedValue(undefined) },
          },
          {
            provide: ChatNotificationPreferenceRepository,
            useValue: { findForUsers: jest.fn().mockResolvedValue(new Map()) },
          },
          {
            provide: RbacService,
            useValue: {
              getEffectivePermissions: jest.fn().mockResolvedValue([]),
            },
          },
        ],
      }).compile();
      const worker = mod.get(ChatPushWorkerService);

      // A message arrives for an uncached channel. `resolveChannel` misses
      // the cache and starts the SELECT above, which stays pending until
      // `resolveSelect` is called below.
      const handlePromise = worker.handleMessage({
        id: 'm1',
        channel_id: CHANNEL.id,
        sender_id: 'sender',
        content: 'hi',
        kind: 'text',
        created_at: '',
      });

      // While that read is in flight, simulate the concurrent
      // ChatService.updateChannel this issue is about: nothing is cached yet
      // (invalidate is a no-op on the map), but it bumps the epoch.
      channelCache.invalidate(CHANNEL.id);

      // Now the in-flight SELECT resolves with the pre-update row.
      resolveSelect({ data: CHANNEL, error: null });
      await handlePromise;

      // Without epoch fencing this would cache CHANNEL for a fresh 30s,
      // silently undoing the invalidate that raced it.
      expect(channelCache.get(CHANNEL.id)).toBeNull();
    });
  });
});
