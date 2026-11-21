import { db, miss } from "../harness.mjs";

console.log(
  "\n=== Functional: a task for everyone makes one copy per member (#4295) ===",
);
{
  // `create_task_group` writes the group, a copy per member and each copy's
  // checklist in one transaction. The unit suites mock the RPC; this is the
  // CI-run proof that the SQL does what the API counts on.
  const CHAPTER = "a4295000-0000-4000-8000-00000000000c";
  const A = "a4295000-0000-4000-8000-0000000000a1";
  const B = "a4295000-0000-4000-8000-0000000000a2";

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${CHAPTER}', 'C', 'U');
      insert into users (id, supabase_auth_id, email, display_name) values
        ('${A}', gen_random_uuid(), 'a4295a@example.test', 'A'),
        ('${B}', gen_random_uuid(), 'a4295b@example.test', 'B');
    `);

    const copies = (
      await db.query(
        `select id, assignee_id, group_id, status, title, point_reward
           from create_task_group(
             $1::uuid, $2::uuid, 'everyone',
             array[$2::uuid, $3::uuid, $3::uuid],
             'Fill out the form', null, date '2026-11-20', null, 5, 'none',
             array['Open it', 'Send it'])`,
        [CHAPTER, A, B],
      )
    ).rows;
    const groupId = copies[0]?.group_id;
    const groups = (
      await db.query(
        `select audience, created_by from task_groups where id = $1`,
        [groupId],
      )
    ).rows;
    const steps = (
      await db.query(
        `select count(*)::int as n from task_subtasks s
           join tasks t on t.id = s.task_id where t.group_id = $1`,
        [groupId],
      )
    ).rows[0].n;
    check(
      "creating a group writes it, one copy per distinct member and each copy's checklist",
      copies.length === 2 &&
        new Set(copies.map((c) => c.assignee_id)).size === 2 &&
        copies.every(
          (c) =>
            c.group_id === groupId &&
            c.status === "TODO" &&
            c.point_reward === 5 &&
            c.title === "Fill out the form",
        ) &&
        groups.length === 1 &&
        groups[0].audience === "everyone" &&
        steps === 4,
      { copies, groups, steps },
    );

    await db.exec("savepoint p4295;");
    let empty = null;
    try {
      await db.query(
        `select * from create_task_group(
           $1::uuid, $2::uuid, 'everyone', array[]::uuid[], 'Nobody', null,
           date '2026-11-20', null, null, 'none', array[]::text[])`,
        [CHAPTER, A],
      );
    } catch (e) {
      empty = String(e?.message ?? e);
    } finally {
      await db.exec("rollback to savepoint p4295;");
    }
    check(
      "a group with no members is refused and leaves no group row",
      /at least one member/.test(empty ?? "") &&
        (
          await db.query(
            `select count(*)::int as n from task_groups where chapter_id = $1`,
            [CHAPTER],
          )
        ).rows[0].n === 1,
      { empty },
    );

    // A group for a role keeps the role and its name as they were (Paul,
    // 2026-11-18); one for a role or group without its id is refused.
    const ROLE = "a4295000-0000-4000-8000-0000000000e1";
    const roleCopies = (
      await db.query(
        `select group_id from create_task_group(
           $1::uuid, $2::uuid, 'role',
           array[$2::uuid], 'Table at the fair', null, date '2026-11-20',
           null, null, 'none', array[]::text[], $3::uuid, 'Recruitment Committee')`,
        [CHAPTER, A, ROLE],
      )
    ).rows;
    const roleGroup = (
      await db.query(
        `select audience, target_id, target_name from task_groups where id = $1`,
        [roleCopies[0]?.group_id],
      )
    ).rows[0];
    await db.exec("savepoint p4295target;");
    let untargeted = null;
    try {
      await db.query(
        `select * from create_task_group(
           $1::uuid, $2::uuid, 'group', array[$2::uuid], 'No group',
           null, date '2026-11-20', null, null, 'none', array[]::text[])`,
        [CHAPTER, A],
      );
    } catch (e) {
      untargeted = String(e?.message ?? e);
    } finally {
      await db.exec("rollback to savepoint p4295target;");
    }
    check(
      "a group for a role keeps its id and name, and one for a group needs its id",
      roleCopies.length === 1 &&
        roleGroup?.audience === "role" &&
        roleGroup?.target_id === ROLE &&
        roleGroup?.target_name === "Recruitment Committee" &&
        /task_groups_target_check/.test(untargeted ?? ""),
      { roleGroup, untargeted },
    );

    // A group for a tier, followed by a group (#5473): every copy carries the
    // follower, and a follower that isn't an entry is refused.
    const TIER = "a5473000-0000-4000-8000-0000000000f1";
    const FOLLOWER = "group:a5473000-0000-4000-8000-0000000000f2";
    const tierCopies = (
      await db.query(
        `select group_id, followed_by from create_task_group(
           $1::uuid, $2::uuid, 'tier',
           array[$2::uuid, $3::uuid], 'Plan the retreat', null,
           date '2026-11-20', null, null, 'none', array[]::text[],
           $4::uuid, 'Exec board', $5)`,
        [CHAPTER, A, B, TIER, FOLLOWER],
      )
    ).rows;
    const tierGroup = (
      await db.query(
        `select audience, target_id from task_groups where id = $1`,
        [tierCopies[0]?.group_id],
      )
    ).rows[0];
    await db.exec("savepoint p5473;");
    let badFollower = null;
    try {
      await db.query(
        `update tasks set followed_by = 'committee:${TIER}' where group_id = $1`,
        [tierCopies[0]?.group_id],
      );
    } catch (e) {
      badFollower = String(e?.message ?? e);
    } finally {
      await db.exec("rollback to savepoint p5473;");
    }
    check(
      "a group for a tier keeps its id, every copy carries its follower, and a malformed follower is refused",
      tierCopies.length === 2 &&
        tierCopies.every((c) => c.followed_by === FOLLOWER) &&
        tierGroup?.audience === "tier" &&
        tierGroup?.target_id === TIER &&
        /tasks_followed_by_check/.test(badFollower ?? ""),
      { tierCopies, tierGroup, badFollower },
    );

    await db.exec(`delete from task_groups where id = '${groupId}';`);
    const kept = (
      await db.query(
        `select count(*)::int as n from tasks where id = any($1::uuid[]) and group_id is null`,
        [copies.map((c) => c.id)],
      )
    ).rows[0].n;
    check(
      "deleting a group's row keeps its copies as ordinary tasks",
      kept === 2,
      { kept },
    );
  } catch (e) {
    check(
      "task-groups scenario ran",
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
      console.log(
        `MISS  ${r.name}\n        ↳ ${JSON.stringify(r.detail ?? null).slice(0, 300)}`,
      );
    }
  }
}
