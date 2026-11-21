import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db, miss } from "../harness.mjs";

// ─── Functional: the Everyone floor and Actives (20261121001050) ────────────
//
// #5802: the `MEMBER`-keyed row becomes Actives, a new `EVERYONE` row outside
// the tiers carries `members:view` only, every member holds it, a default
// invite role naming the old row is cleared, and a trigger keeps Everyone on
// every member row. The migration ran on an empty database before the tiers,
// so this replays its backfill against seeded chapters, twice, to show it is
// idempotent.
//
// Everything runs inside one transaction and is rolled back.
console.log(
  "\n=== Functional: the Everyone floor and Actives (20261121001050) ===",
);
{
  const A = "a5802000-0000-4000-8000-00000000000a";
  const B = "b5802000-0000-4000-8000-00000000000b";
  const T = "a5802000-0000-4000-8000-0000000000c1";
  const R = {
    member: "a5802000-0000-4000-8000-0000000000e1",
    taken: "a5802000-0000-4000-8000-0000000000e2",
    chair: "a5802000-0000-4000-8000-0000000000e3",
    memberB: "b5802000-0000-4000-8000-0000000000e1",
  };
  const U = [1, 2, 3, 4].map((n) => `a5802000-0000-4000-8000-00000000000${n}`);
  const backfillSql = (() => {
    const file = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20261121001050_everyone_floor_actives.sql",
      ),
      "utf8",
    );
    return file.slice(
      file.indexOf("do $$"),
      file.indexOf("-- 5. Every member row"),
    );
  })();
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const rows = async (text, params = []) => (await db.query(text, params)).rows;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const rolesOf = async (user) =>
    (
      await rows(
        `select role_ids::text[] as ids from members where chapter_id = $1 and user_id = $2`,
        [A, user],
      )
    )[0].ids;
  const everyoneOf = async (chapter) =>
    rows(
      `select id::text, name, tier_id, permissions::text[] as permissions,
              mentionable, is_system
         from roles where chapter_id = $1 and system_key = 'EVERYONE'`,
      [chapter],
    );

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values
        ('${A}', 'A5802', 'U'), ('${B}', 'B5802', 'U');
      insert into users (id, supabase_auth_id, email) values
        ${U.map((u, i) => `('${u}', gen_random_uuid(), 'u5802-${i}@x.test')`).join(",\n        ")};
      insert into role_tiers (id, chapter_id, position, name, permissions) values
        ('${T}', '${A}', 1, 'Members', '{members:view}');
      insert into roles (id, chapter_id, name, system_key, is_system, display_order, permissions, tier_id, mentionable) values
        ('${R.member}', '${A}', 'Everyone', 'MEMBER', true, 5, '{members:view}', '${T}', true),
        ('${R.taken}', '${A}', 'Actives', null, false, 6, '{}', null, true),
        ('${R.chair}', '${A}', 'Chair', null, false, 2, '{members:view}', null, true),
        ('${R.memberB}', '${B}', 'Everyone', 'MEMBER', true, 5, '{members:view}', null, false);
      insert into members (chapter_id, user_id, role_ids) values
        ('${A}', '${U[0]}', '{${R.member}}'),
        ('${A}', '${U[1]}', '{${R.chair}}'),
        ('${A}', '${U[2]}', '{}');
      update chapters set default_invite_role_id = '${R.member}' where id = '${A}';
    `);

    await db.exec(backfillSql);

    const [old] = await rows(
      `select name, mentionable, tier_id::text, permissions::text[] as permissions
         from roles where id = $1`,
      [R.member],
    );
    check(
      "the old row is renamed, around a role already called Actives, and keeps its tier",
      old.name === "Actives (base)" &&
        old.mentionable === true &&
        old.tier_id === T &&
        same(old.permissions, ["members:view"]),
      old,
    );
    const [ourB] = await rows(`select name from roles where id = $1`, [
      R.memberB,
    ]);
    check("a chapter with no clash calls it Actives", ourB.name === "Actives", {
      ourB,
    });

    const everyoneA = await everyoneOf(A);
    const e = everyoneA[0];
    check(
      "a new Everyone row sits outside the tiers with members:view only",
      everyoneA.length === 1 &&
        e.name === "Everyone" &&
        e.tier_id === null &&
        e.is_system === true &&
        same(e.permissions, ["members:view"]),
      { everyoneA },
    );
    check(
      "it takes the old row's @everyone switch",
      e?.mentionable === true &&
        (await everyoneOf(B))[0]?.mentionable === false,
      { a: e?.mentionable, b: (await everyoneOf(B))[0]?.mentionable },
    );
    check(
      "a holder of the old row is an active and holds Everyone last",
      same(await rolesOf(U[0]), [R.member, e.id]),
      { roles: await rolesOf(U[0]) },
    );
    check(
      "a chair holds Everyone and is not made an active",
      same(await rolesOf(U[1]), [R.chair, e.id]),
      { roles: await rolesOf(U[1]) },
    );
    check(
      "a member with no role holds Everyone alone",
      same(await rolesOf(U[2]), [e.id]),
      { roles: await rolesOf(U[2]) },
    );
    const [{ d }] = await rows(
      `select default_invite_role_id::text as d from chapters where id = $1`,
      [A],
    );
    check("a default invite role naming the old row is cleared", d === null, {
      d,
    });

    await db.exec(backfillSql);
    check(
      "a second run adds no second Everyone and no second copy",
      (await everyoneOf(A)).length === 1 &&
        same(await rolesOf(U[0]), [R.member, e.id]),
      { roles: await rolesOf(U[0]) },
    );

    await rows(
      `insert into members (chapter_id, user_id, role_ids) values ($1, $2, $3)`,
      [A, U[3], [R.chair]],
    );
    check(
      "the trigger gives a new member row Everyone",
      same(await rolesOf(U[3]), [R.chair, e.id]),
      { roles: await rolesOf(U[3]) },
    );
    await rows(
      `update members set role_ids = $3 where chapter_id = $1 and user_id = $2`,
      [A, U[1], [R.member]],
    );
    check(
      "a role save that leaves Everyone out gets it back",
      same(await rolesOf(U[1]), [R.member, e.id]),
      { roles: await rolesOf(U[1]) },
    );
    await rows(
      `update members set role_ids = $3 where chapter_id = $1 and user_id = $2`,
      [A, U[1], [e.id.toUpperCase()]],
    );
    check(
      "an upper-case Everyone counts as held, so no second copy",
      same(await rolesOf(U[1]), [e.id.toUpperCase()]),
      { roles: await rolesOf(U[1]) },
    );

    const [{ r: deleted }] = await rows(
      `select delete_role($1::uuid, $2::uuid) as r`,
      [A, R.chair],
    );
    check(
      "deleting a member's only other role leaves them Everyone, and hands out nothing",
      same(await rolesOf(U[3]), [e.id]) &&
        same(deleted?.given_everyone_member_ids, []),
      { roles: await rolesOf(U[3]), deleted },
    );
  } catch (err) {
    check("the tier ran to the end", false, {
      error: String(err?.message ?? err).split("\n")[0],
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
