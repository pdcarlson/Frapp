import { readFileSync } from "node:fs";
import { join } from "node:path";

import { db, miss } from "../harness.mjs";

// ─── Functional: daily ceilings counted under lock (20261117172019) ────────
//
// Replay runs the migration against empty tables. This tier seeds two
// chapters and two accounts and checks:
//
//   - `create_emailed_invites` inserts a batch that fits under both limits,
//     with the chapter, sender and addresses it was given;
//   - it inserts nothing for a batch that would pass either limit, and
//     answers the counted times of both;
//   - an invite whose send failed (`email_failed_at`), a share-link invite
//     and one made before `p_since` aren't counted; the sender's are counted
//     across chapters;
//   - it locks the chapter before the sender. PGlite is one connection, so
//     the wait itself can't be seen here; the order is checked in the source;
//   - the chapters trigger lets an account start 3 chapters in 24 hours and
//     refuses a fourth with `FR429`, leaves older ones, other accounts and
//     chapters with no starter alone, and locks before it counts.
//
// Everything runs inside one transaction and is rolled back.
console.log(
  "\n=== Functional: daily ceilings counted under lock (20261117172019) ===",
);
{
  const A = "a5400000-0000-4000-8000-00000000000a";
  const B = "a5400000-0000-4000-8000-00000000000b";
  const U = [1, 2, 3].map((n) => `a5400000-0000-4000-8000-00000000000${n}`);
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const rows = async (text, params = []) => (await db.query(text, params)).rows;
  const batch = (n, tag) =>
    JSON.stringify(
      Array.from({ length: n }, (_, i) => ({
        token: `t5400-${tag}-${i}`,
        role: "Member",
        expires_at: "2099-01-01T00:00:00Z",
        email: `${tag}${i}@x.test`,
      })),
    );
  const send = async (chapter, sender, json, chapterLimit, inviterLimit) =>
    (
      await rows(
        `select create_emailed_invites($1::uuid, $2::uuid, $3::jsonb,
                now() - interval '24 hours', $4, $5) as r`,
        [chapter, sender, json, chapterLimit, inviterLimit],
      )
    )[0].r;
  const emailed = async (chapter) =>
    Number(
      (
        await rows(
          `select count(*) as n from invites where chapter_id = $1 and email is not null`,
          [chapter],
        )
      )[0].n,
    );
  // The SQLSTATE a write fails with, or null when it lands.
  const refusal = async (text, params = []) => {
    await db.exec("savepoint try_write");
    try {
      await db.query(text, params);
      await db.exec("release savepoint try_write");
      return null;
    } catch (e) {
      await db.exec("rollback to savepoint try_write");
      return e?.code ?? String(e?.message ?? e);
    }
  };
  const start = (id, user, ago = "0 hours") =>
    refusal(
      `insert into chapters (id, name, university, legal_accepted_by, created_at)
       values ($1::uuid, 'Started', 'U', $2::uuid, now() - $3::interval)`,
      [id, user, ago],
    );
  try {
    await db.exec(`
      begin;
      insert into users (id, supabase_auth_id, email) values
        ${U.map((u, i) => `('${u}', gen_random_uuid(), 'u5400-${i}@x.test')`).join(",\n        ")};
      insert into chapters (id, name, university) values
        ('${A}', 'A5400', 'U'), ('${B}', 'B5400', 'U');
    `);

    // Emailed invites.
    const first = await send(A, U[0], batch(2, "a"), 3, 300);
    const made = await rows(
      `select chapter_id::text, created_by::text, email from invites
        where chapter_id = $1 order by email`,
      [A],
    );
    check(
      "a batch that fits is inserted for the chapter and sender it names",
      first.outcome === "ok" &&
        first.invites.length === 2 &&
        made.length === 2 &&
        made.every((r) => r.chapter_id === A && r.created_by === U[0]) &&
        made[0].email === "a0@x.test",
      { first, made },
    );

    const over = await send(A, U[0], batch(2, "b"), 3, 300);
    check(
      "a batch past the chapter's limit inserts nothing and answers the counted times",
      over.outcome === "over" &&
        over.chapter.length === 2 &&
        over.inviter.length === 2 &&
        (await emailed(A)) === 2,
      { over, count: await emailed(A) },
    );

    await db.query(
      `update invites set email_failed_at = now() where token = 't5400-a-0'`,
    );
    await db.query(
      `insert into invites (token, chapter_id, role, expires_at, created_by, email, created_at)
       values ('t5400-old', $1, 'Member', now() + interval '1 day', $2, 'old@x.test', now() - interval '25 hours'),
              ('t5400-link', $1, 'Member', now() + interval '1 day', $2, null, now())`,
      [A, U[0]],
    );
    const afterFailure = await send(A, U[0], batch(2, "c"), 3, 300);
    check(
      "a failed send, a share link and an invite from before the window don't count",
      afterFailure.outcome === "ok" && (await emailed(A)) === 5,
      { afterFailure, count: await emailed(A) },
    );

    const acrossChapters = await send(B, U[0], batch(1, "d"), 300, 3);
    check(
      "the sender's invites count across chapters",
      acrossChapters.outcome === "over" &&
        acrossChapters.chapter.length === 0 &&
        acrossChapters.inviter.length === 3 &&
        (await emailed(B)) === 0,
      { acrossChapters },
    );
    const otherSender = await send(B, U[1], batch(1, "e"), 300, 3);
    check(
      "another sender in another chapter is unaffected",
      otherSender.outcome === "ok",
      { otherSender },
    );

    const fn = (
      await rows(
        `select prosrc from pg_proc where proname = 'create_emailed_invites'`,
      )
    )[0]?.prosrc;
    const chapterLock = fn?.indexOf("'invite_email_chapter:'") ?? -1;
    const senderLock = fn?.indexOf("'invite_email_sender:'") ?? -1;
    const firstCount = fn?.indexOf("from public.invites") ?? -1;
    check(
      "it locks the chapter, then the sender, before it counts",
      chapterLock !== -1 && chapterLock < senderLock && senderLock < firstCount,
      { chapterLock, senderLock, firstCount },
    );
    const anonExec = (
      await rows(
        `select has_function_privilege('anon', p.oid, 'EXECUTE') as x
           from pg_proc p where proname = 'create_emailed_invites'`,
      )
    )[0]?.x;
    check("clients can't call it", anonExec === false, { anonExec });

    // Chapters started.
    const C = (n) => `a5400000-0000-4000-8000-0000000000c${n}`;
    const old = await start(C(0), U[2], "25 hours");
    const three = [];
    for (const n of [1, 2, 3]) three.push(await start(C(n), U[2]));
    check(
      "an account starts three chapters in 24 hours, one older not counted",
      old === null && three.every((r) => r === null),
      { old, three },
    );
    const fourth = await start(C(4), U[2]);
    check(
      "a fourth is refused with FR429",
      fourth === "FR429" &&
        (await rows(`select 1 from chapters where id = $1`, [C(4)])).length ===
          0,
      { fourth },
    );
    check(
      "another account, and a chapter with no starter, are unaffected",
      (await start(C(5), U[1])) === null &&
        (await refusal(
          `insert into chapters (id, name, university) values ($1, 'S', 'U')`,
          [C(6)],
        )) === null,
      {},
    );
    const trig = (
      await rows(
        `select prosrc from pg_proc where proname = 'chapters_daily_start_ceiling'`,
      )
    )[0]?.prosrc;
    const lock = trig?.indexOf("pg_advisory_xact_lock") ?? -1;
    const count = trig?.indexOf("count(*)") ?? -1;
    check(
      "the trigger locks the starter before it counts",
      lock !== -1 && lock < count,
      { lock, count },
    );

    // A second run of the file changes nothing it depends on.
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20261117172019_daily_limits_counted_under_lock.sql",
      ),
      "utf8",
    );
    await db.exec(sql);
    check(
      "the migration runs twice",
      (await start(C(7), U[2])) === "FR429",
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
