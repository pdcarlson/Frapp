import { Test } from '@nestjs/testing';
import * as Sentry from '@sentry/nestjs';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { SupabaseQueryError } from '../../infrastructure/supabase/supabase-query-error';
import {
  CHAT_CHANNEL_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
} from '#domain/repositories/chat.repository.interface';
import { SYSTEM_SENDER_ID } from '#domain/constants/chat';
import {
  auditMirrorClientId,
  ChatBridgeWorkerService,
} from './chat-bridge-worker.service';
import { reopenDelayMs } from './worker-subscription';
import { fakeRealtime } from '#test/helpers/fake-realtime';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

type Lookup = () => Promise<string | null>;
type Insert = (
  row: Record<string, unknown>,
) => Promise<'inserted' | 'duplicate'>;

/**
 * The bridge's two repository calls. `lookup` answers the `#chapter-audit`
 * lookup; `insert` defaults to recording the row and reporting it inserted.
 */
function buildRepos(lookup: Lookup, insert?: Insert) {
  const insertCalls: Array<Record<string, unknown>> = [];
  // The bridge reads only the id off `findByName`'s row.
  const findByName = jest.fn(async () => {
    const id = await lookup();
    return id === null ? null : { id };
  });
  const insertIdempotent = jest.fn(
    insert ??
      ((row: Record<string, unknown>) => {
        insertCalls.push(row);
        return Promise.resolve('inserted' as const);
      }),
  );
  return {
    channels: { findByName },
    messages: { insertIdempotent },
    insertCalls,
  };
}

const auditChannel: Lookup = () => Promise.resolve('ch-audit');

