import { readFileSync } from "node:fs";

import { db, miss } from "../harness.mjs";

// ─── Demo seed load (#2308) ──────────────────────────────────────────────────
// `scripts/demo/demo-seed.sql` is what App Review signs in to, and until this
// block nothing in CI ran it: a migration that renamed a column it writes would
// have surfaced on submission day, against production. This is where both
// variants actually execute against the migrated schema.
//
// Beyond "it runs", the properties asserted are each a way the reviewer's
// chapter has been wrong or could be:
//   - the login is linked to its auth user, since sign-in matches on
//     `users.supabase_auth_id` alone and an unlinked login signs in chapterless;
//   - only a login `seed-demo.mjs auth` marked for this namespace is linked, so
//     an existing account the script did not create (a real person's, or one
//     made by hand in the dashboard) is never handed the presidency. The marker
//     cannot catch a mistyped address with no account yet; `auth` would create
//     and mark that one (see ensureAuthUser);
//   - a chapterless row that a sign-in made before the seed is adopted, not a
//     permanent refusal;
//   - the reviewer variant carries what `apps/mobile/store/README.md` § Seed the
//     reviewer's chapter asks for — no invoice on the reviewer, one DM into them,
//     a study zone with past sessions of their own, a message from another
//     member in a channel they can read (the one that offers Block), and a
//     service entry of their own;
//   - re-running is idempotent, which also proves the delete-then-rebuild clears
//     every foreign key onto `users` before it removes them;
//   - a re-seed that fails leaves the chapter it was replacing exactly as it was,
//     the property that makes it safe to run against production at all.
//
// PGlite has no GoTrue, so `auth.users` is stubbed with the three columns the
// seed reads, for the length of this block.
console.log("\n=== demo seed load (#2308) ===");
{
  const seedDemo = await import("../../demo/seed-demo.mjs");
  const template = readFileSync(seedDemo.TEMPLATE_PATH, "utf8");
  const REVIEWER_EMAIL = "app-review@example.test";
  const REVIEWER_AUTH_ID = "0a0a0a0a-0000-4000-8000-00000000a001";
  const STRANGER_EMAIL = "stranger@example.test";
  const STRANGER_AUTH_ID = "0a0a0a0a-0000-4000-8000-00000000a002";
  // Marked by `auth`, but for the marketing namespace: the marker must name THIS chapter.
  const OTHER_NS_EMAIL = "other-namespace@example.test";
  const OTHER_NS_AUTH_ID = "0a0a0a0a-0000-4000-8000-00000000a003";
  const namespaces = [seedDemo.TEMPLATE_NAMESPACE, seedDemo.REVIEWER_NAMESPACE];
  const render = (namespace, loginEmail, reviewer) =>
    seedDemo.renderSeedSql({ template, namespace, loginEmail, reviewer });
  const marketingSql = render(seedDemo.TEMPLATE_NAMESPACE, undefined, false);
  const reviewerSql = render(seedDemo.REVIEWER_NAMESPACE, REVIEWER_EMAIL, true);

  const n = async (sql) => (await db.query(sql)).rows[0].n;
  const snapshot = async (namespace) => {
    const { chapterId, loginUserId, userIdLike } = seedDemo.demoIds(namespace);
    return {
      chapters: await n(`select count(*)::int as n from chapters where id = '${chapterId}'`),
      members: await n(`select count(*)::int as n from members where chapter_id = '${chapterId}'`),
      users: await n(`select count(*)::int as n from users where id::text like '${userIdLike}'`),
      events: await n(`select count(*)::int as n from events where chapter_id = '${chapterId}'`),
      documents: await n(`select count(*)::int as n from chapter_documents where chapter_id = '${chapterId}'`),
      backwork: await n(`select count(*)::int as n from backwork_resources where chapter_id = '${chapterId}'`),
      offLayout: await n(
        `select (select count(*) from chapter_documents
                  where chapter_id = '${chapterId}'
                    and storage_path not like 'chapters/${chapterId}/documents/' || id || '/%.pdf')
              + (select count(*) from backwork_resources
                  where chapter_id = '${chapterId}'
                    and storage_path not like 'chapters/${chapterId}/backwork/' || id || '/%.pdf') as n`,
      ),
      loginInvoices: await n(`select count(*)::int as n from financial_invoices where user_id = '${loginUserId}'`),
      loginServiceEntries: await n(`select count(*)::int as n from service_entries where user_id = '${loginUserId}'`),
      dms: await n(`select count(*)::int as n from chat_channels where chapter_id = '${chapterId}' and type = 'DM'`),
      dmMessages: await n(
        `select count(*)::int as n from chat_messages m join chat_channels c on c.id = m.channel_id
          where c.chapter_id = '${chapterId}' and c.type = 'DM'`,
      ),
      studyZones: await n(`select count(*)::int as n from study_geofences where chapter_id = '${chapterId}' and is_active`),
      loginPastSessions: await n(
        `select count(*)::int as n from study_sessions where user_id = '${loginUserId}' and status = 'COMPLETED'`,
      ),
      // A text message in #general from a member other than the login: what the
      // README's Block row points the reviewer at. The system actor is no member,
      // so the join leaves its posts out, as the app's Block control does.
      blockable: await n(
        `select count(*)::int as n from chat_messages m
           join chat_channels c on c.id = m.channel_id
           join members mb on mb.user_id = m.sender_id and mb.chapter_id = c.chapter_id
          where c.chapter_id = '${chapterId}' and c.type = 'PUBLIC' and c.name = 'general'
            and m.type = 'TEXT' and m.sender_id <> '${loginUserId}'`,
      ),
      loginAuthId: (await db.query(`select supabase_auth_id::text as a from users where id = '${loginUserId}'`)).rows[0]?.a ?? null,
    };
  };
  // A seed expected to raise. The simple-query protocol leaves an explicit
  // transaction aborted, not closed (psql and the SQL editor end the session
  // instead), so roll it back here.
  const refuses = async (sql) => {
    try {
      await db.exec(sql);
      return false;
    } catch {
      await db.exec("rollback;");
      return true;
    }
  };

  try {
    await db.exec(`create table auth.users (id uuid primary key, email text not null, raw_app_meta_data jsonb not null default '{}');`);
    await db.exec(`
      insert into auth.users (id, email, raw_app_meta_data) values
        ('${REVIEWER_AUTH_ID}', '${REVIEWER_EMAIL}', '{"frapp_demo_namespace": "${seedDemo.REVIEWER_NAMESPACE}"}'),
        ('${STRANGER_AUTH_ID}', '${STRANGER_EMAIL}', '{}'),
        ('${OTHER_NS_AUTH_ID}', '${OTHER_NS_EMAIL}', '{"frapp_demo_namespace": "${seedDemo.TEMPLATE_NAMESPACE}"}');
    `);

    await db.exec(marketingSql);
    await db.exec(reviewerSql);
    const first = await Promise.all(namespaces.map(snapshot));
    await db.exec(marketingSql);
    await db.exec(reviewerSql);
    const second = await Promise.all(namespaces.map(snapshot));
    const [marketing, reviewer] = second;

    // Re-seeding the live reviewer chapter with a login that cannot be linked —
    // missing, or an account the script does not own — must raise and leave the
    // chapter it would have replaced untouched.
    const refusedMissing = await refuses(render(seedDemo.REVIEWER_NAMESPACE, "nobody@example.test", true));
    const afterMissing = await snapshot(seedDemo.REVIEWER_NAMESPACE);
    const refusedStranger = await refuses(render(seedDemo.REVIEWER_NAMESPACE, STRANGER_EMAIL, true));
    const afterStranger = await snapshot(seedDemo.REVIEWER_NAMESPACE);
    const refusedOtherNs = await refuses(render(seedDemo.REVIEWER_NAMESPACE, OTHER_NS_EMAIL, true));
    const afterOtherNs = await snapshot(seedDemo.REVIEWER_NAMESPACE);

    // A seeded account that is also a member of another chapter (the App Review login
    // founding one, say): deleting it would cascade through that membership, so both the
    // re-seed and `sql --remove` refuse, and the membership survives. The marketing chapter
    // stands in for the other chapter.
    const { loginUserId: reviewerLogin } = seedDemo.demoIds(seedDemo.REVIEWER_NAMESPACE);
    const { chapterId: marketingChapter } = seedDemo.demoIds(seedDemo.TEMPLATE_NAMESPACE);
    await db.exec(`insert into members (user_id, chapter_id) values ('${reviewerLogin}', '${marketingChapter}');`);
    const refusedCrossReseed = await refuses(reviewerSql);
    const refusedCrossRemove = await refuses(seedDemo.renderRemoveSql({ namespace: seedDemo.REVIEWER_NAMESPACE }));
    const crossKept = await n(
      `select count(*)::int as n from members where user_id = '${reviewerLogin}' and chapter_id = '${marketingChapter}'`,
    );
    const afterCross = await snapshot(seedDemo.REVIEWER_NAMESPACE);
    await db.exec(`delete from members where user_id = '${reviewerLogin}' and chapter_id = '${marketingChapter}';`);

    // The same without a membership: rows the login wrote in another chapter before leaving
    // it. The membership check this replaced let them cascade away with the account.
    await db.exec(
      `insert into point_transactions (chapter_id, user_id, amount, category) values ('${marketingChapter}', '${reviewerLogin}', 5, 'MANUAL');`,
    );
    const refusedLeftRows = await refuses(reviewerSql);
    const leftRowsKept = await n(
      `select count(*)::int as n from point_transactions where user_id = '${reviewerLogin}' and chapter_id = '${marketingChapter}'`,
    );
    await db.exec(`delete from point_transactions where user_id = '${reviewerLogin}' and chapter_id = '${marketingChapter}';`);

    // A reference deleting the account would only null out refuses too: in another chapter
    // that null is its audit log losing the actor, rewritten with no error. A directory
    // request the login filed stands in for it here, and is left as it was.
    await db.exec(
      `insert into chapter_directory_requests (requested_by, university) values ('${reviewerLogin}', 'Demo University');`,
    );
    const refusedNullable = await refuses(reviewerSql);
    const requestKept = await n(
      `select count(*)::int as n from chapter_directory_requests where university = 'Demo University' and requested_by = '${reviewerLogin}'`,
    );
    await db.exec(`delete from chapter_directory_requests where university = 'Demo University';`);

    // What the account owns outright goes with it: a push token or settings row is no reason to refuse.
    await db.exec(`insert into push_tokens (user_id, token) values ('${reviewerLogin}', 'demo-token');`);
    await db.exec(`insert into user_settings (user_id) values ('${reviewerLogin}');`);
    await db.exec(reviewerSql);
    const ownedLeft = await n(
      `select (select count(*) from push_tokens where user_id = '${reviewerLogin}') + (select count(*) from user_settings where user_id = '${reviewerLogin}') as n`,
    );

    // The marketing variant seeds an unmarked account's email unlinked.
    await db.exec(render(seedDemo.TEMPLATE_NAMESPACE, STRANGER_EMAIL, false));
    const strangerLink = (await snapshot(seedDemo.TEMPLATE_NAMESPACE)).loginAuthId;

    // A sign-in before the seed leaves a chapterless row on the login's auth id;
    // the next seed adopts it.
    await db.exec(seedDemo.renderRemoveSql({ namespace: seedDemo.REVIEWER_NAMESPACE }));
    await db.exec(`insert into users (supabase_auth_id, email) values ('${REVIEWER_AUTH_ID}', '${REVIEWER_EMAIL}');`);
    await db.exec(reviewerSql);
    const adopted = await snapshot(seedDemo.REVIEWER_NAMESPACE);
    const shells = await n(`select count(*)::int as n from users where supabase_auth_id = '${REVIEWER_AUTH_ID}'`);

    // ...but a row on the login's auth id that is a member of a chapter is an account in
    // use: the seed refuses instead of deleting it.
    await db.exec(seedDemo.renderRemoveSql({ namespace: seedDemo.REVIEWER_NAMESPACE }));
    const inUse = (
      await db.query(
        `insert into users (supabase_auth_id, email) values ('${REVIEWER_AUTH_ID}', '${REVIEWER_EMAIL}') returning id::text as id`,
      )
    ).rows[0].id;
    await db.exec(`insert into members (user_id, chapter_id) values ('${inUse}', '${marketingChapter}');`);
    const refusedInUse = await refuses(reviewerSql);
    const inUseKept = await n(`select count(*)::int as n from members where user_id = '${inUse}'`);
    await db.exec(`delete from members where user_id = '${inUse}';`);
    // ...and so is one with no membership left but points in a chapter it has left.
    await db.exec(
      `insert into point_transactions (chapter_id, user_id, amount, category) values ('${marketingChapter}', '${inUse}', 5, 'MANUAL');`,
    );
    const refusedLeftOwner = await refuses(reviewerSql);
    const leftOwnerKept = await n(`select count(*)::int as n from point_transactions where user_id = '${inUse}'`);
    await db.exec(`delete from point_transactions where user_id = '${inUse}'; delete from users where id = '${inUse}';`);

    for (const namespace of namespaces) await db.exec(seedDemo.renderRemoveSql({ namespace }));
    const removed = await Promise.all(namespaces.map(snapshot));

    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const checks = [
      [marketing.members === 26 && reviewer.members === 26, `both variants seed 26 members (marketing ${marketing.members}, reviewer ${reviewer.members})`],
      [marketing.events === 12 && marketing.documents === 10 && marketing.backwork === 11, `the chapter's events, documents and backwork land (${marketing.events}/${marketing.documents}/${marketing.backwork})`],
      [marketing.offLayout === 0 && reviewer.offLayout === 0, `every document and backwork path is the API's own chapters/<chapter>/<kind>/<id>/ layout (${marketing.offLayout + reviewer.offLayout} off it)`],
      [reviewer.loginAuthId === REVIEWER_AUTH_ID, `the reviewer login is linked to its marked auth user (got ${reviewer.loginAuthId})`],
      [marketing.loginAuthId?.startsWith("c0ffee00-0000-4000-8000-2000"), "with no matching auth user, the marketing login keeps a synthetic auth id"],
      [strangerLink?.startsWith("c0ffee00-0000-4000-8000-2000"), `an unmarked account with the login's email is never linked (got ${strangerLink})`],
      [reviewer.loginInvoices === 0 && marketing.loginInvoices > 0, `no invoices on the reviewer (reviewer ${reviewer.loginInvoices}, marketing ${marketing.loginInvoices})`],
      [reviewer.loginServiceEntries > 0, `the reviewer has a service entry of their own (${reviewer.loginServiceEntries})`],
      [reviewer.dms === 1 && reviewer.dmMessages === 3 && marketing.dms === 0, `one DM into the reviewer, none in marketing (${reviewer.dms} with ${reviewer.dmMessages} messages / ${marketing.dms})`],
      [reviewer.studyZones > 0 && reviewer.loginPastSessions > 0, `the reviewer has study zones and past sessions of their own (${reviewer.studyZones} zones, ${reviewer.loginPastSessions} sessions)`],
      [reviewer.blockable > 0, `#general holds text from another member, so Block is offered there (${reviewer.blockable} messages)`],
      [same(first, second), "re-running both variants is idempotent"],
      [refusedMissing && same(afterMissing, reviewer), "a reviewer re-seed with no auth user raises and leaves the existing chapter untouched"],
      [refusedStranger && same(afterStranger, reviewer), "a reviewer re-seed naming an unmarked account raises and leaves the existing chapter untouched"],
      [refusedOtherNs && same(afterOtherNs, reviewer), "a login marked for another namespace is never linked: the reviewer re-seed raises"],
      [refusedCrossReseed && refusedCrossRemove && crossKept === 1 && same(afterCross, reviewer), "a seeded account in another chapter makes the re-seed and sql --remove refuse, and that membership survives"],
      [refusedLeftRows && leftRowsKept === 1, "rows a seeded account left in another chapter, with no membership there, also make the re-seed refuse"],
      [Number(ownedLeft) === 0, "a push token and a settings row go with the account, without a refusal"],
      [refusedNullable && requestKept === 1, "a reference the delete would only null (a directory request) refuses too, and is left intact"],
      [adopted.loginAuthId === REVIEWER_AUTH_ID && shells === 1, `a chapterless row from an early sign-in is adopted (linked ${adopted.loginAuthId}, ${shells} row on the auth id)`],
      [refusedInUse && inUseKept === 1, "a row on the login's auth id that is a member of a chapter is refused, not taken over"],
      [refusedLeftOwner && leftOwnerKept === 1, "so is one with no membership but points in a chapter it has left"],
      [removed.every((r) => r.chapters === 0 && r.members === 0 && r.users === 0 && r.documents === 0), "sql --remove clears both chapters and their people"],
    ];
    for (const [ok, name] of checks) {
      if (ok) {
        console.log(`OK    ${name}`);
      } else {
        miss();
        console.log(`MISS  ${name}`);
      }
    }
  } catch (e) {
    miss();
    console.log(`MISS  demo seed load\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`);
    await db.exec("rollback;").catch(() => {});
  } finally {
    // Leave the schema as the migrations produced it, as every block here does.
    for (const namespace of namespaces) await db.exec(seedDemo.renderRemoveSql({ namespace })).catch(() => {});
    await db.exec(`delete from users where supabase_auth_id in ('${REVIEWER_AUTH_ID}', '${STRANGER_AUTH_ID}', '${OTHER_NS_AUTH_ID}');`).catch(() => {});
    await db.exec("drop table if exists auth.users;");
  }
}
