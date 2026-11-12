import { readFileSync } from "node:fs";
import { join } from "node:path";

import { db, miss } from "../harness.mjs";
import { setAuth } from "../probe.mjs";

// ─── Functional: groups and pingable tiers (20261113040002, #4076) ─────────
//
// Replay runs the migration against empty tables, so replay alone proves
// nothing about its triggers, its view or its backfills. This tier seeds a
// chapter and checks:
//
//   - a pledge class gets a group, renamed with it and deleted with it;
//   - a member's graduation year gets a class-year group in their chapter,
//     when they join and when they set it, and a typo'd year gets none;
//   - `chapter_group_memberships` holds a manual group's picked members, a
//     pledge class's members and a year's members, and follows a member's
//     class and year the moment they change;
//   - only a manual group takes hand-picked members, and a member who leaves
//     the chapter leaves its groups;
//   - a channel list takes `group:<id>`, `can_read_chat_channel` admits the
//     group's members and nobody else, and deleting the group (or its pledge
//     class) takes the entry off every list;
//   - a tier is pingable by default;
//   - `groups:manage` reaches every tier and role that manages roles or
//     channels, and a second run of the file changes nothing.
//
// Everything runs inside one transaction and is rolled back.
console.log("\n=== Functional: groups and pingable tiers (20261113040002) ===");
{
  const CH = "a4076000-0000-4000-8000-00000000000a";
  const T_EXEC = "a4076000-0000-4000-8000-0000000000e1";
  const T_MEMBERS = "a4076000-0000-4000-8000-0000000000e3";
  const R_PRES = "a4076000-0000-4000-8000-000000000001";
  const R_CHAIR = "a4076000-0000-4000-8000-000000000002";
  const R_BRO = "a4076000-0000-4000-8000-000000000005";
  const R_SOLO = "a4076000-0000-4000-8000-000000000006";
  const PC_ALPHA = "a4076000-0000-4000-8000-0000000000c1";
  const U = (n) => `a4076000-0000-4000-8000-0000000000a${n}`;
  const A = (n) => `a4076000-0000-4000-8000-0000000000b${n}`;
  const CHAN = "a4076000-0000-4000-8000-0000000c0001";
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20261113040002_chapter_groups.sql",
    ),
    "utf8",
  );
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const rows = async (text, params = []) => (await db.query(text, params)).rows;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const refused = async (text, params = []) => {
    await db.exec("savepoint expect_refusal");
    try {
      await db.query(text, params);
      await db.exec("release savepoint expect_refusal");
      return false;
    } catch {
      await db.exec("rollback to savepoint expect_refusal");
      return true;
    }
  };
  const groups = async () =>
    rows(
      `select kind, name, pledge_class_id, class_year
         from chapter_groups where chapter_id = $1
        order by kind, name`,
      [CH],
    );
  const membersOf = async (groupId) =>
    (
      await rows(
        `select user_id from chapter_group_memberships
          where group_id = $1 order by user_id`,
        [groupId],
      )
    ).map((r) => r.user_id);
  const groupId = async (where, params) =>
    (await rows(`select id from chapter_groups where ${where}`, params))[0]
      ?.id;
  const canRead = async (auth) => {
    await setAuth({ uid: auth, jwtRole: "authenticated" });
    const ok = (await rows(`select can_read_chat_channel($1) as ok`, [CHAN]))[0]
      .ok;
    await setAuth({ uid: null, jwtRole: "service_role" });
    return ok;
  };

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${CH}', 'Groups', 'U');
      insert into role_tiers (id, chapter_id, position, name, permissions) values
        ('${T_EXEC}', '${CH}', 1, 'Exec board', '{roles:manage,members:view}'),
        ('${T_MEMBERS}', '${CH}', 2, 'Members', '{members:view}');
      insert into roles (id, chapter_id, name, system_key, tier_id, display_order, permission_overrides) values
        ('${R_PRES}', '${CH}', 'President', 'PRESIDENT', '${T_EXEC}', 1, '{"*": true}'),
        ('${R_CHAIR}', '${CH}', 'House manager', null, '${T_MEMBERS}', 2, '{"channels:manage": true}'),
        ('${R_BRO}', '${CH}', 'Brother', 'MEMBER', '${T_MEMBERS}', 5, '{}'),
        ('${R_SOLO}', '${CH}', 'Advisor', null, null, 6, '{"roles:manage": true}');
      insert into users (id, supabase_auth_id, email, graduation_year) values
        ('${U(1)}', '${A(1)}', 'one@test.local', 2027),
        ('${U(2)}', '${A(2)}', 'two@test.local', 2028),
        ('${U(3)}', '${A(3)}', 'three@test.local', 20027);
      insert into chapter_pledge_classes (id, chapter_id, name, position) values
        ('${PC_ALPHA}', '${CH}', 'Alpha', 1);
      insert into members (user_id, chapter_id, role_ids, pledge_class_id) values
        ('${U(1)}', '${CH}', '{${R_BRO}}', '${PC_ALPHA}'),
        ('${U(2)}', '${CH}', '{${R_BRO}}', null),
        ('${U(3)}', '${CH}', '{${R_BRO}}', null);
    `);

    check(
      "a pledge class and each member's year get a group; a typo'd year gets none",
      same(await groups(), [
        {
          kind: "class_year",
          name: "Class of 2027",
          pledge_class_id: null,
          class_year: 2027,
        },
        {
          kind: "class_year",
          name: "Class of 2028",
          pledge_class_id: null,
          class_year: 2028,
        },
        {
          kind: "pledge_class",
          name: "Alpha",
          pledge_class_id: PC_ALPHA,
          class_year: null,
        },
      ]),
      await groups(),
    );

    await db.query(
      `update chapter_pledge_classes set name = 'Alpha Alpha' where id = $1`,
      [PC_ALPHA],
    );
    const alpha = await groupId(`pledge_class_id = $1`, [PC_ALPHA]);
    const alphaName = (
      await rows(`select name from chapter_groups where id = $1`, [alpha])
    )[0]?.name;
    check("a renamed pledge class renames its group", alphaName === "Alpha Alpha", {
      alphaName,
    });

    const y2027 = await groupId(`chapter_id = $1 and class_year = 2027`, [CH]);
    const y2028 = await groupId(`chapter_id = $1 and class_year = 2028`, [CH]);
    const before = {
      alpha: await membersOf(alpha),
      y2027: await membersOf(y2027),
      y2028: await membersOf(y2028),
    };
    // The data changes: U2 joins Alpha, U1 moves to 2028, U3 fixes their year.
    await db.query(`update members set pledge_class_id = $1 where user_id = $2`, [
      PC_ALPHA,
      U(2),
    ]);
    await db.query(`update users set graduation_year = 2028 where id = $1`, [
      U(1),
    ]);
    await db.query(`update users set graduation_year = 2029 where id = $1`, [
      U(3),
    ]);
    const y2029 = await groupId(`chapter_id = $1 and class_year = 2029`, [CH]);
    const after = {
      alpha: await membersOf(alpha),
      y2027: await membersOf(y2027),
      y2028: await membersOf(y2028),
      y2029: y2029 ? await membersOf(y2029) : null,
    };
    check(
      "automatic groups follow a member's class and year the moment they change",
      same(before, { alpha: [U(1)], y2027: [U(1)], y2028: [U(2)] }) &&
        same(after, {
          alpha: [U(1), U(2)],
          y2027: [],
          y2028: [U(1), U(2)],
          y2029: [U(3)],
        }),
      { before, after },
    );

    // A manual group and its members.
    const floor = (
      await rows(
        `insert into chapter_groups (chapter_id, kind, name) values ($1, 'manual', 'Third floor') returning id`,
        [CH],
      )
    )[0].id;
    await db.query(
      `insert into chapter_group_members (group_id, chapter_id, user_id) values ($1, $2, $3), ($1, $2, $4)`,
      [floor, CH, U(1), U(3)],
    );
    check(
      "a manual group's members are the ones picked",
      same(await membersOf(floor), [U(1), U(3)]),
      await membersOf(floor),
    );
    check(
      "only a manual group takes hand-picked members",
      await refused(
        `insert into chapter_group_members (group_id, chapter_id, user_id) values ($1, $2, $3)`,
        [y2027, CH, U(2)],
      ),
    );
    check(
      "a hand-picked member must be a member of the chapter",
      await refused(
        `insert into chapter_group_members (group_id, chapter_id, user_id) values ($1, $2, $3)`,
        [floor, CH, "a4076000-0000-4000-8000-0000000000f9"],
      ),
    );
    check(
      "two manual groups can't share a name",
      await refused(
        `insert into chapter_groups (chapter_id, kind, name) values ($1, 'manual', ' third FLOOR ')`,
        [CH],
      ),
    );
    check(
      "a group carries only its own kind's source",
      (await refused(
        `insert into chapter_groups (chapter_id, kind, name, class_year) values ($1, 'manual', 'Odd', 2030)`,
        [CH],
      )) &&
        (await refused(
          `insert into chapter_groups (chapter_id, kind, name) values ($1, 'class_year', 'Class of ?')`,
          [CH],
        )),
    );

    // A channel only the Third floor sees.
    await db.query(
      `insert into chat_channels (id, chapter_id, name, type, who_can_see, who_can_post, is_read_only)
       values ($1, $2, 'third-floor', 'ROLE_GATED', $3, null, false)`,
      [CHAN, CH, [`group:${floor}`]],
    );
    const reads = {
      inGroup: await canRead(A(1)),
      outOfGroup: await canRead(A(2)),
    };
    check(
      "can_read_chat_channel admits a listed group's members and nobody else",
      reads.inGroup === true && reads.outOfGroup === false,
      reads,
    );
    check(
      "a list refuses an entry kind it doesn't know",
      await refused(`update chat_channels set who_can_see = $2 where id = $1`, [
        CHAN,
        [`team:${floor}`],
      ]),
    );

    // U1 leaves the chapter: out of the manual group too.
    await db.query(`delete from members where user_id = $1 and chapter_id = $2`, [
      U(1),
      CH,
    ]);
    check(
      "a member who leaves the chapter leaves its groups",
      same(await membersOf(floor), [U(3)]),
      await membersOf(floor),
    );

    // Deleting the group (or a pledge class) takes it off every list.
    await db.query(
      `update chat_channels set who_can_see = $2 where id = $1`,
      [CHAN, [`group:${alpha}`, `group:${floor}`].sort()],
    );
    await db.query(`delete from chapter_groups where id = $1`, [floor]);
    await db.query(`delete from chapter_pledge_classes where id = $1`, [
      PC_ALPHA,
    ]);
    const listAfter = (
      await rows(`select who_can_see from chat_channels where id = $1`, [CHAN])
    )[0].who_can_see;
    const alphaGone =
      (await rows(`select 1 from chapter_groups where id = $1`, [alpha]))
        .length === 0;
    check(
      "a deleted group, or its pledge class, leaves every channel list",
      same(listAfter, []) && alphaGone,
      { listAfter, alphaGone },
    );

    const tier = (
      await rows(`select mentionable from role_tiers where id = $1`, [T_EXEC])
    )[0];
    check("a tier is pingable by default", tier.mentionable === true, tier);

    // groups:manage: the backfill ran before these rows existed, so run the
    // file over them (a second run must also change nothing).
    await db.exec(sql);
    const perms = async () =>
      Object.fromEntries(
        (
          await rows(
            `select name, 'groups:manage' = any (permissions) as has
               from roles where chapter_id = $1 order by name`,
            [CH],
          )
        ).map((r) => [r.name, r.has]),
      );
    const first = await perms();
    const groupsBefore = await groups();
    await db.exec(sql);
    check(
      "groups:manage reaches whoever manages roles or channels, once",
      same(first, {
        Advisor: true,
        Brother: false,
        "House manager": true,
        President: true,
      }) &&
        same(await perms(), first) &&
        same(await groups(), groupsBefore),
      { first, again: await perms() },
    );
  } catch (e) {
    check("the tier ran to the end", false, {
      error: String(e?.message ?? e).split("\n")[0],
    });
  } finally {
    await db.exec("rollback");
    await setAuth({ uid: null, jwtRole: "service_role" });
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
