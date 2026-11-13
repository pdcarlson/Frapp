import { Test } from '@nestjs/testing';
import * as Sentry from '@sentry/nestjs';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import { CHAT_THREAD_REPOSITORY } from '#domain/repositories/chat-thread.repository.interface';

/** Message threads (#3785): nobody follows anything unless a test says so. */
const threadRepoStub = {
  findFollowStates: jest.fn().mockResolvedValue(new Map()),
};
import { NotificationService } from '../services/notification.service';
import { ChatPushWorkerService } from './chat-push-worker.service';
import { chatPushPreview } from '../services/chat-push-preview';
import {
  CHAT_NOTIFICATION_PREFERENCE_REPOSITORY,
  type ChatNotificationPreferenceRow,
} from '#domain/repositories/chat-notification-preference.repository.interface';
import { CHAT_PUSH_DISPATCH_REPOSITORY } from '#domain/repositories/chat-push-dispatch.repository.interface';
import { CHAT_CHANNEL_REPOSITORY } from '#domain/repositories/chat.repository.interface';
import { RbacService } from '../services/rbac.service';
import { EMPTY_ACCESS_HOLDER } from '#domain/utils/channel-access';
import { ChatBlockService } from '../services/chat-block.service';
import {
  ChannelCacheService,
  type CachedChannelRow,
} from '../services/channel-cache.service';
import { SYSTEM_SENDER_ID } from '@repo/validation';
import { SupabaseQueryError } from '../../infrastructure/supabase/supabase-query-error';

