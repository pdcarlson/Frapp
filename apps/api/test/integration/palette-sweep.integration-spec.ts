// The stale-palette sweep (#1165) against a real PostgREST.
//
// `scheduled-jobs.repository.spec.ts` proves which filters the repository asks
// for. It cannot prove PostgREST reads them the way the sweep depends on:
// that `seed:branding->colors->>accent` comes back as text, that a JSON-path
// `eq`/`is` filter applies to an UPDATE, and that the `or()` staleness filter
// and the seed filter together really make the write compare-and-set. The
// guard is the part that must not be wrong: if it silently matched nothing the
// sweep would never write, and if it silently matched everything it would
// overwrite an officer's accent save with the colour it replaced, stamped
// current, where no later tick would look again.
//
// Run: `npm run test:integration -w apps/api` (needs a local Supabase stack
// with `20260923170000` applied; skips cleanly without a stack). Not run by CI
// today; #1568 tracks wiring the suite in.
//
// The full-sweep case recomputes every stale chapter in the local database,
// not only this file's fixtures. That is the sweep's job and harmless on a dev
// stack; the assertions look only at the fixtures.

import { randomUUID } from 'node:crypto';
import { SIGNET_ENGINE_VERSION } from '@repo/chapter-theme';
import { buildChapterPalette } from '../../src/application/services/chapter-palette';
import { ScheduledJobsRepository } from '../../src/modules/scheduled-jobs/scheduled-jobs.repository';
import { ScheduledJobsService } from '../../src/modules/scheduled-jobs/scheduled-jobs.service';
import type { FrappSupabaseClient } from '../../src/infrastructure/supabase/database.types';
import { createServiceRoleClient, describeIntegration } from './stack';

// `@nestjs/schedule` ships as ESM only, and this suite compiles to CommonJS
// (`jest-integration.json`), so importing the service would fail to load. The
// decorators are irrelevant here, since the sweep is called directly.
jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
  CronExpression: new Proxy({}, { get: (_target, key) => String(key) }),
}));

/** A palette as #2541 found it: the raw crimson seed as the fill, plus a dead legacy key. */
const STALE_CRIMSON = {
  '--signet-accent-primary': '#8B0000',
  '--side-bg': '#2B1F1F',
};

