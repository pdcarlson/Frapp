import { db, miss } from "../harness.mjs";

// ─── `get_points_leaderboard` executes and bounds correctly (#522) ───────────
//
// `CREATE FUNCTION` on a plpgsql body is a SYNTAX check only — identifier
// resolution, aggregate semantics and ORDER BY binding are all deferred to the
// first call. So "the migration applied" proves almost nothing about this
// function, and it is the one that carries the points leaderboard's chapter
// predicate since the aggregation moved out of Node.
//
// The unit suite cannot cover it either: it swaps the repository for a
// TypeScript transcription of the SQL, so flipping `>` to `>=` here leaves it
// green. `apps/api/test/integration/points-leaderboard.integration-spec.ts`
// does execute the real function, but `test:integration` runs in no CI job
// (#1568) — so without this section a boundary regression merges green.
//
// Deliberately minimal: one row sits exactly ON the shared bound instant, and
// that same instant is passed as `p_since` in one call and `p_until` in the
// next, so an inclusive/exclusive mix-up moves it between boards rather than
// merely changing a count.
console.log("\n=== get_points_leaderboard bounds + scoping (#522) ===");
try {
  const CH_A = "aaaaaaaa-0000-4000-8000-000000000001";
  const CH_B = "aaaaaaaa-0000-4000-8000-000000000002";
  // Ids are chosen so that ranking by total and ranking by user_id DISAGREE:
  // U_A sorts first by id but last-but-one by total. Without that, `order by
  // pt.user_id asc` alone — and, worse, `order by total desc` where bare
  // `total` binds to the NULL plpgsql OUT parameter rather than the aggregate,
  // the exact trap this function's header warns about — both reproduce the
  // expected order, and the ordering check passes while the sort is broken.
  const U_A = "bbbbbbbb-0000-4000-8000-00000000000a"; // smallest id, middle total
  const U_B = "bbbbbbbb-0000-4000-8000-00000000000b"; // middle id, TOP total
  const U_C = "bbbbbbbb-0000-4000-8000-00000000000c"; // largest id, the bound member
  const ON_BOUND = "2026-03-01T00:00:00Z";

  await db.exec(`
    insert into public.chapters (id, name, university) values
      ('${CH_A}', 'PGlite A', 'U'), ('${CH_B}', 'PGlite B', 'U');
    insert into public.users (id, supabase_auth_id, email, display_name) values
      ('${U_A}', '${U_A}', 'lb-a@pglite.test', 'A'),
      ('${U_B}', '${U_B}', 'lb-b@pglite.test', 'B'),
      ('${U_C}', '${U_C}', 'lb-c@pglite.test', 'C');
    insert into public.point_transactions (chapter_id, user_id, amount, category, created_at) values
      ('${CH_A}', '${U_A}', 5,  'MANUAL', '2026-01-01T00:00:00Z'),
      ('${CH_A}', '${U_B}', 10, 'MANUAL', '2026-01-01T00:00:00Z'),
      ('${CH_A}', '${U_B}', 5,  'MANUAL', '2026-09-01T00:00:00Z'),
      ('${CH_A}', '${U_C}', 30, 'MANUAL', '${ON_BOUND}'),
      ('${CH_A}', '${U_C}', -35,'FINE',   '2026-09-01T00:00:00Z'),
      ('${CH_B}', '${U_A}', 999,'MANUAL', '2026-01-01T00:00:00Z');
  `);

  const board = async (chapter, since, until) => {
    const r = await db.query(
      `select user_id::text as user_id, total::int as total
         from get_points_leaderboard($1::uuid, $2::timestamptz, $3::timestamptz)`,
      [chapter, since, until],
    );
    return r.rows;
  };

  // Runs the body at all — an unqualified `user_id`/`total` would raise
  // "column reference is ambiguous" HERE and nowhere earlier.
  const allTime = await board(CH_A, null, null);
  const exclusiveLower = await board(CH_A, ON_BOUND, null);
  const inclusiveUpper = await board(CH_A, null, ON_BOUND);
  const otherChapter = await board(CH_B, null, null);

  const totalFor = (rows, u) => rows.find((r) => r.user_id === u)?.total;
  // Every check below indexes with `?.` so one broken assertion reports itself
  // rather than throwing into the outer catch, which would flatten all seven
  // into a single opaque "Cannot read properties of undefined" MISS and point a
  // CI reader at this gate instead of at the migration.
  const order = allTime.map((r) => r.user_id);

  const checks = [
    [
      allTime.length === 3,
      `all-time returns one row per member (got ${allTime.length}, want 3)`,
    ],
    [
      totalFor(allTime, U_B) === 15,
      `sums per member (u_b = ${totalFor(allTime, U_B)}, want 15)`,
    ],
    [
      totalFor(allTime, U_C) === -5,
      `negative totals survive (u_c = ${totalFor(allTime, U_C)}, want -5)`,
    ],
    [
      // U_B (15) outranks U_A (5) despite having the LARGER id, so this fails
      // for `order by user_id` alone and for a `total` that binds to the NULL
      // OUT parameter — both of which would otherwise look correct.
      order[0] === U_B && order[1] === U_A && order[2] === U_C,
      `orders by total descending, not by user_id (got ${order
        .map((u) => u.slice(-1))
        .join(",")}, want b,a,c)`,
    ],
    [
      totalFor(exclusiveLower, U_C) === -35,
      `p_since is EXCLUSIVE — the row ON the bound is dropped (u_c = ${totalFor(exclusiveLower, U_C)}, want -35)`,
    ],
    [
      totalFor(inclusiveUpper, U_C) === 30,
      `p_until is INCLUSIVE — the row ON the bound is kept (u_c = ${totalFor(inclusiveUpper, U_C)}, want 30)`,
    ],
    [
      otherChapter.length === 1 && otherChapter[0]?.total === 999,
      "chapter_id scopes the aggregation (no cross-chapter rows)",
    ],
  ];

  for (const [ok, name] of checks) {
    if (ok) {
      console.log(`OK    ${name}`);
    } else {
      miss();
      console.log(`MISS  ${name}`);
    }
  }

  // Leave the schema as the migrations produced it, same contract as the tiers
  // above. Chapters cascade to point_transactions; users do not.
  await db.exec(`
    delete from public.chapters where id in ('${CH_A}', '${CH_B}');
    delete from public.users where email like 'lb-%@pglite.test';
  `);
} catch (e) {
  miss();
  console.log(
    `MISS  get_points_leaderboard bounds + scoping\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
