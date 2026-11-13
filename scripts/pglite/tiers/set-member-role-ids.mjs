import { db, miss } from "../harness.mjs";

// ─── Functional: set_member_role_ids (20261113184311) ────────────────────────
//
// #4830: `PATCH /v1/members/:id/roles` reads the member, then the chapter's
// roles, then writes. A `delete_role` (20261113164050) committing between
// those reads and the write used to have its id written back, and the
// Everyone it gave dropped. The write now goes through `set_member_role_ids`,
// which writes nothing when the row moved since the read or a newly given
// role is gone.
//
// PGlite is one connection, so no two transactions overlap here and no lock
// is ever waited on. What this tier plays, in order, is each end state the
// locks leave: the delete committed before the save's write (the save is
// refused: the order in which the old write did harm), and the save committed
// before the delete (the delete strips what the save wrote). Which of the two
// a real race lands in is the locks' doing, and a single connection can't
// show that; the tier checks instead that the function still takes them, the
// roles it names before the member row, the order `delete_role` takes them.
// Without that role lock a save giving a role can commit it after a
// concurrent delete scanned for holders, which is the #4830 outcome. The
// overlapping case was run by hand against local Postgres with two
// connections when this landed (#4830); a harness that runs it in CI is
// #4862.
//
// Everything runs inside one transaction and is rolled back.
console.log("\n=== Functional: set_member_role_ids (20261113184311) ===");
{
  const A = "a4830000-0000-4000-8000-00000000000a";
  const B = "b4830000-0000-4000-8000-00000000000b";
  const R = {
    everyone: "a4830000-0000-4000-8000-0000000000e1",
    chair: "a4830000-0000-4000-8000-0000000000e2",
    photo: "a4830000-0000-4000-8000-0000000000e3",
    dj: "a4830000-0000-4000-8000-0000000000e4",
    other: "b4830000-0000-4000-8000-0000000000e1",
  };
  const U = [1, 2, 3, 4, 5].map(
    (n) => `a4830000-0000-4000-8000-00000000000${n}`,
  );
  const STALE = "deadbeef-0000-4000-8000-000000004830";
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const rows = async (text, params = []) => (await db.query(text, params)).rows;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const member = async (user) =>
    (
      await rows(
        `select id::text, role_ids::text[] as ids from members where chapter_id = $1 and user_id = $2`,
        [A, user],
      )
    )[0];
  const write = (memberId, expected, roleIds, chapter = A) =>
    rows(
      `select id::text, role_ids::text[] as ids
         from set_member_role_ids($1::uuid, $2::uuid, $3::text[], $4::text[])`,
      [chapter, memberId, expected, roleIds],
    );

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values
        ('${A}', 'A4830', 'U'), ('${B}', 'B4830', 'U');
      insert into users (id, supabase_auth_id, email) values
        ${U.map((u, i) => `('${u}', gen_random_uuid(), 'u4830-${i}@x.test')`).join(",\n        ")};
      insert into roles (id, chapter_id, name, system_key, is_system, display_order, permissions) values
        ('${R.everyone}', '${A}', 'Everyone', 'MEMBER', true, 5, '{members:view}'),
        ('${R.chair}', '${A}', 'Chair', null, false, 2, '{members:view}'),
        ('${R.photo}', '${A}', 'Photographer', null, false, 7, '{members:view}'),
        ('${R.dj}', '${A}', 'DJ', null, false, 8, '{}'),
        ('${R.other}', '${B}', 'Other', null, false, 7, '{}');
      insert into members (chapter_id, user_id, role_ids) values
        ('${A}', '${U[0]}', '{${R.photo}}'),
        ('${A}', '${U[1]}', '{${R.chair}}'),
        ('${A}', '${U[2]}', '{${R.chair}}'),
        ('${A}', '${U[3]}', '{${STALE},${R.chair}}');
    `);

    // A save that leaves the member's only role on (say, adding the DJ role)
    // reads before the Photographer role is deleted and writes after.
    const solo = await member(U[0]);
    await rows(`select delete_role($1::uuid, $2::uuid)`, [A, R.photo]);
    const lost = await write(solo.id, solo.ids, [R.photo, R.dj]);
    const soloAfter = await member(U[0]);
    check(
      "a save read before a role delete writes nothing after it",
      lost.length === 0,
      { lost },
    );
    check(
      "so the member never ends holding the deleted id",
      !soloAfter.ids.some((id) => id.toLowerCase() === R.photo),
      soloAfter,
    );
    check(
      "and a member whose only role was deleted mid-save still holds Everyone",
      same(soloAfter.ids, [R.everyone]),
      soloAfter,
    );

    // A save giving a role the member never held, deleted between the read
    // and the write: the delete doesn't touch this member's row, so only the
    // live-role check refuses it.
    await db.exec(`
      insert into roles (id, chapter_id, name, is_system, display_order, permissions)
      values ('${R.photo}', '${A}', 'Photographer', false, 7, '{members:view}');
    `);
    const chair = await member(U[1]);
    await rows(`select delete_role($1::uuid, $2::uuid)`, [A, R.photo]);
    const given = await write(chair.id, chair.ids, [R.photo]);
    check(
      "a newly given role deleted after the read is refused",
      given.length === 0 && same((await member(U[1])).ids, [R.chair]),
      { given, after: await member(U[1]) },
    );

    const other = await member(U[2]);
    const ok = await write(other.id, other.ids, [R.chair, R.dj.toUpperCase()]);
    check(
      "an unmoved row is written, a live id stored upper-case included",
      ok.length === 1 && same(ok[0].ids, [R.chair, R.dj.toUpperCase()]),
      { ok },
    );
    const again = await write(other.id, other.ids, [R.chair]);
    check(
      "a second save from the same stale read is refused",
      again.length === 0,
      { again },
    );

    const stale = await member(U[3]);
    const kept = await write(stale.id, stale.ids, [STALE, R.chair, R.dj]);
    check(
      "an id the row already holds may stay though it names no role",
      kept.length === 1 && same(kept[0].ids, [STALE, R.chair, R.dj]),
      { kept },
    );

    const foreignRole = await write(other.id, ok[0].ids, [
      ...ok[0].ids,
      R.other,
    ]);
    check("another chapter's role is refused", foreignRole.length === 0, {
      foreignRole,
    });
    const foreignChapter = await write(other.id, ok[0].ids, [R.chair], B);
    check(
      "a member of another chapter is not written",
      foreignChapter.length === 0 && same((await member(U[2])).ids, ok[0].ids),
      { foreignChapter },
    );

    // The other order: the save commits first, then the role it gave is
    // deleted. The delete strips it and, since nothing else the member holds
    // grants access, gives Everyone.
    const TEMP = "a4830000-0000-4000-8000-0000000000e5";
    await db.exec(`
      insert into roles (id, chapter_id, name, is_system, display_order, permissions)
      values ('${TEMP}', '${A}', 'Rush chair', false, 9, '{members:view}');
      insert into members (chapter_id, user_id, role_ids)
      values ('${A}', '${U[4]}', '{${R.dj}}');
    `);
    const late = await member(U[4]);
    const first = await write(late.id, late.ids, [R.dj, TEMP]);
    await rows(`select delete_role($1::uuid, $2::uuid)`, [A, TEMP]);
    check(
      "a save committed before a delete has the deleted id stripped, and Everyone given",
      first.length === 1 && same((await member(U[4])).ids, [R.dj, R.everyone]),
      { first, after: await member(U[4]) },
    );

    // The locks a single connection can't exercise: the function must still
    // key-share lock the roles it names, before it locks the member row.
    const [{ src }] = await rows(
      `select prosrc as src from pg_proc where proname = 'set_member_role_ids'`,
    );
    const roleLock = src.search(
      /from\s+public\.roles\s+r[^;]*for\s+key\s+share\s*;/i,
    );
    const memberLock = src.search(
      /from\s+public\.members\s+m[^;]*for\s+update\s*;/i,
    );
    check(
      "it key-share locks the named roles before it locks the member row",
      roleLock !== -1 && memberLock !== -1 && roleLock < memberLock,
      { roleLock, memberLock },
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
