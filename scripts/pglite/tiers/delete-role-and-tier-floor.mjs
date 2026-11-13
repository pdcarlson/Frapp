import { db, miss } from "../harness.mjs";

// ─── Functional: delete_role and the Everyone floor (20261113164050) ─────────
//
// #4547: `DELETE /v1/roles/:id` calls `delete_role`, which in one transaction
// takes the role off every holder, gives Everyone to a holder it leaves with
// no member-access role and no New Member or Alumni role (the rule
// `rolesAfterSave` applies to a save), and deletes the role.
//
// #4548: `reorder_role_tiers` refuses (22023) an order that puts a tier
// holding the New Member or Alumni role above the Everyone role's tier.
//
// Everything runs inside one transaction and is rolled back.
console.log(
  "\n=== Functional: delete_role and the Everyone floor (20261113164050) ===",
);
{
  const A = "a4547000-0000-4000-8000-00000000000a";
  const B = "b4547000-0000-4000-8000-00000000000b";
  const T = {
    exec: "a4547000-0000-4000-8000-0000000000c1",
    members: "a4547000-0000-4000-8000-0000000000c2",
    pledges: "a4547000-0000-4000-8000-0000000000c3",
  };
  const R = {
    everyone: "a4547000-0000-4000-8000-0000000000e1",
    newMember: "a4547000-0000-4000-8000-0000000000e2",
    chair: "a4547000-0000-4000-8000-0000000000e3",
    photo: "a4547000-0000-4000-8000-0000000000e4",
    president: "a4547000-0000-4000-8000-0000000000e5",
    otherPhoto: "b4547000-0000-4000-8000-0000000000e4",
  };
  const U = [1, 2, 3, 4, 5].map(
    (n) => `a4547000-0000-4000-8000-00000000000${n}`,
  );
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const rows = async (text, params = []) => (await db.query(text, params)).rows;
  const rolesOf = async (user) =>
    (
      await rows(
        `select role_ids::text[] as ids from members where chapter_id = $1 and user_id = $2`,
        [A, user],
      )
    )[0].ids;
  const attempt = async (text, params) => {
    await db.exec("savepoint expect_refusal");
    try {
      const r = await db.query(text, params);
      await db.exec("release savepoint expect_refusal");
      return { refused: false, rows: r.rows };
    } catch (e) {
      await db.exec("rollback to savepoint expect_refusal");
      return { refused: true, code: e?.code };
    }
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values
        ('${A}', 'A4547', 'U'), ('${B}', 'B4547', 'U');
      insert into users (id, supabase_auth_id, email) values
        ${U.map((u, i) => `('${u}', gen_random_uuid(), 'u4547-${i}@x.test')`).join(",\n        ")};
      insert into role_tiers (id, chapter_id, position, name, permissions) values
        ('${T.exec}', '${A}', 1, 'Exec', '{members:view,roles:manage}'),
        ('${T.members}', '${A}', 2, 'Members', '{members:view}'),
        ('${T.pledges}', '${A}', 3, 'New members', '{members:view}');
      insert into roles (id, chapter_id, name, system_key, is_system, display_order, permissions, tier_id) values
        ('${R.president}', '${A}', 'President', 'PRESIDENT', true, 1, '{*}', '${T.exec}'),
        ('${R.chair}', '${A}', 'Chair', null, false, 2, '{members:view}', '${T.exec}'),
        ('${R.everyone}', '${A}', 'Everyone', 'MEMBER', true, 5, '{members:view}', '${T.members}'),
        ('${R.newMember}', '${A}', 'New Member', 'NEW_MEMBER', true, 6, '{members:view}', '${T.pledges}'),
        ('${R.photo}', '${A}', 'Photographer', null, false, 7, '{}', null),
        ('${R.otherPhoto}', '${B}', 'Photographer', null, false, 7, '{}', null);
      insert into members (chapter_id, user_id, role_ids) values
        ('${A}', '${U[0]}', '{${R.photo}}'),
        ('${A}', '${U[1]}', '{${R.photo},${R.chair}}'),
        ('${A}', '${U[2]}', '{${R.photo},${R.newMember}}'),
        ('${A}', '${U[3]}', '{${R.photo},${R.everyone}}'),
        ('${A}', '${U[4]}', '{${R.chair}}');
    `);

    const refusedSystem = await attempt(
      `select delete_role($1::uuid, $2::uuid) as r`,
      [A, R.everyone],
    );
    check(
      "a system role is refused as insufficient_privilege",
      refusedSystem.refused && refusedSystem.code === "42501",
      refusedSystem,
    );

    const foreign = await rows(`select delete_role($1::uuid, $2::uuid) as r`, [
      A,
      R.otherPhoto,
    ]);
    const otherStill = await rows(`select 1 from roles where id = $1`, [
      R.otherPhoto,
    ]);
    check(
      "another chapter's role answers null and stays",
      foreign[0].r === null && otherStill.length === 1,
      { foreign },
    );

    const [{ r: result }] = await rows(
      `select delete_role($1::uuid, $2::uuid) as r`,
      [A, R.photo],
    );
    check(
      "the role is gone",
      (await rows(`select 1 from roles where id = $1`, [R.photo])).length === 0,
      {},
    );
    check(
      "no member's role_ids still names it",
      (
        await rows(`select 1 from members where $1::text = any(role_ids)`, [
          R.photo,
        ])
      ).length === 0,
      {},
    );
    check(
      "a member whose only role it was holds Everyone",
      same(await rolesOf(U[0]), [R.everyone]),
      { roles: await rolesOf(U[0]) },
    );
    check(
      "a member with another access role keeps just that",
      same(await rolesOf(U[1]), [R.chair]),
      { roles: await rolesOf(U[1]) },
    );
    check(
      "a New Member is not given Everyone",
      same(await rolesOf(U[2]), [R.newMember]),
      { roles: await rolesOf(U[2]) },
    );
    check(
      "a member already holding Everyone gets no second copy",
      same(await rolesOf(U[3]), [R.everyone]),
      { roles: await rolesOf(U[3]) },
    );
    check(
      "a member who never held it is untouched",
      same(await rolesOf(U[4]), [R.chair]),
      {},
    );
    const memberId = async (user) =>
      (
        await rows(
          `select id::text from members where chapter_id = $1 and user_id = $2`,
          [A, user],
        )
      )[0].id;
    const stripped = await Promise.all(U.slice(0, 4).map(memberId));
    check(
      "it reports who lost the role and who was given Everyone",
      result?.role?.id === R.photo &&
        same([...result.stripped_member_ids].sort(), [...stripped].sort()) &&
        same(result.given_everyone_member_ids, [await memberId(U[0])]),
      { result },
    );

    const reorder = (ids) =>
      attempt(
        `select id from reorder_role_tiers($1::uuid, $2::uuid[], $3::uuid[])`,
        [A, ids, []],
      );
    const lifted = await reorder([T.exec, T.pledges, T.members]);
    check(
      "an order putting New members above Everyone is refused as 22023",
      lifted.refused && lifted.code === "22023",
      lifted,
    );
    const topped = await reorder([T.pledges, T.exec, T.members]);
    check(
      "so is one putting New members on top",
      topped.refused && topped.code === "22023",
      topped,
    );
    const fine = await reorder([T.members, T.exec, T.pledges]);
    check(
      "an order keeping New members below Everyone goes through",
      !fine.refused && fine.rows.length === 3,
      fine,
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
