import { Test } from '@nestjs/testing';
import type { RealtimePostgresInsertPayload } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import { NotificationService } from '../../application/services/notification.service';
import { ChatPushWorkerService } from './chat-push-worker.service';
import {
  ChatNotificationPreferenceRepository,
  type ChatNotificationPreferenceRow,
} from './chat-notification-preference.repository';
import { RbacService } from '../../application/services/rbac.service';
import type { ChatMessage } from '../../domain/entities';
import { ChannelCacheService } from './channel-cache.service';

/**
 * Recipient-filter proofs driven through the **real Realtime payload path**.
 *
 * `chat-push-worker.service.spec.ts` calls `handleMessage(row)` directly with
 * hand-built objects. That is the right shape for the rule chain, and it is
 * also exactly the shape that cannot falsify the worker's assumption about what
 * Postgres actually delivers. The span it never touches is
 * `onApplicationBootstrap` → the registered `postgres_changes` callback →
 * `payload.new`, which is the only way a row reaches this worker in production.
 *
 * That span is not hypothetically untested. The realtime carrier contained no
 * tables on either project until #974 repaired it, so this path went
 * undelivered for its entire life and no test noticed — and before C1,
 * `hasMention` was always false because the worker read a column that did not
 * exist, again with every test green.
 *
 * So every case below emits through the captured subscription handler. None of
 * them calls `handleMessage`.
 *
 * **Why this lives in the unit tier rather than `test/integration/`.** The
 * `test:integration` tier is not run by `ci.yml` — only `test`, `test:e2e` and
 * `test:ai-evals` are. A recipient-filter proof that CI never executes defends
 * nothing while reading as though it does.
 */

/**
 * The columns this worker reads out of `chat_messages`, pinned to the canonical
 * entity that `database.types.ts` maps the table to.
 *
 * This is the compile-time half of the guard. The worker's own `ChatMessageRow`
 * is a private interface used as a *type parameter* on
 * `RealtimePostgresInsertPayload`, and a type parameter is erased at runtime —
 * Supabase hands over whatever Postgres sends. So a renamed column makes
 * `payload.new.mentions` `undefined` in production while `tsc` stays silent,
 * which is the same silence the pre-C1 cast had.
 *
 * `Pick` closes the TypeScript half: rename or drop any of these on `ChatMessage`
 * and this file stops compiling.
 *
 * **Two honest limits on that, since overstating a guard is worse than not
 * having one.** It is enforced by ts-jest when this suite runs — `npm run test
 * -w apps/api`, which CI does run — and *not* by `npm run check-types`, whose
 * `tsconfig.build.json` excludes `**\/*spec.ts`. And `ChatMessage` is a
 * hand-authored interface that `database.types.ts` maps the table to, not a
 * `supabase gen types` artefact, so this catches a TypeScript-side divergence
 * and cannot by itself catch a migration that renames the column without
 * touching the entity. Closing that second gap needs schema-derived types,
 * which the repo does not have today.
 */
type WorkerReadsFromChatMessages = Pick<
  ChatMessage,
  'id' | 'channel_id' | 'sender_id' | 'content' | 'kind' | 'mentions'
>;

