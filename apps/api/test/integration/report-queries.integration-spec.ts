// Report queries against a real PostgREST.
//
// `report.service.spec.ts` proves the service *maps* responses correctly. It
// cannot prove PostgREST would accept the request that produced one: its mock
// returns canned rows for any query, discarding the arguments to `.eq()`,
// `.in()` and `.order()` entirely. #746 lived in that gap — an ambiguous embed
// that 500'd `POST /v1/reports/attendance` in every environment since the
// initial schema, with a green suite the whole time.
//
// So these tests assert the things only a real server can answer: that the
// embeds resolve, that the FK hints name the right relationship, that chapter
// isolation actually holds, and that paging survives the server's `max_rows`.
//
// Run: `npm run test:integration -w apps/api` (needs a local Supabase stack;
// skips cleanly without one).

import type { SupabaseClient } from '@supabase/supabase-js';
import { ReportService } from '../../src/application/services/report.service';
import type { ISemesterArchiveRepository } from '../../src/domain/repositories/semester-archive.repository.interface';
import { createServiceRoleClient, describeIntegration } from './stack';
import {
  PAGED_SERVICE_ENTRY_COUNT,
  seedReportFixture,
  type ReportFixture,
} from './report-fixture';

/**
 * The only collaborator that is not the database.
 *
 * Stubbed rather than seeded because it is reached on exactly one path — the
 * `semester` points window — and what this suite is testing is the PostgREST
 * contract, not archive lookup. `null` is the real behaviour for a chapter with
 * no archived semester, which is what the fixture builds.
 */
const semesterArchiveRepo: ISemesterArchiveRepository = {
  findByChapter: () => Promise.resolve([]),
  findLatestByChapter: () => Promise.resolve(null),
  create: () => Promise.reject(new Error('not used by report queries')),
};

