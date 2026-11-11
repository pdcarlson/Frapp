import { readFileSync } from "node:fs";
import { join } from "node:path";

import { db, miss } from "../harness.mjs";

// ─── Functional: custom roles fold into ordinary roles (20261111200000) ─────
//
// Replay runs the fold against an empty `chapter_custom_roles`, so replay
// alone proves nothing about it. This tier seeds chapters holding both kinds
// of role, works out each member's effective permissions the way
// `PermissionsGuard` did before #4075 (their roles' permissions in the
// chapter, plus their custom roles' capabilities in the chapter without `*`),
// re-runs the same SQL, and checks:
//
//   - every member's effective permissions, now read from roles alone, are
//     exactly what they were;
//   - every custom role became a new role of its own, never an existing one
//     (not even a same-named role holding the same list), renamed "(custom)"
//     when the name is taken and cut to fit the 100-character cap;
//   - each new role holds exactly the capabilities without `*`, even in a
//     tier that grants more, and sits in the tier the header says (outside
//     the tiers with no permissions, or when the chapter has no tier at that
//     position);
//   - `role_ids` keeps the member's roles first and appends each folded role
//     once, dropping ids of deleted or foreign custom roles, and
//     `custom_role_ids` is emptied;
//   - a second run changes nothing, and a third, after an officer deletes a
//     folded role, does not bring it back;
//   - `transfer_presidency` still runs, reading roles alone.
//
// Everything runs inside one transaction and is rolled back.
console.log("\n=== Functional: fold custom roles (20261111200000) ===");
{
  const A = "a4075000-0000-4000-8000-00000000000a";
  const B = "b4075000-0000-4000-8000-00000000000b";
  const id = (n) => `e4075000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const R = {
    president: id(1),
    member: id(2),
    alumni: id(3),
    brothers: id(4),
    historian: id(5),
    bPresident: id(6),
  };
  const C = {
    social: id(11),
    brothers: id(12),
    historian: id(13),
    shadow: id(14),
    empty: id(15),
    alumni: id(16),
    historian2: id(17),
    rush: id(18),
    deleted: id(19),
    long: id(20),
  };
  const M = { m1: id(21), m2: id(22), m3: id(23), m4: id(24), m5: id(25) };
  // 95 characters, the name of an existing role: "(custom)" must not push
  // the folded role's name past 100.
  const LONG = "L".repeat(95);
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20261111200000_fold_custom_roles.sql",
    ),
    "utf8",
  );
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const rows = async (text, params = []) => (await db.query(text, params)).rows;
  const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // The pre-#4075 guard, as SQL: roles and custom roles, both in the chapter.
  const effectiveBefore = async () =>
    Object.fromEntries(
      (
        await rows(
          `select m.id,
                  coalesce((
                    select array_agg(distinct p order by p) from (
                      select unnest(r.permissions) as p
                        from roles r
                       where r.chapter_id = m.chapter_id
                         and r.id::text = any (select lower(x) from unnest(m.role_ids) x)
                      union
                      select unnest(c.capabilities)
                        from chapter_custom_roles c
                       where c.chapter_id = m.chapter_id
                         and c.id = any (m.custom_role_ids)
                    ) s where p <> '*' or exists (
                      select 1 from roles r
                       where r.chapter_id = m.chapter_id
                         and r.id::text = any (select lower(x) from unnest(m.role_ids) x)
                         and '*' = any (r.permissions)
                    )
                  ), '{}') as permissions
             from members m where m.chapter_id in ($1, $2) order by m.id`,
          [A, B],
        )
      ).map((r) => [r.id, r.permissions]),
    );
  // After #4075 the guard reads roles alone.
  const effectiveAfter = async () =>
    Object.fromEntries(
      (
        await rows(
          `select m.id,
                  coalesce((
                    select array_agg(distinct p order by p)
                      from roles r, unnest(r.permissions) p
                     where r.chapter_id = m.chapter_id
                       and r.id::text = any (select lower(x) from unnest(m.role_ids) x)
                  ), '{}') as permissions
             from members m where m.chapter_id in ($1, $2) order by m.id`,
          [A, B],
        )
      ).map((r) => [r.id, r.permissions]),
    );
  const snapshot = async () =>
    JSON.stringify(
      await rows(
        `select (select json_agg(r order by r.chapter_id, r.name)
                   from (select chapter_id, name, permissions, tier_id, permission_overrides
                           from roles where chapter_id in ($1, $2)) r) as roles,
                (select json_agg(m order by m.id)
                   from (select id, role_ids, custom_role_ids
                           from members where chapter_id in ($1, $2)) m) as members`,
        [A, B],
      ),
    );

  try {
    // Chapter A has the four starting tiers, granting what a real chapter's
    // do (Members holds the Member role's list), so a folded role that took
    // its tier's list would show up; Chapter B has none.
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${A}', 'A', 'U'), ('${B}', 'B', 'U');
      insert into role_tiers (chapter_id, position, name, permissions) values
        ('${A}', 1, 'Exec board', '{members:view,polls:create,events:create,roles:manage}'),
        ('${A}', 2, 'Officers and chairs', '{members:view,polls:create,events:create}'),
        ('${A}', 3, 'Members', '{members:view,polls:create}'), ('${A}', 4, 'New members', '{}');
      insert into roles (id, chapter_id, name, permissions, is_system, system_key, display_order) values
        ('${R.president}', '${A}', 'President', '{*}', true, 'PRESIDENT', 1),
        ('${R.member}', '${A}', 'Member', '{members:view,polls:create}', true, 'MEMBER', 5),
        ('${R.alumni}', '${A}', 'Alumni', '{}', true, 'ALUMNI', 7),
        ('${R.brothers}', '${A}', 'Brothers', '{members:view}', false, null, 20),
        ('${R.historian}', '${A}', 'Historian', '{chapter_docs:upload,members:view}', false, null, 21),
        ('${R.bPresident}', '${B}', 'President', '{*}', true, 'PRESIDENT', 1),
        ('${id(7)}', '${A}', '${LONG}', '{}', false, null, 22);
      insert into chapter_custom_roles (id, chapter_id, key, label, rank, capabilities) values
        ('${C.social}', '${A}', 'social', 'Social Chair', 1, '{events:create,members:view}'),
        ('${C.brothers}', '${A}', 'brothers', 'Brothers', 2, '{members:view}'),
        ('${C.historian}', '${A}', 'historian', 'Historian', 3, '{members:view}'),
        ('${C.shadow}', '${A}', 'shadow', ' Shadow ', 4, '{*,members:view}'),
        ('${C.empty}', '${A}', 'empty', 'Empty', 5, '{}'),
        ('${C.alumni}', '${A}', 'alumni', 'Alumni', 6, '{}'),
        ('${C.historian2}', '${A}', 'historian2', 'Historian', 7, '{polls:view_all}'),
        ('${C.rush}', '${B}', 'rush', 'Rush', 99, '{rush:view}'),
        ('${C.long}', '${A}', 'long', '${LONG}', 8, '{members:view}');
      insert into users (id, supabase_auth_id, email) values
        ('${id(31)}', gen_random_uuid(), 'm1@x.test'), ('${id(32)}', gen_random_uuid(), 'm2@x.test'),
        ('${id(33)}', gen_random_uuid(), 'm3@x.test'), ('${id(34)}', gen_random_uuid(), 'm4@x.test'),
        ('${id(35)}', gen_random_uuid(), 'm5@x.test');
      insert into members (id, user_id, chapter_id, role_ids, custom_role_ids) values
        ('${M.m1}', '${id(31)}', '${A}', '{${R.member}}', '{${C.social},${C.brothers},${C.social}}'),
        ('${M.m2}', '${id(32)}', '${A}', '{${R.brothers.toUpperCase()}}', '{${C.brothers}}'),
        ('${M.m3}', '${id(33)}', '${A}', '{${R.member}}', '{${C.rush},${C.deleted},${C.shadow}}'),
        ('${M.m4}', '${id(34)}', '${A}', '{${R.president}}', '{${C.empty},${C.alumni},${C.historian},${C.historian2}}'),
        ('${M.m5}', '${id(35)}', '${B}', '{}', '{${C.rush}}');
    `);

    const before = await effectiveBefore();
    await db.exec(sql);
    const after = await effectiveAfter();

    check(
      "every member's effective permissions are identical before and after",
      sameList(before, after),
      { before, after },
    );

    const folded = Object.fromEntries(
      (
        await rows(
          `select c.id, r.id as role_id, r.name, r.permissions, r.system_key,
                  t.position
             from chapter_custom_roles c
             left join roles r on r.id = c.folded_role_id
             left join role_tiers t on t.id = r.tier_id
            where c.chapter_id in ($1, $2)`,
          [A, B],
        )
      ).map((r) => [r.id, r]),
    );
    const expected = {
      [C.social]: ["Social Chair", ["events:create", "members:view"], 2],
      [C.brothers]: ["Brothers (custom)", ["members:view"], 3],
      [C.historian]: ["Historian (custom)", ["members:view"], 3],
      [C.shadow]: ["Shadow", ["members:view"], 3],
      [C.empty]: ["Empty", [], null],
      [C.alumni]: ["Alumni (custom)", [], null],
      [C.historian2]: ["Historian (custom 2)", ["polls:view_all"], 2],
      [C.rush]: ["Rush", ["rush:view"], null],
      [C.long]: [`${"L".repeat(91)} (custom)`, ["members:view"], 3],
    };
    const wrong = Object.entries(expected).filter(([cid, [name, perms, pos]]) => {
      const f = folded[cid];
      return (
        !f?.role_id ||
        f.name !== name ||
        !sameList(f.permissions, perms) ||
        (f.position ?? null) !== pos ||
        f.system_key !== null
      );
    });
    check(
      "each custom role became the role, name, list and tier the header says",
      wrong.length === 0,
      { wrong: wrong.map(([cid]) => folded[cid]) },
    );
    check(
      "a same-named role holding the same list is not reused: role ids drive events and mentions",
      Boolean(folded[C.brothers]?.role_id) &&
        folded[C.brothers].role_id !== R.brothers,
      folded[C.brothers],
    );

    const members = Object.fromEntries(
      (
        await rows(
          `select id, role_ids, custom_role_ids from members where chapter_id in ($1, $2)`,
          [A, B],
        )
      ).map((r) => [r.id, r]),
    );
    const roleOf = (cid) => folded[cid].role_id;
    check(
      "role_ids keeps the member's roles first and appends each folded role once",
      sameList(members[M.m1].role_ids, [
        R.member,
        roleOf(C.social),
        roleOf(C.brothers),
      ]) &&
        sameList(members[M.m2].role_ids, [
          R.brothers.toUpperCase(),
          roleOf(C.brothers),
        ]) &&
        sameList(members[M.m3].role_ids, [R.member, roleOf(C.shadow)]) &&
        sameList(members[M.m4].role_ids, [
          R.president,
          roleOf(C.empty),
          roleOf(C.alumni),
          roleOf(C.historian),
          roleOf(C.historian2),
        ]) &&
        sameList(members[M.m5].role_ids, [roleOf(C.rush)]),
      { members, folded },
    );
    check(
      "custom_role_ids is emptied on every member",
      Object.values(members).every((m) => m.custom_role_ids.length === 0),
      members,
    );

    const once = await snapshot();
    await db.exec(sql);
    check(
      "running it a second time changes nothing",
      (await snapshot()) === once,
      { once, twice: await snapshot() },
    );

    // An officer deletes a folded role; the planned re-run before the table
    // drop (#4194) must not bring it back.
    await db.query(`update members set role_ids = '{}' where id = $1`, [M.m5]);
    await db.query(`delete from roles where id = $1`, [roleOf(C.rush)]);
    await db.exec(sql);
    check(
      "a re-run does not bring back a folded role that was since deleted",
      (
        await rows(
          `select count(*)::int as n from roles where chapter_id = $1 and name = 'Rush'`,
          [B],
        )
      )[0].n === 0,
      await rows(`select name from roles where chapter_id = $1`, [B]),
    );

    const transfer = await rows(
      `select id, role_ids from transfer_presidency($1, $2, $3, $4)`,
      [A, M.m4, M.m1, R.president],
    );
    const out = transfer.find((r) => r.id === M.m4)?.role_ids;
    // The folded "Historian (custom)" carries members:view, so the outgoing
    // President keeps access through it and is not given Member.
    check(
      "transfer_presidency counts a folded role as member access",
      sameList(out, [
        roleOf(C.empty),
        roleOf(C.alumni),
        roleOf(C.historian),
        roleOf(C.historian2),
      ]),
      transfer,
    );
  } catch (e) {
    check(
      "fold custom roles scenario ran",
      false,
      String(e?.message ?? e).split("\n")[0],
    );
  } finally {
    await db.exec("rollback;").catch(() => {});
  }

  for (const res of results) {
    if (res.ok) {
      console.log(`OK    ${res.name}`);
    } else {
      miss();
      console.log(`MISS  ${res.name}\n        ↳ ${JSON.stringify(res.detail)}`);
    }
  }
}
