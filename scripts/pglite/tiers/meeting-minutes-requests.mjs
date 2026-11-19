import { db, miss } from "../harness.mjs";

console.log("\n=== Functional: asking for unposted minutes, one reminder a day (#5471) ===");
{
  // The spam guard lives in `request_meeting_minutes`, which every unit suite
  // mocks: a member asks once per meeting, a meeting sends at most one
  // reminder per cooldown, held-back asks are counted into the next one,
  // `release_meeting_minutes_ping` undoes a reminder the API couldn't send,
  // and posting the minutes or deleting an account clears what it should.
  const CHAPTER = "a5471000-0000-4000-8000-00000000000c";
  const OTHER_CHAPTER = "a5471000-0000-4000-8000-00000000000d";
  const AUTHOR = "a5471000-0000-4000-8000-0000000000a0";
  const [A, B, C, D] = [1, 2, 3, 4].map(
    (n) => `a5471000-0000-4000-8000-0000000000b${n}`,
  );
  const EVENT = "a5471000-0000-4000-8000-0000000000e1";
  const MEETING = "a5471000-0000-4000-8000-0000000000f1";
  const DAY = 86400;

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const ask = async (userId, chapterId = CHAPTER) =>
    (
      await db.query(
        `select requested, ping, asked from request_meeting_minutes($1, $2, $3, $4)`,
        [MEETING, chapterId, userId, DAY],
      )
    ).rows[0];
  const count = async (sql) => (await db.query(sql)).rows[0].n;
  const age = (interval) =>
    db.exec(
      `update meeting_minutes_request_pings set pinged_at = pinged_at - interval '${interval}'
        where meeting_id = '${MEETING}';
       update meeting_minutes_requests set announced_at = announced_at - interval '${interval}'
        where meeting_id = '${MEETING}' and announced_at is not null;`,
    );

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values
        ('${CHAPTER}', 'C', 'U'), ('${OTHER_CHAPTER}', 'D', 'U');
      insert into users (id, supabase_auth_id, email, display_name) values
        ('${AUTHOR}', gen_random_uuid(), 'a5471a@example.test', 'Author'),
        ('${A}', gen_random_uuid(), 'a5471b1@example.test', 'A'),
        ('${B}', gen_random_uuid(), 'a5471b2@example.test', 'B'),
        ('${C}', gen_random_uuid(), 'a5471b3@example.test', 'C'),
        ('${D}', gen_random_uuid(), 'a5471b4@example.test', 'D');
      insert into events (id, chapter_id, name, start_time, end_time)
        values ('${EVENT}', '${CHAPTER}', 'Chapter', now() - interval '2 hours', now() - interval '1 hour');
      insert into meetings (id, chapter_id, event_id, event_name, event_start_time, meeting_type, status, created_by)
        values ('${MEETING}', '${CHAPTER}', '${EVENT}', 'Chapter', now() - interval '2 hours', 'chapter', 'draft', '${AUTHOR}');
    `);

    const first = await ask(A);
    check("the first ask sends a reminder that speaks for one", first?.requested && first?.ping && first?.asked === 1, first);

    const again = await ask(A);
    check("the same member asking again changes nothing", again && !again.requested && !again.ping, again);

    const held = await ask(B);
    check("another ask the same day is recorded but held back", held?.requested && !held?.ping && held?.asked === 0, held);

    const wrong = await ask(C, OTHER_CHAPTER);
    check("an ask through another chapter finds no minutes", wrong && !wrong.requested && !wrong.ping, wrong);

    await db.exec(`update users set deleted_at = now() where id = '${A}';`);
    const afterDelete = await ask(C);
    check(
      "deleting the account whose ask sent the reminder keeps the day's limit",
      afterDelete?.requested && !afterDelete?.ping,
      afterDelete,
    );

    await age("25 hours");
    const nextDay = await ask(D);
    check("the next day's ask reminds again, counting the asks held back", nextDay?.ping && nextDay?.asked === 3, nextDay);

    await db.exec(`select release_meeting_minutes_ping('${MEETING}', '${CHAPTER}', '${D}');`);
    const released = await count(
      `select count(*)::int as n from meeting_minutes_requests
        where meeting_id = '${MEETING}' and announced_at is null`,
    );
    const retry = await ask(D);
    check(
      "a reminder the API couldn't send is undone: its asks wait again and the member can ask again",
      released === 2 && retry?.ping && retry?.asked === 3,
      { released, retry },
    );

    await db.exec(`update meetings set status = 'posted', posted_at = now() where id = '${MEETING}';`);
    const left = await count(
      `select (select count(*) from meeting_minutes_requests where meeting_id = '${MEETING}')
            + (select count(*) from meeting_minutes_request_pings where meeting_id = '${MEETING}') as n`,
    );
    const posted = await ask(B);
    check("posting the minutes clears their asks and stops new ones", Number(left) === 0 && !posted?.requested, { left, posted });
  } catch (e) {
    check("meeting-minutes-requests scenario ran", false, String(e?.message ?? e).split("\n")[0]);
  } finally {
    await db.exec("rollback;").catch(() => {});
  }

  for (const r of results) {
    if (r.ok) {
      console.log(`OK    ${r.name}`);
    } else {
      miss();
      console.log(`MISS  ${r.name}\n        ↳ ${JSON.stringify(r.detail ?? null).slice(0, 300)}`);
    }
  }
}
