import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EVENT_AGENDA_SUGGESTION_CONFLICT,
  EVENT_AGENDA_SUGGESTION_RUN_CONFLICT,
  SupabaseEventAgendaSuggestionRepository,
} from './supabase-event-agenda-suggestion.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `event_agenda_suggestions` and
 * `event_agenda_suggestion_runs` (#5534), which carry their own
 * `chapter_id`.
 *
 * The A/B twins agree on everything but their chapter: same event id, same
 * words, same key. So a read or write that drops the chapter predicate
 * reaches the other chapter's twin.
 */

const EVENT = '0e000000-0000-4000-8000-000000005534';
const EVENT_B = '0e000000-0000-4000-8000-00000000553b';
const MINUTES = '0f000000-0000-4000-8000-000000005534';
const NOW = '2026-11-18T19:00:00.000Z';

const suggestion = (overrides: Record<string, unknown> = {}) => ({
  event_id: EVENT,
  kind: 'tabled',
  text: 'Formal budget',
  reason: null,
  source_meeting_id: MINUTES,
  tabled_meeting_id: MINUTES,
  tabled_start_time: '2026-11-11T23:00:00.000Z',
  tabled_times: 1,
  dedupe_key: `tabled:${MINUTES}:1:formal budget`,
  audience_key: 'r:;o:;x:;e:1',
  status: 'open',
  agenda_item_id: null,
  decided_by: null,
  decided_at: null,
  created_at: '2026-11-18T18:00:00.000Z',
  ...overrides,
});

const decided = {
  status: 'dismissed',
  decided_by: USER_SHARED,
  decided_at: '2026-11-18T18:30:00.000Z',
};

const seed = () => ({
  event_agenda_suggestions: [
    inA({ id: 'open-a', ...suggestion() }),
    inB({ id: 'open-b', ...suggestion() }),
    inA({
      id: 'dismissed-a',
      ...suggestion({ kind: 'ai', dedupe_key: 'ai:dues', text: 'Dues' }),
      ...decided,
      tabled_meeting_id: null,
      tabled_start_time: null,
      tabled_times: null,
    }),
    inB({
      id: 'dismissed-b',
      ...suggestion({ kind: 'ai', dedupe_key: 'ai:dues', text: 'Dues' }),
      ...decided,
      tabled_meeting_id: null,
      tabled_start_time: null,
      tabled_times: null,
    }),
    inA({
      id: 'added-a',
      ...suggestion({ dedupe_key: 'tabled:x:1:rush', text: 'Rush' }),
      status: 'added',
      agenda_item_id: 's-added-a',
      decided_by: USER_SHARED,
      decided_at: '2026-11-18T18:40:00.000Z',
    }),
    inB({
      id: 'added-b',
      ...suggestion({ dedupe_key: 'tabled:x:1:rush', text: 'Rush' }),
      status: 'added',
      agenda_item_id: 's-added-a',
      decided_by: USER_SHARED,
      decided_at: '2026-11-18T18:40:00.000Z',
    }),
  ],
  // The run's key is the event, so the twins' events differ (an event is
  // one chapter's); `id` is the fake's row handle only, the table has none.
  event_agenda_suggestion_runs: [
    inA({
      id: 'run-a',
      event_id: EVENT,
      generated_by: USER_SHARED,
      generated_at: NOW,
      audience_key: 'r:;o:;x:;e:1',
    }),
    inB({
      id: 'run-b',
      event_id: EVENT_B,
      generated_by: USER_SHARED,
      generated_at: NOW,
      audience_key: 'r:;o:;x:;e:1',
    }),
  ],
});

/** The unique columns `name` declares in the migration. */
function constraintColumns(pattern: RegExp): string {
  const sql = readFileSync(
    join(
      __dirname,
      '../../../../../../supabase/migrations/20261118191604_event_agenda_suggestions.sql',
    ),
    'utf8',
  );
  const found = pattern.exec(sql)?.[1];
  if (!found) throw new Error(`no match for ${String(pattern)}`);
  return found.replace(/\s+/g, '');
}

describe('SupabaseEventAgendaSuggestionRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseEventAgendaSuggestionRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      collisionExempt: { event_agenda_suggestion_runs: ['event_id'] },
    });
    repo = new SupabaseEventAgendaSuggestionRepository(harness.client);
  });

  it('lists only the chapter’s suggestions for the event', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.listForEvent(CHAPTER_A, EVENT),
    );
    expect(rows.map((row) => row.id).sort()).toEqual([
      'added-a',
      'dismissed-a',
      'open-a',
    ]);
  });

  it('writes new suggestions in the chapter and skips a key the event has', async () => {
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.insertMany([
        {
          chapter_id: CHAPTER_A,
          event_id: EVENT,
          kind: 'ai',
          text: 'Philanthropy update',
          reason: 'Open at the last meeting',
          source_meeting_id: MINUTES,
          tabled_meeting_id: null,
          tabled_start_time: null,
          tabled_times: null,
          dedupe_key: 'ai:philanthropy update',
          audience_key: 'r:;o:;x:;e:1',
        },
      ]),
    );
    const rows = harness
      .rows('event_agenda_suggestions')
      .filter((row) => row.chapter_id === CHAPTER_A);
    expect(rows.map((row) => row.text)).toContain('Philanthropy update');
    expect(rows.find((row) => row.text === 'Philanthropy update')?.status).toBe(
      'open',
    );
  });

  it('deletes only the chapter’s open suggestions', async () => {
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.deleteOpen(CHAPTER_A, EVENT, ['open-a', 'dismissed-a', 'open-b']),
    );
    const ids = harness.rows('event_agenda_suggestions').map((row) => row.id);
    expect(ids).not.toContain('open-a');
    expect(ids).toEqual(
      expect.arrayContaining(['dismissed-a', 'open-b', 'dismissed-b']),
    );
  });

  it('decides only an open suggestion in the chapter', async () => {
    const change = {
      status: 'added' as const,
      agenda_item_id: 's-open-a',
      decided_by: USER_SHARED,
      decided_at: NOW,
    };
    await expect(
      harness.expectTenantScoped(CHAPTER_A, () =>
        repo.decide(CHAPTER_A, EVENT, 'open-a', change),
      ),
    ).resolves.toBe(true);
    // Already decided, and another chapter's: neither changes.
    await expect(repo.decide(CHAPTER_A, EVENT, 'open-a', change)).resolves.toBe(
      false,
    );
    await expect(repo.decide(CHAPTER_A, EVENT, 'open-b', change)).resolves.toBe(
      false,
    );
    const b = harness
      .rows('event_agenda_suggestions')
      .find((row) => row.id === 'open-b');
    expect(b?.status).toBe('open');
  });

  it('finds added keys in the chapter only', async () => {
    const keys = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.addedKeys(CHAPTER_A, ['tabled:x:1:rush', 'ai:dues']),
    );
    expect([...keys]).toEqual(['tabled:x:1:rush']);
  });

  it('lists the chapter’s decided suggestions, newest first', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.listDecided(CHAPTER_A, 10),
    );
    expect(rows.map((row) => row.id)).toEqual(['added-a', 'dismissed-a']);
  });

  it('reads and saves only the chapter’s run for the event', async () => {
    const run = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findRun(CHAPTER_A, EVENT),
    );
    expect(run).toEqual(expect.objectContaining({ chapter_id: CHAPTER_A }));
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.saveRun({
        event_id: EVENT,
        chapter_id: CHAPTER_A,
        generated_by: USER_SHARED,
        generated_at: '2026-11-18T20:00:00.000Z',
        audience_key: 'r:;o:;x:;e:1',
      }),
    );
    const b = harness
      .rows('event_agenda_suggestion_runs')
      .find((row) => row.chapter_id === CHAPTER_B);
    expect(b?.generated_at).toBe(NOW);
  });

  it('names the migration’s unique key and primary key as conflict targets', () => {
    expect(
      constraintColumns(
        /event_agenda_suggestions_event_key unique \(([^)]+)\)/,
      ),
    ).toBe(EVENT_AGENDA_SUGGESTION_CONFLICT);
    expect(
      constraintColumns(
        /create table if not exists public\.event_agenda_suggestion_runs \(\s*(\w+) uuid primary key/,
      ),
    ).toBe(EVENT_AGENDA_SUGGESTION_RUN_CONFLICT);
  });
});
