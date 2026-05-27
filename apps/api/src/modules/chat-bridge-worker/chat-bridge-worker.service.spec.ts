import { Test } from '@nestjs/testing';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { ChatBridgeWorkerService } from './chat-bridge-worker.service';

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
  } as unknown as SupabaseClient;
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

  async function instantiate(supabase: SupabaseClient) {
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
});
