import { readFileSync } from "node:fs";
import { join } from "node:path";

import { db, miss } from "../harness.mjs";

// ─── Functional: role tiers (20261111140000, #4071) ─────────────────────────
//
// Replay runs the placement against an empty `chapters` table, so replay alone
// proves nothing about it. This tier seeds chapters as they were before the
// migration (roles with a `permissions` list, no tier, no overrides, no
// trigger), re-runs the same SQL, and checks what the migration promises:
//
//   - no role's `permissions` changes, byte for byte: no existing chapter
//     gains or loses a permission;
//   - every role lands where the header says, and its tier's permissions with
//     its overrides applied are exactly the list it holds;
//   - running it a second time changes nothing.
//
// Then, with the triggers the migration leaves in place, it checks the
// write-back: a tier edit, an override, a move between tiers and a write of
// `permissions` alone each leave `roles.permissions` equal to the effective
// list, and the guards (no wildcard on a tier, no deleting a tier that has
// roles, no tier of another chapter) hold.
//
// Everything runs inside one transaction and is rolled back.
console.log("\n=== Functional: role tiers (20261111140000) ===");
{
  const A = "a4071000-0000-4000-8000-00000000000a";
  const B = "b4071000-0000-4000-8000-00000000000b";
  const C = "c4071000-0000-4000-8000-00000000000c";
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/20261111140000_role_tiers.sql"),
    "utf8",
  );
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const rows = async (text, params = []) => (await db.query(text, params)).rows;
  const snapshot = async () =>
    (
      await rows(
        `select string_agg(id::text || '=' || permissions::text, '|' order by id) as s
           from roles where chapter_id in ($1, $2, $3)`,
        [A, B, C],
      )
    )[0].s;
  const placement = async () =>
    Object.fromEntries(
      (
        await rows(
          `select r.chapter_id::text || ':' || r.name as k, t.position
             from roles r left join role_tiers t on t.id = r.tier_id
            where r.chapter_id in ($1, $2, $3)`,
          [A, B, C],
        )
      ).map((r) => [r.k, r.position]),
    );
  const role = async (chapter, name) =>
    (
      await rows(
        `select r.id, r.permissions, r.permission_overrides, t.permissions as tier_permissions
           from roles r left join role_tiers t on t.id = r.tier_id
          where r.chapter_id = $1 and r.name = $2`,
        [chapter, name],
      )
    )[0];
  const tierId = async (chapter, position) =>
    (
      await rows(
        `select id from role_tiers where chapter_id = $1 and position = $2`,
        [chapter, position],
      )
    )[0]?.id;
  const sameSet = (a, b) =>
    a.length === b.length && [...a].sort().join() === [...b].sort().join();
  // A statement expected to fail, without losing the transaction.
  const refused = async (text) => {
    await db.exec("savepoint expect_refusal");
    try {
      await db.exec(text);
      await db.exec("release savepoint expect_refusal");
      return false;
    } catch {
      await db.exec("rollback to savepoint expect_refusal");
      return true;
    }
  };

  try {
    // Chapter A is a chapter as `ChapterService.create` seeded it before this
    // migration, plus four roles an officer or a Discord import added.
    // Chapter B renamed its Member role before `system_key` existed, so it
    // has none. Chapter C has no roles at all.
    await db.exec(`
      begin;
      drop trigger if exists trg_roles_sync_permissions on roles;
      drop trigger if exists trg_role_tiers_sync_roles on role_tiers;
      insert into chapters (id, name, university) values
        ('${A}', 'A', 'U'), ('${B}', 'B', 'U'), ('${C}', 'C', 'U');
      insert into roles (chapter_id, name, system_key, is_system, display_order, permissions) values
        ('${A}', 'President', 'PRESIDENT', true, 1, '{*}'),
        ('${A}', 'Treasurer', 'TREASURER', true, 2, '{billing:view,billing:manage,points:adjust,points:view_all,polls:view_all,members:view,reports:export,events:create,events:update}'),
        ('${A}', 'Vice President', 'VICE_PRESIDENT', true, 3, '{members:view,polls:view_all}'),
        ('${A}', 'Secretary', 'SECRETARY', true, 4, '{polls:view_all,members:view}'),
        ('${A}', 'Member', 'MEMBER', true, 5, '{members:view,backwork:upload,service:log,polls:create}'),
        ('${A}', 'New Member', 'NEW_MEMBER', true, 6, '{members:view,backwork:upload}'),
        ('${A}', 'Alumni', 'ALUMNI', true, 7, '{members:view,alumni:post}'),
        ('${A}', 'Social Chair', null, false, 0, '{members:view,events:create,events:create}'),
        ('${A}', 'Live-ins', null, false, 0, '{}'),
        ('${A}', 'Helper', null, false, 0, '{members:view}'),
        ('${A}', 'Old Admin', null, false, 0, '{*,members:view}'),
        ('${B}', 'President', 'PRESIDENT', true, 1, '{*}'),
        ('${B}', 'Brother', null, true, 5, '{members:view,service:log}'),
        ('${B}', 'Pledge', 'NEW_MEMBER', true, 6, '{members:view}');
    `);
    const before = await snapshot();

    await db.exec(sql);

    check(
      "no role's permissions changed, byte for byte",
      (await snapshot()) === before,
      { before, after: await snapshot() },
    );

    const placed = await placement();
    const expected = {
      [`${A}:President`]: 1,
      [`${A}:Treasurer`]: 1,
      [`${A}:Vice President`]: 1,
      [`${A}:Secretary`]: 1,
      [`${A}:Old Admin`]: 1,
      [`${A}:Social Chair`]: 2,
      [`${A}:Member`]: 3,
      [`${A}:Helper`]: 3,
      [`${A}:New Member`]: 4,
      [`${A}:Alumni`]: null,
      [`${A}:Live-ins`]: null,
      [`${B}:President`]: 1,
      // No Member role to compare against, so a role with permissions ranks
      // as an officer role: over-ranking locks nobody out of what they edit.
      [`${B}:Brother`]: 2,
      [`${B}:Pledge`]: 4,
    };
    check(
      "every role is placed where the migration's header says",
      JSON.stringify(Object.entries(placed).sort()) ===
        JSON.stringify(Object.entries(expected).sort()),
      { placed, expected },
    );

    const tiers = await rows(
      `select chapter_id, position, name, permissions from role_tiers
        where chapter_id in ($1, $2, $3) order by chapter_id, position`,
      [A, B, C],
    );
    check(
      "each chapter, with or without roles, gets the four starting tiers",
      [A, B, C].every(
        (chapter) =>
          tiers
            .filter((t) => t.chapter_id === chapter)
            .map((t) => t.name)
            .join("|") === "Exec board|Officers and chairs|Members|New members",
      ),
      { tiers },
    );
    const tierOf = (chapter, position) =>
      tiers.find((t) => t.chapter_id === chapter && t.position === position)
        .permissions;
    check(
      "a tier starts with what its seeded roles all hold, and never the wildcard",
      sameSet(tierOf(A, 1), ["members:view", "polls:view_all"]) &&
        sameSet(tierOf(A, 2), ["members:view", "events:create"]) &&
        sameSet(tierOf(A, 3), [
          "members:view",
          "backwork:upload",
          "service:log",
          "polls:create",
        ]) &&
        sameSet(tierOf(A, 4), ["members:view", "backwork:upload"]) &&
        sameSet(tierOf(B, 1), []) &&
        tiers.every((t) => !t.permissions.includes("*")),
      { tiers },
    );

    const drift = await rows(
      `select r.name, r.permissions, t.permissions as tier, r.permission_overrides
         from roles r left join role_tiers t on t.id = r.tier_id
        where r.chapter_id in ($1, $2, $3)
          and not (
            role_effective_permissions(t.permissions, r.permission_overrides) @> r.permissions
            and role_effective_permissions(t.permissions, r.permission_overrides) <@ r.permissions
          )`,
      [A, B, C],
    );
    check(
      "tier permissions with the role's overrides are exactly what each role holds",
      drift.length === 0,
      { drift },
    );

    const treasurer = await role(A, "Treasurer");
    const helper = await role(A, "Helper");
    const president = await role(A, "President");
    check(
      "what a role holds beyond its tier is an on override; what it lacks is an off override",
      treasurer.permission_overrides["billing:manage"] === true &&
        !("members:view" in treasurer.permission_overrides) &&
        helper.permission_overrides["service:log"] === false &&
        president.permission_overrides["*"] === true,
      { treasurer, helper, president },
    );
    check(
      "a Vice President who could not approve service hours still cannot",
      !(await role(A, "Vice President")).permissions.includes(
        "service:approve",
      ),
      { vicePresident: await role(A, "Vice President") },
    );

    const full = async () =>
      JSON.stringify(
        await rows(
          `select r.id, r.permissions, r.tier_id, r.permission_overrides
             from roles r where r.chapter_id in ($1, $2, $3) order by r.id`,
          [A, B, C],
        ),
      ) +
      JSON.stringify(
        await rows(
          `select id, position, name, permissions from role_tiers
            where chapter_id in ($1, $2, $3) order by id`,
          [A, B, C],
        ),
      );
    const once = await full();
    await db.exec(sql);
    check(
      "running it twice changes nothing the second time",
      (await full()) === once,
      {},
    );

    // ── The write-back, with the triggers in place ──────────────────────
    const officers = await tierId(A, 2);
    const members = await tierId(A, 3);

    await db.query(
      `update role_tiers set permissions = permissions || '{service:approve}' where id = $1`,
      [await tierId(A, 1)],
    );
    check(
      "a permission added to a tier reaches every role in it, and no other tier's",
      (await role(A, "Vice President")).permissions.includes(
        "service:approve",
      ) &&
        (await role(A, "Treasurer")).permissions.includes("service:approve") &&
        (await role(A, "President")).permissions.includes("*") &&
        !(await role(A, "Member")).permissions.includes("service:approve"),
      { vicePresident: await role(A, "Vice President") },
    );

    await db.query(
      `update roles set permission_overrides = permission_overrides || '{"service:approve": false}'
        where chapter_id = $1 and name = 'Secretary'`,
      [A],
    );
    check(
      "an off override beats the tier",
      !(await role(A, "Secretary")).permissions.includes("service:approve"),
      { secretary: await role(A, "Secretary") },
    );

    await db.query(
      `update role_tiers set permissions = array_remove(permissions, 'polls:view_all') where id = $1`,
      [await tierId(A, 1)],
    );
    await db.query(
      `update roles set permission_overrides = permission_overrides || '{"polls:view_all": true}'
        where chapter_id = $1 and name = 'Secretary'`,
      [A],
    );
    check(
      "a permission removed from a tier leaves its roles, and an on override keeps it",
      !(await role(A, "Vice President")).permissions.includes(
        "polls:view_all",
      ) && (await role(A, "Secretary")).permissions.includes("polls:view_all"),
      { secretary: await role(A, "Secretary") },
    );

    await db.query(
      `update roles set tier_id = $2 where chapter_id = $1 and name = 'Helper'`,
      [A, officers],
    );
    const moved = await role(A, "Helper");
    check(
      "a role moved to another tier takes that tier's permissions and keeps its overrides",
      moved.permissions.includes("events:create") &&
        !moved.permissions.includes("service:log") &&
        moved.permission_overrides["service:log"] === false,
      { moved },
    );

    // What the Roles page's matrix and `PATCH /v1/roles/:id` do today: write
    // the list and nothing else.
    await db.query(
      `update roles set permissions = '{members:view,tasks:manage}'
        where chapter_id = $1 and name = 'Social Chair'`,
      [A],
    );
    const legacy = await role(A, "Social Chair");
    check(
      "a write of permissions alone is kept as given and recorded as overrides",
      sameSet(legacy.permissions, ["members:view", "tasks:manage"]) &&
        legacy.permission_overrides["tasks:manage"] === true &&
        legacy.permission_overrides["events:create"] === false &&
        !("members:view" in legacy.permission_overrides),
      { legacy },
    );
    await db.query(
      `update roles set permissions = '{members:view,events:create}'
        where chapter_id = $1 and name = 'Social Chair'`,
      [A],
    );
    check(
      "writing the tier's own list back clears the overrides it no longer needs",
      JSON.stringify((await role(A, "Social Chair")).permission_overrides) ===
        "{}",
      { socialChair: await role(A, "Social Chair") },
    );

    await db.query(
      `insert into roles (chapter_id, name, permissions) values ($1, 'Imported', '{channels:read:exec}')`,
      [A],
    );
    await db.query(
      `insert into roles (chapter_id, name, tier_id, permission_overrides)
       values ($1, 'Risk Manager', $2, '{"reports:export": true, "service:log": false}')`,
      [A, members],
    );
    const imported = await role(A, "Imported");
    const risk = await role(A, "Risk Manager");
    check(
      "a new role keeps the list it was created with, or takes its tier's with its overrides",
      sameSet(imported.permissions, ["channels:read:exec"]) &&
        imported.permission_overrides["channels:read:exec"] === true &&
        sameSet(risk.permissions, [
          "members:view",
          "backwork:upload",
          "polls:create",
          "reports:export",
        ]),
      { imported, risk },
    );

    await db.query(
      `update roles set name = 'Risk' where chapter_id = $1 and name = 'Risk Manager'`,
      [A],
    );
    check(
      "an edit that touches neither permissions nor the tier leaves both alone",
      JSON.stringify((await role(A, "Risk")).permissions) ===
        JSON.stringify(risk.permissions),
      { risk: await role(A, "Risk") },
    );

    const presidentBefore = JSON.stringify(await role(A, "President"));
    check(
      "a null permissions list is refused, and the role is left as it was",
      (await refused(
        `update roles set permissions = null where chapter_id = '${A}' and name = 'President'`,
      )) && JSON.stringify(await role(A, "President")) === presidentBefore,
      { president: await role(A, "President") },
    );
    check(
      "a tier cannot carry the wildcard",
      await refused(
        `update role_tiers set permissions = '{*}' where id = '${officers}'`,
      ),
      {},
    );
    check(
      "a tier that still has roles cannot be deleted",
      await refused(`delete from role_tiers where id = '${members}'`),
      {},
    );
    check(
      "a role cannot sit in another chapter's tier",
      await refused(
        `update roles set tier_id = '${await tierId(B, 1)}' where chapter_id = '${A}' and name = 'Member'`,
      ),
      {},
    );
    check(
      "two tiers cannot share a position, and one statement can swap two",
      (await refused(
        `update role_tiers set position = 3 where id = '${officers}'`,
      )) &&
        !(await refused(
          `update role_tiers set position = case position when 2 then 3 else 2 end
            where chapter_id = '${A}' and position in (2, 3)`,
        )),
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
