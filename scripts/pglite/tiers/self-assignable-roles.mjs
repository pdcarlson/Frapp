import { db, miss } from "../harness.mjs";

// ─── Functional: self-assignable roles (20261114043300) ──────────────────────
//
// #4958: officers mark a role members may join and leave themselves. A role
// is pickable only while `role_self_assignable_safe` holds (no system key,
// outside the tiers, no permission beyond `channels:read:<slug>`), so nobody
// picks their way into power or into presidency's claim walk.
//
// This tier proves the database half of that rule:
//   - the trigger clears the flag on any write that leaves the role unsafe,
//     whoever writes it, and leaves a safe role's flag alone;
//   - `self_assign_role` adds and removes only a flagged, safe role of the
//     member's own chapter, keeps every other id where it was, and writes
//     nothing for a no-op;
//   - it takes the role's lock before the member's, the order `delete_role`
//     and `set_member_role_ids` take them. PGlite is one connection, so the
//     lock itself can't be waited on here; the tier checks the function
//     still takes it, as `set-member-role-ids.mjs` does.
//
// Everything runs inside one transaction and is rolled back.
console.log("\n=== Functional: self-assignable roles (20261114043300) ===");
{
  const A = "a4958000-0000-4000-8000-00000000000a";
  const B = "b4958000-0000-4000-8000-00000000000b";
  const TIER = "a4958000-0000-4000-8000-0000000000f1";
  const R = {
    everyone: "a4958000-0000-4000-8000-0000000000e1",
    intramurals: "a4958000-0000-4000-8000-0000000000e2",
    study: "a4958000-0000-4000-8000-0000000000e3",
    chair: "a4958000-0000-4000-8000-0000000000e4",
    other: "b4958000-0000-4000-8000-0000000000e1",
  };
  const U = [1, 2].map((n) => `a4958000-0000-4000-8000-00000000000${n}`);
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const rows = async (text, params = []) => (await db.query(text, params)).rows;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const flag = async (roleId) =>
    (await rows(`select self_assignable from roles where id = $1`, [roleId]))[0]
      ?.self_assignable;
  const ids = async (user) =>
    (
      await rows(
        `select role_ids::text[] as ids from members where chapter_id = $1 and user_id = $2`,
        [A, user],
      )
    )[0]?.ids;
  const memberId = async (user) =>
    (
      await rows(
        `select id::text from members where chapter_id = $1 and user_id = $2`,
        [A, user],
      )
    )[0].id;
  const assign = async (member, role, join, chapter = A) =>
    (
      await rows(
        `select outcome, role_ids::text[] as ids
           from self_assign_role($1::uuid, $2::uuid, $3::uuid, $4::boolean)`,
        [chapter, member, role, join],
      )
    )[0];

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values
        ('${A}', 'A4958', 'U'), ('${B}', 'B4958', 'U');
      insert into users (id, supabase_auth_id, email) values
        ${U.map((u, i) => `('${u}', gen_random_uuid(), 'u4958-${i}@x.test')`).join(",\n        ")};
      insert into role_tiers (id, chapter_id, position, name, permissions) values
        ('${TIER}', '${A}', 1, 'Officers', '{}');
      insert into roles (id, chapter_id, name, system_key, is_system, display_order, permissions, self_assignable) values
        ('${R.everyone}', '${A}', 'Everyone', 'MEMBER', true, 5, '{members:view}', true),
        ('${R.intramurals}', '${A}', 'Intramurals', null, false, 7, '{}', true),
        ('${R.study}', '${A}', 'Study group', null, false, 8, '{channels:read:study}', true),
        ('${R.chair}', '${A}', 'Chair', null, false, 2, '{members:view}', true),
        ('${R.other}', '${B}', 'Other', null, false, 7, '{}', true);
      insert into members (chapter_id, user_id, role_ids) values
        ('${A}', '${U[0]}', '{${R.everyone}}');
    `);

    check(
      "a keyed role can't be inserted self-assignable",
      (await flag(R.everyone)) === false,
    );
    check(
      "a role holding a real permission can't be inserted self-assignable",
      (await flag(R.chair)) === false,
    );
    check(
      "a role outside the tiers with no permissions keeps the flag",
      (await flag(R.intramurals)) === true,
    );
    check(
      "so does one holding only channels:read:<slug>",
      (await flag(R.study)) === true,
    );

    // Join, rejoin, leave.
    const m = await memberId(U[0]);
    const joined = await assign(m, R.intramurals, true);
    check(
      "a member joins a flagged role, after what they held",
      joined.outcome === "ok" &&
        same(await ids(U[0]), [R.everyone, R.intramurals]),
      { joined, after: await ids(U[0]) },
    );
    await db.exec(
      `update members set role_ids = array['${R.everyone}', upper('${R.intramurals}')] where user_id = '${U[0]}'`,
    );
    const rejoin = await assign(m, R.intramurals, true);
    check(
      "joining a role already held (in any case) changes nothing",
      rejoin.outcome === "ok" &&
        same(await ids(U[0]), [R.everyone, R.intramurals.toUpperCase()]),
      { rejoin, after: await ids(U[0]) },
    );
    const left = await assign(m, R.intramurals, false);
    check(
      "leaving takes it off, whatever its case, and keeps Everyone",
      left.outcome === "ok" && same(await ids(U[0]), [R.everyone]),
      { left, after: await ids(U[0]) },
    );

    // Refusals.
    for (const [name, role] of [
      ["a keyed role", R.everyone],
      ["a role with a real permission", R.chair],
      ["another chapter's role", R.other],
      ["a role that doesn't exist", "a4958000-0000-4000-8000-0000000000ff"],
    ]) {
      const join = await assign(m, role, true);
      const leave = await assign(m, role, false);
      check(
        `${name} is refused both ways`,
        join.outcome === "not_assignable" &&
          leave.outcome === "not_assignable" &&
          same(await ids(U[0]), [R.everyone]),
        { join, leave, after: await ids(U[0]) },
      );
    }
    const noMember = await assign(m, R.other, true, B);
    check(
      "a member of another chapter is not written",
      noMember.outcome === "no_member" && same(await ids(U[0]), [R.everyone]),
      { noMember },
    );

    // The trigger clears the flag whoever makes the role unsafe.
    await rows(
      `update roles set permissions = '{channels:read:study,events:update}' where id = $1`,
      [R.study],
    );
    check(
      "gaining a real permission clears the flag",
      (await flag(R.study)) === false,
    );
    await rows(
      `update roles set permissions = '{}', self_assignable = true where id = $1`,
      [R.study],
    );
    check(
      "and the flag can be set again once it's safe",
      (await flag(R.study)) === true,
    );
    await rows(`update roles set tier_id = $2 where id = $1`, [R.study, TIER]);
    check(
      "moving into a tier, even an empty one, clears it",
      (await flag(R.study)) === false,
    );
    await rows(
      `update roles set permission_overrides = '{"events:create": true}' where id = $1`,
      [R.intramurals],
    );
    check(
      "an override switched on clears it, judged on the rewritten list",
      (await flag(R.intramurals)) === false,
    );
    const afterUnflag = await assign(m, R.intramurals, true);
    check(
      "and a role that lost its flag can't be joined",
      afterUnflag.outcome === "not_assignable",
      { afterUnflag },
    );

    const [{ src }] = await rows(
      `select prosrc as src from pg_proc where proname = 'self_assign_role'`,
    );
    const roleLock = src.search(
      /from\s+public\.roles\s+r[^;]*for\s+share\s*;/i,
    );
    const memberLock = src.search(
      /from\s+public\.members\s+m[^;]*for\s+update\s*;/i,
    );
    check(
      "it share-locks the role before it locks the member row",
      roleLock !== -1 && memberLock !== -1 && roleLock < memberLock,
      { roleLock, memberLock },
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
