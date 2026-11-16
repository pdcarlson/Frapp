// Repeating tasks (#5119) against a real Postgres and PostgREST.
//
// The unit specs prove what the sweep and the services ask for. These prove
// what the database does with it: that `create_task_series` writes the series,
// its first copy and the copy's checklist together; that two sweeps racing
// over one series make one copy (the compare-and-set on `next_due_date` under
// a row lock, backed by the unique `(series_id, occurrence_date)` key); and
// that the series' reads and compare-and-set writes match what they claim.
//
// Run: `npm run test:integration -w apps/api` (needs a local Supabase stack
// with `20261116044044` applied; skips cleanly without a stack).

import { randomUUID } from 'node:crypto';
import { SupabaseScheduledJobsRepository } from '../../src/infrastructure/supabase/repositories/supabase-scheduled-jobs.repository';
import { SupabaseTaskRepository } from '../../src/infrastructure/supabase/repositories/supabase-task.repository';
import type { FrappSupabaseClient } from '../../src/infrastructure/supabase/database.types';
import { createServiceRoleClient, describeIntegration } from './stack';

const RULE = 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;COUNT=3;TZID=America/New_York';

describeIntegration('Repeating tasks against live PostgREST (#5119)', () => {
  let supabase: FrappSupabaseClient;
  let tasks: SupabaseTaskRepository;
  let sweep: SupabaseScheduledJobsRepository;
  const chapterId = randomUUID();
  const userId = randomUUID();
  let seriesId: string;

  const assertOk = (label: string, error: unknown) => {
    if (error) throw new Error(`${label}: ${JSON.stringify(error)}`);
  };

  beforeAll(async () => {
    supabase = createServiceRoleClient();
    tasks = new SupabaseTaskRepository(supabase);
    sweep = new SupabaseScheduledJobsRepository(supabase);
    assertOk(
      'chapter',
      (
        await supabase
          .from('chapters')
          .insert({ id: chapterId, name: 'Series', university: 'U' })
      ).error,
    );
    assertOk(
      'user',
      (
        await supabase.from('users').insert({
          id: userId,
          supabase_auth_id: randomUUID(),
          email: `${userId}@example.test`,
        })
      ).error,
    );
  });

  afterAll(async () => {
    if (!supabase) return;
    await supabase.from('chapters').delete().eq('id', chapterId);
    await supabase.from('users').delete().eq('id', userId);
  });

  it('writes the series, its first copy and the copy checklist together', async () => {
    const first = await tasks.createSeries({
      chapter_id: chapterId,
      created_by: userId,
      title: 'Kitchen duty',
      description: null,
      assignee_id: userId,
      point_reward: 5,
      proof_kind: 'none',
      subtask_titles: ['Wipe', 'Mop'],
      due_time: '21:00:00',
      recurrence_rule: RULE,
      first_due_date: '2026-11-16',
      first_due_at: '2026-11-17T02:00:00.000Z',
      latest_due_at: '2026-11-17T02:00:00.000Z',
      next_due_date: '2026-11-23',
    });
    seriesId = first.series_id!;

    expect(first).toMatchObject({
      status: 'TODO',
      due_date: '2026-11-16',
      occurrence_date: '2026-11-16',
      point_reward: 5,
    });
    const steps = await tasks.findSubtasks(chapterId, [first.id]);
    expect(steps.map((step) => [step.title, step.position])).toEqual([
      ['Wipe', 0],
      ['Mop', 1],
    ]);
  });

  it('reads the series as due once its latest copy is', async () => {
    const before = await sweep.findDueTaskSeries(
      new Date('2026-11-17T01:59:00.000Z'),
      1000,
    );
    expect(before.map((row) => row.id)).not.toContain(seriesId);
    const after = await sweep.findDueTaskSeries(
      new Date('2026-11-17T02:00:00.000Z'),
      1000,
    );
    expect(after.map((row) => row.id)).toContain(seriesId);
  });

  it('makes one copy when two sweeps race over the series', async () => {
    const input = {
      seriesId,
      expectedNext: '2026-11-23',
      expectedLatestDueAt: '2026-11-17T02:00:00.000Z',
      occurrenceDate: '2026-11-23',
      dueAt: '2026-11-24T02:00:00.000Z',
      latestDueAt: '2026-11-24T02:00:00.000Z',
      nextDueDate: '2026-11-30',
      end: false,
    };
    const results = await Promise.all([
      sweep.materializeTaskSeriesCopy(input),
      sweep.materializeTaskSeriesCopy(input),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    const { data } = await supabase
      .from('tasks')
      .select('occurrence_date')
      .eq('series_id', seriesId)
      .order('occurrence_date');
    expect(data?.map((row) => row.occurrence_date)).toEqual([
      '2026-11-16',
      '2026-11-23',
    ]);
    const latest = await tasks.findLatestSeriesCopy(chapterId, seriesId);
    expect(latest?.occurrence_date).toBe('2026-11-23');
    expect(await tasks.findSubtasks(chapterId, [latest!.id])).toHaveLength(2);
  });

  it('makes no copy from a plan built on a time the officer has since changed', async () => {
    const stale = await sweep.materializeTaskSeriesCopy({
      seriesId,
      expectedNext: '2026-11-30',
      expectedLatestDueAt: '2026-11-17T02:00:00.000Z',
      occurrenceDate: '2026-11-30',
      dueAt: '2026-12-01T02:00:00.000Z',
      latestDueAt: '2026-12-01T02:00:00.000Z',
      nextDueDate: null,
      end: true,
    });
    expect(stale).toBeNull();
  });

  it('writes a series only while next_due_date still matches', async () => {
    expect(
      await tasks.updateSeriesIfNext(chapterId, seriesId, '2026-11-23', {
        title: 'Stale',
      }),
    ).toBeNull();
    const written = await tasks.updateSeriesIfNext(
      chapterId,
      seriesId,
      '2026-11-30',
      { title: 'Kitchen' },
    );
    expect(written?.title).toBe('Kitchen');
  });

  it('ends the series with its last copy, and then makes no more', async () => {
    const last = await sweep.materializeTaskSeriesCopy({
      seriesId,
      expectedNext: '2026-11-30',
      expectedLatestDueAt: '2026-11-24T02:00:00.000Z',
      occurrenceDate: '2026-11-30',
      dueAt: '2026-12-01T02:00:00.000Z',
      latestDueAt: '2026-12-01T02:00:00.000Z',
      nextDueDate: null,
      end: true,
    });
    expect(last?.title).toBe('Kitchen');

    const [series] = await tasks.findSeries(chapterId, [seriesId]);
    expect(series.ended_at).not.toBeNull();
    expect(series.made_count).toBe(3);
    expect(await sweep.endTaskSeries(seriesId, '2026-11-30')).toBe(false);
    const due = await sweep.findDueTaskSeries(new Date('2027-01-01'), 1000);
    expect(due.map((row) => row.id)).not.toContain(seriesId);
  });
});
