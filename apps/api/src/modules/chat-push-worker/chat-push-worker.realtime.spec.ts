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
 * `Pick` closes that: rename or drop any of these on `ChatMessage` and this file
 * fails `npm run check-types`, which CI does run.
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

  function notifiedUsers(): string[] {
    return notifyUser.mock.calls.map((call) => call[0] as string);
  }

  beforeEach(async () => {
    notifyUser = jest.fn().mockResolvedValue(undefined);
    findByChapter = jest.fn();
    findForUser = jest.fn().mockResolvedValue([]);
    getEffectivePermissions = jest.fn().mockResolvedValue([]);

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
          filter.table === 'chat_messages'
        ) {
          handler = cb;
        }
        return channelStub;
      },
      subscribe: () => channelStub,
      unsubscribe: jest.fn().mockResolvedValue('ok'),
    };

    const mod = await Test.createTestingModule({
      providers: [
        ChatPushWorkerService,
        {
          provide: SUPABASE_CLIENT,
          useValue: { channel: () => channelStub, removeChannel: jest.fn() },
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
      handler({
        schema: 'public',
        table: 'chat_messages',
        commit_timestamp: '2026-08-27T00:00:00.000Z',
        eventType: 'INSERT',
        new: row,
        old: {},
        errors: null,
      } as unknown as RealtimePostgresInsertPayload<WorkerReadsFromChatMessages>);
      // The handler `void`s the promise, so the work is in flight rather than
      // awaited. Draining the microtask queue is what makes that observable.
      await new Promise((resolve) => setImmediate(resolve));
    };
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

    it('fails closed when the permission lookup throws', async () => {
      // An unresolved permission set must not become a push.
      service.__setChannelForTest(ROLE_GATED_CHANNEL);
      setMembers(['sender', 'holder']);
      getEffectivePermissions.mockRejectedValue(new Error('rbac down'));

      await emitRow({
        id: 'm-gated-3',
        channel_id: ROLE_GATED_CHANNEL.id,
        sender_id: 'sender',
        content: 'the balance is',
        kind: 'text',
        mentions: ['holder'],
      });

      expect(notifyUser).not.toHaveBeenCalled();
    });
  });

  describe('a mention overrides a mute, but not visibility', () => {
    it('pushes to a muted recipient who is mentioned', async () => {
      service.__setChannelForTest(PUBLIC_CHANNEL);
      setMembers(['sender', 'muted']);
      findForUser.mockResolvedValue([
        {
          user_id: 'muted',
          chapter_id: CHAPTER,
          scope: 'channel',
          scope_id: PUBLIC_CHANNEL.id,
          scope_kind: null,
          level: 'off',
        } satisfies ChatNotificationPreferenceRow,
      ]);

      await emitRow({
        id: 'm-mute-1',
        channel_id: PUBLIC_CHANNEL.id,
        sender_id: 'sender',
        content: 'hey @muted',
        kind: 'text',
        mentions: ['muted'],
      });

      expect(notifiedUsers()).toEqual(['muted']);
    });

    it('does not push a muted recipient who is not mentioned', async () => {
      // The negative control. Without it the test above passes even if the mute
      // were ignored entirely, and "mention overrides mute" would be indistinguishable
      // from "mute does nothing".
      service.__setChannelForTest(PUBLIC_CHANNEL);
      setMembers(['sender', 'muted']);
      findForUser.mockResolvedValue([
        {
          user_id: 'muted',
          chapter_id: CHAPTER,
          scope: 'channel',
          scope_id: PUBLIC_CHANNEL.id,
          scope_kind: null,
          level: 'off',
        } satisfies ChatNotificationPreferenceRow,
      ]);

      await emitRow({
        id: 'm-mute-2',
        channel_id: PUBLIC_CHANNEL.id,
        sender_id: 'sender',
        content: 'general chatter',
        kind: 'text',
        mentions: [],
      });

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('does not lift the mute for someone who cannot read the channel', async () => {
      // Both gates at once: `outsider` is mentioned AND has an explicit `all`.
      // Visibility still wins, because it runs before the rule chain.
      service.__setChannelForTest(DM_CHANNEL);
      setMembers(['sender', 'dm-partner', 'outsider']);
      findForUser.mockResolvedValue([
        {
          user_id: 'outsider',
          chapter_id: CHAPTER,
          scope: 'channel',
          scope_id: DM_CHANNEL.id,
          scope_kind: null,
          level: 'all',
        } satisfies ChatNotificationPreferenceRow,
      ]);

      await emitRow({
        id: 'm-mute-3',
        channel_id: DM_CHANNEL.id,
        sender_id: 'sender',
        content: 'private',
        kind: 'text',
        mentions: ['outsider'],
      });

      expect(notifiedUsers()).not.toContain('outsider');
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

  describe('a row whose mentions column is missing', () => {
    it('treats null as no mentions and does not throw', async () => {
      // The column is NOT NULL with a default, so this guards a payload arriving
      // from somewhere that does not set it — which is precisely the shape the
      // pre-C1 bug had, and it was silent.
      service.__setChannelForTest(PUBLIC_CHANNEL);
      setMembers(['sender', 'other']);

      await emitRow({
        id: 'm-null',
        channel_id: PUBLIC_CHANNEL.id,
        sender_id: 'sender',
        content: 'hello',
        kind: 'text',
        mentions: null,
      });

      // `general` defaults to the mentions tier, so no mention means no push.
      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('treats an absent property as no mentions and does not throw', async () => {
      service.__setChannelForTest(PUBLIC_CHANNEL);
      setMembers(['sender', 'other']);

      await emitRow({
        id: 'm-absent',
        channel_id: PUBLIC_CHANNEL.id,
        sender_id: 'sender',
        content: 'hello',
        kind: 'text',
      });

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('still delivers on an all-level channel when mentions are absent', async () => {
      // The negative control for the two above: proves they assert "no mention"
      // rather than "the payload path silently dropped the row".
      service.__setChannelForTest({
        ...PUBLIC_CHANNEL,
        id: 'ch-announce',
        name: 'announcements',
      });
      setMembers(['sender', 'other']);

      await emitRow({
        id: 'm-announce',
        channel_id: 'ch-announce',
        sender_id: 'sender',
        content: 'Big news',
        kind: 'announcement',
        mentions: null,
      });

      expect(notifiedUsers()).toEqual(['other']);
    });
  });
});
