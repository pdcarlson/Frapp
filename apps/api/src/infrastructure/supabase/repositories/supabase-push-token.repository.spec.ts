import { SupabasePushTokenRepository } from './supabase-push-token.repository';

/**
 * The phone's notifications answer (`notifications_enabled`, #5617) on the
 * write paths: stored as sent, `false` included, and left alone when an
 * older build sends none.
 */
function client() {
  const writes: { op: 'insert' | 'update'; row: Record<string, unknown> }[] =
    [];
  const chain = {
    eq: () => chain,
    select: () => chain,
    single: async () => ({ data: { id: 'pt-1' }, error: null }),
    maybeSingle: async () => ({ data: { id: 'pt-1' }, error: null }),
  };
  const supabase = {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        writes.push({ op: 'insert', row });
        return chain;
      },
      update: (row: Record<string, unknown>) => {
        writes.push({ op: 'update', row });
        return chain;
      },
    }),
  };
  return { supabase, writes };
}

describe('SupabasePushTokenRepository notifications answer', () => {
  it('stores false on a re-register, and leaves the column out when the phone sent none', async () => {
    const { supabase, writes } = client();
    const repo = new SupabasePushTokenRepository(supabase as never);

    await repo.markRegistered(
      'pt-1',
      'u-1',
      '2026-11-19T00:00:00.000Z',
      undefined,
      false,
    );
    await repo.markRegistered('pt-1', 'u-1', '2026-11-19T00:00:00.000Z');

    expect(writes[0].row).toEqual({
      last_registered_at: '2026-11-19T00:00:00.000Z',
      notifications_enabled: false,
    });
    expect(writes[1].row).not.toHaveProperty('notifications_enabled');
  });

  it('stores null on a new row when the phone sent no answer', async () => {
    const { supabase, writes } = client();
    const repo = new SupabasePushTokenRepository(supabase as never);

    await repo.create({ user_id: 'u-1', token: 'ExponentPushToken[x]' });

    expect(writes[0].row.notifications_enabled).toBeNull();
  });
});
