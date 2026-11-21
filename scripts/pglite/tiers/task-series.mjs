import { db, miss } from "../harness.mjs";

console.log(
  "\n=== Functional: a repeating task makes one copy at a time (#5119) ===",
);
{
  // The sweep is safe on every API instance only because
  // `materialize_task_series_copy` is a compare-and-set on the series'
  // `next_due_date` and `latest_due_at` under a row lock, backed by the unique
  // `(series_id, occurrence_date)` key, and `create_task_series` writes the
  // series and its first copy in one transaction. The unit suites mock both
  // RPCs, and the live-PostgREST spec
  // (apps/api/test/integration/task-series.integration-spec.ts, which also
  // races two sweeps) isn't run in CI (#1568). This is the CI-run proof, in
  // commit order: PGlite has one connection, so it can't contend a lock.
  const CHAPTER = "a5119000-0000-4000-8000-00000000000c";
  const USER = "a5119000-0000-4000-8000-0000000000a1";
  const RULE = "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;COUNT=3;TZID=America/New_York";

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const materialize = async (
    seriesId,
    expectedNext,
    expectedLatest,
    day,
    nextDay,
    end,
  ) =>
    (
      await db.query(
        `select id from materialize_task_series_copy(
           $1::uuid, $2::date, $3::timestamptz, $4::date,
           ($4::date + time '21:00') at time zone 'America/New_York',
           ($4::date + time '21:00') at time zone 'America/New_York',
           $5::date, $6::boolean)`,
        [seriesId, expectedNext, expectedLatest, day, nextDay, end],
      )
    ).rows.length;
  const series = async (id) =>
    (
      await db.query(
        `select next_due_date::text as next, latest_due_at, made_count,
                ended_at is not null as ended
           from task_series where id = $1`,
        [id],
      )
    ).rows[0];
  const copies = async (id) =>
    (
      await db.query(
        `select occurrence_date::text as day from tasks where series_id = $1 order by occurrence_date`,
        [id],
      )
    ).rows.map((row) => row.day);

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${CHAPTER}', 'C', 'U');
      insert into users (id, supabase_auth_id, email, display_name)
        values ('${USER}', gen_random_uuid(), 'a5119@example.test', 'Series');
    `);

    const first = (
      await db.query(
        `select id, series_id, occurrence_date::text as day from create_task_series(
           $1::uuid, $2::uuid, 'Kitchen duty', null, $2::uuid, 5, 'none',
           array['Wipe', 'Mop'], time '21:00', $3, date '2026-11-16',
           timestamptz '2026-11-17T02:00:00Z', timestamptz '2026-11-17T02:00:00Z',
           date '2026-11-23')`,
        [CHAPTER, USER, RULE],
      )
    ).rows;
    const seriesId = first[0]?.series_id;
    const steps = (
      await db.query(
        `select count(*)::int as n from task_subtasks where task_id = $1`,
        [first[0]?.id],
      )
    ).rows[0].n;
    check(
      "creating a series writes it, its first copy and the copy's checklist",
      first.length === 1 && first[0].day === "2026-11-16" && steps === 2,
      { first, steps },
    );

    const latest = (await series(seriesId)).latest_due_at;
    const won = await materialize(
      seriesId,
      "2026-11-23",
      latest,
      "2026-11-23",
      "2026-11-30",
      false,
    );
    const lost = await materialize(
      seriesId,
      "2026-11-23",
      latest,
      "2026-11-23",
      "2026-11-30",
      false,
    );
    const afterRace = await series(seriesId);
    check(
      "a second sweep with the same plan makes no copy and doesn't move the series",
      won === 1 &&
        lost === 0 &&
        afterRace.next === "2026-11-30" &&
        afterRace.made_count === 2,
      { won, lost, afterRace },
    );

    const stale = await materialize(
      seriesId,
      "2026-11-30",
      "2026-11-17T02:00:00Z",
      "2026-11-30",
      null,
      true,
    );
    check(
      "a plan made from a latest_due_at that has since moved makes no copy",
      stale === 0 && (await series(seriesId)).ended === false,
      { stale },
    );

    await db.exec("savepoint p5119;");
    let duplicate = null;
    try {
      await db.exec(`
        insert into tasks (chapter_id, title, assignee_id, created_by, due_date, series_id, occurrence_date)
        values ('${CHAPTER}', 'Dup', '${USER}', '${USER}', '2026-11-23', '${seriesId}', '2026-11-23');
      `);
    } catch (e) {
      duplicate = String(e?.message ?? e);
    } finally {
      await db.exec("rollback to savepoint p5119;");
    }
    check(
      "a second copy for the same series and day is refused by the unique pair",
      /duplicate key|unique/i.test(duplicate ?? ""),
      { duplicate },
    );

    const last = await materialize(
      seriesId,
      "2026-11-30",
      afterRace.latest_due_at,
      "2026-11-30",
      null,
      true,
    );
    const ended = await series(seriesId);
    const after = await materialize(
      seriesId,
      "2026-11-30",
      ended.latest_due_at,
      "2026-11-30",
      null,
      true,
    );
    check(
      "the last copy ends the series, and an ended series makes no more",
      last === 1 &&
        ended.ended &&
        ended.made_count === 3 &&
        after === 0 &&
        JSON.stringify(await copies(seriesId)) ===
          JSON.stringify(["2026-11-16", "2026-11-23", "2026-11-30"]),
      { last, ended, after },
    );
  } catch (e) {
    check(
      "task-series scenario ran",
      false,
      String(e?.message ?? e).split("\n")[0],
    );
  } finally {
    await db.exec("rollback;").catch(() => {});
  }

  for (const r of results) {
    if (r.ok) {
      console.log(`OK    ${r.name}`);
    } else {
      miss();
      console.log(
        `MISS  ${r.name}\n        ↳ ${JSON.stringify(r.detail ?? null).slice(0, 300)}`,
      );
    }
  }
}
