import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MEMBER_NUDGE_SETTINGS_CONFLICT,
  SupabaseMemberNudgeRepository,
} from './supabase-member-nudge.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  USER_A,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `member_nudges` and `member_nudge_settings` (#4781),
 * which carry their own `chapter_id`.
 *
 * The A/B twins agree on everything but their chapter: same member, same
 * task, same words. So a read or write that drops the chapter predicate
 * reaches the other chapter's twin. The tables have a second scope the
 * harness doesn't know, `user_id`; another member's card in chapter A is
 * seeded so each read has something real to exclude.
 */

const TASK = '0c000000-0000-4000-8000-000000004781';
const NOW = '2026-11-13T15:00:00.000Z';

const card = (overrides: Record<string, unknown> = {}) => ({
  user_id: USER_SHARED,
  kind: 'task_due_soon',
  task_id: TASK,
  title: 'A good day to start',
  body: 'A call today keeps Monday calm.',
  start_here: 'Call the first venue.',
  written_by: 'ai',
  status: 'showing',
  dismiss_reason: null,
  seen_at: null,
  created_at: '2026-11-12T15:00:00.000Z',
  expires_at: '2026-11-17T00:00:00.000Z',
  closed_at: null,
  ...overrides,
});

const seed = () => ({
  member_nudges: [
    inA({ id: 'card-a', ...card() }),
    inB({ id: 'card-b', ...card() }),
    inA({ id: 'card-a-other', ...card({ user_id: USER_A }) }),
    inB({ id: 'card-b-other', ...card({ user_id: USER_A }) }),
  ],
  member_nudge_settings: [
    inA({
      id: 'settings-a',
      user_id: USER_SHARED,
      enabled: true,
      quiet_until: null,
      updated_at: NOW,
    }),
    inB({
      id: 'settings-b',
      user_id: USER_SHARED,
      enabled: true,
      quiet_until: null,
      updated_at: NOW,
    }),
  ],
});

/** The primary key columns of `table` as the migration declares them. */
function primaryKeyOf(table: string): string {
  const sql = readFileSync(
    join(
      __dirname,
      '../../../../../../supabase/migrations/20261113152811_member_nudges.sql',
    ),
    'utf8',
  );
  const body = new RegExp(
    `create table if not exists public\\.${table} \\(([\\s\\S]*?)\\n\\);`,
  ).exec(sql)?.[1];
  const key = body && /primary key \(([^)]+)\)/.exec(body)?.[1];
  if (!key) throw new Error(`no primary key found for ${table}`);
  return key.replace(/\s+/g, '');
}

describe('SupabaseMemberNudgeRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseMemberNudgeRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseMemberNudgeRepository(harness.client);
  });

  const cardsOf = (chapterId: string, userId: string) =>
    harness
      .rows('member_nudges')
      .filter((row) => row.chapter_id === chapterId && row.user_id === userId);

  it('reads only the member’s own showing card in the chapter', async () => {
    const showing = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findShowing(CHAPTER_A, USER_SHARED),
    );
    expect(showing).toEqual(
      expect.objectContaining({ id: 'card-a', chapter_id: CHAPTER_A }),
    );
  });

  it('reads only the member’s own recent cards in the chapter', async () => {
    const recent = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findRecent(CHAPTER_A, USER_SHARED, '2026-11-06T15:00:00.000Z'),
    );
    expect(recent.map((row) => row.id)).toEqual(['card-a']);
    await expect(
      repo.findRecent(CHAPTER_A, USER_SHARED, '2026-11-13T00:00:00.000Z'),
    ).resolves.toEqual([]);
  });

  it('reads only what the member was already shown in the chapter', async () => {
    const raised = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findRaised(CHAPTER_A, USER_SHARED),
    );
    // The fake returns whole rows whatever the column list says.
    expect(raised).toEqual([
      expect.objectContaining({ task_id: TASK, kind: 'task_due_soon' }),
    ]);
  });

  it('creates a card inside the chapter, showing', async () => {
    const created = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.create({
        chapter_id: CHAPTER_A,
        user_id: USER_A,
        kind: 'task_overdue',
        task_id: TASK,
        title: 'Still open',
        body: 'Finishing it now still counts.',
        start_here: null,
        written_by: 'fixed',
        expires_at: '2026-11-20T15:00:00.000Z',
      }),
    );
    expect(created).toEqual(
      expect.objectContaining({ chapter_id: CHAPTER_A, status: 'showing' }),
    );
  });

  it('marks only the member’s own showing card seen', async () => {
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.markSeen(CHAPTER_A, USER_SHARED, 'card-a', NOW),
    );
    expect(cardsOf(CHAPTER_A, USER_SHARED)[0]?.seen_at).toBe(NOW);
    expect(cardsOf(CHAPTER_B, USER_SHARED)[0]?.seen_at).toBeNull();

    // Another member's card, named by id from this member's session.
    await repo.markSeen(CHAPTER_A, USER_SHARED, 'card-a-other', NOW);
    expect(cardsOf(CHAPTER_A, USER_A)[0]?.seen_at).toBeNull();
  });

  it('closes only the member’s own showing card, and deletes its words', async () => {
    await expect(
      harness.expectTenantScoped(CHAPTER_A, () =>
        repo.close(CHAPTER_A, USER_SHARED, 'card-a', {
          status: 'dismissed',
          dismiss_reason: 'not_now',
          closed_at: NOW,
        }),
      ),
    ).resolves.toBe(true);
    expect(cardsOf(CHAPTER_A, USER_SHARED)[0]).toEqual(
      expect.objectContaining({
        status: 'dismissed',
        dismiss_reason: 'not_now',
        closed_at: NOW,
        title: null,
        body: null,
        start_here: null,
      }),
    );
    expect(cardsOf(CHAPTER_B, USER_SHARED)[0]?.status).toBe('showing');

    // The other chapter's twin, or another member's card: no such card.
    await expect(
      repo.close(CHAPTER_A, USER_SHARED, 'card-b', {
        status: 'dismissed',
        closed_at: NOW,
      }),
    ).resolves.toBe(false);
    await expect(
      repo.close(CHAPTER_A, USER_SHARED, 'card-a-other', {
        status: 'dismissed',
        closed_at: NOW,
      }),
    ).resolves.toBe(false);
    expect(cardsOf(CHAPTER_A, USER_A)[0]?.status).toBe('showing');
  });

  it('closes cards past their time in this chapter only', async () => {
    await repo.closeExpired(CHAPTER_A, '2999-01-01T00:00:00.000Z');
    expect(
      harness
        .rows('member_nudges')
        .filter((row) => row.chapter_id === CHAPTER_A)
        .every((row) => row.status === 'expired' && row.title === null),
    ).toBe(true);
    expect(
      harness
        .rows('member_nudges')
        .filter((row) => row.chapter_id === CHAPTER_B)
        .every((row) => row.status === 'showing'),
    ).toBe(true);
  });

  it('deletes a person’s cards in every chapter, and nobody else’s', async () => {
    // On purpose not chapter-scoped: a No on the AI sheet is the person's,
    // not a chapter's (`AiConsentService.onConsentWithdrawn`).
    await repo.deleteByUser(USER_SHARED);
    expect(harness.rows('member_nudges').map((row) => row.id)).toEqual([
      'card-a-other',
      'card-b-other',
    ]);
  });

  it('reads and saves only the member’s own settings in the chapter', async () => {
    await expect(
      harness.expectTenantScoped(CHAPTER_A, () =>
        repo.findSettings(CHAPTER_A, USER_SHARED),
      ),
    ).resolves.toEqual(expect.objectContaining({ chapter_id: CHAPTER_A }));
    await expect(repo.findSettings(CHAPTER_A, USER_A)).resolves.toBeNull();

    const saved = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.saveSettings(CHAPTER_A, USER_SHARED, { enabled: false }, NOW),
    );
    expect(saved).toEqual(
      expect.objectContaining({ chapter_id: CHAPTER_A, enabled: false }),
    );
    const theirs = harness
      .rows('member_nudge_settings')
      .find((row) => row.chapter_id === CHAPTER_B);
    expect(theirs?.enabled).toBe(true);
  });

  it('names the settings table’s primary key as its upsert target', () => {
    // The harness matches any column list, so only this ties the target to a
    // constraint Postgres would accept; a mismatch is a 42P10 on every write.
    expect(MEMBER_NUDGE_SETTINGS_CONFLICT).toBe(
      primaryKeyOf('member_nudge_settings'),
    );
  });
});
