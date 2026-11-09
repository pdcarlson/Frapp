import { db, miss } from "../harness.mjs";

console.log("\n=== Functional: one check-in and one award per member per event (#3703) ===");
{
  // The API maps a second check-in to 409 and pays nothing, but only because
  // `check_in_event` inserts `on conflict (event_id, user_id) do nothing` over
  // the table's unique pair, and returns no row when that fires. Every unit
  // suite mocks the RPC, and the live-PostgREST spec
  // (apps/api/test/integration/check-in-once.integration-spec.ts, which also
  // races two calls) isn't run in CI. This is the CI-run proof that a second
  // check-in writes neither a row nor a second ledger award, and that the pair
  // is per occurrence of a series.
  const CHAPTER = "a3703000-0000-4000-8000-00000000000c";
  const USER = "a3703000-0000-4000-8000-0000000000a1";
  const EVENT = "a3703000-0000-4000-8000-0000000000e1";
  const NEXT = "a3703000-0000-4000-8000-0000000000e2";

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const checkIn = async (eventId) =>
    (
      await db.query(
        `select id from check_in_event($1, $2, $3, now(), 10, 'Chapter')`,
        [eventId, USER, CHAPTER],
      )
    ).rows.length;
  const count = async (sql, params) => (await db.query(sql, params)).rows[0].n;
  const awards = (eventId) =>
    count(
      `select count(*)::int as n from point_transactions
        where user_id = $1 and category = 'ATTENDANCE' and metadata->>'event_id' = $2`,
      [USER, eventId],
    );

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${CHAPTER}', 'C', 'U');
      insert into users (id, supabase_auth_id, email, display_name)
        values ('${USER}', gen_random_uuid(), 'a3703@example.test', 'Check In');
      insert into events (id, chapter_id, name, start_time, end_time, point_value)
        values ('${EVENT}', '${CHAPTER}', 'Chapter', now(), now() + interval '1 hour', 10);
      insert into events (id, chapter_id, name, start_time, end_time, point_value, parent_event_id)
        values ('${NEXT}', '${CHAPTER}', 'Chapter', now() + interval '7 days',
                now() + interval '7 days 1 hour', 10, '${EVENT}');
    `);

    const first = await checkIn(EVENT);
    const second = await checkIn(EVENT);
    const rows = await count(
      `select count(*)::int as n from event_attendance where event_id = $1 and user_id = $2`,
      [EVENT, USER],
    );
    const paid = await awards(EVENT);
    check(
      "a second check-in returns no row and writes neither a row nor an award",
      first === 1 && second === 0 && rows === 1 && paid === 1,
      { first, second, rows, paid },
    );

    const nextWeek = await checkIn(NEXT);
    check(
      "the next occurrence of the series takes its own check-in",
      nextWeek === 1 && (await awards(NEXT)) === 1,
      { nextWeek },
    );

    await db.exec("savepoint p3703;");
    let duplicate = null;
    try {
      await db.exec(
        `insert into event_attendance (event_id, user_id, status) values ('${EVENT}', '${USER}', 'PRESENT');`,
      );
    } catch (e) {
      duplicate = String(e?.message ?? e);
    } finally {
      await db.exec("rollback to savepoint p3703;");
    }
    check(
      "a duplicate row written past the RPC is refused by the unique pair",
      /duplicate key|unique/i.test(duplicate ?? ""),
      { duplicate },
    );

    const lead = await db.query(
      `select check_in_opens_minutes from events where id = $1`,
      [EVENT],
    );
    await db.exec("savepoint p3703b;");
    let outOfRange = null;
    try {
      await db.exec(`update events set check_in_opens_minutes = 121 where id = '${EVENT}';`);
    } catch (e) {
      outOfRange = String(e?.message ?? e);
    } finally {
      await db.exec("rollback to savepoint p3703b;");
    }
    check(
      "an event opens check-in 10 minutes early by default, and no more than 120",
      lead.rows[0]?.check_in_opens_minutes === 10 &&
        /events_check_in_opens_minutes_range/.test(outOfRange ?? ""),
      { lead: lead.rows[0], outOfRange },
    );
  } catch (e) {
    check("check-in-once scenario ran", false, String(e?.message ?? e).split("\n")[0]);
  } finally {
    await db.exec("rollback;").catch(() => {});
  }

  for (const r of results) {
    if (r.ok) {
      console.log(`OK    ${r.name}`);
    } else {
      miss();
      console.log(`MISS  ${r.name}\n        ↳ ${JSON.stringify(r.detail ?? null).slice(0, 300)}`);
    }
  }
}
