import { GoogleCalendarSyncSweepService } from './google-calendar-sync-sweep.service';
import type { GoogleCalendarSyncService } from '../services/google-calendar/google-calendar-sync.service';
import type { IGoogleCalendarRepository } from '#domain/repositories/google-calendar.repository.interface';
import type { GoogleCalendarConnection } from '#domain/entities/google-calendar-connection.entity';

const NOW = new Date('2026-11-12T19:00:00.000Z');

function row(id: string): GoogleCalendarConnection {
  return { id } as GoogleCalendarConnection;
}

function setup(claimed: GoogleCalendarConnection[]) {
  const repo = {
    claim: jest.fn(async () => claimed),
    deleteExpiredStates: jest.fn(async () => 0),
  };
  const sync = { process: jest.fn(async () => 'synced' as const) };
  const sweep = new GoogleCalendarSyncSweepService(
    repo as unknown as IGoogleCalendarRepository,
    sync as unknown as GoogleCalendarSyncService,
  );
  return { sweep, repo, sync };
}

describe('GoogleCalendarSyncSweepService', () => {
  it('works through every claimed connection and tallies what each came to', async () => {
    const { sweep, repo, sync } = setup([
      row('a'),
      row('b'),
      row('c'),
      row('d'),
    ]);
    sync.process
      .mockResolvedValueOnce('synced')
      .mockResolvedValueOnce('retry' as never)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('more' as never);

    const tally = await sweep.sweep(NOW);

    expect(repo.claim).toHaveBeenCalledWith(NOW, 12, 1200);
    expect(sync.process).toHaveBeenCalledTimes(4);
    expect(tally).toMatchObject({ synced: 1, retry: 1, error: 1, more: 1 });
    // Sign-ins that expired a day ago go.
    expect(repo.deleteExpiredStates).toHaveBeenCalledWith(
      new Date('2026-11-11T19:00:00.000Z'),
    );
  });

  it('does not overlap a tick still running on this replica', async () => {
    const { sweep, repo } = setup([]);
    let release: () => void = () => undefined;
    repo.claim.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve([]);
        }),
    );

    const first = sweep.handleGoogleCalendarSync();
    await sweep.handleGoogleCalendarSync();
    release();
    await first;

    expect(repo.claim).toHaveBeenCalledTimes(1);
  });
});