describeIntegration('Stale-palette sweep against live PostgREST', () => {
  let supabase: FrappSupabaseClient;
  let repo: ScheduledJobsRepository;
  let service: ScheduledJobsService;

  const crimson = randomUUID(); // branding accent, unstamped, stale fill
  const noAccent = randomUUID(); // never picked an accent, empty palette
  const current = randomUUID(); // already stamped by the running engine
  const behind = randomUUID(); // stamped by an older engine
  const racedSeed = randomUUID(); // accent changes between read and write
  const racedStamp = randomUUID(); // another writer stamps between read and write
  const fixtures = [crimson, noAccent, current, behind, racedSeed, racedStamp];

  const assertOk = (label: string, error: { message: string } | null) => {
    if (error) throw new Error(`seed ${label}: ${error.message}`);
  };

  const chapterRow = (
    id: string,
    extra: Record<string, unknown>,
  ): Record<string, unknown> => ({
    id,
    name: `palette-${id.slice(0, 8)}`,
    university: 'Integration Test University',
    ...extra,
  });

  const read = async (id: string) => {
    const { data, error } = await supabase
      .from('chapters')
      .select('theme_palette, theme_palette_engine_version')
      .eq('id', id)
      .single();
    assertOk(`read ${id}`, error);
    return data as {
      theme_palette: Record<string, string> | null;
      theme_palette_engine_version: number | null;
    };
  };

  beforeAll(async () => {
    supabase = createServiceRoleClient();
    repo = new ScheduledJobsRepository(supabase);
    // Only the repository is reached by `sweepStalePalettes`.
    service = new ScheduledJobsService(
      repo,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );

    assertOk(
      'chapters',
      (
        await supabase.from('chapters').insert([
          chapterRow(crimson, {
            accent_color: '#8B0000',
            branding: { colors: { accent: '#8B0000' } },
            theme_palette: STALE_CRIMSON,
          }),
          // `{}`, not absent: the column is NOT NULL, and a bulk insert
          // sends null for any key another row in the batch carries.
          chapterRow(noAccent, { branding: {}, theme_palette: {} }),
          chapterRow(current, {
            branding: { colors: { accent: '#003087' } },
            theme_palette: { sentinel: 'untouched' },
            theme_palette_engine_version: SIGNET_ENGINE_VERSION,
          }),
          chapterRow(behind, {
            branding: { colors: { accent: '#006400' } },
            theme_palette: { sentinel: 'old engine' },
            theme_palette_engine_version: SIGNET_ENGINE_VERSION - 1,
          }),
          chapterRow(racedSeed, {
            branding: { colors: { accent: '#8B0000' } },
            theme_palette: STALE_CRIMSON,
          }),
          chapterRow(racedStamp, {
            branding: { colors: { accent: '#8B0000' } },
            theme_palette: STALE_CRIMSON,
          }),
        ] as never)
      ).error,
    );
  });

  afterAll(async () => {
    if (!supabase) return;
    await supabase.from('chapters').delete().in('id', fixtures);
  });

  it('reads every unstamped or older row, with its seed as text, and skips a current one', async () => {
    const stale = await repo.findChaptersWithStalePalette(
      SIGNET_ENGINE_VERSION,
    );
    const byId = new Map(stale.map((row) => [row.id, row]));

    expect(byId.get(crimson)).toEqual({ id: crimson, seed: '#8B0000' });
    expect(byId.get(noAccent)).toEqual({ id: noAccent, seed: null });
    expect(byId.get(behind)).toEqual({ id: behind, seed: '#006400' });
    expect(byId.has(current)).toBe(false);
  });

  it('does not write over an accent that changed after the read', async () => {
    const [row] = (
      await repo.findChaptersWithStalePalette(SIGNET_ENGINE_VERSION)
    ).filter((r) => r.id === racedSeed);
    // An officer's save from an API instance that predates the stamp column:
    // the accent moves and the stamp does not.
    assertOk(
      'raced seed',
      (
        await supabase
          .from('chapters')
          .update({ branding: { colors: { accent: '#003087' } } } as never)
          .eq('id', racedSeed)
      ).error,
    );

    const written = await repo.writeRecomputedPalette(row, {
      theme_palette: buildChapterPalette({ accent: row.seed ?? undefined })
        .palette,
      theme_palette_engine_version: SIGNET_ENGINE_VERSION,
    });

    expect(written).toBe(false);
    expect(await read(racedSeed)).toEqual({
      theme_palette: STALE_CRIMSON,
      theme_palette_engine_version: null,
    });
  });

  it('does not write over a row another writer stamped after the read', async () => {
    const [row] = (
      await repo.findChaptersWithStalePalette(SIGNET_ENGINE_VERSION)
    ).filter((r) => r.id === racedStamp);
    const officerSave = { sentinel: 'officer save' };
    assertOk(
      'raced stamp',
      (
        await supabase
          .from('chapters')
          .update({
            theme_palette: officerSave,
            theme_palette_engine_version: SIGNET_ENGINE_VERSION,
          } as never)
          .eq('id', racedStamp)
      ).error,
    );

    const written = await repo.writeRecomputedPalette(row, {
      theme_palette: buildChapterPalette({ accent: row.seed ?? undefined })
        .palette,
      theme_palette_engine_version: SIGNET_ENGINE_VERSION,
    });

    expect(written).toBe(false);
    expect((await read(racedStamp)).theme_palette).toEqual(officerSave);
  });

  it('recomputes every stale row through buildChapterPalette, whole-map, and stamps it', async () => {
    await service.sweepStalePalettes();

    const crimsonRow = await read(crimson);
    expect(crimsonRow).toEqual({
      theme_palette: buildChapterPalette({ accent: '#8B0000' }).palette,
      theme_palette_engine_version: SIGNET_ENGINE_VERSION,
    });
    // The #2541 lift reached a row written before it.
    expect(crimsonRow.theme_palette?.['--signet-accent-primary']).toBe(
      '#C34437',
    );
    // Replaced, not merged: the dead legacy key is gone.
    expect(crimsonRow.theme_palette).not.toHaveProperty('--side-bg');

    expect(await read(noAccent)).toEqual({
      theme_palette: buildChapterPalette({}).palette,
      theme_palette_engine_version: SIGNET_ENGINE_VERSION,
    });
    expect(await read(behind)).toEqual({
      theme_palette: buildChapterPalette({ accent: '#006400' }).palette,
      theme_palette_engine_version: SIGNET_ENGINE_VERSION,
    });
    // The seed-raced row is picked up on the next tick with its new seed.
    expect(await read(racedSeed)).toEqual({
      theme_palette: buildChapterPalette({ accent: '#003087' }).palette,
      theme_palette_engine_version: SIGNET_ENGINE_VERSION,
    });

    expect(await read(current)).toEqual({
      theme_palette: { sentinel: 'untouched' },
      theme_palette_engine_version: SIGNET_ENGINE_VERSION,
    });
  });

  it('is idempotent: a second sweep finds none of them stale', async () => {
    const before = await Promise.all(fixtures.map(read));

    await service.sweepStalePalettes();

    const stale = await repo.findChaptersWithStalePalette(
      SIGNET_ENGINE_VERSION,
    );
    expect(stale.filter((row) => fixtures.includes(row.id))).toEqual([]);
    expect(await Promise.all(fixtures.map(read))).toEqual(before);
  });
});
