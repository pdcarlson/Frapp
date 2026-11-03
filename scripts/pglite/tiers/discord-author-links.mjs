import { db, miss } from "../harness.mjs";

// ─── Functional: Discord author links (#2878) ───────────────────────────────
//
// Linking makes a member the sender of their imported Discord history. Every
// promise that makes that safe is SQL, so it is proved here against the real
// functions rather than through a mocked repository:
//
//   - tenant isolation: linking in chapter A attaches only chapter A's rows,
//     even when chapter B imported the same Discord author;
//   - the insert trigger attaches rows imported after the link, in the linked
//     chapter only;
//   - one Discord account is one member (23505) and only a member links
//     (42501);
//   - switching accounts detaches what the first attached, and unlinking
//     restores the Discord name;
//   - reports on those rows follow the sender when linking, so the officer
//     queue's "not about the viewer" rule covers reports filed before the
//     link, and unlinking never points a report back at nobody;
//   - unlinking or switching in one chapter leaves the same account's link,
//     rows and reports in another chapter alone;
//   - a deleted account cannot link;
//   - account deletion clears the Discord snapshot on the deleted member's
//     linked rows and on reports about them, and deletes their links.
//
// Everything runs inside one transaction and is rolled back.
console.log("\n=== Functional: Discord author links (#2878) ===");
{
  const A = "a2878000-0000-4000-8000-00000000000a"; // chapter A
  const B = "b2878000-0000-4000-8000-00000000000b"; // chapter B
  const JAKE = "a2878000-0000-4000-8000-000000000001"; // member of A and B
  const PIN = "a2878000-0000-4000-8000-000000000002"; // member of A
  const OUT = "a2878000-0000-4000-8000-000000000003"; // member of neither
  const CH_A = "a2878000-0000-4000-8000-0000000000c1";
  const CH_B = "b2878000-0000-4000-8000-0000000000c1";
  const JK = "900000000000000001"; // jkslayer's Discord id
  const PS = "900000000000000002"; // Pinstripe's Discord id

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const q = async (sql) => (await db.query(sql)).rows;
  // The code, and whether the message carries the function's prefix: the API
  // maps 23505 / 42501 to 409 / 403 only for the function's own refusals
  // (`SupabaseDiscordAuthorLinkRepository.link`), so rewording a `raise`
  // without the prefix would turn them into 500s.
  const errCode = async (sql) => {
    await db.exec("savepoint author_link_probe;");
    try {
      await db.query(sql);
      return null;
    } catch (e) {
      const prefixed = String(e?.message ?? "").startsWith("link_discord_author:");
      return `${e?.code ?? String(e?.message ?? e)}${prefixed ? "" : " (no link_discord_author: prefix)"}`;
    } finally {
      await db.exec("rollback to savepoint author_link_probe;");
    }
  };
  const senders = async (channel) =>
    Object.fromEntries(
      (
        await q(
          `select content, sender_id from chat_messages where channel_id = '${channel}' order by content`,
        )
      ).map((r) => [r.content, r.sender_id]),
    );

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${A}', 'A', 'U'), ('${B}', 'B', 'U');
      insert into users (id, supabase_auth_id, email, display_name) values
        ('${JAKE}', gen_random_uuid(), 'jake@2878.test', 'Jake'),
        ('${PIN}', gen_random_uuid(), 'pin@2878.test', 'Pin'),
        ('${OUT}', gen_random_uuid(), 'out@2878.test', 'Out');
      insert into members (user_id, chapter_id) values
        ('${JAKE}', '${A}'), ('${JAKE}', '${B}'), ('${PIN}', '${A}');
      insert into chat_channels (id, chapter_id, name, type) values
        ('${CH_A}', '${A}', 'general', 'PUBLIC'), ('${CH_B}', '${B}', 'general', 'PUBLIC');
      insert into chat_messages (channel_id, content, kind, author_name, author_external_id, external_message_id, payload) values
        ('${CH_A}', 'a1', 'imported', 'jkslayer', '${JK}', 'm1', '{"author_username":"jk"}'),
        ('${CH_A}', 'a2', 'imported', 'Pinstripe', '${PS}', 'm2', null),
        ('${CH_B}', 'b1', 'imported', 'jkslayer', '${JK}', 'm3', null);
      -- Filed while the row had no sender: it names only the Discord author.
      insert into chat_message_reports (chapter_id, message_id, reporter_user_id, reason, reported_content, reported_author_name)
        select '${A}', id, '${PIN}', 'spam', content, author_name from chat_messages where content = 'a1';
      insert into chat_message_reports (chapter_id, message_id, reporter_user_id, reason, reported_content, reported_author_name)
        select '${B}', id, '${JAKE}', 'spam', content, author_name from chat_messages where content = 'b1';
    `);
    const reportSender = async (chapter = A) =>
      (await q(`select reported_sender_id, reported_author_name from chat_message_reports where chapter_id = '${chapter}' and message_id is not null`))[0];

    const linked = await q(
      `select messages_linked from link_discord_author('${A}', '${JAKE}', '${JK}', 'jkslayer')`,
    );
    check(
      "linking attaches the author's imported rows in that chapter",
      linked[0]?.messages_linked === 1,
      linked,
    );
    const afterLink = { a: await senders(CH_A), b: await senders(CH_B) };
    check(
      "linking in chapter A never attaches chapter B's rows by the same Discord author",
      afterLink.a.a1 === JAKE && afterLink.a.a2 === null && afterLink.b.b1 === null,
      afterLink,
    );

    await db.exec(`
      insert into chat_messages (channel_id, content, kind, author_name, author_external_id, external_message_id) values
        ('${CH_A}', 'a3', 'imported', 'jkslayer', '${JK}', 'm4'),
        ('${CH_B}', 'b2', 'imported', 'jkslayer', '${JK}', 'm5');
    `);
    const linkedReport = await reportSender();
    check(
      "a report filed before the link names the linked member afterwards",
      linkedReport?.reported_sender_id === JAKE,
      linkedReport,
    );

    const afterImport = { a: await senders(CH_A), b: await senders(CH_B) };
    check(
      "a row imported after the link attaches in the linked chapter only",
      afterImport.a.a3 === JAKE && afterImport.b.b2 === null,
      afterImport,
    );

    // The same account linked in B too, before anything changes in A.
    await q(`select * from link_discord_author('${B}', '${JAKE}', '${JK}', 'jkslayer')`);

    check(
      "another member claiming a linked account is refused with 23505",
      (await errCode(
        `select * from link_discord_author('${A}', '${PIN}', '${JK}', 'x')`,
      )) === "23505",
    );
    check(
      "a non-member cannot link in the chapter (42501)",
      (await errCode(
        `select * from link_discord_author('${A}', '${OUT}', '${PS}', 'x')`,
      )) === "42501",
    );

    await q(`select * from link_discord_author('${A}', '${JAKE}', '${PS}', 'pin')`);
    const afterSwitch = await senders(CH_A);
    const switchedReport = await reportSender();
    check(
      "switching accounts leaves reports naming the member who proved the account",
      switchedReport?.reported_sender_id === JAKE,
      switchedReport,
    );
    check(
      "linking a different account detaches the first and attaches the second",
      afterSwitch.a1 === null && afterSwitch.a3 === null && afterSwitch.a2 === JAKE,
      afterSwitch,
    );

    const restored = await q(`select unlink_discord_author('${A}', '${JAKE}') as n`);
    const afterUnlink = await senders(CH_A);
    const linksLeft = await q(`select count(*)::int as n from discord_author_links where chapter_id = '${A}'`);
    check(
      "unlinking returns the rows to their Discord name and removes the link",
      restored[0]?.n === 1 && afterUnlink.a2 === null && linksLeft[0]?.n === 0,
      { restored, afterUnlink, linksLeft },
    );
    const bAfterA = await senders(CH_B);
    const bReport = await reportSender(B);
    const bLink = await q(`select count(*)::int as n from discord_author_links where chapter_id = '${B}' and user_id = '${JAKE}'`);
    check(
      "switching and unlinking in chapter A leave chapter B's link, rows and reports alone",
      bAfterA.b1 === JAKE && bAfterA.b2 === JAKE && bReport?.reported_sender_id === JAKE && bLink[0]?.n === 1,
      { bAfterA, bReport, bLink },
    );

    await q(`select * from link_discord_author('${A}', '${JAKE}', '${JK}', 'jkslayer')`);
    // A report whose message is gone (a purged import sets message_id null):
    // only its reported sender ties it to the member.
    await db.exec(`
      insert into chat_message_reports (chapter_id, message_id, reporter_user_id, reported_sender_id, reason, reported_content, reported_author_name)
        values ('${A}', null, '${PIN}', '${JAKE}', 'spam', 'gone', 'jkslayer');
    `);
    await q(`select anonymize_user('${JAKE}')`);
    const orphanReport = await q(
      `select reported_author_name from chat_message_reports where chapter_id = '${A}' and message_id is null`,
    );
    const deletedReport = await reportSender();
    const scrubbed = await q(
      `select content, sender_id, author_name, author_avatar_path, author_external_id, payload
         from chat_messages where author_external_id is null and kind = 'imported' order by content`,
    );
    const pinstripe = await q(
      `select author_name, author_external_id from chat_messages where content = 'a2'`,
    );
    const jakeLinks = await q(`select count(*)::int as n from discord_author_links where user_id = '${JAKE}'`);
    check(
      "account deletion clears the Discord snapshot on the member's linked rows and their reports, keeps the rows, and deletes the links",
      scrubbed.length === 4 &&
        scrubbed.every(
          (r) =>
            r.sender_id === JAKE &&
            r.author_name === null &&
            r.author_avatar_path === null &&
            (r.payload === null || !("author_username" in r.payload)),
        ) &&
        pinstripe[0]?.author_name === "Pinstripe" &&
        pinstripe[0]?.author_external_id === PS &&
        jakeLinks[0]?.n === 0 &&
        deletedReport?.reported_sender_id === JAKE &&
        deletedReport?.reported_author_name === null &&
        orphanReport[0]?.reported_author_name === null,
      { scrubbed, pinstripe, jakeLinks, deletedReport, orphanReport },
    );

    // `anonymize_user` also deletes the membership, so the membership check
    // alone would refuse this. Put the membership back so only the tombstone
    // guard stands between a deleted account and a link: the state a first
    // link racing account deletion sees.
    await db.exec(`insert into members (user_id, chapter_id) values ('${JAKE}', '${A}');`);
    const tombstoneLink = await errCode(
      `select * from link_discord_author('${A}', '${JAKE}', '${JK}', 'jkslayer')`,
    );
    const tombstoneLinks = await q(
      `select count(*)::int as n from discord_author_links where user_id = '${JAKE}'`,
    );
    check(
      "a deleted account cannot link",
      tombstoneLink === "42501" && tombstoneLinks[0]?.n === 0,
      { tombstoneLink, tombstoneLinks },
    );
  } catch (e) {
    check("Discord author links scenario ran", false, String(e?.message ?? e).split("\n")[0]);
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