describe('ChatPushWorkerService — recipient filter over the Realtime payload path', () => {
  let service: ChatPushWorkerService;
  let notifyUser: jest.Mock;
  let findByChapter: jest.Mock;
  let findForUser: jest.Mock;
  let getEffectivePermissions: jest.Mock;
  let subscribeSpy: jest.Mock;
  let removeChannel: jest.Mock;
  /** The `postgres_changes` callback the worker registers at bootstrap. */
  let emitRow: (row: WorkerReadsFromChatMessages) => Promise<void>;

  const CHAPTER = 'chap-1';

  const PUBLIC_CHANNEL = {
    id: 'ch-public',
    chapter_id: CHAPTER,
    name: 'general',
    is_read_only: false,
    type: 'PUBLIC',
    member_ids: null,
    required_permissions: null,
  };

  /** Sender + one partner. `outsider` is in the chapter but not in the DM. */
  const DM_CHANNEL = {
    ...PUBLIC_CHANNEL,
    id: 'ch-dm',
    name: 'dm',
    type: 'DM',
    member_ids: ['sender', 'dm-partner'],
  };

  const PRIVATE_CHANNEL = {
    ...PUBLIC_CHANNEL,
    id: 'ch-private',
    name: 'exec',
    type: 'PRIVATE',
    member_ids: ['sender', 'insider'],
  };

  /**
   * `defaultLevelFor` returns `all` for a channel named `announcements` and
   * `mentions` for anything else. The mute cases below therefore have to run
   * HERE: on a `mentions`-default channel a seeded `off` changes no outcome, so
   * those tests would pass with per-channel preferences disabled entirely.
   */
  const ANNOUNCE_CHANNEL = {
    ...PUBLIC_CHANNEL,
    id: 'ch-announce',
    name: 'announcements',
  };

  const ROLE_GATED_CHANNEL = {
    ...PUBLIC_CHANNEL,
    id: 'ch-gated',
    name: 'treasury',
    type: 'ROLE_GATED',
    required_permissions: ['finances:read'],
  };

  function setMembers(userIds: string[]) {
    findByChapter.mockResolvedValue(userIds.map((id) => ({ user_id: id })));
  }

  /**
   * Seed preferences **per user**, as `findForUser(recipientId, chapterId)`
   * actually behaves. A bare `mockResolvedValue([row])` returns one user's row
   * for every recipient, so a member with no preference silently inherits
   * someone else's level — which is how a DM test can assert the right
   * recipient and still be passing for the wrong reason.
   */
  function setPrefs(byUser: Record<string, ChatNotificationPreferenceRow[]>) {
    findForUser.mockImplementation(
      async (userId: string) => byUser[userId] ?? [],
    );
  }

  function notifiedUsers(): string[] {
    return notifyUser.mock.calls.map((call) => call[0] as string);
  }

  beforeEach(async () => {
    notifyUser = jest.fn().mockResolvedValue(undefined);
    // Defaulted, unlike a bare `jest.fn()`: without it a case that forgets
    // `setMembers` resolves `undefined`, `members.map()` throws, and the outer
    // try/catch swallows it — so a `not.toHaveBeenCalled()` assertion would
    // pass because the roster load crashed, not because the rule skipped.
    findByChapter = jest.fn().mockResolvedValue([]);
    findForUser = jest.fn().mockResolvedValue([]);
    getEffectivePermissions = jest.fn().mockResolvedValue([]);

    subscribeSpy = jest.fn(() => channelStub);
    removeChannel = jest.fn().mockResolvedValue('ok');

    let handler:
      | ((
          payload: RealtimePostgresInsertPayload<WorkerReadsFromChatMessages>,
        ) => void)
      | null = null;

    // A Supabase stand-in that records the subscription the worker builds,
    // rather than one that pretends the worker built it correctly. If the
    // worker stops registering an INSERT listener on `chat_messages`, `emitRow`
    // throws and every case below fails — which is the point.
    const channelStub = {
      on: (
        event: string,
        filter: { event?: string; schema?: string; table?: string },
        cb: (
          payload: RealtimePostgresInsertPayload<WorkerReadsFromChatMessages>,
        ) => void,
      ) => {
        if (
          event === 'postgres_changes' &&
          filter.event === 'INSERT' &&
          filter.schema === 'public' &&
          filter.table === 'chat_messages'
        ) {
          handler = cb;
        }
        return channelStub;
      },
      subscribe: subscribeSpy,
      // `resolveChannel` opens a presence channel through the same `channel()`
      // factory, and `readPresence` then calls `presenceState()` on it. Without
      // this the call throws and is swallowed by `readPresence`'s own catch —
      // the tests would still pass, but via an error path rather than the empty
      // presence map they mean to assume. No case here seeds presence, so an
      // empty map is the honest fixture: nobody is currently reading.
      presenceState: () => ({}),
    };

    const mod = await Test.createTestingModule({
      providers: [
        ChatPushWorkerService,
        ChannelCacheService,
        {
          provide: SUPABASE_CLIENT,
          useValue: { channel: () => channelStub, removeChannel },
        },
        { provide: MEMBER_REPOSITORY, useValue: { findByChapter } },
        { provide: NotificationService, useValue: { notifyUser } },
        {
          provide: ChatNotificationPreferenceRepository,
          useValue: { findForUser },
        },
        { provide: RbacService, useValue: { getEffectivePermissions } },
      ],
    }).compile();

    service = mod.get(ChatPushWorkerService);
    service.onApplicationBootstrap();

    emitRow = async (row) => {
      if (!handler) {
        throw new Error(
          'worker registered no INSERT listener on chat_messages — the payload path is broken',
        );
      }
      // Annotated, not cast through `unknown`. A double cast would disable
      // checking of every field including `new` — the one field the whole file
      // exists to exercise — so a vendor reshape of the payload would leave all
      // of these green while production silently received `undefined`.
      const payload: RealtimePostgresInsertPayload<WorkerReadsFromChatMessages> =
        {
          schema: 'public',
          table: 'chat_messages',
          commit_timestamp: '2026-08-27T00:00:00.000Z',
          eventType: 'INSERT',
          new: row,
          old: {},
          errors: [],
        };
      handler(payload);
      // The handler `void`s the promise, so the work is in flight rather than
      // awaited. Yielding to the macrotask queue makes it observable: Node
      // drains the microtask queue to empty before reaching the check phase
      // where `setImmediate` fires, and every mock here resolves synchronously,
      // so the whole chain has settled by then.
      await new Promise((resolve) => setImmediate(resolve));
    };
  });

  describe('the subscription contract', () => {
    it('joins the channel it registered the listener on', async () => {
      // Capturing the handler in `.on()` is not proof the channel was ever
      // joined: delete the `.subscribe(...)` call from `onApplicationBootstrap`
      // and every payload case here still passes, while production receives
      // exactly zero rows.
      expect(subscribeSpy).toHaveBeenCalled();
    });

    it('removes the channel on shutdown', async () => {
      // Teardown goes through `supabase.removeChannel(channel)`, never
      // `channel.unsubscribe()`. Without this, a dropped teardown leaks a topic
      // per hot restart and nothing notices.
      await service.onApplicationShutdown();
      expect(removeChannel).toHaveBeenCalled();
    });
  });

  describe('a mention never widens the read audience', () => {
    it('confines a DM mention to the DM participants, never the chapter', async () => {
      // The single most damaging failure this worker can have. The push payload
      // carries a 200-character body preview AND `notifyUser` persists a
      // notification row, so notifying a non-participant hands them the content
      // of a DM they cannot open. `decidePush` returns 'send' on `hasMention`
      // *before* the level check, so the visibility filter is the only thing
      // standing between a crafted mention and a chapter-wide disclosure.
      service.__setChannelForTest(DM_CHANNEL);
      setMembers(['sender', 'dm-partner', 'outsider']);

      await emitRow({
        id: 'm-dm',
        channel_id: DM_CHANNEL.id,
        sender_id: 'sender',
        content: 'account number is 1234',
        kind: 'text',
        // Mentions someone outside the DM. Resolution happens at send time and
        // does not consult channel membership, so this is reachable input.
        mentions: ['dm-partner', 'outsider'],
      });

      expect(notifiedUsers()).toEqual(['dm-partner']);
    });

    it('confines a PRIVATE mention to channel members', async () => {
      service.__setChannelForTest(PRIVATE_CHANNEL);
      setMembers(['sender', 'insider', 'outsider']);

      await emitRow({
        id: 'm-priv',
        channel_id: PRIVATE_CHANNEL.id,
        sender_id: 'sender',
        content: 'exec only',
        kind: 'text',
        mentions: ['insider', 'outsider'],
      });

      expect(notifiedUsers()).toEqual(['insider']);
    });

    it('confines a ROLE_GATED mention to permission holders', async () => {
      service.__setChannelForTest(ROLE_GATED_CHANNEL);
      setMembers(['sender', 'holder', 'nonholder']);
      getEffectivePermissions.mockImplementation(
        async (_chapterId: string, userId: string) =>
          userId === 'holder' ? ['finances:read'] : ['events:read'],
      );

      await emitRow({
        id: 'm-gated',
        channel_id: ROLE_GATED_CHANNEL.id,
        sender_id: 'sender',
        content: 'the balance is',
        kind: 'text',
        mentions: ['holder', 'nonholder'],
      });

      expect(notifiedUsers()).toEqual(['holder']);
    });

    it('admits a wildcard permission holder to a ROLE_GATED channel', async () => {
      service.__setChannelForTest(ROLE_GATED_CHANNEL);
      setMembers(['sender', 'admin']);
      getEffectivePermissions.mockResolvedValue(['*']);

      await emitRow({
        id: 'm-gated-2',
        channel_id: ROLE_GATED_CHANNEL.id,
        sender_id: 'sender',
        content: 'the balance is',
        kind: 'text',
        mentions: ['admin'],
      });

      expect(notifiedUsers()).toEqual(['admin']);
    });

    it('skips only the unresolvable recipient when a permission lookup throws', async () => {
      // Two recipients, one whose lookup rejects. Asserting merely that nobody
      // was pushed cannot tell fail-closed from crash-and-swallow: the outer
      // try/catch in `handleMessage` turns any thrown error into "no push", so
      // deleting the per-candidate try/catch entirely would still read green.
      // The distinction is operational — the intended path drops one recipient
      // and still delivers to the rest; the crash path silently drops the whole
      // message for everyone.
      service.__setChannelForTest(ROLE_GATED_CHANNEL);
      setMembers(['sender', 'holder', 'broken']);
      getEffectivePermissions.mockImplementation(
        async (_chapterId: string, userId: string) => {
          if (userId === 'broken') throw new Error('rbac down');
          return ['finances:read'];
        },
      );

      await emitRow({
        id: 'm-gated-3',
        channel_id: ROLE_GATED_CHANNEL.id,
        sender_id: 'sender',
        content: 'the balance is',
        kind: 'text',
        mentions: ['holder', 'broken'],
      });

      expect(notifiedUsers()).toEqual(['holder']);
    });
  });

  describe('per-channel mute', () => {
    it('is honoured when the recipient is not mentioned', async () => {
      // On `announcements` the default level is `all`, so this push happens
      // unless the seeded `off` is actually consulted. Running it on a
      // `mentions`-default channel (as an earlier draft did) made the whole
      // block pass with per-channel preferences disabled entirely.
      service.__setChannelForTest(ANNOUNCE_CHANNEL);
      setMembers(['sender', 'muted']);
      setPrefs({
        muted: [
          {
            user_id: 'muted',
            chapter_id: CHAPTER,
            scope: 'channel',
            scope_id: ANNOUNCE_CHANNEL.id,
            scope_kind: null,
            level: 'off',
          } satisfies ChatNotificationPreferenceRow,
        ],
      });

      await emitRow({
        id: 'm-mute-1',
        channel_id: ANNOUNCE_CHANNEL.id,
        sender_id: 'sender',
        content: 'Big news',
        kind: 'announcement',
        mentions: [],
      });

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('delivers on the same channel with no mute, proving the control', async () => {
      // Without this, the case above passes for any reason at all — including
      // the worker never delivering announcements.
      service.__setChannelForTest(ANNOUNCE_CHANNEL);
      setMembers(['sender', 'muted']);

      await emitRow({
        id: 'm-mute-1b',
        channel_id: ANNOUNCE_CHANNEL.id,
        sender_id: 'sender',
        content: 'Big news',
        kind: 'announcement',
        mentions: [],
      });

      expect(notifiedUsers()).toEqual(['muted']);
    });

    it('is overridden by a mention', async () => {
      service.__setChannelForTest(ANNOUNCE_CHANNEL);
      setMembers(['sender', 'muted']);
      setPrefs({
        muted: [
          {
            user_id: 'muted',
            chapter_id: CHAPTER,
            scope: 'channel',
            scope_id: ANNOUNCE_CHANNEL.id,
            scope_kind: null,
            level: 'off',
          } satisfies ChatNotificationPreferenceRow,
        ],
      });

      await emitRow({
        id: 'm-mute-2',
        channel_id: ANNOUNCE_CHANNEL.id,
        sender_id: 'sender',
        content: 'hey @muted',
        kind: 'announcement',
        mentions: ['muted'],
      });

      expect(notifiedUsers()).toEqual(['muted']);
    });

    it('does not let a mention override channel visibility', async () => {
      // Both gates at once: `outsider` is mentioned AND has an explicit `all`.
      // Visibility still wins, because it runs before the rule chain.
      service.__setChannelForTest(DM_CHANNEL);
      setMembers(['sender', 'dm-partner', 'outsider']);
      setPrefs({
        outsider: [
          {
            user_id: 'outsider',
            chapter_id: CHAPTER,
            scope: 'channel',
            scope_id: DM_CHANNEL.id,
            scope_kind: null,
            level: 'all',
          } satisfies ChatNotificationPreferenceRow,
        ],
      });

      await emitRow({
        id: 'm-mute-3',
        channel_id: DM_CHANNEL.id,
        sender_id: 'sender',
        content: 'private',
        kind: 'text',
        // Both are mentioned. `dm-partner` legitimately receives; `outsider`
        // does not, despite the mention AND an explicit `all`. Mentioning only
        // the outsider would make the positive half unassertable — with a
        // faithful per-user preference mock, `dm-partner` is on the `dm`
        // channel's `mentions` default and would correctly receive nothing,
        // so the expectation would collapse to an empty array.
        mentions: ['dm-partner', 'outsider'],
      });

      // Strict, not `not.toContain`: an empty array would satisfy that, so any
      // regression dropping DM pushes wholesale would read as a pass. This also
      // asserts the positive half — the participant still gets their push.
      expect(notifiedUsers()).toEqual(['dm-partner']);
    });
  });

  describe('the sender', () => {
    it('is never notified of their own message, even self-mentioned', async () => {
      service.__setChannelForTest(PUBLIC_CHANNEL);
      setMembers(['sender', 'other']);

      await emitRow({
        id: 'm-self',
        channel_id: PUBLIC_CHANNEL.id,
        sender_id: 'sender',
        content: 'note to self @sender',
        kind: 'text',
        mentions: ['sender', 'other'],
      });

      expect(notifiedUsers()).toEqual(['other']);
    });
  });

  describe('a row whose mentions column is null or absent', () => {
    // The trap here: `handleMessage` wraps everything in a try/catch that logs
    // and swallows, so `expect(notifyUser).not.toHaveBeenCalled()` is satisfied
    // identically by "treated as no mentions" and by "threw". An earlier draft
    // asserted only that, and stayed green under the exact mutation it named
    // (`row.mentions ?? []` -> `row.mentions as string[]`, which throws a
    // TypeError on `.includes`). So each case below pairs the negative with a
    // POSITIVE assertion on an `all`-level channel: a push that still lands is
    // proof the worker got past the mentions read without throwing.

    it('treats null as no mentions, and still delivers on an all-level channel', async () => {
      service.__setChannelForTest(ANNOUNCE_CHANNEL);
      setMembers(['sender', 'other']);

      await emitRow({
        id: 'm-null-all',
        channel_id: ANNOUNCE_CHANNEL.id,
        sender_id: 'sender',
        content: 'Big news',
        kind: 'announcement',
        mentions: null,
      });

      // Delivered => no throw. This is the assertion the null guard actually owns.
      expect(notifiedUsers()).toEqual(['other']);
    });

    it('treats an absent property as no mentions, and still delivers', async () => {
      service.__setChannelForTest(ANNOUNCE_CHANNEL);
      setMembers(['sender', 'other']);

      await emitRow({
        id: 'm-absent-all',
        channel_id: ANNOUNCE_CHANNEL.id,
        sender_id: 'sender',
        content: 'Big news',
        kind: 'announcement',
      });

      expect(notifiedUsers()).toEqual(['other']);
    });

    it('does not invent a mention on a mentions-level channel', async () => {
      // The negative half, now meaningful because the two above prove the code
      // reaches this point at all rather than dying in the catch.
      service.__setChannelForTest(PUBLIC_CHANNEL);
      setMembers(['sender', 'other']);

      await emitRow({
        id: 'm-null-mentions-tier',
        channel_id: PUBLIC_CHANNEL.id,
        sender_id: 'sender',
        content: 'hello',
        kind: 'text',
        mentions: null,
      });

      expect(notifyUser).not.toHaveBeenCalled();
    });
  });
});
