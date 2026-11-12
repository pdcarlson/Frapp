import { db, miss } from "../harness.mjs";

console.log("\n=== Functional: a study session finishes and awards once (finish_study_session) ===");
{
  // StudyService decides what a finish is worth, then hands the transition and
  // the STUDY award to `finish_study_session`, which applies both behind a
  // compare-and-set on the row the API read. Every unit suite mocks the RPC, so
  // this is the CI-run proof of the SQL: a second finish from the same read
  // awards nothing, a read a heartbeat has since moved past finishes nothing,
  // and the one-ACTIVE-session index refuses a second ACTIVE row.
  const CHAPTER = "a5e55000-0000-4000-8000-00000000000c";
  const USER = "a5e55000-0000-4000-8000-0000000000a1";
  const GEOFENCE = "a5e55000-0000-4000-8000-0000000000f1";
  const SESSION = "a5e55000-0000-4000-8000-0000000000b1";
  const READ_AT = "2026-11-12T10:05:00.000Z";

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const finish = async (expectedHeartbeat, status = "COMPLETED", points = 2) =>
    (
      await db.query(
        `select id, status, points_awarded, paused_at from finish_study_session(
           $1, $2, $3, null, $4, '2026-11-12T11:00:00Z', '2026-11-12T11:00:00Z', 60, $5,
           'Study session: Library')`,
        [SESSION, CHAPTER, expectedHeartbeat, status, points],
      )
    ).rows;
  const awards = async () =>
    (
      await db.query(
        `select count(*)::int as n, coalesce(sum(amount), 0)::int as total
           from point_transactions
          where category = 'STUDY' and metadata->>'study_session_id' = $1`,
        [SESSION],
      )
    ).rows[0];

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${CHAPTER}', 'C', 'U');
      insert into users (id, supabase_auth_id, email, display_name)
        values ('${USER}', gen_random_uuid(), 'a5e55@example.test', 'Study');
      insert into study_geofences (id, chapter_id, name, coordinates)
        values ('${GEOFENCE}', '${CHAPTER}', 'Library', '[]'::jsonb);
      insert into study_sessions (id, chapter_id, user_id, geofence_id, status,
                                  last_heartbeat_at, total_foreground_minutes)
        values ('${SESSION}', '${CHAPTER}', '${USER}', '${GEOFENCE}', 'ACTIVE',
                '${READ_AT}', 55);
    `);

    const stale = await finish("2026-11-12T10:00:00.000Z");
    check(
      "a finish computed from a watermark the row has moved past finishes nothing",
      stale.length === 0 && (await awards()).n === 0,
      { stale },
    );

    const first = await finish(READ_AT);
    const second = await finish(READ_AT);
    const paid = await awards();
    check(
      "the first finish completes and awards; the second from the same read returns no row and pays nothing",
      first.length === 1 &&
        first[0].status === "COMPLETED" &&
        first[0].points_awarded === true &&
        second.length === 0 &&
        paid.n === 1 &&
        paid.total === 2,
      { first, second, paid },
    );

    await db.exec("savepoint s1;");
    let refused = null;
    try {
      await finish(READ_AT, "EXPIRED", 0);
    } catch (e) {
      refused = String(e?.message ?? e);
    } finally {
      await db.exec("rollback to savepoint s1;");
    }
    check(
      "a status that awards nothing cannot finish through the award path",
      /does not award/.test(refused ?? ""),
      { refused },
    );

    await db.exec(`
      insert into study_sessions (chapter_id, user_id, geofence_id, status)
        values ('${CHAPTER}', '${USER}', '${GEOFENCE}', 'ACTIVE');
    `);
    await db.exec("savepoint s2;");
    let duplicate = null;
    try {
      await db.exec(`
        insert into study_sessions (chapter_id, user_id, geofence_id, status)
          values ('${CHAPTER}', '${USER}', '${GEOFENCE}', 'ACTIVE');
      `);
    } catch (e) {
      duplicate = String(e?.message ?? e);
    } finally {
      await db.exec("rollback to savepoint s2;");
    }
    check(
      "a second ACTIVE session for the same member and chapter is refused",
      /idx_study_sessions_one_active|duplicate key|unique/i.test(duplicate ?? ""),
      { duplicate },
    );
  } catch (e) {
    check("study-session-finish scenario ran", false, String(e?.message ?? e).split("\n")[0]);
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
