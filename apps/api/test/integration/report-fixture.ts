// Fixture builder for the report-query integration suite.
//
// The shape here is the test. Two chapters are seeded with *deliberately
// overlapping* data — a shared member, same-named roles, attendance recorded by
// a different user than the attendee — so that a query which loses its chapter
// filter, or embeds the wrong foreign key, produces visibly wrong rows rather
// than merely fewer of them. A fixture where the two chapters had nothing in
// common could not tell a scoped query from an unscoped one.

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Service entries seeded for the paging test.
 *
 * Must exceed `supabase/config.toml`'s `max_rows = 1000` so the read genuinely
 * spans more than one round-trip and the server caps a page below what
 * `REPORT_PAGE_SIZE` asked for — the condition `fetchAllPages` advances by
 * `batch.length` to survive. Just over the cap rather than far over: the point
 * is to cross the boundary, and every extra row is seed time on every run.
 */
export const PAGED_SERVICE_ENTRY_COUNT = 1_100;

/** Rows per insert round-trip while seeding. Keeps request bodies sane. */
const INSERT_CHUNK = 500;

export interface SeededChapter {
  id: string;
  name: string;
  /** Members seeded into this chapter, in insertion order. */
  users: SeededUser[];
  roleIds: string[];
  eventIds: string[];
}

export interface SeededUser {
  id: string;
  displayName: string;
  email: string;
}

export interface ReportFixture {
  /** The chapter under test — every report is run against this one. */
  primary: SeededChapter;
  /** The control. No report scoped to `primary` may ever surface its rows. */
  other: SeededChapter;
  /** Member of **both** chapters — the strongest isolation probe. */
  sharedUser: SeededUser;
  /** The officer who recorded attendance; never an attendee himself. */
  markedByUser: SeededUser;
  /** Event in `primary` used for the `event_id` filter assertions. */
  primaryFilterEventId: string;
  cleanup: () => Promise<void>;
}

function assertOk(context: string, error: { message: string } | null): void {
  if (error) throw new Error(`fixture: ${context} failed — ${error.message}`);
}

async function insertChunked(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const { error } = await supabase
      .from(table)
      .insert(rows.slice(i, i + INSERT_CHUNK));
    assertOk(`insert into ${table}`, error);
  }
}

/**
 * A run-scoped tag stamped into every seeded user's email.
 *
 * Users are the one entity here not owned by a chapter, so they cannot ride the
 * `on delete cascade` that cleans up everything else. Tagging them lets
 * `cleanup` find exactly this run's rows — and lets two concurrent runs share a
 * stack without deleting each other's fixtures.
 */
function makeRunTag(): string {
  return `it-${randomUUID().slice(0, 8)}`;
}

async function makeUser(
  supabase: SupabaseClient,
  runTag: string,
  displayName: string,
): Promise<SeededUser> {
  const id = randomUUID();
  const email = `${runTag}-${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@example.test`;
  const { error } = await supabase.from('users').insert({
    id,
    supabase_auth_id: randomUUID(),
    email,
    display_name: displayName,
  });
  assertOk(`insert user ${displayName}`, error);
  return { id, displayName, email };
}

/**
 * Build the two-chapter fixture and return it with its own teardown.
 *
 * Deleting the two chapters is enough for members, roles, events, attendance,
 * point transactions and service entries — all of them are `on delete cascade`
 * from `chapters` (or from `events`, which cascades in turn). Only `users` is
 * deleted explicitly, by the run tag.
 */
