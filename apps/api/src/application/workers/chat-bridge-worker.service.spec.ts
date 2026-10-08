import { Test } from '@nestjs/testing';
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

  function warnSpy(service: ChatBridgeWorkerService) {
    return jest.spyOn(
      (service as unknown as { logger: { warn: (...args: unknown[]) => void } })
        .logger,
      'warn',
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

  it('warns and skips the insert when the channel lookup fails', async () => {
    const repos = buildRepos(() =>
      Promise.reject(new SupabaseQueryError({ message: 'lookup boom' })),
    );
    const service = await instantiate(repos);
    const warn = warnSpy(service);
    await expect(service.handleAuditRow(baseRow)).resolves.toBeUndefined();
    expect(repos.messages.insertIdempotent).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      'chapter-audit channel lookup failed for chapter chap-1',
    );
  });

  it('warns and does not throw when the insert fails', async () => {
    const repos = buildRepos(auditChannel, () =>
      Promise.reject(new SupabaseQueryError({ message: 'boom' })),
    );
    const service = await instantiate(repos);
    const warn = warnSpy(service);
    await expect(service.handleAuditRow(baseRow)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      'system_audit insert failed for audit audit-1',
    );
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
