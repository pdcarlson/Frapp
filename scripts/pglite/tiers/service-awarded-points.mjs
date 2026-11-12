import { db, miss } from "../harness.mjs";

console.log("\n=== Functional: an approval records the points it awarded (#3868) ===");
{
  // `approve_service_entry` writes the number it awarded onto the entry, so the
  // History row can say "3 points" without recomputing from a rate that may
  // have changed since. Every unit suite mocks the RPC; this is the CI-run
  // proof that the column matches the ledger row, that a sub-rate approval
  // records 0 with no ledger row, and that a second approval changes nothing.
  const CHAPTER = "a3868000-0000-4000-8000-00000000000c";
  const MEMBER = "a3868000-0000-4000-8000-0000000000a1";
  const REVIEWER = "a3868000-0000-4000-8000-0000000000a2";
  const LONG = "a3868000-0000-4000-8000-0000000000e1";
  const SHORT = "a3868000-0000-4000-8000-0000000000e2";

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const approve = async (entryId, points) =>
    (
      await db.query(
        `select awarded_points, points_awarded, status
           from approve_service_entry($1, $2, $3, null, $4)`,
        [entryId, CHAPTER, REVIEWER, points],
      )
    ).rows;
  const ledger = async (entryId) =>
    (
      await db.query(
        `select coalesce(sum(amount), 0)::int as total, count(*)::int as n
           from point_transactions
          where category = 'SERVICE' and metadata->>'service_entry_id' = $1`,
        [entryId],
      )
    ).rows[0];

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${CHAPTER}', 'C', 'U');
      insert into users (id, supabase_auth_id, email, display_name) values
        ('${MEMBER}', gen_random_uuid(), 'a3868m@example.test', 'Member'),
        ('${REVIEWER}', gen_random_uuid(), 'a3868r@example.test', 'Reviewer');
      insert into service_entries (id, chapter_id, user_id, date, duration_minutes, description) values
        ('${LONG}', '${CHAPTER}', '${MEMBER}', current_date, 180, 'Food bank'),
        ('${SHORT}', '${CHAPTER}', '${MEMBER}', current_date, 45, 'Tutoring');
    `);

    const pending = await db.query(
      `select awarded_points from service_entries where id = $1`,
      [LONG],
    );
    check(
      "a pending entry has no awarded number",
      pending.rows[0]?.awarded_points === null,
      pending.rows[0],
    );

    const long = await approve(LONG, 3);
    const longLedger = await ledger(LONG);
    check(
      "approving records the points awarded, matching the ledger row",
      long.length === 1 &&
        long[0].awarded_points === 3 &&
        long[0].points_awarded === true &&
        longLedger.total === 3 &&
        longLedger.n === 1,
      { long, longLedger },
    );

    const short = await approve(SHORT, 0);
    const shortLedger = await ledger(SHORT);
    check(
      "a sub-rate approval records 0 and writes no ledger row",
      short.length === 1 &&
        short[0].awarded_points === 0 &&
        short[0].points_awarded === false &&
        shortLedger.n === 0,
      { short, shortLedger },
    );

    const again = await approve(LONG, 5);
    const after = await db.query(
      `select awarded_points from service_entries where id = $1`,
      [LONG],
    );
    check(
      "a second approval returns no row and leaves the recorded number alone",
      again.length === 0 && after.rows[0]?.awarded_points === 3,
      { again, after: after.rows[0] },
    );

    await db.exec("savepoint p3868;");
    let negative = null;
    try {
      await db.exec(`update service_entries set awarded_points = -1 where id = '${LONG}';`);
    } catch (e) {
      negative = String(e?.message ?? e);
    } finally {
      await db.exec("rollback to savepoint p3868;");
    }
    check(
      "a negative awarded number is refused",
      /check constraint|violates/i.test(negative ?? ""),
      { negative },
    );
  } catch (e) {
    check("service-awarded-points scenario ran", false, String(e?.message ?? e).split("\n")[0]);
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