export async function seedReportFixture(
  supabase: SupabaseClient,
): Promise<ReportFixture> {
  const runTag = makeRunTag();
  const primaryId = randomUUID();
  const otherId = randomUUID();

  const { error: chapterError } = await supabase.from('chapters').insert([
    { id: primaryId, name: `${runTag} Primary`, university: 'Test University' },
    { id: otherId, name: `${runTag} Other`, university: 'Test University' },
  ]);
  assertOk('insert chapters', chapterError);

  const cleanup = async (): Promise<void> => {
    // Chapters first: their cascades remove the rows that reference users, so
    // the user delete below cannot trip a foreign key.
    await supabase.from('chapters').delete().in('id', [primaryId, otherId]);
    await supabase.from('users').delete().like('email', `${runTag}-%`);
  };

  try {
    const sharedUser = await makeUser(supabase, runTag, 'Shared Member');
    const markedByUser = await makeUser(supabase, runTag, 'Recording Officer');
    const primaryOnly = await makeUser(supabase, runTag, 'Primary Only');
    const otherOnly = await makeUser(supabase, runTag, 'Other Only');

    // Same role *name* in both chapters, different ids — so a roster that
    // resolved role names from the wrong chapter would still look plausible,
    // and only the id mapping proves it right.
    const primaryRoleId = randomUUID();
    const otherRoleId = randomUUID();
    const { error: roleError } = await supabase.from('roles').insert([
      { id: primaryRoleId, chapter_id: primaryId, name: 'Treasurer' },
      { id: otherRoleId, chapter_id: otherId, name: 'Treasurer' },
    ]);
    assertOk('insert roles', roleError);

    const { error: memberError } = await supabase.from('members').insert([
      {
        user_id: sharedUser.id,
        chapter_id: primaryId,
        role_ids: [primaryRoleId],
      },
      { user_id: primaryOnly.id, chapter_id: primaryId, role_ids: [] },
      { user_id: markedByUser.id, chapter_id: primaryId, role_ids: [] },
      { user_id: sharedUser.id, chapter_id: otherId, role_ids: [otherRoleId] },
      { user_id: otherOnly.id, chapter_id: otherId, role_ids: [] },
    ]);
    assertOk('insert members', memberError);

    const primaryEventA = randomUUID();
    const primaryEventB = randomUUID();
    const otherEvent = randomUUID();
    const { error: eventError } = await supabase.from('events').insert([
      {
        id: primaryEventA,
        chapter_id: primaryId,
        name: 'Primary Chapter Meeting',
        start_time: '2026-03-01T18:00:00.000Z',
        end_time: '2026-03-01T19:00:00.000Z',
      },
      {
        id: primaryEventB,
        chapter_id: primaryId,
        name: 'Primary Philanthropy',
        start_time: '2026-04-15T18:00:00.000Z',
        end_time: '2026-04-15T19:00:00.000Z',
      },
      {
        id: otherEvent,
        chapter_id: otherId,
        name: 'Other Chapter Meeting',
        start_time: '2026-03-01T18:00:00.000Z',
        end_time: '2026-03-01T19:00:00.000Z',
      },
    ]);
    assertOk('insert events', eventError);

    // `marked_by` is always the officer and never the attendee. This is what
    // makes the FK-hint assertion meaningful: swapping the embed to
    // `users!event_attendance_marked_by_fkey` would return "Recording Officer"
    // for every row instead of failing loudly.
    const { error: attendanceError } = await supabase
      .from('event_attendance')
      .insert([
        {
          event_id: primaryEventA,
          user_id: sharedUser.id,
          status: 'PRESENT',
          check_in_time: '2026-03-01T18:05:00.000Z',
          marked_by: markedByUser.id,
        },
        {
          event_id: primaryEventA,
          user_id: primaryOnly.id,
          status: 'LATE',
          check_in_time: '2026-03-01T18:20:00.000Z',
          marked_by: markedByUser.id,
        },
        {
          event_id: primaryEventB,
          user_id: primaryOnly.id,
          status: 'ABSENT',
          marked_by: markedByUser.id,
        },
        {
          event_id: otherEvent,
          user_id: sharedUser.id,
          status: 'PRESENT',
          check_in_time: '2026-03-01T18:02:00.000Z',
          marked_by: markedByUser.id,
        },
      ]);
    assertOk('insert event_attendance', attendanceError);

    // The shared member earns points in both chapters. A points report that
    // dropped its chapter filter would sum 130 instead of 30 — a wrong number
    // rather than a missing row, which a row-count assertion would miss.
    const { error: pointsError } = await supabase
      .from('point_transactions')
      .insert([
        {
          chapter_id: primaryId,
          user_id: sharedUser.id,
          amount: 10,
          category: 'ATTENDANCE',
        },
        {
          chapter_id: primaryId,
          user_id: sharedUser.id,
          amount: 20,
          category: 'SERVICE',
        },
        {
          chapter_id: primaryId,
          user_id: primaryOnly.id,
          amount: 5,
          category: 'ATTENDANCE',
        },
        {
          chapter_id: otherId,
          user_id: sharedUser.id,
          amount: 100,
          category: 'ATTENDANCE',
        },
      ]);
    assertOk('insert point_transactions', pointsError);

    const serviceRows: Record<string, unknown>[] = [];
    for (let i = 0; i < PAGED_SERVICE_ENTRY_COUNT; i++) {
      serviceRows.push({
        chapter_id: primaryId,
        user_id: i % 2 === 0 ? sharedUser.id : primaryOnly.id,
        // A single repeated date on purpose: `date` is the primary sort key and
        // is not unique, so this forces the `id` tiebreak in `getServiceReport`
        // to carry every page boundary. Without it the ordering would be
        // incidentally stable and the tiebreak untested.
        date: '2026-05-01',
        duration_minutes: 60,
        description: `Primary service entry ${i}`,
        status: 'APPROVED',
      });
    }
    serviceRows.push({
      chapter_id: otherId,
      user_id: otherOnly.id,
      date: '2026-05-01',
      duration_minutes: 90,
      description: 'Other chapter service entry',
      status: 'APPROVED',
    });
    await insertChunked(supabase, 'service_entries', serviceRows);

    return {
      primary: {
        id: primaryId,
        name: `${runTag} Primary`,
        users: [sharedUser, primaryOnly, markedByUser],
        roleIds: [primaryRoleId],
        eventIds: [primaryEventA, primaryEventB],
      },
      other: {
        id: otherId,
        name: `${runTag} Other`,
        users: [sharedUser, otherOnly],
        roleIds: [otherRoleId],
        eventIds: [otherEvent],
      },
      sharedUser,
      markedByUser,
      primaryFilterEventId: primaryEventB,
      cleanup,
    };
  } catch (error) {
    // A fixture that throws halfway through still wrote rows. Clean them up
    // before rethrowing so a failed run doesn't poison the next one.
    await cleanup();
    throw error;
  }
}
