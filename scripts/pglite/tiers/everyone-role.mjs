import { readFileSync } from "node:fs";
import { join } from "node:path";

import { db, miss } from "../harness.mjs";

// ─── Functional: the Member role becomes Everyone (20261112160000) ─────────
//
// Replay runs the rename against chapters with no roles, so replay alone
// proves nothing about it. This tier seeds chapters and checks:
//
//   - the seeded Member role (system_key MEMBER) is called Everyone and is
//     switched off for mentions, keeping its id, tier, permissions, overrides
//     and color;
//   - another role whose name reads as @everyone is renamed "(role)", or
//     "(role 2)" when that is taken, keeps its id and permissions, and its
//     pending invites follow it;
//   - pending invites naming the Member role by its old name now name
//     Everyone, and redeemed, revoked or other roles' invites keep theirs;
//   - every member's effective permissions (the union of their roles') are
//     exactly what they were;
//   - a chapter with no MEMBER-keyed role is not touched;
//   - a second run changes nothing.
//
// Everything runs inside one transaction and is rolled back.
console.log(
  "\n=== Functional: the Member role becomes Everyone (20261112160000) ===",
);
{
  const A = "a4191000-0000-4000-8000-00000000000a";
  const B = "b4191000-0000-4000-8000-00000000000b";
  const U = "c4191000-0000-4000-8000-0000000000c1";
  const U2 = "c4191000-0000-4000-8000-0000000000c2";
  const T = "a4191000-0000-4000-8000-0000000000b3";
  const id = (n) => `e4191000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const R = {
    member: id(1),
    brothers: id(2),
    lowerEveryone: id(3),
    taken: id(4),
    dashed: id(5),
    bMember: id(6),
  };
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/20261112160000_everyone_role.sql"),
    "utf8",
  );
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const rows = async (text, params = []) => (await db.query(text, params)).rows;
  const role = async (roleId) =>
    (
      await rows(
        `select name, mentionable, tier_id, permissions, permission_overrides, color, system_key
           from roles where id = $1`,
        [roleId],
      )
    )[0];
  const invite = async (token) =>
    (await rows(`select role from invites where token = $1`, [token]))[0].role;
  const effective = async () =>
    (
      await rows(
        `select m.user_id::text as u,
                coalesce(
                  (select array_agg(distinct p order by p)
                     from roles r, unnest(r.permissions) p
                    where r.id::text = any(m.role_ids::text[])), '{}') as perms
           from members m where m.chapter_id = $1 order by m.user_id`,
        [A],
      )
    ).map((r) => `${r.u}=${r.perms.join(",")}`);
  const snapshot = async () =>
    (
      await rows(
        `select string_agg(id::text || name || mentionable::text, '|' order by id) as s
           from roles where chapter_id in ($1, $2)`,
        [A, B],
      )
    )[0].s +
    (
      await rows(
        `select string_agg(token || role, '|' order by token) as s
           from invites where chapter_id in ($1, $2)`,
        [A, B],
      )
    )[0].s;

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values
        ('${A}', 'A4191', 'U'), ('${B}', 'B4191', 'U');
      insert into users (id, supabase_auth_id, email) values
        ('${U}', gen_random_uuid(), 'u4191@x.test'),
        ('${U2}', gen_random_uuid(), 'u4191b@x.test');
      insert into role_tiers (id, chapter_id, position, name, permissions) values
        ('${T}', '${A}', 3, 'Members', '{members:view,events:create}');
      insert into roles (id, chapter_id, name, system_key, is_system, display_order, permissions, tier_id, permission_overrides, color, mentionable) values
        ('${R.member}', '${A}', 'Actives', 'MEMBER', true, 5, '{}', '${T}', '{"service:log": true}', 'sky', true),
        ('${R.brothers}', '${A}', 'Brothers', null, false, 6, '{}', null, '{"channels:read:x": true}', null, true),
        ('${R.lowerEveryone}', '${A}', 'everyone', null, false, 7, '{}', null, '{"members:view": true}', null, true),
        ('${R.taken}', '${A}', 'everyone (role)', null, false, 8, '{}', null, '{}', null, true),
        ('${R.dashed}', '${A}', 'Every-One', null, false, 9, '{}', null, '{}', null, true),
        ('${R.bMember}', '${B}', 'Everyone', null, false, 1, '{members:view}', null, '{}', null, true);
      insert into members (chapter_id, user_id, role_ids) values
        ('${A}', '${U}', '{${R.brothers},${R.member}}'),
        ('${A}', '${U2}', '{${R.lowerEveryone}}');
      insert into invites (token, chapter_id, role, expires_at, created_by, used_at, revoked_at) values
        ('t4191-pending', '${A}', 'Actives', now() + interval '7 days', '${U}', null, null),
        ('t4191-used', '${A}', 'Actives', now() + interval '7 days', '${U}', now(), null),
        ('t4191-revoked', '${A}', 'Actives', now() + interval '7 days', '${U}', null, now()),
        ('t4191-brothers', '${A}', 'Brothers', now() + interval '7 days', '${U}', null, null),
        ('t4191-lower', '${A}', 'everyone', now() + interval '7 days', '${U}', null, null),
        ('t4191-dashed', '${A}', 'Every-One', now() + interval '7 days', '${U}', null, null),
        ('t4191-dashed-used', '${A}', 'Every-One', now() + interval '7 days', '${U}', now(), null),
        ('t4191-b', '${B}', 'Everyone', now() + interval '7 days', '${U}', null, null);
    `);

    const before = await effective();
    const memberBefore = await role(R.member);
    await db.exec(sql);

    const member = await role(R.member);
    check(
      "the Member role is called Everyone and is switched off for mentions",
      member.name === "Everyone" && member.mentionable === false,
      member,
    );
    check(
      "it keeps its key, tier, permissions, overrides and color",
      member.system_key === "MEMBER" &&
        member.tier_id === memberBefore.tier_id &&
        JSON.stringify(member.permissions) ===
          JSON.stringify(memberBefore.permissions) &&
        JSON.stringify(member.permission_overrides) ===
          JSON.stringify(memberBefore.permission_overrides) &&
        member.color === memberBefore.color,
      { before: memberBefore, after: member },
    );
    const lower = await role(R.lowerEveryone);
    const dashed = await role(R.dashed);
    check(
      "other roles reading as @everyone are renamed, past a name already taken",
      lower.name === "everyone (role 2)" &&
        dashed.name === "Every-One (role)" &&
        JSON.stringify(lower.permissions) === '["members:view"]',
      { lower, dashed },
    );
    check(
      "pending invites for a renamed role follow it; a redeemed one keeps its name",
      (await invite("t4191-lower")) === "everyone (role 2)" &&
        (await invite("t4191-dashed")) === "Every-One (role)" &&
        (await invite("t4191-dashed-used")) === "Every-One",
      {
        lower: await invite("t4191-lower"),
        dashed: await invite("t4191-dashed"),
      },
    );
    check(
      "a role whose name only contains the word is left alone",
      (await role(R.taken)).name === "everyone (role)",
      await role(R.taken),
    );
    check(
      "pending invites for the Member role name Everyone; history and other roles keep theirs",
      (await invite("t4191-pending")) === "Everyone" &&
        (await invite("t4191-used")) === "Actives" &&
        (await invite("t4191-revoked")) === "Actives" &&
        (await invite("t4191-brothers")) === "Brothers",
      {},
    );
    check(
      "every member's effective permissions are what they were",
      JSON.stringify(await effective()) === JSON.stringify(before),
      { before, after: await effective() },
    );
    const b = await role(R.bMember);
    check(
      "a chapter with no Member role is not touched",
      b.name === "Everyone" &&
        b.mentionable === true &&
        (await invite("t4191-b")) === "Everyone",
      b,
    );

    const once = await snapshot();
    await db.exec(sql);
    check("running it again changes nothing", (await snapshot()) === once, {});
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
