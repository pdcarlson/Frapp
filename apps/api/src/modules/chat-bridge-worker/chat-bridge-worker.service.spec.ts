import { Test } from '@nestjs/testing';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import {
  auditMirrorClientId,
  ChatBridgeWorkerService,
} from './chat-bridge-worker.service';

function buildMockSupabase(
  channelData: { data: unknown; error: unknown } | null,
  insertError: unknown = null,
) {
  const insertCalls: Array<Record<string, unknown>> = [];
  const client = {
    from: (table: string) => {
      if (table === 'chat_channels') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve(channelData ?? { data: null, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'chat_messages') {
        return {
          insert: (row: Record<string, unknown>) => {
            insertCalls.push(row);
            return Promise.resolve({ error: insertError });
          },
        };
      }
      return {};
    },
  } as unknown as FrappSupabaseClient;
  return { client, insertCalls };
}

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

  async function instantiate(supabase: FrappSupabaseClient) {
    const mod = await Test.createTestingModule({
      providers: [
        ChatBridgeWorkerService,
        { provide: SUPABASE_CLIENT, useValue: supabase },
      ],
    }).compile();
    return mod.get(ChatBridgeWorkerService);
  }

  it('posts a system_audit message when the channel exists', async () => {
    const { client, insertCalls } = buildMockSupabase({
      data: { id: 'ch-audit' },
      error: null,
    });
    const service = await instantiate(client);
    await service.handleAuditRow(baseRow);
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toMatchObject({
      channel_id: 'ch-audit',
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
    const { client, insertCalls } = buildMockSupabase({
      data: { id: 'ch-audit' },
      error: null,
    });
    const service = await instantiate(client);
    await service.handleAuditRow({ ...baseRow, member_visible: false });
    expect(insertCalls).toHaveLength(0);
  });

  it('logs and continues when the chapter-audit channel is missing', async () => {
    const { client, insertCalls } = buildMockSupabase({
      data: null,
      error: null,
    });
    const service = await instantiate(client);
    await service.handleAuditRow(baseRow);
    expect(insertCalls).toHaveLength(0);
  });

  it('does not throw when the insert fails', async () => {
    const { client } = buildMockSupabase(
      { data: { id: 'ch-audit' }, error: null },
      { message: 'boom' },
    );
    const service = await instantiate(client);
    await expect(service.handleAuditRow(baseRow)).resolves.toBeUndefined();
  });

  describe('one mirror per audit row (#2846)', () => {
    /**
     * One `chat_messages` table shared by every client built from it, keyed
     * the way `idx_chat_messages_dedupe` is: `(channel_id, sender_id,
     * client_message_id)` where the id is not null. A second insert under the
     * same key fails with `23505`, as Postgres does.
     */
    function sharedDatabase() {
      const rows: Array<Record<string, unknown>> = [];
      const keyOf = (row: Record<string, unknown>) =>
        `${String(row.channel_id)}|${String(row.sender_id)}|${String(row.client_message_id)}`;
      const client = () => {
        const { client: base } = buildMockSupabase({
          data: { id: 'ch-audit' },
          error: null,
        });
        return {
          from: (table: string) =>
            table === 'chat_messages'
              ? {
                  insert: (row: Record<string, unknown>) => {
                    const taken =
                      row.client_message_id != null &&
                      rows.some((r) => keyOf(r) === keyOf(row));
                    if (taken) {
                      return Promise.resolve({
                        error: { code: '23505', message: 'duplicate key' },
                      });
                    }
                    rows.push(row);
                    return Promise.resolve({ error: null });
                  },
                }
              : base.from(table as never),
        } as unknown as FrappSupabaseClient;
      };
      return { rows, client };
    }

    it('two instances hearing one audit INSERT post one message', async () => {
      const db = sharedDatabase();
      const first = await instantiate(db.client());
      const second = await instantiate(db.client());

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
      const service = await instantiate(db.client());

      await service.handleAuditRow(baseRow);
      await service.handleAuditRow({ ...baseRow, id: 'audit-2' });

      expect(db.rows).toHaveLength(2);
    });

    it('treats the losing insert as done, not as a failure', async () => {
      const db = sharedDatabase();
      const service = await instantiate(db.client());
      const warn = jest.spyOn(
        (service as unknown as { logger: { warn: () => void } }).logger,
        'warn',
      );

      await service.handleAuditRow(baseRow);
      await service.handleAuditRow(baseRow);

      expect(warn).not.toHaveBeenCalled();
    });
  });
});
