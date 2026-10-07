import { Test } from '@nestjs/testing';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import { NotificationService } from '../services/notification.service';
import { ChatPushWorkerService } from './chat-push-worker.service';
import {
  CHAT_NOTIFICATION_PREFERENCE_REPOSITORY,
  type ChatNotificationPreferenceRow,
} from '#domain/repositories/chat-notification-preference.repository.interface';
import { CHAT_PUSH_DISPATCH_REPOSITORY } from '#domain/repositories/chat-push-dispatch.repository.interface';
import { CHAT_CHANNEL_REPOSITORY } from '#domain/repositories/chat.repository.interface';
import { RbacService } from '../services/rbac.service';
import { ChatBlockService } from '../services/chat-block.service';
import { ChannelCacheService } from '../services/channel-cache.service';
import { SYSTEM_SENDER_ID } from '@repo/validation';

describe('ChatPushWorkerService', () => {
  let service: ChatPushWorkerService;
  let notifyUser: jest.Mock;
  let findByChapter: jest.Mock;
  let findForUsers: jest.Mock;
  let getEffectivePermissions: jest.Mock;
  let filterOutBlockers: jest.Mock;
  let findDisplayIdentitiesByIds: jest.Mock;
  let claim: jest.Mock;
  let purgeBefore: jest.Mock;

  /** Display names the sender lookup answers with; anyone else has none. */
  const NAMES: Record<string, string> = {
    sender: 'Sam Rivera',
    alice: 'Alice Chen',
  };

  const CHANNEL = {
    id: 'ch-1',
    chapter_id: 'chap-1',
    name: 'random',
    default_notification_level: null,
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
    findDisplayIdentitiesByIds = jest.fn(async (ids: string[]) =>
      ids
        .filter((id) => NAMES[id])
        .map((id) => ({ id, display_name: NAMES[id], avatar_url: null })),
    );
    findByChapter = jest.fn();
    // Default: this instance wins every claim, so the rule-chain cases below
    // run as a single instance would. The claim cases override it.
    claim = jest.fn().mockResolvedValue('claimed');
    purgeBefore = jest.fn().mockResolvedValue(0);
    findForUsers = jest.fn().mockResolvedValue(new Map());
    getEffectivePermissions = jest.fn().mockResolvedValue([]);
    // Default: nobody has blocked the sender. Answered from the recipients
    // actually passed in rather than a fixed array, for the reason `setPrefs`
    // gives below — a static answer would stay green if the worker started
    // asking about the wrong audience.
    filterOutBlockers = jest.fn(
      async (
        _chapterId: string,
        _senderId: string | null,
        recipientIds: string[],
      ) => recipientIds,
    );

    service = await compileWorker({ claim, purgeBefore });
  });

  /**
   * One worker over this file's shared stubs, with its own claim store. Each
   * call is a separate instance (its own channel cache, bundler and presence
   * map), which is what the cross-instance claim cases need: two of these
   * behind one claim store are two API processes behind one database.
   */
  async function compileWorker(
    dispatches: {
      claim: (messageId: string) => Promise<string>;
      purgeBefore?: jest.Mock;
    },
    openChannel: jest.Mock = jest.fn(() => ({
      subscribe: jest.fn(),
      presenceState: () => ({}),
    })),
  ): Promise<ChatPushWorkerService> {
    const mod = await Test.createTestingModule({
      providers: [
        ChatPushWorkerService,
        { provide: USER_REPOSITORY, useValue: { findDisplayIdentitiesByIds } },
        ChannelCacheService,
        {
          // Only the presence subscription reaches the client directly; every
          // test seeds its channel through `__setChannelForTest`. An empty
          // roster by default: nobody is reading.
          provide: SUPABASE_CLIENT,
          useValue: { channel: openChannel },
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
          provide: CHAT_NOTIFICATION_PREFERENCE_REPOSITORY,
          useValue: { findForUsers },
        },
        {
          provide: CHAT_CHANNEL_REPOSITORY,
          useValue: { findPushRouting: jest.fn() },
        },
        { provide: CHAT_PUSH_DISPATCH_REPOSITORY, useValue: dispatches },
        {
          provide: RbacService,
          useValue: { getEffectivePermissions },
        },
        {
          provide: ChatBlockService,
          useValue: { filterOutBlockers },
        },
      ],
    }).compile();

    return mod.get(ChatPushWorkerService);
  }

  function setMembers(userIds: string[]) {
    findByChapter.mockResolvedValue(userIds.map((id) => ({ user_id: id })));
  }

  /**
   * Answer the preference read from the ids it was actually asked about.
   *
   * A `mockResolvedValue(new Map([['a', [pref]]]))` answers for `'a'` no matter
   * who the worker asked about, so a regression to the wrong audience — the
   * sender's id, an empty array — leaves every mute test green.
   * `docs/guides/testing.md` names that static form as the hazard that replaced
   * the old per-user stub's; this is the `chat-push-worker.realtime.spec.ts`
   * `setPrefs` shape, for the same reason.
   *
   * **Only for the workers built by the `beforeEach` module.** The nested
   * `channel cache eviction race (#988)` block compiles its own module with its
   * own `findForUsers` stub, which this helper does not touch — calling it from
   * there would configure a mock that worker never consults, and the test would
   * pass because no preference was read at all. That is the same "green for the
   * wrong reason" failure this helper exists to remove, so it is worth the two
   * lines to say it here rather than rediscover it.
   *
   * It does **not** discriminate `candidateIds` from `recipientIds`. Both tests
   * using it run a roster where every candidate can read the channel, so the
   * two arrays are equal and a swap is invisible — catching that needs a
   * fixture with a member who cannot read the channel, which is
   * `filterCanReadChannel`'s own concern rather than this helper's.
   *
   * A user with no rows is **absent** from the map rather than present with an
   * empty array, which is what pins the call site's `?? []` instead of assuming
   * it.
   */
  function setPrefs(byUser: Record<string, ChatNotificationPreferenceRow[]>) {
    findForUsers.mockImplementation(async (userIds: string[]) => {
      const map = new Map<string, ChatNotificationPreferenceRow[]>();
      for (const userId of userIds) {
        const rows = byUser[userId];
        if (rows?.length) map.set(userId, rows);
      }
      return map;
    });
  }

  describe('blocked senders (#2257)', () => {
    /*
      `spec/behavior/chat/README.md` § Report and block. A push is the one
      delivery that reaches past every client-side list — it lands on a lock
      screen and `notifyUser` persists a notification row — so the block has to
      be applied to the AUDIENCE, not to the preview.
    */
    it('does not notify a recipient who has blocked the sender', async () => {
      service.__setChannelForTest(CHANNEL);
      setMembers(['sender', 'blocker', 'bystander']);
      filterOutBlockers.mockImplementation(
        async (
          _chapterId: string,
          _senderId: string | null,
          recipientIds: string[],
        ) => recipientIds.filter((id) => id !== 'blocker'),
      );

      await service.handleMessage({
        id: 'm1',
        channel_id: CHANNEL.id,
        sender_id: 'sender',
        content: 'go away',
        kind: 'text',
        mentions: ['blocker', 'bystander'],
        created_at: '',
      });

      expect(filterOutBlockers).toHaveBeenCalledWith('chap-1', 'sender', [
        'blocker',
        'bystander',
      ]);
      expect(notifyUser).toHaveBeenCalledTimes(1);
      expect(notifyUser).toHaveBeenCalledWith(
        'bystander',
        'chap-1',
        expect.anything(),
      );
    });

    it('records the sender on every row it writes, bundled ones included (#2715)', async () => {
      // The in-app list withholds a member's chat rows from someone who blocks
      // them later, and `senderId` is what it filters on. A row without it is
      // withheld from anyone with a block, so dropping it here would quietly
      // empty blockers' history instead of failing anything.
      service.__setChannelForTest(CHANNEL);
      setMembers(['sender', 'bystander']);

      for (let i = 0; i < 3; i++) {
        await service.handleMessage({
          id: `m${i}`,
          channel_id: CHANNEL.id,
          sender_id: 'sender',
          content: `message ${i}`,
          kind: 'text',
          mentions: ['bystander'],
          created_at: '',
        });
      }

      const data = notifyUser.mock.calls.map(
        (c) => (c[2] as { data: Record<string, unknown> }).data,
      );
      expect(data.some((d) => d.bundled === true)).toBe(true);
      expect(data.some((d) => d.bundled === undefined)).toBe(true);
      for (const d of data) {
        expect(d).toMatchObject({
          target: { screen: 'chat', channelId: CHANNEL.id },
          senderId: 'sender',
        });
      }
    });

    it('drops a blocker even when the message mentions them', async () => {
      // The sharpest case: `decidePush` returns 'send' on `hasMention` BEFORE
      // the level check, so a mention overrides an explicit `off`. If the block
      // were applied anywhere downstream of that, a blocked member could force
      // a push into a channel the blocker had deliberately muted.
      service.__setChannelForTest(CHANNEL);
      setMembers(['sender', 'blocker']);
      setPrefs({
        blocker: [
          {
            user_id: 'blocker',
            chapter_id: 'chap-1',
            scope: 'channel',
            scope_id: CHANNEL.id,
            scope_kind: null,
            level: 'off',
          },
        ],
      });
      filterOutBlockers.mockResolvedValue([]);

      await service.handleMessage({
        id: 'm1',
        channel_id: CHANNEL.id,
        sender_id: 'sender',
        content: 'hey @blocker',
        kind: 'text',
        mentions: ['blocker'],
        created_at: '',
      });

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('never reads preferences for an audience it has not filtered', async () => {
      // Ordering, as an assertion. The block filter has to run before anything
      // that could produce a delivery — a preference read is harmless on its
      // own, but it is the step immediately before the fan-out loop, so if the
      // blocker is still in the list here they are still in it at `notifyUser`.
      service.__setChannelForTest(CHANNEL);
      setMembers(['sender', 'blocker', 'bystander']);
      filterOutBlockers.mockResolvedValue(['bystander']);

      await service.handleMessage({
        id: 'm1',
        channel_id: CHANNEL.id,
        sender_id: 'sender',
        content: 'hello',
        kind: 'text',
        mentions: ['bystander'],
        created_at: '',
      });

      expect(findForUsers).toHaveBeenCalledWith(['bystander'], 'chap-1');
    });

    it('sends nothing at all when the block list cannot be read', async () => {
      // Fail closed. "A block list that cannot be read is not an empty block
      // list" — so the whole fan-out for this message is lost rather than one
      // blocked member's content reaching the blocker's lock screen. The throw
      // is caught by `handleMessage`'s own try/catch, so the worker survives.
      service.__setChannelForTest(CHANNEL);
      setMembers(['sender', 'a', 'b']);
      filterOutBlockers.mockRejectedValue(new Error('pg down'));

      await expect(
        service.handleMessage({
          id: 'm1',
          channel_id: CHANNEL.id,
          sender_id: 'sender',
          content: 'hello @a @b',
          kind: 'text',
          mentions: ['a', 'b'],
          created_at: '',
        }),
      ).resolves.toBeUndefined();

      expect(notifyUser).not.toHaveBeenCalled();
    });
  });

  it('does not push the sender on their own message', async () => {
    service.__setChannelForTest(CHANNEL);
    setMembers(['sender', 'recipient']);
    await service.handleMessage({
      id: 'm1',
      channel_id: CHANNEL.id,
      sender_id: 'sender',
      content: 'hello',
      kind: 'text',
      mentions: [],
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
      mentions: [],
      created_at: '',
    });
    expect(notifyUser).toHaveBeenCalledTimes(2);
    expect(notifyUser).toHaveBeenCalledWith(
      'a',
      'chap-1',
      expect.objectContaining({
        title: 'Announcement from Sam Rivera',
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
      mentions: [],
      created_at: '',
    });
    expect(notifyUser).toHaveBeenCalledWith(
      'a',
      'chap-1',
      expect.objectContaining({
        title: 'Announcement from Sam Rivera',
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
        title: 'Sam Rivera in #random',
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
      mentions: [],
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
    setPrefs({ a: [pref] });
    await service.handleMessage({
      id: 'm1',
      channel_id: ANNOUNCEMENT_CHANNEL.id,
      sender_id: 'sender',
      content: 'Big news',
      kind: 'announcement',
      mentions: [],
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
      mentions: [],
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
    setPrefs({ a: [pref] });
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
    // The mute has to actually be IN PLAY for this to test an override, and
    // asserting the ARGUMENT is not enough to establish that — the worker can
    // ask about `'a'` and be handed nothing back.
    //
    // Without this, the test passes with the preference never delivered: `'a'`
    // falls to the channel default for a `text` message, the mention fires,
    // and `notifyUser` is called exactly once — the same assertions below,
    // reached with no mute to override. So assert what the worker was
    // RETURNED. A future "mentions override mutes anyway, skip the read"
    // optimisation is exactly what this catches.
    await expect(findForUsers.mock.results[0]?.value).resolves.toEqual(
      new Map([['a', [pref]]]),
    );
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
      mentions: [],
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
        mentions: [],
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
      default_notification_level: null,
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
      default_notification_level: null,
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
      default_notification_level: null,
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
      mentions: [],
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

  describe('one instance per message (#2846)', () => {
    const MESSAGE = {
      id: 'm-claim',
      channel_id: ANNOUNCEMENT_CHANNEL.id,
      sender_id: 'sender',
      content: 'chapter meeting moved to 8',
      kind: 'text',
      mentions: [],
      created_at: '',
    };

    /**
     * The database's half of the claim, in memory: a primary key on the
     * message id. The check and the add run with no await between them, so two
     * concurrent calls cannot both win, as two inserts cannot.
     */
    function sharedClaimStore() {
      const claimed = new Set<string>();
      return jest.fn(async (messageId: string) => {
        if (claimed.has(messageId)) return 'taken';
        claimed.add(messageId);
        return 'claimed';
      });
    }

    it('two instances receiving one INSERT notify each recipient exactly once', async () => {
      // Realtime hands the same row to every subscribed process. Before the
      // claim, each of them fanned it out.
      const store = sharedClaimStore();
      const first = await compileWorker({ claim: store });
      const second = await compileWorker({ claim: store });
      first.__setChannelForTest(ANNOUNCEMENT_CHANNEL);
      second.__setChannelForTest(ANNOUNCEMENT_CHANNEL);
      setMembers(['sender', 'a', 'b']);

      await Promise.all([
        first.handleMessage(MESSAGE),
        second.handleMessage(MESSAGE),
      ]);

      expect(store).toHaveBeenCalledTimes(2);
      expect(notifyUser.mock.calls.map((c) => c[0]).sort()).toEqual(['a', 'b']);
      // The loser stopped at the claim: one roster load, not two.
      expect(findByChapter).toHaveBeenCalledTimes(1);
    });

    it('the instance that loses the claim still joins the channel presence', async () => {
      // Presence is what keeps a push off the screen of someone already
      // reading the channel, and a subscription only knows the roster once it
      // has synced. If only the winner joined, each instance's first win in a
      // channel would read an empty roster.
      const store = sharedClaimStore();
      const openFirst = jest.fn(() => ({
        subscribe: jest.fn(),
        presenceState: () => ({}),
      }));
      const openSecond = jest.fn(() => ({
        subscribe: jest.fn(),
        presenceState: () => ({}),
      }));
      const first = await compileWorker({ claim: store }, openFirst);
      const second = await compileWorker({ claim: store }, openSecond);
      first.__setChannelForTest(ANNOUNCEMENT_CHANNEL);
      second.__setChannelForTest(ANNOUNCEMENT_CHANNEL);
      setMembers(['sender', 'a']);

      await first.handleMessage(MESSAGE);
      await second.handleMessage(MESSAGE);

      expect(notifyUser).toHaveBeenCalledTimes(1);
      for (const open of [openFirst, openSecond]) {
        expect(open).toHaveBeenCalledTimes(1);
        expect(open).toHaveBeenCalledWith(
          `chat:channel:${ANNOUNCEMENT_CHANNEL.id}`,
          expect.objectContaining({
            config: expect.objectContaining({ private: true }),
          }),
        );
      }
    });

    it('a redelivery to the same instance is not sent again', async () => {
      // A reconnecting socket can hand one process the same INSERT twice.
      const store = sharedClaimStore();
      const worker = await compileWorker({ claim: store });
      worker.__setChannelForTest(ANNOUNCEMENT_CHANNEL);
      setMembers(['sender', 'a']);

      await worker.handleMessage(MESSAGE);
      await worker.handleMessage(MESSAGE);

      expect(notifyUser).toHaveBeenCalledTimes(1);
    });

    it.each(['taken', 'gone', 'failed'])(
      'sends nothing and reads nothing when the claim is %s',
      async (outcome) => {
        service.__setChannelForTest(ANNOUNCEMENT_CHANNEL);
        setMembers(['sender', 'a', 'b']);
        claim.mockResolvedValue(outcome);

        await service.handleMessage(MESSAGE);

        expect(claim).toHaveBeenCalledWith('m-claim');
        expect(findByChapter).not.toHaveBeenCalled();
        expect(notifyUser).not.toHaveBeenCalled();
      },
    );

    it('survives a claim that throws, sending nothing', async () => {
      service.__setChannelForTest(ANNOUNCEMENT_CHANNEL);
      setMembers(['sender', 'a']);
      claim.mockRejectedValue(new Error('socket hang up'));

      await expect(service.handleMessage(MESSAGE)).resolves.toBeUndefined();

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('takes no claim for an imported message', async () => {
      // An import writes thousands of rows; none of them pushes, so none of
      // them should cost a claim row either.
      await service.handleMessage({ ...MESSAGE, kind: 'imported' });

      expect(claim).not.toHaveBeenCalled();
    });

    it('purges claims older than a day', async () => {
      const now = new Date('2026-09-30T12:00:00.000Z');
      purgeBefore.mockResolvedValue(3);

      await service.purgeDispatchClaims(now);

      expect(purgeBefore).toHaveBeenCalledWith(
        new Date('2026-09-29T12:00:00.000Z'),
      );
    });

    it('a failed purge is logged, not thrown out of the cron', async () => {
      purgeBefore.mockRejectedValue(new Error('pg down'));

      await expect(
        service.purgeDispatchClaims(new Date()),
      ).resolves.toBeUndefined();
    });
  });

  describe('one push path, sender-named titles, default levels (#2771)', () => {
    const DM = {
      ...CHANNEL,
      id: 'dm-1',
      name: 'dm-alice-sender',
      type: 'DM',
      member_ids: ['sender', 'alice'],
    };
    const send = (
      channelId: string,
      over: Partial<Parameters<ChatPushWorkerService['handleMessage']>[0]> = {},
    ) =>
      service.handleMessage({
        id: 'm1',
        channel_id: channelId,
        sender_id: 'sender',
        content: 'hello',
        kind: 'text',
        mentions: [],
        created_at: '',
        ...over,
      });
    const titles = () =>
      notifyUser.mock.calls.map((c) => (c[2] as { title: string }).title);

    it('pushes every DM message by default, titled with the sender alone', async () => {
      service.__setChannelForTest(DM);
      setMembers(['sender', 'alice', 'carol']);
      await send(DM.id);
      expect(notifyUser).toHaveBeenCalledTimes(1);
      expect(notifyUser).toHaveBeenCalledWith(
        'alice',
        'chap-1',
        expect.objectContaining({
          title: 'Sam Rivera',
          body: 'hello',
          category: 'chat',
          priority: 'NORMAL',
        }),
      );
    });

    it('pushes nothing for a DM the recipient muted', async () => {
      service.__setChannelForTest(DM);
      setMembers(['sender', 'alice']);
      setPrefs({
        alice: [
          {
            user_id: 'alice',
            chapter_id: 'chap-1',
            scope: 'channel',
            scope_id: DM.id,
            scope_kind: null,
            level: 'off',
          },
        ],
      });
      await send(DM.id);
      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('still pushes a muted DM that mentions the recipient, once', async () => {
      service.__setChannelForTest(DM);
      setMembers(['sender', 'alice']);
      setPrefs({
        alice: [
          {
            user_id: 'alice',
            chapter_id: 'chap-1',
            scope: 'channel',
            scope_id: DM.id,
            scope_kind: null,
            level: 'off',
          },
        ],
      });
      await send(DM.id, { content: 'hey @alice', mentions: ['alice'] });
      expect(notifyUser).toHaveBeenCalledTimes(1);
    });

    it('titles a named group DM with the sender and the group', async () => {
      service.__setChannelForTest({
        ...DM,
        id: 'gdm-1',
        name: 'Rush chairs',
        type: 'GROUP_DM',
        member_ids: ['sender', 'alice', 'bob'],
      });
      setMembers(['sender', 'alice', 'bob']);
      await send('gdm-1');
      expect(titles()).toEqual([
        'Sam Rivera in Rush chairs',
        'Sam Rivera in Rush chairs',
      ]);
    });

    it("never puts an unnamed group DM's placeholder name in a title", async () => {
      service.__setChannelForTest({
        ...DM,
        id: 'gdm-2',
        name: 'group-dm-1727000000000',
        type: 'GROUP_DM',
        member_ids: ['sender', 'alice'],
      });
      setMembers(['sender', 'alice']);
      await send('gdm-2');
      expect(titles()).toEqual(['Sam Rivera']);
    });

    it('pushes #general to everyone by default, naming the sender', async () => {
      service.__setChannelForTest({
        ...CHANNEL,
        id: 'ch-gen',
        name: 'general',
      });
      setMembers(['sender', 'a', 'b']);
      await send('ch-gen');
      expect(notifyUser.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
      expect(titles()).toEqual([
        'Sam Rivera in #general',
        'Sam Rivera in #general',
      ]);
    });

    it('follows the officer-set channel default over the built-in one', async () => {
      service.__setChannelForTest({
        ...CHANNEL,
        id: 'ch-gen',
        name: 'general',
        default_notification_level: 'mentions',
      });
      setMembers(['sender', 'a']);
      await send('ch-gen');
      expect(notifyUser).not.toHaveBeenCalled();

      service.__setChannelForTest({
        ...CHANNEL,
        id: 'ch-social',
        name: 'social',
        default_notification_level: 'all',
      });
      await send('ch-social');
      expect(notifyUser).toHaveBeenCalledTimes(1);
    });

    it("lets a member's own level beat the officer-set default", async () => {
      service.__setChannelForTest({
        ...CHANNEL,
        id: 'ch-social',
        name: 'social',
        default_notification_level: 'all',
      });
      setMembers(['sender', 'a']);
      setPrefs({
        a: [
          {
            user_id: 'a',
            chapter_id: 'chap-1',
            scope: 'channel',
            scope_id: 'ch-social',
            scope_kind: null,
            level: 'off',
          },
        ],
      });
      await send('ch-social');
      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('treats a public read-only channel named like announcements as one', async () => {
      // `ChatService` used to fan these out itself. The worker now owns them,
      // so the announcement test has to cover them or they go silent.
      service.__setChannelForTest({
        ...CHANNEL,
        id: 'ch-exec-ann',
        name: 'chapter-announcements',
        is_read_only: true,
      });
      setMembers(['sender', 'a']);
      await send('ch-exec-ann');
      expect(notifyUser).toHaveBeenCalledWith(
        'a',
        'chap-1',
        expect.objectContaining({
          title: 'Announcement from Sam Rivera',
          priority: 'URGENT',
          category: 'announcements',
        }),
      );
    });

    it('does not treat a channel anyone can post in as announcements', async () => {
      service.__setChannelForTest({
        ...CHANNEL,
        id: 'ch-im',
        name: 'intramural-announcements',
        is_read_only: false,
      });
      setMembers(['sender', 'a']);
      await send('ch-im');
      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('keeps a bundled announcement burst URGENT and in its own category', async () => {
      service.__setChannelForTest(ANNOUNCEMENT_CHANNEL);
      setMembers(['sender', 'a']);
      for (let i = 0; i < 3; i++) {
        await send(ANNOUNCEMENT_CHANNEL.id, { id: `m${i}` });
      }
      expect(notifyUser.mock.calls[2][2]).toEqual(
        expect.objectContaining({
          title: 'Announcement from Sam Rivera',
          body: '3 new messages',
          priority: 'URGENT',
          category: 'announcements',
        }),
      );
    });

    it('names the sender in a bundled channel push too', async () => {
      service.__setChannelForTest({
        ...CHANNEL,
        id: 'ch-gen',
        name: 'general',
      });
      setMembers(['sender', 'a']);
      for (let i = 0; i < 3; i++) {
        await send('ch-gen', { id: `m${i}` });
      }
      expect(notifyUser.mock.calls[2][2]).toEqual(
        expect.objectContaining({
          title: 'Sam Rivera in #general',
          body: '3 new messages',
          data: expect.objectContaining({ bundled: true, count: 3 }),
        }),
      );
    });

    it('falls back to the old titles when the sender has no name', async () => {
      service.__setChannelForTest({
        ...CHANNEL,
        id: 'ch-gen',
        name: 'general',
      });
      service.__setChannelForTest(DM);
      setMembers(['nameless', 'sender', 'alice']);
      await send('ch-gen', { sender_id: 'nameless' });
      await send(DM.id, { sender_id: 'nameless', id: 'm2' });
      expect(titles()).toEqual([
        'New message in #general',
        'New message in #general',
        'New Message',
        'New Message',
      ]);
    });

    it('gives a nameless burst the title a single push has, not a plural one', async () => {
      service.__setChannelForTest({
        ...CHANNEL,
        id: 'ch-gen',
        name: 'general',
      });
      service.__setChannelForTest(ANNOUNCEMENT_CHANNEL);
      service.__setChannelForTest(DM);
      setMembers(['nameless', 'alice']);
      for (const channelId of ['ch-gen', ANNOUNCEMENT_CHANNEL.id, DM.id]) {
        for (let i = 0; i < 3; i++) {
          await send(channelId, {
            id: `${channelId}-${i}`,
            sender_id: 'nameless',
          });
        }
      }
      const bundled = notifyUser.mock.calls
        .map((c) => c[2] as { title: string; data: { bundled?: boolean } })
        .filter((p) => p.data.bundled)
        .map((p) => p.title);
      expect(bundled).toEqual([
        'New message in #general',
        'New Announcement',
        'New Message',
      ]);
    });

    it('keeps the old titles for the system actor, never "Frapp System"', async () => {
      // An opted-in member's audit-bridge push, and a system DM they opened.
      findDisplayIdentitiesByIds.mockResolvedValue([
        {
          id: SYSTEM_SENDER_ID,
          display_name: 'Frapp System',
          avatar_url: null,
        },
      ]);
      service.__setChannelForTest({
        ...CHANNEL,
        id: 'ch-gen',
        name: 'general',
      });
      setMembers(['a']);
      await send('ch-gen', { sender_id: SYSTEM_SENDER_ID, kind: 'text' });
      expect(titles()).toEqual(['New message in #general']);
      expect(findDisplayIdentitiesByIds).not.toHaveBeenCalled();
    });

    it('ignores a client-supplied announcement kind outside an announcements channel', async () => {
      // `kind` comes from the client, and any member may post one in #general.
      service.__setChannelForTest({
        ...CHANNEL,
        id: 'ch-gen',
        name: 'general',
      });
      setMembers(['sender', 'a']);
      await send('ch-gen', { kind: 'announcement' });
      expect(notifyUser).toHaveBeenCalledWith(
        'a',
        'chap-1',
        expect.objectContaining({
          title: 'Sam Rivera in #general',
          priority: 'NORMAL',
          category: 'chat',
        }),
      );
    });

    it('does not treat a group DM named announcements as announcements', async () => {
      service.__setChannelForTest({
        ...DM,
        id: 'gdm-ann',
        name: 'announcements',
        type: 'GROUP_DM',
        member_ids: ['sender', 'alice'],
      });
      setMembers(['sender', 'alice']);
      await send('gdm-ann');
      expect(notifyUser).toHaveBeenCalledWith(
        'alice',
        'chap-1',
        expect.objectContaining({
          title: 'Sam Rivera in announcements',
          priority: 'NORMAL',
          category: 'chat',
        }),
      );
    });

    it('does not treat #announcements with read-only switched off as announcements', async () => {
      service.__setChannelForTest({
        ...ANNOUNCEMENT_CHANNEL,
        is_read_only: false,
      });
      setMembers(['sender', 'a']);
      await send(ANNOUNCEMENT_CHANNEL.id);
      // An ordinary channel now: `mentions` by default, so no push at all.
      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('still pushes when the sender name cannot be read', async () => {
      findDisplayIdentitiesByIds.mockRejectedValue(new Error('db down'));
      service.__setChannelForTest(DM);
      setMembers(['sender', 'alice']);
      await send(DM.id);
      expect(titles()).toEqual(['New Message']);
    });

    it('reads the sender name once per message, and not at all when nobody is pushed', async () => {
      service.__setChannelForTest({
        ...CHANNEL,
        id: 'ch-gen',
        name: 'general',
      });
      setMembers(['sender', 'a', 'b', 'c']);
      await send('ch-gen');
      expect(findDisplayIdentitiesByIds).toHaveBeenCalledTimes(1);

      findDisplayIdentitiesByIds.mockClear();
      service.__setChannelForTest(CHANNEL); // `mentions` default, no mention
      await send(CHANNEL.id, { id: 'm2' });
      expect(findDisplayIdentitiesByIds).not.toHaveBeenCalled();
    });
  });

  describe('channel cache eviction race (#988)', () => {
    it('does not re-cache a channel read that resolves after a concurrent invalidate', async () => {
      // No `__setChannelForTest` here — the point is to exercise the real,
      // uncached `resolveChannel` read path with a controllable repository
      // response, so `channelCache.set()` gets called for real rather than
      // being bypassed by a pre-seeded cache hit.
      let resolveRead!: (value: typeof CHANNEL) => void;
      const readPromise = new Promise<typeof CHANNEL>((resolve) => {
        resolveRead = resolve;
      });
      // Signals the moment the read is actually issued, so the invalidate
      // below lands while the read is in flight rather than before it starts.
      // `handleMessage` awaits its dispatch claim first, so the read no longer
      // starts in the same tick the message arrives.
      let readStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        readStarted = resolve;
      });
      const findPushRouting = jest.fn(() => {
        readStarted();
        return readPromise;
      });
      const channelStub = {
        subscribe: jest.fn(),
        presenceState: () => ({}),
      };

      const channelCache = new ChannelCacheService();
      const raceFindByChapter = jest.fn().mockResolvedValue([]); // empty roster: handleMessage returns right after resolveChannel

      const mod = await Test.createTestingModule({
        providers: [
          ChatPushWorkerService,
          {
            provide: USER_REPOSITORY,
            useValue: { findDisplayIdentitiesByIds },
          },
          { provide: ChannelCacheService, useValue: channelCache },
          {
            provide: SUPABASE_CLIENT,
            useValue: { channel: () => channelStub },
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
            provide: CHAT_NOTIFICATION_PREFERENCE_REPOSITORY,
            useValue: { findForUsers: jest.fn().mockResolvedValue(new Map()) },
          },
          { provide: CHAT_CHANNEL_REPOSITORY, useValue: { findPushRouting } },
          {
            provide: CHAT_PUSH_DISPATCH_REPOSITORY,
            useValue: { claim: jest.fn().mockResolvedValue('claimed') },
          },
          {
            provide: RbacService,
            useValue: {
              getEffectivePermissions: jest.fn().mockResolvedValue([]),
            },
          },
          {
            // The roster is empty in this race fixture, so `handleMessage`
            // returns before the audience is filtered at all; the provider is
            // here to satisfy the injector, not to be consulted.
            provide: ChatBlockService,
            useValue: { filterOutBlockers: jest.fn() },
          },
        ],
      }).compile();
      const worker = mod.get(ChatPushWorkerService);

      // A message arrives for an uncached channel. `resolveChannel` misses
      // the cache and starts the read above, which stays pending until
      // `resolveRead` is called below.
      const handlePromise = worker.handleMessage({
        id: 'm1',
        channel_id: CHANNEL.id,
        sender_id: 'sender',
        content: 'hi',
        kind: 'text',
        mentions: [],
        created_at: '',
      });

      // While that read is in flight, simulate the concurrent
      // ChatService.updateChannel this issue is about: nothing is cached yet
      // (invalidate is a no-op on the map), but it bumps the epoch.
      await started;
      channelCache.invalidate(CHANNEL.id);

      // Now the in-flight read resolves with the pre-update row.
      resolveRead(CHANNEL);
      await handlePromise;

      // Without epoch fencing this would cache CHANNEL for a fresh 30s,
      // silently undoing the invalidate that raced it.
      expect(channelCache.get(CHANNEL.id)).toBeNull();
    });
  });
});
