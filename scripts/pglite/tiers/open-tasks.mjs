import { db, miss } from "../harness.mjs";

console.log(
  "\n=== Functional: a task up for grabs is claimed once and can be given back (2026-11-18) ===",
);
{
  // `claim_open_task` writes one task from a posting under its row lock, and
  // `release_open_task` gives it back. The unit suites mock both RPCs; this is
  // the CI-run proof that the SQL does what the API counts on, refusals and
  // their SQLSTATEs included (the repository maps them to 404, 403 and 409).
  const CHAPTER = "b1180000-0000-4000-8000-00000000000c";
  const OFFICER = "b1180000-0000-4000-8000-0000000000a1";
  const SAM = "b1180000-0000-4000-8000-0000000000a2";
  const ALEX = "b1180000-0000-4000-8000-0000000000a3";

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  // A call's SQLSTATE, or null when it went through; rolled back either way
  // when it fails, so the scenario carries on.
  const codeOf = async (sql, params) => {
    await db.exec("savepoint p1118;");
    try {
      await db.query(sql, params);
      await db.exec("release savepoint p1118;");
      return null;
    } catch (e) {
      await db.exec("rollback to savepoint p1118;");
      return e?.code ?? String(e?.message ?? e);
    }
  };

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${CHAPTER}', 'C', 'U');
      insert into users (id, supabase_auth_id, email, display_name) values
        ('${OFFICER}', gen_random_uuid(), 'b1180a@example.test', 'O'),
        ('${SAM}', gen_random_uuid(), 'b1180b@example.test', 'S'),
        ('${ALEX}', gen_random_uuid(), 'b1180c@example.test', 'A');
    `);

    const posting = (
      await db.query(
        `insert into open_tasks (chapter_id, created_by, title, due_date,
           point_reward, proof_kind, subtask_titles)
         values ($1, $2, 'Drive to the store', date '2026-11-21', 10, 'photo',
           array['Get the list', 'Buy it'])
         returning id`,
        [CHAPTER, OFFICER],
      )
    ).rows[0].id;

    const claimed = (
      await db.query(
        `select id, assignee_id, created_by, status, point_reward, proof_kind
           from claim_open_task($1::uuid, $2::uuid, $3::uuid, null)`,
        [CHAPTER, posting, SAM],
      )
    ).rows;
    const after = (
      await db.query(
        `select status, claimed_task_id, claimed_by from open_tasks where id = $1`,
        [posting],
      )
    ).rows[0];
    const steps = (
      await db.query(
        `select count(*)::int as n from task_subtasks where task_id = $1`,
        [claimed[0]?.id],
      )
    ).rows[0].n;
    check(
      "claiming writes one task from the posting, with its checklist, and marks it claimed",
      claimed.length === 1 &&
        claimed[0].assignee_id === SAM &&
        claimed[0].created_by === OFFICER &&
        claimed[0].status === "TODO" &&
        claimed[0].point_reward === 10 &&
        claimed[0].proof_kind === "photo" &&
        steps === 2 &&
        after.status === "claimed" &&
        after.claimed_task_id === claimed[0].id &&
        after.claimed_by === SAM,
      { claimed, after, steps },
    );

    const second = await codeOf(
      `select * from claim_open_task($1::uuid, $2::uuid, $3::uuid, null)`,
      [CHAPTER, posting, ALEX],
    );
    const missing = await codeOf(
      `select * from claim_open_task($1::uuid, gen_random_uuid(), $2::uuid, null)`,
      [CHAPTER, ALEX],
    );
    check(
      "a second claim is refused with FR409, and an unknown posting with P0002",
      second === "FR409" && missing === "P0002",
      { second, missing },
    );

    const notTheirs = await codeOf(
      `select * from release_open_task($1::uuid, $2::uuid, $3::uuid)`,
      [CHAPTER, claimed[0].id, ALEX],
    );
    await db.query(
      `insert into task_photos (task_id, chapter_id, kind, storage_path)
       values ($1, $2, 'proof', 'chapters/x/tasks/proof-1.jpg')`,
      [claimed[0].id, CHAPTER],
    );
    const withProof = await codeOf(
      `select * from release_open_task($1::uuid, $2::uuid, $3::uuid)`,
      [CHAPTER, claimed[0].id, SAM],
    );
    await db.query(`delete from task_photos where task_id = $1`, [
      claimed[0].id,
    ]);
    check(
      "giving back is refused to anyone but the assignee (42501) and once there's proof (FR409)",
      notTheirs === "42501" && withProof === "FR409",
      { notTheirs, withProof },
    );

    const released = (
      await db.query(
        `select id, status, claimed_task_id, claimed_by, claimed_at
           from release_open_task($1::uuid, $2::uuid, $3::uuid)`,
        [CHAPTER, claimed[0].id, SAM],
      )
    ).rows;
    const taskLeft = (
      await db.query(`select count(*)::int as n from tasks where id = $1`, [
        claimed[0].id,
      ])
    ).rows[0].n;
    const reclaimed = (
      await db.query(
        `select assignee_id from claim_open_task($1::uuid, $2::uuid, $3::uuid, null)`,
        [CHAPTER, posting, ALEX],
      )
    ).rows;
    check(
      "giving it back deletes the task and opens the posting, which can be claimed again",
      released.length === 1 &&
        released[0].id === posting &&
        released[0].status === "open" &&
        released[0].claimed_task_id === null &&
        released[0].claimed_by === null &&
        taskLeft === 0 &&
        reclaimed[0]?.assignee_id === ALEX,
      { released, taskLeft, reclaimed },
    );

    const unclaimed = await codeOf(
      `select * from release_open_task($1::uuid, gen_random_uuid(), $2::uuid)`,
      [CHAPTER, SAM],
    );
    check(
      "giving back a task that wasn't claimed from a posting is refused with P0002",
      unclaimed === "P0002",
      { unclaimed },
    );
  } catch (e) {
    check(
      "open-tasks scenario ran",
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