jest.mock('@sentry/nestjs', () => ({
  ...jest.requireActual<typeof import('@sentry/nestjs')>('@sentry/nestjs'),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

describe('ChatPushWorkerService', () => {
  let service: ChatPushWorkerService;
  let notifyUser: jest.Mock;
  let findByChapter: jest.Mock;
  let findForUsers: jest.Mock;
  let getEffectivePermissions: jest.Mock;
  let getChapterMemberAccess: jest.Mock;
  let filterOutBlockers: jest.Mock;
  let findDisplayIdentitiesByIds: jest.Mock;
  let claim: jest.Mock;
  let purgeBefore: jest.Mock;
  let findPushRouting: jest.Mock;

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
    who_can_see: null,
    who_can_post: null,
  } satisfies CachedChannelRow;

  const ANNOUNCEMENT_CHANNEL = {
    ...CHANNEL,
    id: 'ch-announce',
    name: 'announcements',
    is_read_only: true,
  } satisfies CachedChannelRow;

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
    // Every test but the lookup cases seeds its channel through
    // `__setChannelForTest`, so the read never runs for them.
    findPushRouting = jest.fn().mockResolvedValue(null);
    getEffectivePermissions = jest.fn().mockResolvedValue([]);
    getChapterMemberAccess = jest.fn().mockResolvedValue([]);
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
        { provide: CHAT_THREAD_REPOSITORY, useValue: threadRepoStub },
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
          useValue: { findPushRouting },
        },
        { provide: CHAT_PUSH_DISPATCH_REPOSITORY, useValue: dispatches },
        {
          provide: RbacService,
          useValue: { getEffectivePermissions, getChapterMemberAccess },
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
      } // Bundled or not, every push stacks with its channel's others on iOS.
      for (const call of notifyUser.mock.calls) {
        expect(call[2]).toMatchObject({ threadId: `chat:${CHANNEL.id}` });
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

  // Message threads (#3785): a reply pushes its followers only, never more
  // than the channel allows except an @mention, and never as an announcement,
  // because any reader may reply in a thread under one.
  describe('thread replies (#3785)', () => {
    afterEach(() => {
      threadRepoStub.findFollowStates.mockResolvedValue(new Map());
    });

    const threadReply = (mentions: string[] = []) => ({
      id: 'r1',
      channel_id: ANNOUNCEMENT_CHANNEL.id,
      sender_id: 'sender',
      content: 'Can I bring a friend?',
      kind: 'text',
      mentions,
      thread_root_id: 'root-1',
      created_at: '',
    });

    it('pushes a follower, as chat at NORMAL, and skips everyone else', async () => {
      service.__setChannelForTest(ANNOUNCEMENT_CHANNEL);
      setMembers(['sender', 'a', 'b', 'c']);
      threadRepoStub.findFollowStates.mockResolvedValue(
        new Map([
          ['a', 'following'],
          ['b', 'muted'],
          ['c', 'unfollowed'],
        ]),
      );

      await service.handleMessage(threadReply());

      expect(threadRepoStub.findFollowStates).toHaveBeenCalledWith('root-1');
      expect(notifyUser).toHaveBeenCalledTimes(1);
      expect(notifyUser).toHaveBeenCalledWith(
        'a',
        'chap-1',
        expect.objectContaining({
          category: 'chat',
          priority: 'NORMAL',
          data: expect.objectContaining({
            target: {
              screen: 'chat',
              channelId: ANNOUNCEMENT_CHANNEL.id,
              threadRootId: 'root-1',
            },
          }),
        }),
      );
    });

    it('still pushes an @mention to a member who muted the thread', async () => {
      service.__setChannelForTest(ANNOUNCEMENT_CHANNEL);
      setMembers(['sender', 'b']);
      threadRepoStub.findFollowStates.mockResolvedValue(
        new Map([['b', 'muted']]),
      );

      await service.handleMessage(threadReply(['b']));

      expect(notifyUser).toHaveBeenCalledTimes(1);
      expect(notifyUser).toHaveBeenCalledWith(
        'b',
        'chap-1',
        expect.any(Object),
      );
    });
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

  // #3846: a photo or file sent with no text used to push an empty body, which
  // an iPhone shows as the bare word "Notification". The body has to say what
  // was sent, and the title still names the sender.
  it('says what was sent when a message is only a file', async () => {
    service.__setChannelForTest(CHANNEL);
    setMembers(['sender', 'a']);
    await service.handleMessage({
      id: 'm1',
      channel_id: CHANNEL.id,
      sender_id: 'sender',
      content: '',
      kind: 'text',
      mentions: ['a'],
      metadata: { attachment_count: 1 },
      created_at: '',
    });
    expect(notifyUser).toHaveBeenCalledWith(
      'a',
      'chap-1',
      expect.objectContaining({
        title: expect.stringMatching(/\S/),
        body: 'Sent an attachment',
      }),
    );
  });

  describe('chatPushPreview', () => {
    it('names a GIF message, which has no text (#4631)', () => {
      expect(
        chatPushPreview({
          content: '',
          metadata: { gif: { url: 'https://static.klipy.com/h.webp' } },
        }),
      ).toBe('Sent a GIF');
    });

    it('drops U+FFFC, which every surface drew as an "OBJ" box (#4346)', () => {
      expect(chatPushPreview({ content: 'take a look \uFFFC' })).toBe(
        'take a look',
      );
      expect(
        chatPushPreview({
          content: '\uFFFC',
          metadata: { attachment_count: 1 },
        }),
      ).toBe('Sent an attachment');
    });

    it('is the first 200 characters of the text', () => {
      expect(chatPushPreview({ content: 'x'.repeat(250) })).toBe(
        'x'.repeat(200),
      );
      expect(chatPushPreview({ content: '  hi  ' })).toBe('hi');
    });

    it('never splits an emoji at the cut', () => {
      const preview = chatPushPreview({ content: `${'a'.repeat(199)}😀x` });
      expect(preview).toBe(`${'a'.repeat(199)}😀`);
      expect(preview).not.toMatch(/[\uD800-\uDBFF]$/);
    });

    it('ignores an attachment count that is not a whole number', () => {
      expect(
        chatPushPreview({ content: '', metadata: { attachment_count: 2.5 } }),
      ).toBe('Sent a message');
    });

    it('never comes back blank', () => {
      expect(
        chatPushPreview({ content: '', metadata: { attachment_count: 3 } }),
      ).toBe('Sent 3 attachments');
      expect(
        chatPushPreview({ content: '   ', metadata: { attachment_count: 1 } }),
      ).toBe('Sent an attachment');
      for (const content of [null, '', '  \n ']) {
        expect(chatPushPreview({ content, metadata: null }).trim()).not.toBe(
          '',
        );
      }
    });
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
    // A single push is tied to the message it quotes, so deleting the message
    // deletes its row (#4418); a bundle quotes no one message and is not.
    expect(notifyUser.mock.calls[0][2]).toMatchObject({ chatMessageId: 'm0' });
    expect(notifyUser.mock.calls[1][2]).toMatchObject({ chatMessageId: 'm1' });
    expect(bundledCall[2]).not.toHaveProperty('chatMessageId');
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
      who_can_see: null,
      who_can_post: null,
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
      who_can_see: null,
      who_can_post: null,
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

  it('gates a channel with a who-can-see list on the recipient holding an entry in it', async () => {
    service.__setChannelForTest({
      id: 'ch-exec',
      chapter_id: 'chap-1',
      name: 'exec',
      default_notification_level: null,
      is_read_only: false,
      type: 'ROLE_GATED',
      member_ids: null,
      who_can_see: ['tier:00000000-0000-4000-8000-0000000000e1'],
      who_can_post: null,
    });
    setMembers(['sender', 'officer', 'pledge']);
    const exec = {
      ...EMPTY_ACCESS_HOLDER,
      entries: new Set(['tier:00000000-0000-4000-8000-0000000000e1']),
    };
    getChapterMemberAccess.mockResolvedValue([
      { user_id: 'sender', channel_access: exec },
      { user_id: 'officer', channel_access: exec },
      { user_id: 'pledge', channel_access: EMPTY_ACCESS_HOLDER },
    ]);

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

  it('exits on a posted Ask Frapp answer: no push, no notification, no roster read (#4713)', async () => {
    service.__setChannelForTest(ANNOUNCEMENT_CHANNEL);
    setMembers(['sender', 'a', 'b']);

    await service.handleMessage({
      id: 'm-ask-answer-1',
      channel_id: ANNOUNCEMENT_CHANNEL.id,
      sender_id: '00000000-0000-0000-0000-000000000000',
      content: 'Chapter meeting is Sunday at 7:00 PM.',
      kind: 'ask_answer',
      mentions: [],
      created_at: '2026-11-13T18:00:00.000Z',
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

    it('a caught failure that drops a claimed message reports to Sentry', async () => {
      // Past the claim no other instance will send this message, so the
      // failure is a dropped fan-out, not a log line.
      const worker = await compileWorker({ claim: sharedClaimStore() });
      worker.__setChannelForTest(ANNOUNCEMENT_CHANNEL);
      findByChapter.mockRejectedValue(new Error('roster read failed'));
      jest.mocked(Sentry.captureException).mockClear();

      await expect(worker.handleMessage(MESSAGE)).resolves.toBeUndefined();

      expect(notifyUser).not.toHaveBeenCalled();
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
      expect(
        jest.mocked(Sentry.captureException).mock.calls[0]?.[1],
      ).toMatchObject({
        level: 'error',
        tags: { caught_at: 'chat-push-fan-out-failed' },
      });
    });

    it('reports a failed push to one recipient as a warning, and pushes the rest', async () => {
      const worker = await compileWorker({ claim: sharedClaimStore() });
      worker.__setChannelForTest(ANNOUNCEMENT_CHANNEL);
      setMembers(['sender', 'a', 'b']);
      notifyUser.mockImplementation(async (userId: string) => {
        if (userId === 'a') throw new Error('push provider down');
      });
      jest.mocked(Sentry.captureException).mockClear();

      await worker.handleMessage(MESSAGE);

      expect(notifyUser.mock.calls.map((c) => c[0]).sort()).toEqual(['a', 'b']);
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
      expect(
        jest.mocked(Sentry.captureException).mock.calls[0]?.[1],
      ).toMatchObject({
        level: 'warning',
        tags: { caught_at: 'chat-push-notify-recipient' },
      });
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

    it('reports a failed purge to Sentry once, as a warning', async () => {
      jest.mocked(Sentry.captureException).mockClear();
      purgeBefore.mockRejectedValue(new Error('pg down'));

      await service.purgeDispatchClaims(new Date());
      await service.purgeDispatchClaims(new Date());

      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
      expect(
        jest.mocked(Sentry.captureException).mock.calls[0]?.[1],
      ).toMatchObject({
        level: 'warning',
        tags: { caught_at: 'chat-push-dispatch-claim-purge' },
      });
    });
  });

  describe('one push path, sender-named titles, default levels (#2771)', () => {
    const DM = {
      ...CHANNEL,
      id: 'dm-1',
      name: 'dm-alice-sender',
      type: 'DM',
      member_ids: ['sender', 'alice'],
    } satisfies CachedChannelRow;
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

    describe('what the in-app list draws a row by (#4346)', () => {
      const dataFor = (recipient: string) =>
        notifyUser.mock.calls
          .filter((c) => c[0] === recipient)
          .map((c) => (c[2] as { data: Record<string, unknown> }).data);

      it('marks a DM as one, with no channel name', async () => {
        service.__setChannelForTest(DM);
        setMembers(['sender', 'alice']);
        await send(DM.id);
        const [data] = dataFor('alice');
        expect(data).toMatchObject({ chatKind: 'dm', senderId: 'sender' });
        expect(data).not.toHaveProperty('channelName');
        expect(data).not.toHaveProperty('mentioned');
      });

      it('names a channel, and flags the mention only for the member it mentioned', async () => {
        service.__setChannelForTest({
          ...CHANNEL,
          id: 'ch-gen',
          name: 'general',
        });
        setMembers(['sender', 'alice', 'bob']);
        setPrefs({
          bob: [
            {
              user_id: 'bob',
              chapter_id: 'chap-1',
              scope: 'channel',
              scope_id: 'ch-gen',
              scope_kind: null,
              level: 'all',
            },
          ],
        });
        await send('ch-gen', { content: 'hey @alice', mentions: ['alice'] });
        expect(dataFor('alice')).toEqual([
          expect.objectContaining({
            chatKind: 'channel',
            channelName: 'general',
            mentioned: true,
          }),
        ]);
        const [bobs] = dataFor('bob');
        expect(bobs).toMatchObject({
          chatKind: 'channel',
          channelName: 'general',
        });
        expect(bobs).not.toHaveProperty('mentioned');
      });

      it('marks an announcement as one', async () => {
        service.__setChannelForTest(ANNOUNCEMENT_CHANNEL);
        setMembers(['sender', 'alice']);
        await send(ANNOUNCEMENT_CHANNEL.id);
        expect(dataFor('alice')[0]).toMatchObject({
          chatKind: 'announcement',
          channelName: 'announcements',
        });
      });

      it('carries the same fields on a bundled burst', async () => {
        service.__setChannelForTest(DM);
        setMembers(['sender', 'alice']);
        // The third message in a burst is the one pushed as the bundle.
        for (let i = 0; i < 3; i++) {
          await send(DM.id, {
            id: `m${i}`,
            content: i === 2 ? 'hey @alice' : 'hi',
            mentions: i === 2 ? ['alice'] : [],
          });
        }
        const bundled = dataFor('alice').filter((d) => d.bundled === true);
        expect(bundled).toHaveLength(1);
        expect(bundled[0]).toMatchObject({
          chatKind: 'dm',
          senderId: 'sender',
          mentioned: true,
        });
      });

      it('still reaches the recipient when a mention is the 4th message of a burst (#4359)', async () => {
        service.__setChannelForTest({
          ...CHANNEL,
          id: 'ch-gen',
          name: 'general',
        });
        setMembers(['sender', 'alice', 'bob']);
        // Both get every message here, so the burst bundles for each; only
        // Alice is mentioned, in the 4th, after her bundle row was written.
        setPrefs({
          alice: [
            {
              user_id: 'alice',
              chapter_id: 'chap-1',
              scope: 'channel',
              scope_id: 'ch-gen',
              scope_kind: null,
              level: 'all',
            },
          ],
          bob: [
            {
              user_id: 'bob',
              chapter_id: 'chap-1',
              scope: 'channel',
              scope_id: 'ch-gen',
              scope_kind: null,
              level: 'all',
            },
          ],
        });
        // The 5th mentions her again: one mention push per burst, so a
        // sender pinging in every message stays capped like any burst.
        for (let i = 0; i < 5; i++) {
          await send('ch-gen', {
            id: `m${i}`,
            content:
              i === 3
                ? '@alice can you cover saturday?'
                : i === 4
                  ? '@alice and sunday?'
                  : `msg ${i}`,
            mentions: i >= 3 ? ['alice'] : [],
          });
        }
        const alices = dataFor('alice');
        // 1, 2, the bundle at 3, then the mention on its own; not the 5th.
        expect(alices).toHaveLength(4);
        expect(alices[2]).toMatchObject({ bundled: true, count: 3 });
        expect(alices[2]).not.toHaveProperty('mentioned');
        expect(alices[3]).toMatchObject({
          chatKind: 'channel',
          channelName: 'general',
          senderId: 'sender',
          mentioned: true,
        });
        expect(alices[3]).not.toHaveProperty('bundled');
        const mentionPush = notifyUser.mock.calls.filter(
          (c) => c[0] === 'alice',
        )[3][2] as { body: string };
        expect(mentionPush.body).toContain('can you cover saturday');

        // Bob was not mentioned: his 4th and 5th stay inside the bundle.
        expect(dataFor('bob')).toHaveLength(3);
      });

      it('names a named group DM and leaves an unnamed one unnamed', async () => {
        const group = {
          ...DM,
          id: 'gdm-1',
          name: 'Rush chairs',
          type: 'GROUP_DM',
          member_ids: ['sender', 'alice', 'bob'],
        } satisfies CachedChannelRow;
        service.__setChannelForTest(group);
        setMembers(['sender', 'alice', 'bob']);
        await send(group.id);
        expect(dataFor('alice')[0]).toMatchObject({
          chatKind: 'group',
          channelName: 'Rush chairs',
        });

        notifyUser.mockClear();
        service.__setChannelForTest({
          ...group,
          id: 'gdm-2',
          name: 'group-dm-1700000000',
        });
        await send('gdm-2', { id: 'm2' });
        const [unnamed] = dataFor('alice');
        expect(unnamed).toMatchObject({ chatKind: 'group' });
        expect(unnamed).not.toHaveProperty('channelName');
      });
    });
  });

  describe('channel lookup (#3219)', () => {
    const MESSAGE = {
      id: 'm-lookup',
      channel_id: 'ch-uncached',
      sender_id: 'sender',
      content: 'hi',
      kind: 'text',
      mentions: [],
      created_at: '',
    };

    function warnSpy() {
      return jest.spyOn(
        (
          service as unknown as {
            logger: { warn: (...args: unknown[]) => void };
          }
        ).logger,
        'warn',
      );
    }

    it('reports and pushes nothing when the channel read fails', async () => {
      findPushRouting.mockRejectedValue(
        new SupabaseQueryError({ message: 'connection reset', code: '08006' }),
      );
      const error = jest
        .spyOn(
          (
            service as unknown as {
              logger: { error: (...args: unknown[]) => void };
            }
          ).logger,
          'error',
        )
        .mockImplementation(() => undefined);
      jest.mocked(Sentry.captureException).mockClear();

      await expect(service.handleMessage(MESSAGE)).resolves.toBeUndefined();

      expect(findPushRouting).toHaveBeenCalledWith('ch-uncached');
      // The lookup's own report, not the handler's catch-all: past the claim
      // the whole message's pushes are dropped, so it is an error.
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0]?.[0])).toContain(
        'chat-push: channel lookup failed',
      );
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
      expect(
        jest.mocked(Sentry.captureException).mock.calls[0]?.[1],
      ).toMatchObject({
        level: 'error',
        fingerprint: [
          'caught-failure',
          'chat-push-channel-lookup',
          'SupabaseQueryError:08006',
        ],
      });
      error.mockRestore();
      expect(findByChapter).not.toHaveBeenCalled();
      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('pushes nothing, quietly, when the channel is gone', async () => {
      const warn = warnSpy();

      await service.handleMessage(MESSAGE);

      expect(findPushRouting).toHaveBeenCalledWith('ch-uncached');
      expect(warn).not.toHaveBeenCalled();
      expect(findByChapter).not.toHaveBeenCalled();
      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('caches the row it read, so the next message does not read again', async () => {
      findPushRouting.mockResolvedValue({ ...CHANNEL, id: 'ch-uncached' });
      setMembers([]);

      await service.handleMessage(MESSAGE);
      await service.handleMessage({ ...MESSAGE, id: 'm-lookup-2' });

      expect(findPushRouting).toHaveBeenCalledTimes(1);
      expect(findByChapter).toHaveBeenCalledWith('chap-1');
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
          { provide: CHAT_THREAD_REPOSITORY, useValue: threadRepoStub },
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
