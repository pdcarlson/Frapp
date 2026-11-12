import { SupabaseAskDiagnosticsRepository } from './supabase-ask-diagnostics.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  USER_A,
  USER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for the Ask diagnostics window (#4315). The database allows
 * one window on the platform; the A/B twins here exist only so a read or
 * write that drops the chapter predicate reaches the other chapter's row.
 *
 * Two writes cross chapters on purpose and are pinned as such below: a No on
 * the AI sheet deletes the person's exchanges everywhere, and the sweep
 * deletes whatever has run out wherever it is.
 */

const STARTED = '2026-11-12T10:00:00.000Z';
const ENDS = '2026-11-26T10:00:00.000Z';

const seed = () => ({
  ai_diagnostics_windows: [
    inA({
      id: 'window-a',
      started_by: USER_SHARED,
      started_at: STARTED,
      ends_at: ENDS,
    }),
    inB({
      id: 'window-b',
      started_by: USER_SHARED,
      started_at: STARTED,
      ends_at: ENDS,
    }),
  ],
  ai_diagnostics_exchanges: [
    inA({
      id: 'exchange-a',
      window_id: 'window',
      member_id: 'member',
      user_id: USER_SHARED,
      sealed: 'v1.k.n.t.c',
      created_at: STARTED,
    }),
    inB({
      id: 'exchange-b',
      window_id: 'window',
      member_id: 'member',
      user_id: USER_SHARED,
      sealed: 'v1.k.n.t.c',
      created_at: STARTED,
    }),
  ],
});

describe('SupabaseAskDiagnosticsRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseAskDiagnosticsRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseAskDiagnosticsRepository(harness.client);
  });

  it('findWindow reads only the chapter’s window', async () => {
    const found = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findWindow(CHAPTER_A),
    );
    expect(found).toEqual(expect.objectContaining({ chapter_id: CHAPTER_A }));
  });

  it('deleteWindow deletes only the chapter’s window', async () => {
    const deleted = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.deleteWindow(CHAPTER_A),
    );
    expect(deleted).toBe(true);
    expect(
      harness.rows('ai_diagnostics_windows').map((row) => row.chapter_id),
    ).toEqual([CHAPTER_B]);
  });

  it('openWindow writes the window under the chapter it was given', async () => {
    // The one-window rule is the database's (the PGlite tier proves it), so
    // the harness takes a second row.
    const opened = await repo.openWindow({
      chapterId: CHAPTER_A,
      startedBy: USER_A,
      startedAt: new Date(STARTED),
      endsAt: new Date(ENDS),
    });
    expect(opened).toEqual(
      expect.objectContaining({ chapter_id: CHAPTER_A, ends_at: ENDS }),
    );
    expect(
      harness
        .rows('ai_diagnostics_windows')
        .filter((row) => row.started_by === USER_A)
        .map((row) => row.chapter_id),
    ).toEqual([CHAPTER_A]);
  });

  it('insertExchange writes the exchange under the chapter it was given', async () => {
    await expect(
      repo.insertExchange({
        chapterId: CHAPTER_A,
        windowId: 'window',
        memberId: 'member',
        userId: USER_A,
        sealed: 'v1.k.n.t.c2',
        createdAt: new Date(STARTED),
      }),
    ).resolves.toBe(true);
    const written = harness
      .rows('ai_diagnostics_exchanges')
      .filter((row) => row.user_id === USER_A);
    expect(written).toEqual([
      expect.objectContaining({ chapter_id: CHAPTER_A, sealed: 'v1.k.n.t.c2' }),
    ]);
  });

  it('deleteExchangesByUser deletes the person’s exchanges in every chapter, and nobody else’s', async () => {
    await repo.insertExchange({
      chapterId: CHAPTER_B,
      windowId: 'window',
      memberId: 'member',
      userId: USER_B,
      sealed: 'v1.k.n.t.c3',
      createdAt: new Date(STARTED),
    });
    await expect(repo.deleteExchangesByUser(USER_SHARED)).resolves.toBe(2);
    expect(
      harness.rows('ai_diagnostics_exchanges').map((row) => row.user_id),
    ).toEqual([USER_B]);
  });

  it('deleteExpiredWindows deletes every window that has run out, and none that has not', async () => {
    await expect(
      repo.deleteExpiredWindows(new Date('2026-11-20T00:00:00.000Z')),
    ).resolves.toBe(0);
    expect(harness.rows('ai_diagnostics_windows')).toHaveLength(2);
    await expect(repo.deleteExpiredWindows(new Date(ENDS))).resolves.toBe(2);
    expect(harness.rows('ai_diagnostics_windows')).toHaveLength(0);
  });
});