describe('ChatBridgeWorkerService.handleAuditRow', () => {
  const baseRow = {
    id: 'audit-1',
    chapter_id: 'chap-1',
    actor_user_id: 'user-1',
    action: 'chapter_config_updated',
    target_type: 'chapter',
    target_id: 'chap-1',
    scope: 'chapter',
    diff: { branding: { from: {}, to: { greek_letters: 'ΣΦΕ' } } },
    member_visible: true,
    created_at: '',
  };

  async function instantiate(repos: ReturnType<typeof buildRepos>) {
    const mod = await Test.createTestingModule({
      providers: [
        ChatBridgeWorkerService,
        // Only the Realtime subscription uses the client, and these tests
        // never open it.
        { provide: SUPABASE_CLIENT, useValue: {} as FrappSupabaseClient },
        { provide: CHAT_CHANNEL_REPOSITORY, useValue: repos.channels },
        { provide: CHAT_MESSAGE_REPOSITORY, useValue: repos.messages },
      ],
    }).compile();
    return mod.get(ChatBridgeWorkerService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function errorSpy(service: ChatBridgeWorkerService) {
    return jest
      .spyOn(
        (
          service as unknown as {
            logger: { error: (...args: unknown[]) => void };
          }
        ).logger,
        'error',
      )
      .mockImplementation(() => undefined);
  }

  function warnSpy(service: ChatBridgeWorkerService) {
    return jest.spyOn(
      (service as unknown as { logger: { warn: (...args: unknown[]) => void } })
        .logger,
      'warn',
    );
  }

  /** The Sentry fingerprint's site, for each capture so far. */
  function reportedSites(): unknown[] {
    return jest
      .mocked(Sentry.captureException)
      .mock.calls.map(
        (call) => (call[1] as { fingerprint: string[] }).fingerprint[1],
      );
  }

  it('posts a system_audit message when the channel exists', async () => {
    const repos = buildRepos(auditChannel);
    const { insertCalls } = repos;
    const service = await instantiate(repos);
    await service.handleAuditRow(baseRow);
    expect(repos.channels.findByName).toHaveBeenCalledWith(
      'chap-1',
      'chapter-audit',
    );
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toMatchObject({
      channel_id: 'ch-audit',
      // Part of the dedupe key, and the author the table's CHECK requires.
      sender_id: SYSTEM_SENDER_ID,
      kind: 'system_audit',
      client_message_id: 'audit:audit-1',
      payload: {
        action: 'chapter_config_updated',
        actor_user_id: 'user-1',
        diff: baseRow.diff,
      },
    });
    expect(insertCalls[0]?.content).toMatch(/chapter_config_updated/);
  });

  it('drops member-invisible rows', async () => {
    const repos = buildRepos(auditChannel);
    const { insertCalls } = repos;
    const service = await instantiate(repos);
    await service.handleAuditRow({ ...baseRow, member_visible: false });
    expect(insertCalls).toHaveLength(0);
  });

  it('logs and continues when the chapter-audit channel is missing', async () => {
    const repos = buildRepos(() => Promise.resolve(null));
    const service = await instantiate(repos);
    await service.handleAuditRow(baseRow);
    expect(repos.insertCalls).toHaveLength(0);
  });

  it('reports and skips the insert when the channel lookup fails', async () => {
    const repos = buildRepos(() =>
      Promise.reject(new SupabaseQueryError({ message: 'lookup boom' })),
    );
    const service = await instantiate(repos);
    const error = errorSpy(service);
    await expect(service.handleAuditRow(baseRow)).resolves.toBeUndefined();
    expect(repos.messages.insertIdempotent).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain(
      'chapter-audit channel lookup failed for chapter chap-1',
    );
    expect(reportedSites()).toEqual([
      'chat-bridge-audit-channel-lookup-failed',
    ]);
  });

  it('reports once and does not throw when inserts keep failing', async () => {
    const repos = buildRepos(auditChannel, () =>
      Promise.reject(new SupabaseQueryError({ message: 'boom' })),
    );
    const service = await instantiate(repos);
    const error = errorSpy(service);
    await expect(service.handleAuditRow(baseRow)).resolves.toBeUndefined();
    await expect(
      service.handleAuditRow({ ...baseRow, id: 'audit-2' }),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(2);
    expect(String(error.mock.calls[0]?.[0])).toContain(
      'system_audit insert failed for audit audit-1',
    );
    // One event for the outage, not one per audit row.
    expect(reportedSites()).toEqual(['chat-bridge-audit-insert-failed']);
    expect(
      JSON.stringify(jest.mocked(Sentry.captureException).mock.calls),
    ).not.toContain('audit-1');
  });

  describe('one mirror per audit row (#2846)', () => {
    /**
     * One `chat_messages` table shared by every repository built from it, keyed
     * the way `idx_chat_messages_dedupe` is: `(channel_id, sender_id,
     * client_message_id)` where the id is not null. A second insert under the
     * same key fails with `23505`, as Postgres does.
     */
    function sharedDatabase() {
      const rows: Array<Record<string, unknown>> = [];
      const keyOf = (row: Record<string, unknown>) =>
        `${String(row.channel_id)}|${String(row.sender_id)}|${String(row.client_message_id)}`;
      // `insertIdempotent` reports the 23505 the index raises as 'duplicate'.
      const repos = () =>
        buildRepos(auditChannel, (row) => {
          const taken =
            row.client_message_id != null &&
            rows.some((r) => keyOf(r) === keyOf(row));
          if (taken) return Promise.resolve('duplicate' as const);
          rows.push(row);
          return Promise.resolve('inserted' as const);
        });
      return { rows, repos };
    }

    it('two instances hearing one audit INSERT post one message', async () => {
      const db = sharedDatabase();
      const first = await instantiate(db.repos());
      const second = await instantiate(db.repos());

      await Promise.all([
        first.handleAuditRow(baseRow),
        second.handleAuditRow(baseRow),
      ]);

      expect(db.rows).toHaveLength(1);
      expect(db.rows[0]?.client_message_id).toBe(
        auditMirrorClientId(baseRow.id),
      );
    });

    it('two different audit rows still post two messages', async () => {
      const db = sharedDatabase();
      const service = await instantiate(db.repos());

      await service.handleAuditRow(baseRow);
      await service.handleAuditRow({ ...baseRow, id: 'audit-2' });

      expect(db.rows).toHaveLength(2);
    });

    it('treats the losing insert as done, not as a failure', async () => {
      const db = sharedDatabase();
      const service = await instantiate(db.repos());
      const warn = warnSpy(service);
      const debug = jest.spyOn(
        (
          service as unknown as {
            logger: { debug: (...args: unknown[]) => void };
          }
        ).logger,
        'debug',
      );

      await service.handleAuditRow(baseRow);
      await service.handleAuditRow(baseRow);

      expect(warn).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalledWith(
        'chat-bridge: audit audit-1 already mirrored',
      );
    });
  });
});

/**
 * The bridge's own subscription (#3365), driven the way realtime-js would.
 * The reopen logic itself is proven in `worker-subscription.spec.ts`; this
 * proves the bridge is on it, with its listener on every channel it opens.
 */
describe('ChatBridgeWorkerService — the audit-log subscription', () => {
  const TOPIC = 'chat-bridge-worker:audit-log';
  const row = {
    id: 'audit-9',
    chapter_id: 'chap-1',
    actor_user_id: 'user-1',
    action: 'chapter_config_updated',
    target_type: 'chapter',
    target_id: 'chap-1',
    scope: 'chapter',
    diff: null,
    member_visible: true,
    created_at: '',
  };

  let realtime: ReturnType<typeof fakeRealtime>;
  let repos: ReturnType<typeof buildRepos>;
  let service: ChatBridgeWorkerService;

  const channels = () => realtime.onTopic(TOPIC);
  /** `handleAuditRow` is fired and forgotten; let its awaits settle. */
  const settle = () => jest.advanceTimersByTimeAsync(0);

  beforeEach(async () => {
    jest.useFakeTimers();
    realtime = fakeRealtime();
    repos = buildRepos(auditChannel);
    const mod = await Test.createTestingModule({
      providers: [
        ChatBridgeWorkerService,
        {
          provide: SUPABASE_CLIENT,
          useValue: {
            channel: realtime.channel,
            removeChannel: realtime.removeChannel,
          },
        },
        { provide: CHAT_CHANNEL_REPOSITORY, useValue: repos.channels },
        { provide: CHAT_MESSAGE_REPOSITORY, useValue: repos.messages },
      ],
    }).compile();
    service = mod.get(ChatBridgeWorkerService);
    // The status lines are this file's subject only through their effects.
    const logger = (
      service as unknown as {
        logger: { warn: (...args: unknown[]) => void };
      }
    ).logger;
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    service.onApplicationBootstrap();
  });

  afterEach(async () => {
    await service.onApplicationShutdown();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('mirrors an audit INSERT delivered on its subscription', async () => {
    expect(channels()).toHaveLength(1);
    expect(channels()[0].insert('chapter_audit_log', row)).toBe(1);
    await settle();

    expect(repos.insertCalls).toHaveLength(1);
  });

  it('reopens after the server closes its channel, and mirrors rows on the new one', async () => {
    const [first] = channels();
    first.status('SUBSCRIBED');

    first.status('CLOSED');
    await settle();
    await jest.advanceTimersByTimeAsync(reopenDelayMs(0));

    expect(channels()).toHaveLength(2);
    expect(first.teardown).toHaveBeenCalledTimes(1);
    expect(first.insert('chapter_audit_log', row)).toBe(0);
    expect(channels()[1].insert('chapter_audit_log', row)).toBe(1);
    await settle();
    expect(repos.insertCalls).toHaveLength(1);
  });

  it('keeps its channel through a TIMED_OUT, which realtime-js rejoins', async () => {
    const [first] = channels();

    first.status('TIMED_OUT');
    await jest.advanceTimersByTimeAsync(60_000);

    expect(channels()).toHaveLength(1);
    expect(first.teardown).not.toHaveBeenCalled();
    expect(first.insert('chapter_audit_log', row)).toBe(1);
  });

  it('removes its channel on shutdown, and does not reopen it', async () => {
    const [first] = channels();

    await service.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(realtime.removeChannel).toHaveBeenCalledWith(first);
    expect(channels()).toHaveLength(1);
  });
});
