import { db, miss } from "../harness.mjs";

// ─── Functional: Ask diagnostics window (20261112200000, #4315) ─────────────
//
// The one place Ask keeps text. It checks:
//
//   - only one window can be open on the whole platform;
//   - a window can't run longer than 14 days;
//   - deleting the window (off, or its end date) deletes what it kept;
//   - an asker who leaves the chapter takes their exchanges with them, and
//     `anonymize_user` (account deletion) does the same;
//   - RLS is on with no policies, so no client role reads either table.
//
// Everything runs inside one transaction and is rolled back.
console.log("\n=== Functional: Ask diagnostics window (20261112200000) ===");
{
  const CH = "a4315000-0000-4000-8000-00000000000a";
  const CH2 = "a4315000-0000-4000-8000-00000000000b";
  const U1 = "a4315000-0000-4000-8000-0000000000a1";
  const U2 = "a4315000-0000-4000-8000-0000000000a2";
  const U3 = "a4315000-0000-4000-8000-0000000000a3";
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const rows = async (text, params = []) => (await db.query(text, params)).rows;
  const refused = async (fn) => {
    await db.exec("savepoint expect_refusal");
    try {
      await fn();
      await db.exec("release savepoint expect_refusal");
      return false;
    } catch {
      await db.exec("rollback to savepoint expect_refusal");
      return true;
    }
  };
  const open = (chapter, days) =>
    db.query(
      `insert into ai_diagnostics_windows (chapter_id, started_by, started_at, ends_at)
       values ($1, $2, now(), now() + make_interval(days => $3))`,
      [chapter, U1, days],
    );
  const keep = async (user) => {
    await db.query(
      `insert into ai_diagnostics_exchanges (window_id, chapter_id, member_id, user_id, sealed)
       select w.id, w.chapter_id, m.id, m.user_id, 'v1.k.n.t.c'
         from ai_diagnostics_windows w
         join members m on m.chapter_id = w.chapter_id and m.user_id = $1`,
      [user],
    );
  };
  const kept = async () =>
    (await rows(`select user_id from ai_diagnostics_exchanges order by user_id`)).map(
      (r) => r.user_id,
    );

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values
        ('${CH}', 'A', 'U'), ('${CH2}', 'B', 'U');
      insert into users (id, supabase_auth_id, email, display_name) values
        ('${U1}', gen_random_uuid(), 'd1@example.com', 'One'),
        ('${U2}', gen_random_uuid(), 'd2@example.com', 'Two'),
        ('${U3}', gen_random_uuid(), 'd3@example.com', 'Three');
      insert into members (user_id, chapter_id) values
        ('${U1}', '${CH}'), ('${U2}', '${CH}'), ('${U3}', '${CH}');
    `);

    check(
      "a window can't run longer than 14 days",
      await refused(() => open(CH, 15)),
      {},
    );
    await open(CH, 14);
    check(
      "a second chapter can't open a window while one is open",
      await refused(() => open(CH2, 14)),
      {},
    );

    await keep(U1);
    await keep(U2);
    await keep(U3);

    await db.query(`delete from members where user_id = $1 and chapter_id = $2`, [
      U2,
      CH,
    ]);
    const afterLeave = await kept();
    check(
      "an asker who leaves the chapter takes their exchanges with them",
      JSON.stringify(afterLeave) === JSON.stringify([U1, U3]),
      { afterLeave },
    );

    await db.query(`select anonymize_user($1)`, [U3]);
    const afterDelete = await kept();
    check(
      "deleting an account deletes the person's exchanges",
      JSON.stringify(afterDelete) === JSON.stringify([U1]),
      { afterDelete },
    );

    await db.query(`delete from ai_diagnostics_windows where chapter_id = $1`, [CH]);
    const afterOff = await kept();
    check("turning the window off deletes what it kept", afterOff.length === 0, {
      afterOff,
    });
    check(
      "another chapter can open one once the first is gone",
      !(await refused(() => open(CH2, 14))),
      {},
    );

    const security = await rows(
      `select c.relname, c.relrowsecurity,
              (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
         from pg_class c
        where c.relname in ('ai_diagnostics_windows', 'ai_diagnostics_exchanges')
        order by c.relname`,
    );
    check(
      "both tables have RLS on and no policies",
      security.length === 2 &&
        security.every((r) => r.relrowsecurity === true && r.policies === 0),
      { security },
    );
  } catch (e) {
    check("the tier ran to the end", false, {
      error: String(e?.message ?? e).split("\n")[0],
    });
  } finally {
    await db.exec("rollback");
  }

  for (const r of results) {
    if (r.ok) {
      console.log(`OK    ${r.name}`);
    } else {
      miss();
      console.log(
        `MISS  ${r.name}\n        ↳ ${JSON.stringify(r.detail).slice(0, 600)}`,
      );
    }
  }
}