describeIntegration('Report queries against live PostgREST', () => {
  let supabase: SupabaseClient;
  let service: ReportService;
  let fixture: ReportFixture;

  beforeAll(async () => {
    supabase = createServiceRoleClient();
    service = new ReportService(supabase, semesterArchiveRepo);
    fixture = await seedReportFixture(supabase);
    // Seeding 1,100 service entries plus the rest is several round-trips.
  }, 120_000);

  afterAll(async () => {
    await fixture?.cleanup();
  }, 60_000);

  describe('getAttendanceReport', () => {
    it('resolves the embeds and returns the attendee, not the recording officer', async () => {
      const { rows } = await service.getAttendanceReport(
        fixture.primary.id,
        {},
      );

      // Three attendance rows live in the primary chapter; the fourth belongs
      // to the control chapter.
      expect(rows).toHaveLength(3);

      const names = rows.map((r) => r.member_name);
      expect(names).toContain('Shared Member');
      expect(names).toContain('Primary Only');
      // The crux. `marked_by` points at this user on every seeded row, so if
      // the embed's FK hint were swapped to `event_attendance_marked_by_fkey`
      // the query would still succeed and every name would be his.
      expect(names).not.toContain('Recording Officer');

      expect(rows.map((r) => r.event_name)).not.toContain(
        'Other Chapter Meeting',
      );
    });

    it('excludes another chapter despite a member shared with it', async () => {
      const { rows } = await service.getAttendanceReport(
        fixture.primary.id,
        {},
      );

      // The shared member attended an event in *both* chapters at the same
      // hour. `!inner` on `events.chapter_id` is the only thing separating
      // them — this is the assertion that deleting those six characters breaks.
      const sharedRows = rows.filter((r) => r.member_name === 'Shared Member');
      expect(sharedRows).toHaveLength(1);
      expect(sharedRows[0].event_name).toBe('Primary Chapter Meeting');
    });

    it('applies the event_id and date filters server-side', async () => {
      const byEvent = await service.getAttendanceReport(fixture.primary.id, {
        event_id: fixture.primaryFilterEventId,
      });
      expect(byEvent.rows).toHaveLength(1);
      expect(byEvent.rows[0].event_name).toBe('Primary Philanthropy');
      expect(byEvent.rows[0].status).toBe('ABSENT');

      // The seeded events sit on 2026-03-01 and 2026-04-15, so this window
      // selects the later one only — proving the bound is applied to the
      // embedded `events.start_time` and not to `event_attendance`.
      const byDate = await service.getAttendanceReport(fixture.primary.id, {
        start_date: '2026-04-01',
        end_date: '2026-04-30',
      });
      expect(byDate.rows).toHaveLength(1);
      expect(byDate.rows[0].event_date).toBe('2026-04-15');
    });

    it('fails if the users embed loses its foreign-key hint (the #746 regression)', async () => {
      // Re-introduces the exact defect, against the same server the service
      // talks to. `event_attendance` reaches `users` through both `user_id` and
      // `marked_by`, so a bare embed is ambiguous and PostgREST refuses it.
      const { error } = await supabase
        .from('event_attendance')
        .select('status, events!inner (id), users (display_name)')
        .eq('events.chapter_id', fixture.primary.id)
        .order('id', { ascending: true })
        .range(0, 9);

      expect(error).not.toBeNull();
      expect(error?.code).toBe('PGRST201');

      // And the shape the service actually ships is accepted.
      const { error: hintedError } = await supabase
        .from('event_attendance')
        .select(
          'status, check_in_time, events!inner (id, name, start_time), users!event_attendance_user_id_fkey (display_name)',
        )
        .eq('events.chapter_id', fixture.primary.id)
        .order('id', { ascending: true })
        .range(0, 9);
      expect(hintedError).toBeNull();
    });
  });

  describe('getPointsReport', () => {
    it('sums only the queried chapter for a member who earns in both', async () => {
      const { rows } = await service.getPointsReport(fixture.primary.id, {});

      const shared = rows.find((r) => r.member_name === 'Shared Member');
      // 10 + 20 here, 100 in the control chapter. An unscoped RPC returns 130 —
      // a wrong number, not a missing row.
      expect(shared?.total_points).toBe(30);
      expect(shared?.breakdown_by_category).toEqual({
        ATTENDANCE: 10,
        SERVICE: 20,
      });

      expect(
        rows.find((r) => r.member_name === 'Primary Only')?.total_points,
      ).toBe(5);
      // Seeded with no transactions in this chapter.
      expect(rows.map((r) => r.member_name)).not.toContain('Other Only');
    });

    it('accepts .order() and .range() on the RPC result set', async () => {
      // PostgREST applies these outside the function call. The service depends
      // on that working — `fetchAllPages` pages the RPC exactly like a table —
      // and a mock cannot tell you whether the server allows it.
      const { rows } = await service.getPointsReport(fixture.primary.id, {});
      const names = rows.map((r) => r.member_name);
      expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
    });

    it('honours the user_id filter', async () => {
      const { rows } = await service.getPointsReport(fixture.primary.id, {
        user_id: fixture.sharedUser.id,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].member_name).toBe('Shared Member');
    });
  });

  describe('getRosterReport', () => {
    it('returns the chapter roster with resolved role names and balances', async () => {
      const { rows, truncated } = await service.getRosterReport(
        fixture.primary.id,
      );

      expect(truncated).toBe(false);
      expect(rows).toHaveLength(3);

      const shared = rows.find((r) => r.name === 'Shared Member');
      // Both chapters define a role literally named "Treasurer" with different
      // ids, so resolving from the wrong chapter's map yields the same string.
      // What it could not survive is the id lookup missing entirely, which
      // falls back to printing the raw uuid.
      expect(shared?.roles).toEqual(['Treasurer']);
      expect(shared?.point_balance).toBe(30);
      expect(shared?.email).toBe(fixture.sharedUser.email);

      expect(rows.map((r) => r.name)).not.toContain('Other Only');
    });

    it('chunks the member lookup rather than overflowing the query string', async () => {
      // `chunkIds` exists because passing every member id in one `in (...)`
      // produced a 414. The mock's `.in()` ignores its argument, so a dropped
      // chunk stays green there; here a dropped chunk means a member with a
      // blank name and email.
      const { rows } = await service.getRosterReport(fixture.primary.id);
      for (const row of rows) {
        expect(row.name).not.toBe('');
        expect(row.email).not.toBe('');
      }
    });
  });

  describe('getServiceReport', () => {
    it('pages past the server max_rows and returns every row', async () => {
      const { rows, truncated } = await service.getServiceReport(
        fixture.primary.id,
        {},
      );

      // `supabase/config.toml` sets `max_rows = 1000`, and the service requests
      // 1,000-row pages — so the server caps the first page at exactly what was
      // asked for and the second returns the remainder. Getting all 1,100 back
      // is the proof that `fetchAllPages` advances by rows *received*.
      expect(rows).toHaveLength(PAGED_SERVICE_ENTRY_COUNT);
      // 1,100 is under REPORT_MAX_ROWS, so a complete read must not claim to be
      // short.
      expect(truncated).toBe(false);

      // Every row resolved a name: the paged read and the chunked user lookup
      // agree with each other across the page boundary.
      expect(rows.every((r) => r.member_name !== '')).toBe(true);
      // No duplicates or drops at the boundary — all rows share one date, so
      // only the `id` tiebreak keeps the offset windows disjoint.
      expect(new Set(rows.map((r) => r.description)).size).toBe(
        PAGED_SERVICE_ENTRY_COUNT,
      );
    }, 60_000);

    it('excludes the other chapter', async () => {
      const { rows } = await service.getServiceReport(fixture.primary.id, {});
      expect(rows.map((r) => r.description)).not.toContain(
        'Other chapter service entry',
      );
    }, 60_000);

    it('applies the user_id and date filters server-side', async () => {
      const byUser = await service.getServiceReport(fixture.primary.id, {
        user_id: fixture.sharedUser.id,
      });
      expect(byUser.rows).toHaveLength(PAGED_SERVICE_ENTRY_COUNT / 2);
      expect(byUser.rows.every((r) => r.member_name === 'Shared Member')).toBe(
        true,
      );

      const outsideWindow = await service.getServiceReport(fixture.primary.id, {
        start_date: '2026-06-01',
        end_date: '2026-06-30',
      });
      expect(outsideWindow.rows).toHaveLength(0);
    }, 60_000);
  });
});
