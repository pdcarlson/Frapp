import { db, miss } from "../harness.mjs";

console.log(
  "\n=== Functional: sign-up sheet claims keep to each slot's limit (#3926) ===",
);
{
  // `claim_signup_slots` is the only thing that keeps a sign-up sheet's slot
  // to its limit, and every API test mocks it. This is the CI-run proof of its
  // rules: other members' claims fill a slot and refuse the next one, a slot
  // the member already holds is never full to them, an unknown slot and a
  // card that isn't a sign-up are refused, a change of slots updates the one
  // row and keeps its first time, and nobody but the API may call it. PGlite
  // has one connection, so the row lock that serializes two taps at once is
  // read from the function's text rather than raced.
  const CHAPTER = "a3926000-0000-4000-8000-00000000000c";
  const CHANNEL = "a3926000-0000-4000-8000-0000000000c1";
  const CARD = "a3926000-0000-4000-8000-0000000000d1";
  const TEXT = "a3926000-0000-4000-8000-0000000000d2";
  const [A, B, C] = ["a1", "a2", "a3"].map(
    (s) => `a3926000-0000-4000-8000-0000000000${s}`,
  );
  const card = {
    title: "Sober drivers",
    slots: [
      { id: "fri", label: "Friday", capacity: 2 },
      { id: "sat", label: "Saturday", capacity: null },
    ],
  };

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const claim = async (user, slots, messageId = CARD) => {
    await db.exec("savepoint s3926;");
    try {
      const { rows } = await db.query(
        `select claim_signup_slots($1, $2, $3::text[]) as r`,
        [messageId, user, slots],
      );
      await db.exec("release savepoint s3926;");
      return { ok: rows[0].r };
    } catch (e) {
      await db.exec("rollback to savepoint s3926;");
      return { error: String(e?.message ?? e) };
    }
  };

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${CHAPTER}', 'C', 'U');
      insert into users (id, supabase_auth_id, email, display_name) values
        ('${A}', gen_random_uuid(), 'a3926a@example.test', 'A'),
        ('${B}', gen_random_uuid(), 'a3926b@example.test', 'B'),
        ('${C}', gen_random_uuid(), 'a3926c@example.test', 'C');
      insert into chat_channels (id, chapter_id, name, type, member_ids) values
        ('${CHANNEL}', '${CHAPTER}', 'general', 'PUBLIC', '{}'::uuid[]);
      insert into chat_messages (id, channel_id, sender_id, content, kind, payload) values
        ('${CARD}', '${CHANNEL}', '${A}', 'Sober drivers', 'signup', '${JSON.stringify(card)}'),
        ('${TEXT}', '${CHANNEL}', '${A}', 'hi', 'text', null);
    `);

    const a = await claim(A, ["fri"]);
    const b = await claim(B, ["fri", "sat"]);
    const c = await claim(C, ["fri"]);
    check(
      "two members fill a slot of two, and the third is refused",
      a.ok?.updated === false &&
        b.ok?.updated === false &&
        /signup_slot_full/.test(c.error ?? ""),
      { a, b, c },
    );

    const before = (
      await db.query(
        `select created_at from chat_message_actions where message_id = $1 and user_id = $2`,
        [CARD, A],
      )
    ).rows[0].created_at;
    const aMore = await claim(A, ["fri", "sat"]);
    const after = await db.query(
      `select count(*)::int as n, min(created_at) as at from chat_message_actions
        where message_id = $1 and user_id = $2 and action_type = 'signup'`,
      [CARD, A],
    );
    check(
      "a slot the member holds is never full to them; the change updates their one row and keeps its time",
      aMore.ok?.updated === true &&
        after.rows[0].n === 1 &&
        String(after.rows[0].at) === String(before),
      { aMore, after: after.rows[0], before },
    );

    const unlimited = await claim(C, ["sat"]);
    const unknown = await claim(C, ["sun"]);
    const notSignup = await claim(C, ["fri"], TEXT);
    check(
      "a slot with no limit takes anyone; an unknown slot and a card that isn't a sign-up are refused",
      !!unlimited.ok &&
        /signup_slot_unknown/.test(unknown.error ?? "") &&
        /signup_card_missing/.test(notSignup.error ?? ""),
      { unlimited, unknown, notSignup },
    );

    const dropped = await claim(B, []);
    const cAgain = await claim(C, ["fri", "sat"]);
    check(
      "giving up a slot frees its spot",
      dropped.ok?.updated === true && cAgain.ok?.updated === true,
      { dropped, cAgain },
    );

    const def = (
      await db.query(
        `select pg_get_functiondef('public.claim_signup_slots(uuid, uuid, text[])'::regprocedure) as d`,
      )
    ).rows[0].d;
    check(
      "claims on one card run one at a time: the card's row is locked first",
      /from chat_messages m[\s\S]*for update/i.test(def),
      null,
    );

    const grants = (
      await db.query(
        `select
           has_function_privilege('authenticated', 'public.claim_signup_slots(uuid, uuid, text[])', 'execute') as authed,
           has_function_privilege('service_role', 'public.claim_signup_slots(uuid, uuid, text[])', 'execute') as service`,
      )
    ).rows[0];
    check(
      "only the API may call it",
      grants.authed === false && grants.service === true,
      grants,
    );
  } catch (e) {
    check(
      "signup-card-claims scenario ran",
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
