import { db, miss } from "../harness.mjs";
import { setAuth } from "../probe.mjs";

// ─── Functional: a group per major (20261120215726, #5778) ─────────────────
//
// Replay runs the migration against empty tables, so replay alone proves
// nothing about its triggers or its view. This tier seeds two chapters and
// checks:
//
//   - each distinct major a member of a chapter has gets one group there,
//     matched ignoring case and whitespace, named by the spelling most of its
//     members use, and nothing for a blank major;
//   - `chapter_group_memberships` follows a member's major the moment it
//     changes, the first member with a new major makes its group, the last
//     one to leave empties it (the row stays), and a chapter's group holds
//     only that chapter's members;
//   - a major on a channel list admits nobody, its own members included.
//
// Everything runs inside one transaction and is rolled back.
console.log("\n=== Functional: a group per major (20261120215726) ===");
{
  const CH = "a5778000-0000-4000-8000-00000000000a";
  const CH2 = "a5778000-0000-4000-8000-00000000000b";
  const T = "a5778000-0000-4000-8000-0000000000e1";
  const T2 = "a5778000-0000-4000-8000-0000000000e2";
  const R_BRO = "a5778000-0000-4000-8000-000000000005";
  const R_BRO2 = "a5778000-0000-4000-8000-000000000006";
  const U = (n) => `a5778000-0000-4000-8000-0000000000a${n}`;
  const A = (n) => `a5778000-0000-4000-8000-0000000000b${n}`;
  const CHAN = "a5778000-0000-4000-8000-0000000c0001";
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const rows = async (text, params = []) => (await db.query(text, params)).rows;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const majors = async (chapter = CH) =>
    rows(
      `select name, major_key from chapter_groups
        where chapter_id = $1 and kind = 'major' order by major_key`,
      [chapter],
    );
  const groupId = async (key, chapter = CH) =>
    (
      await rows(
        `select id from chapter_groups
          where chapter_id = $1 and kind = 'major' and major_key = $2`,
        [chapter, key],
      )
    )[0]?.id;
  const membersOf = async (id) =>
    (
      await rows(
        `select user_id from chapter_group_memberships
          where group_id = $1 order by user_id`,
        [id],
      )
    ).map((r) => r.user_id);

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values
        ('${CH}', 'Majors', 'U'),
        ('${CH2}', 'Other', 'U');
      insert into role_tiers (id, chapter_id, position, name, permissions) values
        ('${T}', '${CH}', 1, 'Members', '{members:view}'),
        ('${T2}', '${CH2}', 1, 'Members', '{members:view}');
      insert into roles (id, chapter_id, name, system_key, tier_id, display_order, permission_overrides) values
        ('${R_BRO}', '${CH}', 'Brother', 'MEMBER', '${T}', 1, '{}'),
        ('${R_BRO2}', '${CH2}', 'Brother', 'MEMBER', '${T2}', 1, '{}');
      insert into users (id, supabase_auth_id, email, major) values
        ('${U(1)}', '${A(1)}', 'one@test.local', 'Mechanical Engineering'),
        ('${U(2)}', '${A(2)}', 'two@test.local', '  mechanical   engineering '),
        ('${U(3)}', '${A(3)}', 'three@test.local', 'Mechanical Engineering'),
        ('${U(4)}', '${A(4)}', 'four@test.local', '   '),
        ('${U(5)}', '${A(5)}', 'five@test.local', 'Music');
      insert into members (user_id, chapter_id, role_ids) values
        ('${U(1)}', '${CH}', '{${R_BRO}}'),
        ('${U(2)}', '${CH}', '{${R_BRO}}'),
        ('${U(3)}', '${CH}', '{${R_BRO}}'),
        ('${U(4)}', '${CH}', '{${R_BRO}}'),
        ('${U(5)}', '${CH2}', '{${R_BRO2}}');
    `);

    check(
      "majors that differ only in case and spacing make one group, named as most members write it; a blank major makes none",
      same(await majors(), [
        {
          name: "Mechanical Engineering",
          major_key: "mechanical engineering",
        },
      ]),
      await majors(),
    );
    const mech = await groupId("mechanical engineering");
    check(
      "the group holds every member with the major, however they wrote it",
      same(await membersOf(mech), [U(1), U(2), U(3)]),
      await membersOf(mech),
    );
    check(
      "a major's group is the chapter's own: another chapter's member isn't in it, and gets their own",
      (await groupId("music")) === undefined &&
        same(await majors(CH2), [{ name: "Music", major_key: "music" }]),
      { here: await majors(), there: await majors(CH2) },
    );

    // The first member with a new major makes its group.
    await db.query(`update users set major = 'Industrial Systems' where id = $1`, [
      U(4),
    ]);
    const isys = await groupId("industrial systems");
    check(
      "the first member to save a new major makes its group, with them in it",
      !!isys && same(await membersOf(isys), [U(4)]),
      { isys, members: isys && (await membersOf(isys)) },
    );

    // Two of three switch spelling: the name follows the majority.
    await db.query(
      `update users set major = 'mechanical engineering' where id = any ($1)`,
      [[U(1), U(3)]],
    );
    const renamed = (
      await rows(`select name from chapter_groups where id = $1`, [mech])
    )[0]?.name;
    check(
      "the name follows the spelling most members use",
      renamed === "mechanical engineering",
      { renamed },
    );

    // The last member to leave empties it; the row stays for the next.
    await db.query(`update users set major = 'Music' where id = $1`, [U(4)]);
    const isysAfter = await membersOf(isys);
    const isysRow = (
      await rows(`select 1 from chapter_groups where id = $1`, [isys])
    ).length;
    const music = await groupId("music");
    check(
      "a member changing major moves group at once; the empty group's row stays",
      same(isysAfter, []) &&
        isysRow === 1 &&
        !!music &&
        same(await membersOf(music), [U(4)]),
      { isysAfter, isysRow, music },
    );

    // A member leaving the chapter leaves the group.
    await db.query(
      `delete from members where user_id = $1 and chapter_id = $2`,
      [U(3), CH],
    );
    check(
      "a member who leaves the chapter leaves its major's group",
      same(await membersOf(mech), [U(1), U(2)]),
      await membersOf(mech),
    );

    // A major never opens a channel.
    await db.query(
      `insert into chat_channels (id, chapter_id, name, type, who_can_see, who_can_post, is_read_only)
       values ($1, $2, 'mechies', 'ROLE_GATED', $3, null, false)`,
      [CHAN, CH, [`group:${mech}`]],
    );
    await setAuth({ uid: A(1), jwtRole: "authenticated" });
    const read = (
      await rows(`select can_read_chat_channel($1) as ok`, [CHAN])
    )[0].ok;
    await setAuth({ uid: null, jwtRole: "service_role" });
    check(
      "a major on a channel list admits nobody, its own members included",
      read === false,
      { read },
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
