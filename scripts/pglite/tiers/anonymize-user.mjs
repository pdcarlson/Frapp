import { db, miss, runOne } from "../harness.mjs";

// ─── Functional smoke: anonymize_user (FRA-40) ──────────────────────────────
//
// The account-deletion contract (spec/behavior/data-retention.md "Individual
// Account Deletion") is a *data* invariant — "history preserved, PII gone" —
// so shape assertions alone can't pin it. This tier seeds a user with
// preserved history (point transaction, chat messages, task card) plus
// current-state rows (membership, settings, push token), runs the RPC twice
// (the second call proves idempotent retry), asserts the tombstone contract,
// and rolls the whole thing back so the validated schema stays untouched.

console.log("\n=== Functional smoke: anonymize_user ===");
{
  const U = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; // doomed user
  const C = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"; // chapter
  const CH = "cccccccc-cccc-cccc-cccc-cccccccccccc"; // channel
  const CARD = "dddddddd-dddd-dddd-dddd-dddddddddddd"; // task-card message
  const EVCARD = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"; // event-card message
  const PCARD = "ffffffff-ffff-ffff-ffff-ffffffffffff"; // punctuation-name card
  const LATECARD = "99999999-9999-9999-9999-999999999999"; // card racing the scrub
  const OTHER = "77777777-7777-7777-7777-777777777777"; // the other member in a block pair
  const CAND = "88888888-8888-8888-8888-888888888888"; // rush candidate the doomed user voted on

  // ─── change-ping tables stay writable without a `realtime` schema ──────────
  //
  // 20260816140000 (#867) puts AFTER-ROW triggers on notifications / events /
  // event_attendance that call `realtime.send()`. plpgsql resolves that at RUN
  // time, not CREATE time, so a migration referencing a schema this substrate
  // does not have applies perfectly and then makes three core tables
  // unwritable on the first insert — an AFTER trigger raising unwinds the
  // caller's statement, `return null` notwithstanding.
  //
  // This tier exists because nothing else here writes to those three tables:
  // every assertion above stayed green while inserts into them were broken,
  // which is precisely how the defect reached review. Keep at least one write
  // per ping table here.
  // A swallowed ping-trigger failure must still be observable (#978) — each
  // trigger's exception handler now `raise warning`s with SQLERRM before
  // swallowing (labeled "ping trigger failed", not "realtime.send failed":
  // the handler also wraps the `changed` scan above the send call). PGlite
  // has no `realtime` schema, so every insert below already exercises the
  // swallow; capture the notices this exec produces and assert exactly one
  // WARNING per ping table rather than only that the writes survived.
  try {
    const notices = [];
    await db.exec(
      `
      begin;
      insert into chapters (id, name, university)
        values ('11111111-1111-1111-1111-111111111111', 'Ping', 'RPI');
      insert into users (id, supabase_auth_id, email, display_name)
        values ('22222222-2222-2222-2222-222222222222', gen_random_uuid(), 'ping@example.com', 'Ping');
      insert into notifications (chapter_id, user_id, title, body)
        values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 't', 'b');
      insert into events (id, chapter_id, name, start_time, end_time)
        values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
                'probe', now(), now() + interval '1 hour');
      insert into event_attendance (event_id, user_id, status)
        values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'PRESENT');
      commit;
    `,
      { onNotice: (n) => notices.push(n) },
    );
    console.log("OK    change-ping tables accept writes with no `realtime` schema");

    const warnings = notices.filter((n) => n.severity === "WARNING");
    const pingTables = ["notifications", "events", "event_attendance"];
    // Exact count, not merely "at least one": each table's trigger fires
    // once for this transaction (one INSERT each), so a table reporting
    // zero or more than one WARNING is itself a regression worth catching
    // — e.g. a future migration accidentally double-registering a trigger.
    const counts = Object.fromEntries(
      pingTables.map((t) => [
        t,
        warnings.filter((n) => new RegExp(`ping trigger failed for ${t}\\b`).test(n.message ?? "")).length,
      ]),
    );
    const wrongCount = pingTables.filter((t) => counts[t] !== 1);
    if (wrongCount.length === 0) {
      console.log("OK    each swallowed realtime.send failure raised exactly one observable WARNING");
    } else {
      miss();
      console.log(
        `ERR   each swallowed realtime.send failure raised exactly one observable WARNING\n        ↳ wrong count for: ${wrongCount.map((t) => `${t}=${counts[t]}`).join(", ")} (got ${warnings.length} warning(s) total: ${JSON.stringify(warnings.map((n) => n.message))})`,
      );
    }
  } catch (e) {
    miss();
    console.log(
      `ERR   change-ping tables accept writes with no \`realtime\` schema\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
    );
  }

  let seeded = false;
  try {
    await db.exec(`
      begin;
      insert into users (id, supabase_auth_id, email, display_name, bio, avatar_url, graduation_year, current_city)
      values ('${U}', gen_random_uuid(), 'doomed@example.com', 'Doomed User', 'bio', 'chapters/${C}/profiles/${U}/a.png', 2027, 'Troy');
      insert into chapters (id, name, university) values ('${C}', 'Smoke', 'RPI');
      insert into members (user_id, chapter_id) values ('${U}', '${C}');
      insert into point_transactions (chapter_id, user_id, amount, category, description)
      values ('${C}', '${U}', 5, 'SERVICE', 'helped');
      insert into chat_channels (id, chapter_id, name, type) values ('${CH}', '${C}', 'general', 'PUBLIC');
      insert into chat_messages (channel_id, sender_id, content) values ('${CH}', '${U}', 'hi, Doomed User here');
      insert into chat_messages (id, channel_id, sender_id, content, kind, payload)
      values ('${CARD}', '${CH}', '${U}',
              'Assigned "T" to Doomed User (due tomorrow) cc Doomed Userling', 'task',
              '{"assigner_user_id":"someone-else","assigner_name":"Someone Else","assignee_user_id":"${U}","assignee_name":"Doomed User"}'::jsonb);
      insert into chat_messages (id, channel_id, sender_id, content, kind, payload)
      values ('${EVCARD}', '${CH}', '${U}',
              'Doomed User scheduled "BBQ" — Aug 9, 6:00 PM UTC', 'event',
              '{"event_id":"ev1","name":"BBQ"}'::jsonb);
      -- Punctuation-bounded snapshot: word boundaries can never match it, so
      -- the helper must fall back to exact-substring replacement.
      insert into chat_messages (id, channel_id, sender_id, content, kind, payload)
      values ('${PCARD}', '${CH}', '${U}',
              'Granted 5 points to (DU) Doomed: nice work', 'points',
              '{"actor_user_id":"someone-else","actor_name":"Someone Else","recipient_user_id":"${U}","recipient_name":"(DU) Doomed"}'::jsonb);
      insert into user_settings (user_id) values ('${U}');
      insert into push_tokens (user_id, token) values ('${U}', 'ExponentPushToken[smoke]');
      -- #2257 safety state. The asymmetry below is the property under test:
      -- the doomed user's OWN block goes, the block another member placed
      -- AGAINST them stays (purging it would let a reported member clear every
      -- block standing against him by deleting his account), and the report
      -- they filed stays because it is moderation history. Plus #494's rush
      -- ballot, whose purge line this same migration adds.
      insert into users (id, supabase_auth_id, email, display_name)
      values ('${OTHER}', gen_random_uuid(), 'other@example.com', 'Other Member');
      insert into chat_member_blocks (chapter_id, blocker_user_id, blocked_user_id)
      values ('${C}', '${U}', '${OTHER}'), ('${C}', '${OTHER}', '${U}');
      insert into chat_message_reports (chapter_id, message_id, reporter_user_id, reason, reported_content)
      values ('${C}', '${CARD}', '${U}', 'harassment',
              'Assigned "T" to Doomed User (due tomorrow) cc Doomed Userling');
      -- The other direction, which is the one carrying the abuse vector: a
      -- report filed BY someone else ABOUT the departing member. A symmetric
      -- "purge everything about them" would wipe the moderation queue about a
      -- member who is deleting his account to escape it.
      insert into chat_message_reports (chapter_id, message_id, reporter_user_id, reported_sender_id, reason)
      values ('${C}', '${EVCARD}', '${OTHER}', '${U}', 'spam');
      insert into rush_candidates (id, chapter_id, display_name, created_by)
      values ('${CAND}', '${C}', 'Prospect', '${OTHER}');
      insert into rush_candidate_votes (candidate_id, chapter_id, voter_id)
      values ('${CAND}', '${C}', '${U}');
      -- #2877: the member's own sidebar arrangement.
      insert into chat_sidebar_preferences (user_id, chapter_id, hide_muted, collapsed_sections)
      values ('${U}', '${C}', true, array['direct']);
      insert into chat_sidebar_pins (user_id, chapter_id, channel_id)
      values ('${U}', '${C}', '${CH}');
      -- Rename before deletion: the content rewrite must key on the card's own
      -- payload snapshot ('Doomed User'), not the live display name.
      update users set display_name = 'D' where id = '${U}';
      select anonymize_user('${U}');
      -- Simulate the retry window: the tombstone gets PII written back onto it
      -- (PATCH /users/me is possible while the auth account still exists). The
      -- second call must RE-scrub the users row — no tombstone early-return —
      -- while skipping the card scan (retries stay cheap).
      update users set display_name = 'Sneaky Comeback', bio = 'still here' where id = '${U}';
      select anonymize_user('${U}');
      -- Simulate a card writer that raced the first scrub: its snapshot lands
      -- after the one gated card scan. The convergence call (rescan=true) must
      -- repair it.
      insert into chat_messages (id, channel_id, sender_id, content, kind, payload)
      values ('${LATECARD}', '${CH}', '${U}',
              'Assigned "Z" to Doomed User (due later)', 'task',
              '{"assigner_user_id":"someone-else","assigner_name":"Someone Else","assignee_user_id":"${U}","assignee_name":"Doomed User"}'::jsonb);
      select anonymize_user('${U}', true);
    `);
    seeded = true;
  } catch (e) {
    miss();
    console.log(
      `ERR   anonymize_user functional seed\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
    );
  }

  if (seeded) {
    const FUNCTIONAL = [
      {
        name: "users row tombstoned in place, re-scrubbed on retry (PII re-added in the window is gone)",
        sql: `select display_name, email, bio, avatar_url, graduation_year, current_city,
                     (deleted_at is not null) as tombstoned
                from users where id = '${U}'`,
        ok: (rows) =>
          rows.length === 1 &&
          rows[0].display_name === "Deleted User" &&
          rows[0].email === `deleted+${U}@anonymized.invalid` &&
          rows[0].bio === null &&
          rows[0].avatar_url === null &&
          rows[0].graduation_year === null &&
          rows[0].current_city === null &&
          rows[0].tombstoned === true,
      },
      {
        name: "history preserved: point transaction + chat messages keep their user FKs",
        sql: `select (select count(*)::int from point_transactions where user_id = '${U}') as points,
                     (select count(*)::int from chat_messages where sender_id = '${U}') as messages`,
        ok: (rows) =>
          rows.length === 1 && rows[0].points === 1 && rows[0].messages === 5,
      },
      {
        name: "current-state purged: membership, settings, push token",
        sql: `select (select count(*)::int from members where user_id = '${U}')
                   + (select count(*)::int from user_settings where user_id = '${U}')
                   + (select count(*)::int from push_tokens where user_id = '${U}') as leftovers`,
        ok: (rows) => rows.length === 1 && rows[0].leftovers === 0,
      },
      {
        // #2257. The delete block has been hand-copied forward twice
        // (20260803140000 -> 20260902160000 -> 20260915210100) and each
        // omission so far was caught only by a human diffing the body. These
        // two assertions are the regression guard for the safety-relevant
        // half, in BOTH directions: a future copy that drops the purge fails
        // the first, and one that over-purges -- deleting blocks against the
        // departing member, or their reports -- fails the second.
        name: "current-state purged: own block list, rush ballots",
        sql: `select (select count(*)::int from chat_member_blocks where blocker_user_id = '${U}')
                   + (select count(*)::int from rush_candidate_votes where voter_id = '${U}') as leftovers`,
        ok: (rows) => rows.length === 1 && rows[0].leftovers === 0,
      },
      {
        // #2877. The fourth hand copy of the delete block
        // (20260929213000); a copy that drops either line fails here.
        name: "current-state purged: sidebar preferences, sidebar pins",
        sql: `select (select count(*)::int from chat_sidebar_preferences where user_id = '${U}')
                   + (select count(*)::int from chat_sidebar_pins where user_id = '${U}') as leftovers`,
        ok: (rows) => rows.length === 1 && rows[0].leftovers === 0,
      },
      {
        // Exact counts, not `>= 0`: an over-purge gives 0 and a spurious
        // duplicate gives 2, so both directions fail. reports_against is the
        // one that matters most -- it is the queue ABOUT the departing member,
        // which a symmetric purge would let him erase by leaving.
        name: "safety state RETAINED: blocks against them, reports they filed, reports about them",
        sql: `select (select count(*)::int from chat_member_blocks where blocked_user_id = '${U}') as blocked_by,
                     (select count(*)::int from chat_message_reports where reporter_user_id = '${U}') as reports,
                     (select count(*)::int from chat_message_reports where reported_sender_id = '${U}') as reports_against`,
        ok: (rows) =>
          rows.length === 1 &&
          rows[0].blocked_by === 1 &&
          rows[0].reports === 1 &&
          rows[0].reports_against === 1,
      },
      {
        // #2257. reported_content is a second copy of chat_messages.content, so
        // the card scrub has to reach it too or a scrubbed display name
        // survives verbatim in a table nothing ever purges.
        name: "report evidence snapshot scrubbed alongside the card it copies",
        sql: `select reported_content from chat_message_reports where message_id = '${CARD}'`,
        // Exactly the string the sibling assertion above pins for
        // chat_messages.content, including the 'Doomed Userling' that word
        // boundaries must leave alone -- the snapshot has to track the message
        // it copies precisely, not merely stop saying 'Doomed User'.
        ok: (rows) =>
          rows.length === 1 &&
          rows[0].reported_content ===
            'Assigned "T" to Deleted User (due tomorrow) cc Doomed Userling',
      },
      {
        name: "task card rewritten in payload AND content via payload snapshot (rename-proof, word-boundary safe)",
        sql: `select payload->>'assigner_name' as assigner, payload->>'assignee_name' as assignee,
                     content
                from chat_messages where id = '${CARD}'`,
        ok: (rows) =>
          rows.length === 1 &&
          rows[0].assigner === "Someone Else" &&
          rows[0].assignee === "Deleted User" &&
          // 'Doomed Userling' must survive — word boundaries prevent the
          // substring collision the raw replace() had.
          rows[0].content ===
            'Assigned "T" to Deleted User (due tomorrow) cc Doomed Userling',
      },
      {
        name: "event card creator prefix rewritten in content (no payload name to rewrite)",
        sql: `select content, payload->>'name' as event_name
                from chat_messages where id = '${EVCARD}'`,
        ok: (rows) =>
          rows.length === 1 &&
          rows[0].content === 'Deleted User scheduled "BBQ" — Aug 9, 6:00 PM UTC' &&
          rows[0].event_name === "BBQ",
      },
      {
        name: "punctuation-bounded snapshot rewritten via exact-substring fallback",
        sql: `select payload->>'recipient_name' as recipient, content
                from chat_messages where id = '${PCARD}'`,
        ok: (rows) =>
          rows.length === 1 &&
          rows[0].recipient === "Deleted User" &&
          rows[0].content === "Granted 5 points to Deleted User: nice work",
      },
      {
        name: "card that raced the first scrub is repaired by the rescan (convergence) call",
        sql: `select payload->>'assignee_name' as assignee, content
                from chat_messages where id = '${LATECARD}'`,
        ok: (rows) =>
          rows.length === 1 &&
          rows[0].assignee === "Deleted User" &&
          rows[0].content === 'Assigned "Z" to Deleted User (due later)',
      },
      {
        name: "member-typed free text is NOT rewritten (only system-generated cards)",
        sql: `select content from chat_messages
               where sender_id = '${U}' and kind = 'text'`,
        ok: (rows) => rows.length === 1 && rows[0].content === "hi, Doomed User here",
      },
    ];
    for (const lm of FUNCTIONAL) await runOne(lm);
  }

  await db.exec("rollback;");
}
