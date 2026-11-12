import { readFileSync } from "node:fs";
import { join } from "node:path";

import { db, miss } from "../harness.mjs";

// ─── Functional: members create events by default (20261112150000) ─────────
//
// 20261112150000 gives existing chapters `events:create` and `backwork:upload`
// on the Member role's tier and every tier above it (#3709). Replay runs it
// against an empty table, so replay alone proves nothing. This tier re-runs it
// against seeded chapters and checks:
//
//   - the Member role's tier and the tiers above it gain `events:create`, the
//     tiers above it gain `backwork:upload` when members hold it, and every
//     role in them holds the keys through the tier;
//   - a role that switched a key off keeps it off;
//   - the tier below the Member role's (New members) is untouched;
//   - a chapter that took `backwork:upload` away from its members does not
//     see it handed to anyone;
//   - a Member role outside the tiers gets `events:create` as an "on"
//     override, unless it has an override for it already;
//   - another chapter with no Member role is untouched;
//   - running it a second time changes nothing.
//
// Everything runs inside one transaction and is rolled back.
console.log(
  "\n=== Functional: members create events by default (20261112150000) ===",
);
{
  const A = "a3709000-0000-4000-8000-00000000000a";
  const B = "b3709000-0000-4000-8000-00000000000b";
  const C = "c3709000-0000-4000-8000-00000000000c";
  const D = "d3709000-0000-4000-8000-00000000000d";
  const E = "e3709000-0000-4000-8000-00000000000e";
  const T = {
    board: "a3709000-0000-4000-8000-0000000000b1",
    chairs: "a3709000-0000-4000-8000-0000000000b2",
    members: "a3709000-0000-4000-8000-0000000000b3",
    pledges: "a3709000-0000-4000-8000-0000000000b4",
    cBoard: "c3709000-0000-4000-8000-0000000000b1",
    dBoard: "d3709000-0000-4000-8000-0000000000b1",
    dMembers: "d3709000-0000-4000-8000-0000000000b3",
  };
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20261112150000_member_social_trust_defaults.sql",
    ),
    "utf8",
  );
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const rows = async (text, params = []) => (await db.query(text, params)).rows;
  const role = async (chapter, name) =>
    (
      await rows(
        `select permissions, permission_overrides from roles
          where chapter_id = $1 and name = $2`,
        [chapter, name],
      )
    )[0];
  const tier = async (id) =>
    (await rows(`select permissions from role_tiers where id = $1`, [id]))[0]
      .permissions;
  const has = (list, ...keys) => keys.every((k) => list.includes(k));
  const snapshot = async () =>
    (
      await rows(
        `select string_agg(
                  name || '=' || permissions::text || permission_overrides::text,
                  '|' order by chapter_id, name) as s
           from roles where chapter_id in ($1, $2, $3, $4, $5)`,
        [A, B, C, D, E],
      )
    )[0].s +
    (
      await rows(
        `select string_agg(id::text || '=' || permissions::text, '|' order by id) as s
           from role_tiers where chapter_id in ($1, $2, $3, $4, $5)`,
        [A, B, C, D, E],
      )
    )[0].s;

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values
        ('${A}', 'A', 'U'), ('${B}', 'B', 'U'), ('${C}', 'C', 'U'),
        ('${D}', 'D', 'U'), ('${E}', 'E', 'U');
      insert into role_tiers (id, chapter_id, position, name, permissions) values
        ('${T.board}', '${A}', 1, 'Exec board', '{members:view,roles:manage}'),
        ('${T.chairs}', '${A}', 2, 'Officers and chairs', '{members:view}'),
        ('${T.members}', '${A}', 3, 'Members', '{backwork:upload,members:view}'),
        ('${T.pledges}', '${A}', 4, 'New members', '{members:view}'),
        ('${T.cBoard}', '${C}', 1, 'Board', '{members:view}'),
        ('${T.dBoard}', '${D}', 1, 'Board', '{members:view}'),
        ('${T.dMembers}', '${D}', 2, 'Members', '{members:view}');
      insert into roles (chapter_id, name, system_key, is_system, display_order, permissions, tier_id, permission_overrides) values
        ('${A}', 'Vice President', 'VICE_PRESIDENT', true, 1, '{}', '${T.board}', '{}'),
        ('${A}', 'Risk chair', null, false, 2, '{}', '${T.chairs}', '{}'),
        ('${A}', 'Member', 'MEMBER', true, 3, '{}', '${T.members}', '{}'),
        ('${A}', 'Brothers', null, false, 4, '{}', '${T.members}', '{"backwork:upload": false}'),
        ('${A}', 'New Member', 'NEW_MEMBER', true, 5, '{}', '${T.pledges}', '{}'),
        ('${A}', 'Imported VP', null, false, 6, '{}', null, '{}'),
        ('${B}', 'Member', 'MEMBER', true, 1, '{}', null, '{"members:view": true, "events:create": false}'),
        ('${C}', 'Board member', null, false, 1, '{}', '${T.cBoard}', '{}'),
        ('${D}', 'Member', 'MEMBER', true, 1, '{}', '${T.dMembers}', '{}'),
        ('${E}', 'Member', 'MEMBER', true, 1, '{}', null, '{"backwork:upload": false}');
    `);

    await db.exec(sql);

    check(
      "the Member role's tier and those above gain events:create, and those above the backwork:upload members hold",
      has(await tier(T.board), "events:create", "backwork:upload") &&
        has(await tier(T.chairs), "events:create", "backwork:upload") &&
        has(await tier(T.members), "events:create", "backwork:upload"),
      {
        board: await tier(T.board),
        chairs: await tier(T.chairs),
        members: await tier(T.members),
      },
    );
    const vp = await role(A, "Vice President");
    const chair = await role(A, "Risk chair");
    const member = await role(A, "Member");
    check(
      "every role in those tiers holds the keys through the tier, with no override",
      [vp, chair, member].every(
        (r) =>
          has(r.permissions, "events:create", "backwork:upload") &&
          Object.keys(r.permission_overrides).length === 0,
      ),
      { vp, chair, member },
    );
    const brothers = await role(A, "Brothers");
    check(
      "a role that switched a key off keeps it off",
      brothers.permissions.includes("events:create") &&
        !brothers.permissions.includes("backwork:upload"),
      brothers,
    );
    const pledge = await role(A, "New Member");
    check(
      "the tier below the Member role's is untouched",
      JSON.stringify(await tier(T.pledges)) === '["members:view"]' &&
        JSON.stringify(pledge.permissions) === '["members:view"]',
      { tier: await tier(T.pledges), pledge },
    );
    const imported = await role(A, "Imported VP");
    check(
      "a role outside the tiers is untouched",
      imported.permissions.length === 0,
      imported,
    );
    const bMember = await role(B, "Member");
    check(
      "a Member role outside the tiers keeps its own override for events:create",
      bMember.permission_overrides["events:create"] === false &&
        !("backwork:upload" in bMember.permission_overrides) &&
        !bMember.permissions.includes("events:create"),
      bMember,
    );
    const eMember = await role(E, "Member");
    check(
      "a Member role outside the tiers gets events:create, and backwork:upload stays off",
      eMember.permission_overrides["events:create"] === true &&
        eMember.permission_overrides["backwork:upload"] === false &&
        eMember.permissions.includes("events:create") &&
        !eMember.permissions.includes("backwork:upload"),
      eMember,
    );
    check(
      "a chapter that took backwork:upload from its members hands it to nobody",
      JSON.stringify(await tier(T.dBoard)) ===
        '["members:view","events:create"]' &&
        JSON.stringify(await tier(T.dMembers)) ===
          '["members:view","events:create"]',
      { board: await tier(T.dBoard), members: await tier(T.dMembers) },
    );
    check(
      "a chapter with no Member role is untouched",
      JSON.stringify(await tier(T.cBoard)) === '["members:view"]',
      { tier: await tier(T.cBoard) },
    );

    const before = await snapshot();
    await db.exec(sql);
    check(
      "running it again changes nothing",
      (await snapshot()) === before,
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
