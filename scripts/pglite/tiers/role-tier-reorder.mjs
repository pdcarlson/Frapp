import { db, miss } from "../harness.mjs";

// ─── Functional: reorder_role_tiers (20261111234500, #4071) ─────────────────
//
// `PUT /v1/role-tiers/order` calls the function with every tier of the
// chapter in its new order and the tiers the caller may not move
// (`p_fixed_ids`: the top of the order down to the caller's own). It checks:
//
//   - two tiers trade places in one call (the position constraint is
//     deferrable), and positions come out 1 to n;
//   - a list that misses, repeats or borrows a tier is refused;
//   - an order that moves a fixed tier, or a current order that no longer
//     starts with them (someone else reordered first), is refused;
//   - no role's permissions change, since rank is read from the order;
//   - another chapter's tiers are untouched.
//
// Everything runs inside one transaction and is rolled back.
console.log("\n=== Functional: reorder_role_tiers (20261111234500) ===");
{
  const A = "a4071200-0000-4000-8000-00000000000a";
  const B = "b4071200-0000-4000-8000-00000000000b";
  const T = {
    board: "a4071200-0000-4000-8000-0000000000b1",
    chairs: "a4071200-0000-4000-8000-0000000000b2",
    brothers: "a4071200-0000-4000-8000-0000000000b3",
    pledges: "a4071200-0000-4000-8000-0000000000b4",
    other: "b4071200-0000-4000-8000-0000000000b1",
  };
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const rows = async (text, params = []) => (await db.query(text, params)).rows;
  const order = async (chapter) =>
    (
      await rows(
        `select id::text from role_tiers where chapter_id = $1 order by position`,
        [chapter],
      )
    ).map((r) => r.id);
  const positions = async (chapter) =>
    (
      await rows(
        `select position from role_tiers where chapter_id = $1 order by position`,
        [chapter],
      )
    ).map((r) => r.position);
  const reorder = (ids, fixed) =>
    db.query(
      `select id from reorder_role_tiers($1::uuid, $2::uuid[], $3::uuid[])`,
      [A, ids, fixed],
    );
  const refused = async (ids, fixed) => {
    await db.exec("savepoint expect_refusal");
    try {
      await reorder(ids, fixed);
      await db.exec("release savepoint expect_refusal");
      return { refused: false };
    } catch (e) {
      await db.exec("rollback to savepoint expect_refusal");
      return { refused: true, code: e?.code };
    }
  };
  const permissions = async () =>
    (
      await rows(
        `select string_agg(name || '=' || permissions::text, '|' order by name) as s
           from roles where chapter_id = $1`,
        [A],
      )
    )[0].s;

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values
        ('${A}', 'A', 'U'), ('${B}', 'B', 'U');
      insert into role_tiers (id, chapter_id, position, name, permissions) values
        ('${T.board}', '${A}', 1, 'Cabinet', '{members:view,roles:manage}'),
        ('${T.chairs}', '${A}', 2, 'Committee heads', '{members:view,tasks:manage}'),
        ('${T.brothers}', '${A}', 3, 'Brothers', '{members:view}'),
        ('${T.pledges}', '${A}', 4, 'Associates', '{members:view}'),
        ('${T.other}', '${B}', 1, 'Board', '{members:view}');
      insert into roles (chapter_id, name, is_system, display_order, permissions, tier_id) values
        ('${A}', 'Vice President', false, 1, '{members:view,roles:manage}', '${T.board}'),
        ('${A}', 'Risk chair', false, 2, '{members:view,tasks:manage}', '${T.chairs}'),
        ('${A}', 'Brother', false, 3, '{members:view}', '${T.brothers}');
    `);
    const before = await permissions();

    await reorder(
      [T.board, T.chairs, T.pledges, T.brothers],
      [T.board, T.chairs],
    );
    check(
      "a chair swaps the two tiers below them in one call",
      JSON.stringify(await order(A)) ===
        JSON.stringify([T.board, T.chairs, T.pledges, T.brothers]) &&
        JSON.stringify(await positions(A)) === "[1,2,3,4]",
      { order: await order(A) },
    );
    check("no role's permissions change", (await permissions()) === before, {});

    const missing = await refused([T.board, T.chairs, T.brothers], []);
    const repeated = await refused(
      [T.board, T.chairs, T.brothers, T.brothers],
      [],
    );
    const borrowed = await refused(
      [T.board, T.chairs, T.brothers, T.other],
      [],
    );
    check(
      "a list that misses, repeats or borrows a tier is refused as check_violation",
      [missing, repeated, borrowed].every(
        (r) => r.refused && r.code === "23514",
      ),
      { missing, repeated, borrowed },
    );

    const lifted = await refused(
      [T.board, T.brothers, T.chairs, T.pledges],
      [T.board, T.chairs],
    );
    check(
      "an order that moves a fixed tier is refused",
      lifted.refused && lifted.code === "23514",
      lifted,
    );

    // Someone else put the chairs on top since the caller read the order.
    await reorder([T.chairs, T.board, T.pledges, T.brothers], []);
    const stale = await refused(
      [T.board, T.chairs, T.brothers, T.pledges],
      [T.board, T.chairs],
    );
    check(
      "a current order that no longer starts with the fixed tiers is refused",
      stale.refused && stale.code === "23514",
      stale,
    );

    check(
      "another chapter's tiers are untouched",
      JSON.stringify(await order(B)) === JSON.stringify([T.other]),
      {},
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
