import { readFileSync } from "node:fs";
import { join } from "node:path";

import { db, miss } from "../harness.mjs";

// ─── Functional: members keep the Member role (20261107020000) ──────────────
//
// 20261107020000 gives the chapter's Member role to members whose roles carry
// no member access. Replay runs it against an empty table, so replay alone
// proves nothing; this tier re-runs it against seeded rows and checks:
//
//   - a member holding only a custom role without `members:view` gets Member,
//     appended after the role they held;
//   - a custom role that grants `members:view` (or `*`), any seeded role, a
//     member with no roles, and a member whose ids all point at deleted roles
//     are left alone;
//   - a seeded role id from ANOTHER chapter doesn't count as access, the way
//     `PermissionsGuard` reads it;
//   - running it a second time changes nothing.
//
// Everything runs inside one transaction and is rolled back.
console.log(
  "\n=== Functional: members keep the Member role (20261107020000) ===",
);
{
  const A = "a3707000-0000-4000-8000-00000000000a";
  const B = "b3707000-0000-4000-8000-00000000000b";
  const MEMBER_A = "a3707000-0000-4000-8000-0000000000a1";
  const CABINET_A = "a3707000-0000-4000-8000-0000000000a2";
  const GUEST_A = "a3707000-0000-4000-8000-0000000000a3";
  const PLEDGE_A = "a3707000-0000-4000-8000-0000000000a4";
  const MEMBER_B = "b3707000-0000-4000-8000-0000000000b1";
  const GONE = "d3707000-0000-4000-8000-0000000000d1";
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20261107020000_members_keep_base_role.sql",
    ),
    "utf8",
  );
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const rolesOf = async (memberId) =>
    (await db.query(`select role_ids from members where id = $1`, [memberId]))
      .rows[0]?.role_ids;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const m = (n) => `e3707000-0000-4000-8000-00000000000${n}`;
  const u = (n) => `f3707000-0000-4000-8000-00000000000${n}`;

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${A}', 'A', 'U'), ('${B}', 'B', 'U');
      insert into roles (id, chapter_id, name, permissions, is_system, system_key, display_order) values
        ('${MEMBER_A}', '${A}', 'Member', '{members:view,polls:create}', true, 'MEMBER', 5),
        ('${CABINET_A}', '${A}', 'Cabinet', '{channels:read:cabinet}', false, null, 21),
        ('${GUEST_A}', '${A}', 'Rush Guest', '{members:view,channels:read:rush}', false, null, 22),
        ('${PLEDGE_A}', '${A}', 'Pledge', '{backwork:upload}', true, null, 6),
        ('${MEMBER_B}', '${B}', 'Member', '{members:view}', true, 'MEMBER', 5);
      insert into users (id, supabase_auth_id, email) values
        ${[1, 2, 3, 4, 5, 6, 7].map((n) => `('${u(n)}', gen_random_uuid(), 'u${n}@x.test')`).join(",\n        ")};
      insert into members (id, user_id, chapter_id, role_ids) values
        ('${m(1)}', '${u(1)}', '${A}', '{${CABINET_A}}'),
        ('${m(2)}', '${u(2)}', '${A}', '{${GUEST_A}}'),
        ('${m(3)}', '${u(3)}', '${A}', '{${PLEDGE_A}}'),
        ('${m(4)}', '${u(4)}', '${A}', '{}'),
        ('${m(5)}', '${u(5)}', '${A}', '{${GONE}}'),
        ('${m(6)}', '${u(6)}', '${A}', '{${CABINET_A},${MEMBER_B}}'),
        ('${m(7)}', '${u(7)}', '${A}', '{${MEMBER_A},${CABINET_A}}');
    `);

    await db.exec(sql);
    check(
      "a custom role with no member access gets Member, after it",
      same(await rolesOf(m(1)), [CABINET_A, MEMBER_A]),
      { got: await rolesOf(m(1)) },
    );
    check(
      "a custom role that grants members:view is left alone",
      same(await rolesOf(m(2)), [GUEST_A]),
      { got: await rolesOf(m(2)) },
    );
    check(
      "a seeded role renamed before system_key existed is left alone",
      same(await rolesOf(m(3)), [PLEDGE_A]),
      { got: await rolesOf(m(3)) },
    );
    check(
      "no roles, and only deleted roles, are left alone",
      same(await rolesOf(m(4)), []) && same(await rolesOf(m(5)), [GONE]),
      { none: await rolesOf(m(4)), deleted: await rolesOf(m(5)) },
    );
    check(
      "another chapter's Member id doesn't count as access",
      same(await rolesOf(m(6)), [CABINET_A, MEMBER_B, MEMBER_A]),
      { got: await rolesOf(m(6)) },
    );
    check(
      "a member who already holds Member is untouched",
      same(await rolesOf(m(7)), [MEMBER_A, CABINET_A]),
      { got: await rolesOf(m(7)) },
    );

    const snapshot = async () =>
      (
        await db.query(
          `select string_agg(id::text || array_to_string(role_ids, ','), '|' order by id) as s
           from members where chapter_id = $1`,
          [A],
        )
      ).rows[0].s;
    const before = await snapshot();
    await db.exec(sql);
    const after = await snapshot();
    check(
      "running it twice changes nothing the second time",
      before === after,
      {
        before,
        after,
      },
    );
  } catch (e) {
    check(
      "members keep the Member role scenario ran",
      false,
      String(e?.message ?? e).split("\n")[0],
    );
  } finally {
    await db.exec("rollback;").catch(() => {});
  }

  for (const r of results) {
    if (r.ok) {
      console.log(`OK    ${r.name}`);
    } else {
      miss();
      console.log(`MISS  ${r.name}\n        ↳ ${JSON.stringify(r.detail)}`);
    }
  }
}
