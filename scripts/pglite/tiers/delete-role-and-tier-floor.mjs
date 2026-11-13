import { readFileSync } from "node:fs";
import { join } from "node:path";
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
    alumni: "a4547000-0000-4000-8000-0000000000c4",
  };
  const R = {
    everyone: "a4547000-0000-4000-8000-0000000000e1",
    newMember: "a4547000-0000-4000-8000-0000000000e2",
    chair: "a4547000-0000-4000-8000-0000000000e3",
    photo: "a4547000-0000-4000-8000-0000000000e4",
    alumni: "a4547000-0000-4000-8000-0000000000e6",
    president: "a4547000-0000-4000-8000-0000000000e5",
    otherPhoto: "b4547000-0000-4000-8000-0000000000e4",
  };
  const U = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(
    (n) => `a4547000-0000-4000-8000-00000000000${n}`,
  );
  // A stored id may be an upper-case copy (rbac.service.ts reads them
  // lower-cased), so the function compares lower-cased too.
  const up = (id) => id.toUpperCase();
  const repairSql = (() => {
    const file = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20261113164050_delete_role_and_tier_floor.sql",
      ),
      "utf8",
    );
    return file.slice(file.indexOf("-- 3. Repair"));
  })();
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
        ('${T.pledges}', '${A}', 3, 'New members', '{}'),
        ('${T.alumni}', '${A}', 4, 'Alumni', '{}');
      insert into roles (id, chapter_id, name, system_key, is_system, display_order, permissions, tier_id) values
        ('${R.president}', '${A}', 'President', 'PRESIDENT', true, 1, '{*}', '${T.exec}'),
        ('${R.chair}', '${A}', 'Chair', null, false, 2, '{members:view}', '${T.exec}'),
        ('${R.everyone}', '${A}', 'Everyone', 'MEMBER', true, 5, '{members:view}', '${T.members}'),
        ('${R.newMember}', '${A}', 'New Member', 'NEW_MEMBER', true, 6, '{}', '${T.pledges}'),
        ('${R.alumni}', '${A}', 'Alumni', 'ALUMNI', true, 8, '{}', '${T.alumni}'),
        ('${R.photo}', '${A}', 'Photographer', null, false, 7, '{}', null),
        ('${R.otherPhoto}', '${B}', 'Photographer', null, false, 7, '{}', null);
      insert into members (chapter_id, user_id, role_ids) values
        ('${A}', '${U[0]}', '{${R.photo}}'),
        ('${A}', '${U[1]}', '{${R.photo},${R.chair}}'),
        ('${A}', '${U[2]}', '{${R.photo},${R.newMember}}'),
        ('${A}', '${U[3]}', '{${R.photo},${R.everyone}}'),
        ('${A}', '${U[4]}', '{${R.chair}}'),
        ('${A}', '${U[5]}', '{${R.photo},${R.president}}'),
        ('${A}', '${U[6]}', '{${up(R.photo)},${R.chair}}'),
        ('${A}', '${U[7]}', '{${R.photo},${up(R.everyone)}}');
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
      "a New Member is not given Everyone, though New Member grants no access",
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
    check(
      "a member left with a wildcard role is not given Everyone",
      same(await rolesOf(U[5]), [R.president]),
      { roles: await rolesOf(U[5]) },
    );
    check(
      "an upper-case copy of the deleted id is stripped too",
      same(await rolesOf(U[6]), [R.chair]),
      { roles: await rolesOf(U[6]) },
    );
    check(
      "an upper-case Everyone counts as held, so no second copy",
      same(await rolesOf(U[7]), [up(R.everyone)]),
      { roles: await rolesOf(U[7]) },
    );
    const stripped = await Promise.all(
      [0, 1, 2, 3, 5, 6, 7].map((i) => memberId(U[i])),
    );
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
    const lifted = await reorder([T.exec, T.pledges, T.members, T.alumni]);
    check(
      "an order lifting New members above Everyone is refused as 22023",
      lifted.refused && lifted.code === "22023",
      lifted,
    );
    const topped = await reorder([T.alumni, T.exec, T.members, T.pledges]);
    check(
      "so is one lifting Alumni to the top",
      topped.refused && topped.code === "22023",
      topped,
    );
    const fine = await reorder([T.members, T.exec, T.pledges, T.alumni]);
    check(
      "an order keeping New members and Alumni below Everyone goes through",
      !fine.refused && fine.rows.length === 4,
      fine,
    );

    // A chapter already in violation (a reorder from before the floor, or a
    // role moved before the API refused it) can still reorder, and bring the
    // tier down step by step.
    await db.exec(`
      update role_tiers set position = case id
        when '${T.pledges}' then 1 when '${T.exec}' then 2
        when '${T.members}' then 3 when '${T.alumni}' then 4 end
       where chapter_id = '${A}';
    `);
    // Now [New members, Exec, Members, Alumni].
    const stillAbove = await reorder([T.exec, T.pledges, T.members, T.alumni]);
    check(
      "a chapter already in violation can still reorder, the tier still above",
      !stillAbove.refused,
      stillAbove,
    );
    const lowered = await reorder([T.exec, T.members, T.pledges, T.alumni]);
    check(
      "and can bring New members down below Everyone",
      !lowered.refused,
      lowered,
    );
    await db.exec(`
      update role_tiers set position = case id
        when '${T.pledges}' then 1 when '${T.exec}' then 2
        when '${T.members}' then 3 when '${T.alumni}' then 4 end
       where chapter_id = '${A}';
    `);
    const alumniUp = await reorder([T.pledges, T.exec, T.alumni, T.members]);
    check(
      "but may not lift another keyed tier above Everyone meanwhile",
      alumniUp.refused && alumniUp.code === "22023",
      alumniUp,
    );

    // The one-time repair (section 3), re-run against stale rows, as
    // members-keep-base-role.mjs re-runs its migration: replay alone runs it
    // on an empty table.
    const STALE = "deadbeef-0000-4000-8000-000000004547";
    await db.exec(`
      update members set role_ids = '{${STALE}}'
       where chapter_id = '${A}' and user_id = '${U[0]}';
      update members set role_ids = '{${STALE},${up(R.chair)}}'
       where chapter_id = '${A}' and user_id = '${U[1]}';
      update members set role_ids = '{${STALE},${R.newMember}}'
       where chapter_id = '${A}' and user_id = '${U[2]}';
      insert into members (chapter_id, user_id, role_ids) values
        ('${B}', '${U[8]}', '{${R.chair}}');
    `);
    await db.exec(repairSql);
    check(
      "the repair gives Everyone to a member whose only id was stale",
      same(await rolesOf(U[0]), [R.everyone]),
      { roles: await rolesOf(U[0]) },
    );
    check(
      "it keeps a live id stored upper-case, so no Everyone",
      same(await rolesOf(U[1]), [up(R.chair)]),
      { roles: await rolesOf(U[1]) },
    );
    check(
      "it gives a New Member no Everyone",
      same(await rolesOf(U[2]), [R.newMember]),
      { roles: await rolesOf(U[2]) },
    );
    const crossChapter = (
      await rows(
        `select role_ids::text[] as ids from members where chapter_id = $1 and user_id = $2`,
        [B, U[8]],
      )
    )[0].ids;
    check(
      "it strips an id naming another chapter's role",
      same(crossChapter, []),
      { crossChapter },
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
