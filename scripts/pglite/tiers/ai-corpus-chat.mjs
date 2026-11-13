import { db, miss } from "../harness.mjs";

// ─── Functional: chat in the AI corpus (20261112170000, #4314) ──────────────
//
// The database half of chat as a source. The API decides whose messages are
// read (consent); the database decides which messages exist to be read, and
// makes sure a change to them reaches the index. This tier runs the real SQL.
//
//   NEVER A DM
//   - turning chat on enrols public, private and role-gated channels, and no
//     DM, group DM or audit-log channel;
//   - a message in a DM never makes a window;
//   - the window read refuses a DM window even when one is planted by hand,
//     so the rule holds in the query, not only in its callers.
//
//   THE SWITCH
//   - with the chapter's chat switch off, a message writes nothing;
//   - turning it on enrols the chapter's history, one window per channel
//     and day, a thread's replies on their root's day, a late-night message
//     on the evening it belongs to;
//   - turning it off deletes every chat window, source and passage of the
//     chapter, and nothing of another chapter's.
//
//   FOLLOWING THE CHAT
//   - a new message, an edit, a delete and a linked Discord author each drop
//     the window's passages at once and put it back in line within ten
//     minutes; a pin or a thread's reply count does not;
//   - a busy window keeps its turn instead of being pushed back per message;
//   - a two-thousand-row insert in one statement makes one window per day;
//   - deleting a channel deletes its windows, sources and passages.
//
//   CHANGES OF MIND AND RETRIEVAL
//   - passages carry their authors and first message, and retrieval returns
//     them with the window's channel and left-out count;
//   - requeueing by author drops every passage by that member and every
//     window that left them out, in their chapter only or in all of them;
//   - the authors listing tells indexed from left out;
//   - documents are claimed before chat;
//   - neither client role may execute any of the new functions.
//
// Everything runs inside one transaction and is rolled back.
console.log("\n=== Functional: chat in the AI corpus (20261112170000, #4314) ===");
{
  const CH = "a4314000-0000-4000-8000-00000000000a";
  const CH2 = "a4314000-0000-4000-8000-00000000000b";
  const U1 = "a4314000-0000-4000-8000-0000000000a1";
  const U2 = "a4314000-0000-4000-8000-0000000000a2";
  const GEN = "a4314000-0000-4000-8000-0000000000c1";
  const PRIV = "a4314000-0000-4000-8000-0000000000c2";
  const DM = "a4314000-0000-4000-8000-0000000000c3";
  const GDM = "a4314000-0000-4000-8000-0000000000c4";
  const AUDIT = "a4314000-0000-4000-8000-0000000000c5";
  const GEN2 = "a4314000-0000-4000-8000-0000000000c6";
  const ROOT = "a4314000-0000-4000-8000-0000000000e1";
  const REPLY = "a4314000-0000-4000-8000-0000000000e2";
  const LATE = "a4314000-0000-4000-8000-0000000000e3";
  const DOC = "a4314000-0000-4000-8000-0000000000d1";
  const MODEL = "gemini-embedding-001";
  const FP = `${MODEL}.1536.p1`;
  const VEC = `[${Array.from({ length: 1536 }, (_, n) => (n === 0 ? 1 : 0)).join(",")}]`;

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const rows = async (text, params = []) => (await db.query(text, params)).rows;
  const one = async (text, params = []) => (await rows(text, params))[0];
  const windows = (chapter) =>
    rows(
      `select w.id, w.channel_id, w.day::text as day
         from corpus_chat_windows w where w.chapter_id = $1
        order by w.channel_id, w.day`,
      [chapter],
    );
  const chatSource = (windowId) =>
    one(
      `select * from corpus_sources
        where source_type = 'chat_message' and source_id = $1`,
      [windowId],
    );
  const windowOf = (channel, day) =>
    one(`select id from corpus_chat_windows where channel_id = $1 and day = $2`, [
      channel,
      day,
    ]);
  const chunkCount = async (sourceRowId) =>
    (
      await one(
        `select count(*)::int as n from corpus_chunks where corpus_source_id = $1`,
        [sourceRowId],
      )
    ).n;
  // Index a window by hand, as the API would: one passage by `authors`.
  const index = async (source, authors, leftOut = []) => {
    await db.query(`select write_corpus_chunks($1, $2, true, $3, $4::jsonb)`, [
      source.id,
      source.revision,
      MODEL,
      JSON.stringify([
        {
          chunk_index: 0,
          heading: "#general",
          content: "Who has the van keys? I do, they are on the hook.",
          page_start: null,
          page_end: null,
          embedding: VEC,
          author_ids: authors,
          anchor_id: ROOT,
          anchor_at: "2026-11-09T22:00:00Z",
          message_count: 2,
        },
      ]),
    ]);
    await db.query(
      `select finish_corpus_source($1, $2, $3, '#general', now(), true, 1, null, $4, $5::uuid[])`,
      [source.id, source.revision, FP, leftOut.length, leftOut],
    );
  };

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values
        ('${CH}', 'Chat A', 'U'), ('${CH2}', 'Chat B', 'U');
      insert into users (id, supabase_auth_id, email, display_name) values
        ('${U1}', gen_random_uuid(), 'chat-1@test.local', 'Sam Ortiz'),
        ('${U2}', gen_random_uuid(), 'chat-2@test.local', 'Lee Park');
      insert into members (user_id, chapter_id) values
        ('${U1}', '${CH}'), ('${U2}', '${CH}'), ('${U1}', '${CH2}');
      insert into chat_channels (id, chapter_id, name, type, member_ids, is_audit_log) values
        ('${GEN}', '${CH}', 'general', 'PUBLIC', null, false),
        ('${PRIV}', '${CH}', 'exec', 'PRIVATE', array['${U1}']::uuid[], false),
        ('${DM}', '${CH}', 'dm-a-b', 'DM', array['${U1}', '${U2}']::uuid[], false),
        ('${GDM}', '${CH}', 'trip', 'GROUP_DM', array['${U1}', '${U2}']::uuid[], false),
        ('${AUDIT}', '${CH}', 'chapter-audit', 'PUBLIC', null, true),
        ('${GEN2}', '${CH2}', 'general', 'PUBLIC', null, false);
      -- History before the switch exists: November 9 evening, a reply the
      -- next morning, and a message at 03:00 UTC on November 10 that belongs
      -- to the evening of the 9th.
      insert into chat_messages (id, channel_id, sender_id, content, created_at) values
        ('${ROOT}', '${GEN}', '${U1}', 'Who has the van keys?', '2026-11-09T22:00:00Z'),
        ('${LATE}', '${GEN}', '${U2}', 'still up, anyone?', '2026-11-10T03:00:00Z');
      insert into chat_messages (id, channel_id, sender_id, content, created_at, thread_root_id) values
        ('${REPLY}', '${GEN}', '${U2}', 'I do, on the hook.', '2026-11-11T14:00:00Z', '${ROOT}');
      insert into chat_messages (channel_id, sender_id, content, created_at) values
        ('${PRIV}', '${U1}', 'budget draft attached', '2026-11-09T20:00:00Z'),
        ('${DM}', '${U1}', 'a private word', '2026-11-09T20:00:00Z'),
        ('${GDM}', '${U2}', 'road trip plans', '2026-11-09T20:00:00Z'),
        ('${AUDIT}', '${U1}', 'Sam changed a role', '2026-11-09T20:00:00Z'),
        ('${GEN2}', '${U1}', 'other chapter talk', '2026-11-09T20:00:00Z');
    `);

    check(
      "with no chat switch on, messages write no window and no source",
      (await windows(CH)).length === 0 &&
        (await one(`select count(*)::int as n from corpus_sources where source_type = 'chat_message'`)).n === 0,
      {},
    );

    // ── The switch on: history is enrolled ───────────────────────────────
    await db.exec(`
      insert into chapter_ai_settings (chapter_id, ask_enabled, chat_source_enabled)
      values ('${CH}', true, true);
    `);
    const enrolled = await windows(CH);
    check(
      "turning chat on enrols one window per channel and day: #general's evening (reply and late message included) and #exec",
      enrolled.length === 2 &&
        enrolled.some((w) => w.channel_id === GEN && w.day === "2026-11-09") &&
        enrolled.some((w) => w.channel_id === PRIV && w.day === "2026-11-09"),
      { enrolled },
    );
    check(
      "no DM, group DM or audit-log channel is enrolled",
      enrolled.every((w) => ![DM, GDM, AUDIT].includes(w.channel_id)),
      { enrolled },
    );
    check(
      "another chapter's channels are not enrolled",
      (await windows(CH2)).length === 0,
      {},
    );
    const genWin = await windowOf(GEN, "2026-11-09");
    const genSrc = await chatSource(genWin.id);
    check(
      "each enrolled window has a waiting chat source that decays",
      genSrc?.status === "pending" && genSrc.decays === true && genSrc.chapter_id === CH,
      { genSrc },
    );

    // ── The window read ──────────────────────────────────────────────────
    const read = await rows(`select * from read_chat_corpus_window($1, $2)`, [CH, genWin.id]);
    check(
      "the window read returns the evening in order, the thread reply right after its root, with names",
      read.map((r) => r.message_id).join() === [ROOT, REPLY, LATE].join() &&
        read[0].channel_name === "general" &&
        read[0].sender_name === "Sam Ortiz" &&
        read[1].conversation_at.toISOString() === "2026-11-09T22:00:00.000Z",
      { read: read.map((r) => [r.message_id, r.sender_name]) },
    );
    check(
      "the window read refuses the window from another chapter",
      (await rows(`select * from read_chat_corpus_window($1, $2)`, [CH2, genWin.id])).length === 0,
      {},
    );
    // A window planted on a DM by hand: the read must still refuse it.
    const planted = await one(
      `insert into corpus_chat_windows (chapter_id, channel_id, day)
       values ($1, $2, '2026-11-09') returning id`,
      [CH, DM],
    );
    check(
      "the window read and the channel lookup refuse a DM window, even one planted by hand",
      (await rows(`select * from read_chat_corpus_window($1, $2)`, [CH, planted.id])).length === 0 &&
        (await rows(`select * from chat_corpus_window_channels($1, $2::uuid[])`, [CH, [planted.id, genWin.id]]))
          .map((r) => r.window_id)
          .join() === genWin.id,
      {},
    );
    await db.query(`delete from corpus_chat_windows where id = $1`, [planted.id]);

    // ── Indexing and retrieval ───────────────────────────────────────────
    await index(genSrc, [U1, U2], [U2]);
    const matched = await rows(
      `select * from match_corpus_chunks($1, $2, 'van keys', $3, $4, 40)`,
      [CH, U1, VEC, MODEL],
    );
    check(
      "retrieval returns a chat passage with its authors, first message, channel and left-out count",
      matched.length === 1 &&
        matched[0].source_type === "chat_message" &&
        matched[0].channel_id === GEN &&
        matched[0].anchor_id === ROOT &&
        matched[0].author_ids.slice().sort().join() === [U1, U2].sort().join() &&
        matched[0].left_out_count === 1 &&
        matched[0].message_count === 2,
      { matched },
    );

    // Narrowing (20261113204057, #4900): each argument can only remove
    // passages, and a null one removes none.
    const narrowed = async (extra, params) =>
      (
        await rows(
          `select * from match_corpus_chunks($1, $2, 'van keys', $3, $4, 40, ${extra})`,
          [CH, U1, VEC, MODEL, ...params],
        )
      ).length;
    const stranger = "00000000-0000-4000-8000-00000000f00d";
    const narrowing = {
      chatOnly: await narrowed(`p_source_types => $5::text[]`, [["chat_message"]]),
      documentsOnly: await narrowed(`p_source_types => $5::text[]`, [["chapter_document"]]),
      thisChannel: await narrowed(`p_channel_ids => $5::uuid[]`, [[GEN]]),
      otherChannel: await narrowed(`p_channel_ids => $5::uuid[]`, [[stranger]]),
      thisAuthor: await narrowed(`p_author_id => $5::uuid`, [U1]),
      otherAuthor: await narrowed(`p_author_id => $5::uuid`, [stranger]),
      sinceLongAgo: await narrowed(`p_since => $5::timestamptz`, ["2000-01-01T00:00:00Z"]),
      sinceTheFuture: await narrowed(`p_since => $5::timestamptz`, ["2999-01-01T00:00:00Z"]),
      untilLongAgo: await narrowed(`p_until => $5::timestamptz`, ["2000-01-01T00:00:00Z"]),
      untilTheFuture: await narrowed(`p_until => $5::timestamptz`, ["2999-01-01T00:00:00Z"]),
    };
    check(
      "retrieval narrows by source type, channel, author and dates, and only ever removes",
      JSON.stringify(narrowing) ===
        JSON.stringify({
          chatOnly: 1,
          documentsOnly: 0,
          thisChannel: 1,
          otherChannel: 0,
          thisAuthor: 1,
          otherAuthor: 0,
          sinceLongAgo: 1,
          sinceTheFuture: 0,
          untilLongAgo: 0,
          untilTheFuture: 1,
        }),
      { narrowing },
    );
    check(
      "the source read never returns a chat window, and nothing to a stranger to the chapter",
      (await rows(`select * from read_corpus_source_chunks($1, $2, 'chat_message', $3)`, [CH, U1, genWin.id]))
        .length === 0 &&
        (await rows(`select * from read_corpus_source_chunks($1, $2, 'chapter_document', $3)`, [CH, stranger, genWin.id]))
          .length === 0,
      {},
    );

    // ── Following the chat ───────────────────────────────────────────────
    let before = await chatSource(genWin.id);
    await db.query(`update chat_messages set is_pinned = true, pinned_at = now() where id = $1`, [ROOT]);
    let after = await chatSource(genWin.id);
    check(
      "a pin leaves the indexed window alone",
      Number(after.revision) === Number(before.revision) &&
        after.status === "indexed" &&
        (await chunkCount(after.id)) === 1,
      { before: before.revision, after: after.revision },
    );

    await db.query(`update chat_messages set content = 'Who has the bus keys?', edited_at = now() where id = $1`, [ROOT]);
    after = await chatSource(genWin.id);
    const wait = new Date(after.next_attempt_at).getTime() - Date.now();
    check(
      "an edit drops the window's passages at once and puts it back in line within ten minutes",
      after.status === "pending" &&
        Number(after.revision) === Number(before.revision) + 1 &&
        (await chunkCount(after.id)) === 0 &&
        wait > 9 * 60_000 &&
        wait <= 10 * 60_000 + 5_000,
      { after, wait },
    );

    // A busy window keeps its turn.
    await db.query(`update corpus_sources set next_attempt_at = now() + interval '2 minutes' where id = $1`, [after.id]);
    await db.query(
      `insert into chat_messages (channel_id, sender_id, content, created_at)
       values ($1, $2, 'one more thing', '2026-11-09T23:00:00Z')`,
      [GEN, U1],
    );
    const busy = await chatSource(genWin.id);
    check(
      "a message in a waiting window does not push its turn back",
      new Date(busy.next_attempt_at).getTime() - Date.now() <= 2 * 60_000 + 5_000 &&
        Number(busy.revision) === Number(after.revision) + 1,
      { busy },
    );

    // Index again, then a soft delete.
    await index(await chatSource(genWin.id), [U1]);
    before = await chatSource(genWin.id);
    await db.query(`update chat_messages set is_deleted = true where id = $1`, [LATE]);
    after = await chatSource(genWin.id);
    check(
      "a deleted message drops the window's passages at once",
      after.status === "pending" && (await chunkCount(after.id)) === 0,
      { after },
    );

    // A Discord author linked to a member: the imported rows gain a sender.
    await index(await chatSource(genWin.id), [U1]);
    const imported = await one(
      `insert into chat_messages (channel_id, sender_id, author_name, content, kind, created_at)
       values ($1, null, 'oldhandle', 'imported hello', 'imported', '2026-11-09T21:00:00Z')
       returning id`,
      [GEN],
    );
    await index(await chatSource(genWin.id), [U1], []);
    await db.query(`update chat_messages set sender_id = $1 where id = $2`, [U2, imported.id]);
    after = await chatSource(genWin.id);
    check(
      "linking a Discord author to a member puts the window back in line",
      after.status === "pending" && (await chunkCount(after.id)) === 0,
      { after },
    );

    // A message moved to another day leaves the window it was in.
    await index(await chatSource(genWin.id), [U1, U2]);
    await db.query(`update chat_messages set created_at = '2026-11-11T15:00:00Z' where id = $1`, [imported.id]);
    after = await chatSource(genWin.id);
    const movedTo = await windowOf(GEN, "2026-11-11");
    check(
      "a message moved to another day rebuilds the window it left and the one it joined",
      after.status === "pending" && (await chunkCount(after.id)) === 0 && movedTo &&
        (await chatSource(movedTo.id))?.status === "pending",
      { after, movedTo },
    );

    // A new day makes a new window.
    await db.query(
      `insert into chat_messages (channel_id, sender_id, content, created_at)
       values ($1, $2, 'morning all', '2026-11-12T15:00:00Z')`,
      [GEN, U1],
    );
    const newDay = await windowOf(GEN, "2026-11-12");
    check(
      "a message on a new day makes a new window, waiting about ten minutes",
      newDay && (await chatSource(newDay.id))?.status === "pending",
      { newDay },
    );

    // A DM message never makes a window.
    await db.query(
      `insert into chat_messages (channel_id, sender_id, content) values ($1, $2, 'just us')`,
      [DM, U1],
    );
    check(
      "a message in a DM makes no window",
      (await rows(`select 1 from corpus_chat_windows where channel_id in ($1, $2)`, [DM, GDM])).length === 0,
      {},
    );

    // Two thousand messages, a minute apart, in one statement.
    await db.query(
      `insert into chat_messages (channel_id, sender_id, content, created_at)
       select $1, $2, 'bulk ' || g, timestamptz '2026-10-01T12:00:00Z' + (g || ' minutes')::interval
         from generate_series(1, 2000) g`,
      [GEN, U1],
    );
    const bulk = await rows(
      `select day::text from corpus_chat_windows
        where channel_id = $1 and day between '2026-10-01' and '2026-10-02' order by day`,
      [GEN],
    );
    check(
      "a two-thousand-row insert makes one window per day it spans",
      bulk.map((r) => r.day).join() === "2026-10-01,2026-10-02",
      { bulk },
    );

    // ── Changes of mind ──────────────────────────────────────────────────
    const fresh = await chatSource(genWin.id);
    await index(fresh, [U1, U2]);
    const exec = await windowOf(PRIV, "2026-11-09");
    await index(await chatSource(exec.id), [U1], [U2]);
    const authors = await rows(`select * from chat_corpus_authors($1) order by indexed desc, user_id`, [CH]);
    check(
      "the authors listing tells who is indexed from who was left out",
      authors.some((a) => a.user_id === U2 && a.indexed === true) &&
        authors.some((a) => a.user_id === U2 && a.indexed === false) &&
        authors.some((a) => a.user_id === U1 && a.indexed === true),
      { authors },
    );
    check(
      "the reconcile lists the chapters that hold chat",
      (await rows(`select * from chat_corpus_chapters()`)).map((r) => r.chat_corpus_chapters).join() === CH,
      {},
    );
    const requeued = await one(`select requeue_chat_corpus_by_authors($1::uuid[], $2) as n`, [[U2], CH]);
    const genAfter = await chatSource(genWin.id);
    const execAfter = await chatSource(exec.id);
    check(
      "requeueing a member drops every passage by them and every window that left them out",
      requeued.n >= 2 &&
        genAfter.status === "pending" &&
        execAfter.status === "pending" &&
        (await chunkCount(genAfter.id)) === 0 &&
        (await chunkCount(execAfter.id)) === 0 &&
        new Date(genAfter.next_attempt_at).getTime() <= Date.now() + 1000,
      { requeued, genAfter: genAfter.status, execAfter: execAfter.status },
    );
    // A run may have read the window under the member's old answer and not
    // written yet: the window holds no passage by them, but its revision must
    // still move so that run's write is refused.
    const inFlight = await chatSource(genWin.id);
    const again = await one(`select requeue_chat_corpus_by_authors($1::uuid[], $2) as n`, [[U2], CH]);
    check(
      "requeueing a member also moves a window still waiting to be indexed that holds their messages",
      again.n >= 1 && Number((await chatSource(genWin.id)).revision) === Number(inFlight.revision) + 1,
      { again, before: inFlight.revision },
    );
    check(
      "requeueing a member with nothing indexed changes nothing",
      (await one(`select requeue_chat_corpus_by_authors($1::uuid[], null) as n`, [
        ["a4314000-0000-4000-8000-0000000000ff"],
      ])).n === 0,
      {},
    );

    // ── Claim order ──────────────────────────────────────────────────────
    await db.query(
      `insert into chapter_documents (id, chapter_id, title, storage_path, uploaded_by)
       values ($1, $2, 'Bylaws', 'a/bylaws.pdf', $3)`,
      [DOC, CH, U1],
    );
    await db.query(
      `update corpus_sources set next_attempt_at = now() - interval '1 hour'
        where chapter_id = $1 and source_type = 'chat_message'`,
      [CH],
    );
    const claimed = await rows(
      `select source_type from claim_corpus_sources($1, now() + interval '1 minute', 1)`,
      [FP],
    );
    check(
      "a waiting document is claimed before chat that has waited longer",
      claimed.length === 1 && claimed[0].source_type === "chapter_document",
      { claimed },
    );
    // Nothing waiting, one indexed source made by an older model: the second
    // pass claims it.
    await db.query(`update corpus_sources set status = 'indexed', indexed_revision = revision, index_fingerprint = $2
                     where chapter_id = $1`, [CH, FP]);
    await db.query(`update corpus_sources set index_fingerprint = 'old-model', next_attempt_at = now() - interval '1 minute'
                     where id = (select id from corpus_sources where chapter_id = $1 and source_type = 'chat_message' limit 1)`, [CH]);
    const stale = await rows(
      `select source_type, index_fingerprint from claim_corpus_sources($1, now() + interval '1 minute', 5)`,
      [FP],
    );
    check(
      "with nothing waiting, a source made by another model is claimed again, and only that one",
      stale.length === 1 && stale[0].index_fingerprint === "old-model",
      { stale },
    );

    // ── The switch off, and channel deletion ─────────────────────────────
    await db.exec(`
      insert into chapter_ai_settings (chapter_id, ask_enabled, chat_source_enabled)
      values ('${CH2}', true, true);
    `);
    const ch2Windows = (await windows(CH2)).length;
    await index(await chatSource((await windowOf(GEN, "2026-11-09")).id), [U1]);
    await db.query(`update chapter_ai_settings set chat_source_enabled = false where chapter_id = $1`, [CH]);
    const [gone] = await rows(
      `select (select count(*) from corpus_chat_windows where chapter_id = $1)::int as windows,
              (select count(*) from corpus_sources where chapter_id = $1 and source_type = 'chat_message')::int as sources,
              (select count(*) from corpus_chunks c join corpus_sources s on s.id = c.corpus_source_id
                where s.chapter_id = $1 and s.source_type = 'chat_message')::int as chunks,
              (select count(*) from corpus_sources where chapter_id = $1 and source_type = 'chapter_document')::int as docs`,
      [CH],
    );
    check(
      "turning chat off deletes the chapter's chat windows, sources and passages, and keeps its documents",
      gone.windows === 0 && gone.sources === 0 && gone.chunks === 0 && gone.docs === 1,
      { gone },
    );
    check(
      "turning one chapter's chat off leaves another chapter's alone",
      ch2Windows === 1 && (await windows(CH2)).length === 1,
      { ch2Windows },
    );
    await db.query(`insert into chat_messages (channel_id, sender_id, content) values ($1, $2, 'after off')`, [GEN, U1]);
    check(
      "with the switch off again a new message writes nothing",
      (await windows(CH)).length === 0,
      {},
    );
    await db.query(`delete from chat_channels where id = $1`, [GEN2]);
    const [ch2Left] = await rows(
      `select (select count(*) from corpus_chat_windows where chapter_id = $1)::int as windows,
              (select count(*) from corpus_sources where chapter_id = $1 and source_type = 'chat_message')::int as sources`,
      [CH2],
    );
    check(
      "deleting a channel deletes its windows and their sources",
      ch2Left.windows === 0 && ch2Left.sources === 0,
      { ch2Left },
    );

    // ── Grants ───────────────────────────────────────────────────────────
    const fns = [
      "public.note_chat_corpus_windows(uuid[], timestamptz[], uuid[], boolean)",
      "public.enrol_chat_corpus(uuid)",
      "public.requeue_chat_corpus_by_authors(uuid[], uuid)",
      "public.chat_corpus_chapters()",
      "public.chat_corpus_authors(uuid)",
      "public.read_chat_corpus_window(uuid, uuid)",
      "public.chat_corpus_window_channels(uuid, uuid[])",
      "public.finish_corpus_source(uuid, bigint, text, text, timestamptz, boolean, integer, text, integer, uuid[])",
      "public.match_corpus_chunks(uuid, uuid, text, text, text, integer, text[], uuid[], uuid, timestamptz, timestamptz)",
      "public.read_corpus_source_chunks(uuid, uuid, text, uuid, integer, integer)",
    ];
    const grants = [];
    for (const fn of fns) {
      for (const role of ["anon", "authenticated"]) {
        const g = await one(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn]);
        if (g.ok !== false) grants.push(`${role}: ${fn}`);
      }
    }
    check("neither client role may execute a chat corpus function", grants.length === 0, { grants });
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
