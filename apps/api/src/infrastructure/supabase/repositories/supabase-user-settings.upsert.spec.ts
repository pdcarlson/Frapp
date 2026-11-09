import { SupabaseUserSettingsRepository } from './supabase-user-settings.repository';
import type { FrappSupabaseClient } from '../database.types';

/**
 * What `upsert` sends to `user_settings` (#3845). The status columns go out
 * only when the caller names them: PostgREST's upsert updates only the columns
 * in the payload, so leaving them out is what keeps a status another device
 * set while this save was in flight.
 *
 * Not a tenant-scope spec, so not named `*.repository.spec.ts`: `user_settings`
 * is per user and has no chapter (`tenant-scope-coverage.spec.ts`'s backlog).
 */
function harness() {
  const upsert = jest.fn().mockReturnValue({
    select: () => ({
      single: () => Promise.resolve({ data: { id: 'us-1' }, error: null }),
    }),
  });
  const client = {
    from: jest.fn().mockReturnValue({ upsert }),
  } as unknown as FrappSupabaseClient;
  return {
    repo: new SupabaseUserSettingsRepository(client),
    written: () => upsert.mock.calls[0][0] as Record<string, unknown>,
  };
}

describe('SupabaseUserSettingsRepository.upsert', () => {
  it('writes the status columns it is given', async () => {
    const { repo, written } = harness();

    await repo.upsert({
      user_id: 'u-1',
      status: 'dnd',
      status_expires_at: '2027-11-09T10:00:00.000Z',
      custom_status: 'At practice',
      custom_status_expires_at: null,
    });

    expect(written()).toMatchObject({
      user_id: 'u-1',
      status: 'dnd',
      status_expires_at: '2027-11-09T10:00:00.000Z',
      custom_status: 'At practice',
      custom_status_expires_at: null,
    });
  });

  it('leaves out the status columns it is not given', async () => {
    const { repo, written } = harness();

    await repo.upsert({ user_id: 'u-1', theme: 'dark' });

    const row = written();
    expect(row).toMatchObject({ user_id: 'u-1', theme: 'dark' });
    for (const key of [
      'status',
      'status_expires_at',
      'custom_status',
      'custom_status_expires_at',
    ]) {
      expect(row).not.toHaveProperty(key);
    }
  });
});
