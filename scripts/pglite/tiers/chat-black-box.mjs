import { db, miss } from "../harness.mjs";
import { F } from "../chat-read-fixtures.mjs";
import {
  ANON_CLAIM,
  ANON_KEY,
  NULL_SUB,
  expectSet,
  probeAs,
  setAuth,
  signedIn,
} from "../probe.mjs";
import { AUTH_ADMIN_ONLY } from "./policy-inventory.mjs";
import { readSeeded } from "./chat-read-enforcement.mjs";

// ─── BLACK-BOX policy enforcement (FRA-38) ──────────────────────────────────
//
// The read-enforcement tier (`chat-read-enforcement.mjs`) calls
// can_read_chat_message() directly, which proves the PREDICATE is right but
// says nothing about whether the POLICY is wired to it.
// The shape assertion covers the wiring only by pattern-matching the policy
// expression, and a pattern match is defeatable — `... AND
// can_read_chat_message(message_id) IS NOT NULL` is constant-true, and De Morgan
// spells an OR out of AND and NOT.
//
// So read the table for real, as a role that is not the owner. RLS does not
// apply to superusers or table owners, which is why this needs its own role.
// A permissive `using (true)` policy of ANY command shape (FOR SELECT or FOR
// ALL), a neutered predicate, or a dropped policy all change these counts, and
// none of them can be papered over by how the expression is spelled.
console.log("\n=== chat_message_actions policy enforcement (black-box, SET ROLE) ===");
if (readSeeded) {
  try {
    await db.exec(`
      insert into chat_message_actions (message_id, user_id, action_type) values
        ('${F.msgPublic}',        '${F.userAId}', 'reaction'),
        ('${F.msgPrivate}',       '${F.userAId}', 'reaction'),
        ('${F.msgDM}',            '${F.userAId}', 'reaction'),
        ('${F.msgRoleGated}',     '${F.userAId}', 'reaction'),
        ('${F.msgRoleGatedOpen}', '${F.userAId}', 'reaction'),
        ('${F.msgGroupDM}',       '${F.userAId}', 'reaction'),
        -- userB's own reaction in their own chapter. Without it the
        -- cross-chapter expectation below is a negative control with no
        -- positive half: a predicate that denied every chapter-B member
        -- outright, rather than scoping by tenant, would still satisfy it.
        ('${F.msgPublicB}',       '${F.userBId}', 'reaction');

      drop role if exists rls_probe;
      create role rls_probe nologin;
      -- Membership in the authenticated role is what subjects the probe to
      -- policies carrying a TO authenticated clause. Without it those policies
      -- exist but never apply to this role, and every read below is answered
      -- by default-deny rather than by the policy under test.
      grant authenticated to rls_probe;
      grant usage on schema public to rls_probe;
      grant select on public.chat_message_actions to rls_probe;
      grant select on public.chat_messages to rls_probe;
      -- #423: both are default-deny (no policy a client role can reach), so the
      -- grant is what makes "reads nothing" mean RLS rather than a missing
      -- privilege. See the default-deny tier at the end of this block.
      grant select on public.members to rls_probe;
      grant select on public.financial_invoices to rls_probe;
      grant execute on function public.can_read_chat_message(uuid) to rls_probe;

      -- The anon key's reader (ANON_KEY). A member of anon and NOT of
      -- authenticated, as on hosted, so a policy bound to anon or public
      -- applies to it and one bound to authenticated does not. It gets the same
      -- table grants: hosted's default grant all on tables to anon is never
      -- revoked at table level, so RLS is what stands between the anon key and
      -- these rows there too. It gets no EXECUTE on can_read_chat_message,
      -- which is revoked from anon on hosted.
      drop role if exists rls_probe_anon;
      create role rls_probe_anon nologin;
      grant anon to rls_probe_anon;
      grant usage on schema public to rls_probe_anon;
      grant select on public.chat_message_actions to rls_probe_anon;
      grant select on public.chat_messages to rls_probe_anon;
      grant select on public.members to rls_probe_anon;
      grant select on public.financial_invoices to rls_probe_anon;
    `);

    // userA: chapter A, in member_ids of PRIVATE/DM/GROUP_DM, holds chat:secret.
    // userC: chapter A, no privileges, in no member list -> PUBLIC only.
    // userB: chapter B -> its own chapter's row only. No JWT, read either way
    // (NULL_SUB, ANON_KEY) -> nothing.
    //
    // FRA-321 moved both non-zero counts down by one, and the row that left each
    // is the same one: the ROLE_GATED channel with an empty requirement list.
    // It used to be readable by every chapter member; it is now readable by
    // none of them (userA holds chat:secret, which the open channel does not
    // ask for, and neither user holds the wildcard).
    const MSG_LABEL = {
      [F.msgPublic]: "PUBLIC",
      [F.msgPrivate]: "PRIVATE",
      [F.msgDM]: "DM",
      [F.msgRoleGated]: "ROLE_GATED(chat:secret)",
      [F.msgRoleGatedOpen]: "ROLE_GATED(empty-req)",
      [F.msgGroupDM]: "GROUP_DM",
      [F.msgPublicB]: "chapterB/PUBLIC",
    };
    const ALL_MSG_IDS = Object.keys(MSG_LABEL);
    const label = (id) => MSG_LABEL[id] ?? id;

    // Exact sets, not counts. A count is satisfied by the right NUMBER of wrong
    // rows — a policy that swapped one PRIVATE row for one cross-chapter row
    // would still total 5 here and stay green, which is the whole failure this
    // tier exists to catch.
    const BLACKBOX = [
      { name: "member sees every action row in channels they can read (all but the empty-gated one)", as: signedIn(F.userAAuth),
        visible: [F.msgPublic, F.msgPrivate, F.msgDM, F.msgRoleGated, F.msgGroupDM] },
      { name: "cross-chapter reader sees only their own chapter's row (tenant boundary holds at the table)", as: signedIn(F.userBAuth),
        visible: [F.msgPublicB] },
      { name: "chapter member sees only PUBLIC, not PRIVATE/DM/gated (incl. empty-gated)", as: signedIn(F.userCAuth),
        visible: [F.msgPublic] },
      { name: "no JWT (null auth.uid()) sees nothing", as: NULL_SUB, visible: [] },
      { name: "the anon key (role anon, no JWT) sees nothing", as: ANON_KEY, visible: [] },
    ];

    for (const s of BLACKBOX) {
      const probe = await probeAs(
        s.as,
        `select message_id::text as id from public.chat_message_actions`,
      );
      expectSet(s.name, probe, s.visible, label);
    }


    // ─── chat_message_actions: a block hides the blocked member's reactions (#2494)
    //
    // `spec/behavior/chat/README.md` § What a block does and does not hide: a
    // blocked member's reactions are hidden from the blocker on every message,
    // and their poll votes are counted, not hidden. Both clients read reaction
    // chips straight from this table, so the policy is the only place that can
    // enforce it for PostgREST and for the Realtime echo alike.
    //
    // userC blocks userA in chapter A. Every expectation is an exact set over
    // the rows this tier inserts, read as `rls_probe`:
    //   - userC loses userA's `reaction:*` rows in chapter A, on userA's own
    //     message and on userC's;
    //   - userC keeps userA's `vote`, userA's reaction in chapter B (both are
    //     members there, and the block is chapter A's), and other members'
    //     reactions. The last is the control: a clause that hid every reaction
    //     would pass the first check;
    //   - userA still reads every row. The block must not be observable from
    //     the blocked side.
    //
    // Runs in a savepoint that is always rolled back, so the chat_messages tier
    // below still sees exactly the six seeded messages it counts.
    //
    // Scenario names are cited by `chat-read-surface-ledger.spec.ts` as the
    // proof for `chat_message_actions_select`, which that spec checks is still
    // a `name:` here. Rename one there too.
    console.log("\n=== chat_message_actions block enforcement (black-box, SET ROLE) — #2494 ===");
    await db.exec("savepoint block_tier;");
    try {
      const K = {
        blockerMsg: "10000008-0000-0000-0000-000000000001", // userC's message in chapter A's PUBLIC channel
        blockedOnOwn: "30000001-0000-0000-0000-000000000001", // userA reaction on userA's message
        blockedOnBlockers: "30000002-0000-0000-0000-000000000001", // userA reaction on userC's message
        blockedVote: "30000003-0000-0000-0000-000000000001", // userA vote, chapter A
        blockedInChapB: "30000004-0000-0000-0000-000000000001", // userA reaction, chapter B
        otherReaction: "30000005-0000-0000-0000-000000000001", // userD reaction, chapter A
        blockerReaction: "30000006-0000-0000-0000-000000000001", // userC's own reaction
      };
      const ROW_LABEL = {
        [K.blockedOnOwn]: "userA reaction on userA's message",
        [K.blockedOnBlockers]: "userA reaction on userC's message",
        [K.blockedVote]: "userA vote",
        [K.blockedInChapB]: "userA reaction in chapter B",
        [K.otherReaction]: "userD reaction",
        [K.blockerReaction]: "userC reaction",
      };
      const ROW_IDS = Object.keys(ROW_LABEL);
      const rowLabel = (id) => ROW_LABEL[id] ?? id;

      await db.exec(`
        insert into members (user_id, chapter_id) values
          ('${F.userAId}', '${F.chapB}'),
          ('${F.userCId}', '${F.chapB}');
        insert into chat_messages (id, channel_id, sender_id) values
          ('${K.blockerMsg}', '${F.chPublic}', '${F.userCId}');
        insert into chat_message_actions (id, message_id, user_id, action_type) values
          ('${K.blockedOnOwn}',      '${F.msgPublic}',  '${F.userAId}', 'reaction:👍'),
          ('${K.blockedOnBlockers}', '${K.blockerMsg}', '${F.userAId}', 'reaction:👎'),
          ('${K.blockedVote}',       '${F.msgPublic}',  '${F.userAId}', 'vote'),
          ('${K.blockedInChapB}',    '${F.msgPublicB}', '${F.userAId}', 'reaction:👍'),
          ('${K.otherReaction}',     '${F.msgPublic}',  '${F.userDId}', 'reaction:👍'),
          ('${K.blockerReaction}',   '${F.msgPublic}',  '${F.userCId}', 'reaction:🎉');
      `);

      const readRowsAs = (uid) =>
        probeAs(
          signedIn(uid),
          `select id::text as id from public.chat_message_actions
            where id in (${ROW_IDS.map((id) => `'${id}'`).join(", ")})`,
        );

      // Read before the block, so "unchanged" has something to compare with.
      const blockedBefore = await readRowsAs(F.userAAuth);
      const blockerBefore = await readRowsAs(F.userCAuth);

      await db.exec(`
        insert into chat_member_blocks (chapter_id, blocker_user_id, blocked_user_id)
        values ('${F.chapA}', '${F.userCId}', '${F.userAId}');
      `);

      const blockerAfter = await readRowsAs(F.userCAuth);
      const blockedAfter = await readRowsAs(F.userAAuth);

      // Both members can read every channel these rows sit in, so before the
      // block each reads all six. Those two are the positive controls: without
      // them, a fixture that never landed would pass the "unchanged" check.
      const BLOCK_SCENARIOS = [
        {
          name: "before any block, the blocker-to-be reads every reaction and vote in both chapters",
          probe: blockerBefore,
          visible: ROW_IDS,
        },
        {
          name: "before any block, the member about to be blocked reads every reaction and vote in both chapters",
          probe: blockedBefore,
          visible: ROW_IDS,
        },
        {
          name: "a blocker reads none of a blocked member's reaction rows in that chapter, and keeps everything else",
          probe: blockerAfter,
          visible: [K.blockedVote, K.blockedInChapB, K.otherReaction, K.blockerReaction],
        },
        {
          name: "the blocked member still reads every row after being blocked (no oracle)",
          probe: blockedAfter,
          visible: ROW_IDS,
        },
      ];
      for (const s of BLOCK_SCENARIOS) expectSet(s.name, s.probe, s.visible, rowLabel);

      // The helper takes no blocker parameter. Called over RPC it must answer
      // only about the caller's own list: userA learns nothing about userC's
      // block, and userC's answer stays inside chapter A.
      const HELPER_SCENARIOS = [
        {
          name: "chat_viewer_has_blocked answers true for the caller's own block in the message's chapter",
          uid: F.userCAuth, actor: F.userAId, msg: F.msgPublic, expect: true,
        },
        {
          name: "chat_viewer_has_blocked answers false in another chapter (blocks are per chapter)",
          uid: F.userCAuth, actor: F.userAId, msg: F.msgPublicB, expect: false,
        },
        {
          name: "chat_viewer_has_blocked answers false to the blocked member asking about their blocker",
          uid: F.userAAuth, actor: F.userCId, msg: F.msgPublic, expect: false,
        },
        {
          // userC holds the block in chapter A but is not in the DM. A true
          // here would tell them the message exists.
          name: "chat_viewer_has_blocked answers false for a message the caller cannot read (no existence oracle)",
          uid: F.userCAuth, actor: F.userAId, msg: F.msgDM, expect: false,
        },
      ];
      for (const s of HELPER_SCENARIOS) {
        await setAuth(signedIn(s.uid));
        const res = await db.query(
          `select public.chat_viewer_has_blocked('${s.actor}'::uuid, '${s.msg}'::uuid) as ok`,
        );
        const got = res.rows[0].ok === true;
        if (got === s.expect) {
          console.log(`OK    ${s.name}`);
        } else {
          miss();
          console.log(`MISS  ${s.name}\n        ↳ expected ${s.expect}, got ${got}`);
        }
      }
    } catch (e) {
      miss();
      console.log(
        `ERR   chat_message_actions block enforcement\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
      );
    } finally {
      await db.exec("rollback to savepoint block_tier; release savepoint block_tier;");
    }


    // ─── chat_messages read enforcement (black-box, SET ROLE) — #977 ─────────
    //
    // The tier above proves the POLICY on `chat_message_actions` is wired to the
    // predicate. `chat_messages` had only the shape assertion in the RLS smoke
    // list, plus (since #974) the two archive-rule reads below — and a shape
    // assertion is defeatable by construction. The harness says so itself about
    // the sibling: substring-shaped, so a determined rewrite slips past it.
    // That check tests three substrings — `can_read_chat_message(id)`,
    // `authenticated`, and `kind <> 'imported'` — so a defeating rewrite keeps
    // all three and neuters only the one doing the work:
    //     and (public.can_read_chat_message(id) or true)
    // which satisfies all three AND `rows.length === 1`, turning every message
    // in every chapter's private channels and DMs into an authenticated read.
    // Only reading the table as a non-owner role catches that.
    //
    // Placement is deliberate: this runs BEFORE the archive block below inserts
    // its imported row and its live null-sender row, so the fixture here is
    // exactly the six seeded live messages. An expectation in this tier means
    // "of those six" and cannot silently absorb rows added later.
    //
    // Asserted as an exact SET per reader, not a count. A total can be right for
    // the wrong reason — userD sees three rows, but *which* three is the whole
    // question: '*' opens both ROLE_GATED channels and must still not open a DM.

    const MSG_BLACKBOX = [
      {
        who: "chapter member in member_ids holding chat:secret",
        as: signedIn(F.userAAuth),
        visible: [F.msgPublic, F.msgPrivate, F.msgDM, F.msgRoleGated, F.msgGroupDM],
      },
      {
        // The positive control is what makes this assertion mean anything. userB
        // is a real, functioning reader — it sees its OWN chapter's PUBLIC
        // message — and still sees none of chapter A's six. Without that half,
        // "sees zero of chapter A" is equally satisfied by a uuid belonging to
        // nobody, and the tenant boundary is never actually exercised.
        who: "cross-chapter member (sees only their own chapter)",
        as: signedIn(F.userBAuth),
        visible: [F.msgPublicB],
      },
      {
        who: "chapter member with no privileges, in no member list",
        as: signedIn(F.userCAuth),
        visible: [F.msgPublic],
      },
      {
        // The case the sibling tier never exercises black-box, and the sharpest
        // one: permission and membership are independent axes. '*' grants both
        // ROLE_GATED channels (including the empty-requirement one) and still
        // must not grant PRIVATE / DM / GROUP_DM, which gate on member_ids.
        who: "chapter member holding the '*' wildcard, in no member list",
        as: signedIn(F.userDAuth),
        visible: [F.msgPublic, F.msgRoleGated, F.msgRoleGatedOpen],
      },
      { who: "no JWT (null auth.uid())", as: NULL_SUB, visible: [] },
      { who: "the anon key (role anon, no JWT)", as: ANON_KEY, visible: [] },
    ];

    // Every expectation below is stated as a set over ALL_MSG_IDS. That is only
    // equivalent to "what this reader can see in the table" if the fixtures ARE
    // the table — so assert it once, as owner, instead of re-counting per
    // scenario. If a future seed adds a message and forgets this tier, this
    // fails loudly rather than letting the set assertions quietly go partial.
    {
      const total = await db.query(
        `select count(*)::int as n from public.chat_messages`,
      );
      const name = "the message fixtures are the whole table (set assertions below are table-wide)";
      if (total.rows[0].n === ALL_MSG_IDS.length) {
        console.log(`OK    ${name}`);
      } else {
        miss();
        console.log(
          `MISS  ${name}\n        ↳ expected ${ALL_MSG_IDS.length} row(s), found ${total.rows[0].n}`,
        );
      }
    }

    for (const s of MSG_BLACKBOX) {
      const want = [...s.visible].sort();
      const probe = await probeAs(
        s.as,
        `select id::text as id from public.chat_messages
          where id in (${ALL_MSG_IDS.map((m) => `'${m}'`).join(", ")})`,
      );
      expectSet(
        `${s.who} reads exactly ${want.length}/${ALL_MSG_IDS.length} (${want.map(label).join(", ") || "nothing"})`,
        probe,
        s.visible,
        label,
      );
    }


    // ─── chat_messages: the imported-archive exclusion (Discord import) ──────
    //
    // This is the Realtime fan-out control, and it only works if it is enforced
    // at the POLICY. Supabase Realtime evaluates this exact policy per subscriber
    // in `realtime.apply_rls`, and emits a frame only for rows that pass — so an
    // imported archive row that is invisible here is a frame that is never sent.
    //
    // A publication row filter cannot substitute: `realtime.list_changes` builds
    // wal2json's `add-tables` parameter from `pg_publication_tables` NAMES and
    // never reads `prqual`, so `alter publication ... where (kind <> 'imported')`
    // is silently ignored.
    //
    // The second scenario is the one that pins WHERE the rule lives. The
    // predicate `can_read_chat_message` must still answer true for an imported
    // row, because it is also the `chat_message_actions` SELECT policy — pushing
    // `kind` into the function would break reactions and votes on archived
    // messages. So: invisible through the table, still readable through the
    // predicate.
    const IMPORTED_MSG = "a5a5a5a5-0000-4000-8000-00000000aaaa";
    await db.exec(`
      insert into chat_messages (id, channel_id, sender_id, author_name, author_external_id, kind, content)
      values ('${IMPORTED_MSG}', '${F.chPublic}', null, 'DiscordUser', '9911', 'imported', 'a message from 2019');
    `);

    const ARCHIVE = [
      {
        name: "an imported archive row is invisible to a member who CAN read the channel",
        as: signedIn(F.userAAuth),
        sql: `select count(*)::int as n from public.chat_messages where id = '${IMPORTED_MSG}'`,
        expect: 0,
      },
      {
        name: "a live row in the same channel is still visible (the rule is `kind`, not a blanket deny)",
        as: signedIn(F.userAAuth),
        sql: `select count(*)::int as n from public.chat_messages where id = '${F.msgPublic}'`,
        expect: 1,
      },
    ];

    for (const s of ARCHIVE) {
      const probe = await probeAs(s.as, s.sql);
      const got = probe.rows?.[0]?.n;
      if (probe.failure === null && got === s.expect) {
        console.log(`OK    ${s.name}`);
      } else {
        miss();
        console.log(
          `MISS  ${s.name}\n        ↳ ` +
            (probe.failure === null
              ? `expected ${s.expect} visible row(s), got ${got}`
              : `the read raised instead: ${probe.failure}`),
        );
      }
    }

    // ─── The archive row must not reopen the table to unauthorised readers ──
    //
    // The membership tier above runs before IMPORTED_MSG exists, which is what
    // keeps its expectations readable — but it also means no assertion there can
    // see a policy that special-cases imported rows. That gap is reachable:
    //
    //   using ((auth.role() = 'authenticated' and kind <> 'imported'
    //           and can_read_chat_message(id))
    //          or (auth.uid() is null and kind = 'imported'))
    //
    // hands every archived message in every chapter to an unauthenticated
    // PostgREST client. It satisfies all three shape regexes, keeps one
    // permissive policy, and passes every membership expectation — because the
    // row it leaks does not exist yet when those run. So re-check the readers
    // that must see nothing of another tenant, now that it does.
    // Exact sets over the WHOLE table, matching the membership tier — a count
    // can be right for the wrong reason (a policy hiding chapterB/PUBLIC from
    // userB while exposing one imported row keeps the total at 1).
    const POST_ARCHIVE = [
      { who: "no JWT (null auth.uid())", as: NULL_SUB, visible: [] },
      { who: "the anon key (role anon, no JWT)", as: ANON_KEY, visible: [] },
      {
        who: "cross-chapter member",
        as: signedIn(F.userBAuth),
        visible: [F.msgPublicB], // their own chapter's PUBLIC message, nothing else
      },
    ];
    const postLabel = (id) => (id === IMPORTED_MSG ? "IMPORTED" : label(id));
    for (const s of POST_ARCHIVE) {
      const probe = await probeAs(s.as, `select id::text as id from public.chat_messages`);
      expectSet(
        `${s.who} still reads exactly ${s.visible.length} row(s) once an imported archive row exists`,
        probe,
        s.visible,
        postLabel,
      );
    }

    // ─── Unread counts: the "47,000 unread" case, end to end ────────────────
    //
    // A member with no `channel_read_receipts` row has never opened the channel,
    // so `get_channel_unread_counts` counts EVERYTHING (the `-infinity` cursor
    // branch). That is correct for live chat and catastrophic for an archive:
    // importing a chapter's Discord history would hand every member a badge the
    // size of the import that no amount of reading could clear.
    //
    // Both halves are asserted because they are independent rules that happened
    // to overlap. `sender_id is distinct from` is null-safety; `kind <>
    // 'imported'` is the archive rule. Before this migration the archive was
    // excluded only as a side effect of `NULL <> uuid` being NULL — invisible,
    // and undone by the obvious null-safety "fix".
    {
      const name = "unread counts skip imported rows but still count a live null-sender row";
      await db.exec(`
        insert into chat_messages (id, channel_id, sender_id, author_name, kind, content)
        values ('a5a5a5a5-0000-4000-8000-00000000bbbb', '${F.chPublic}', null, 'Webhook Bot', 'text', 'live, no sender');
      `);
      // userC is a chapter-A member with no read receipt for any channel.
      const res = await db.query(
        `select unread_count::int as n from public.get_channel_unread_counts(
           '${F.chapA}'::uuid, '${F.userCId}'::uuid)
          where channel_id = '${F.chPublic}'::uuid`,
      );
      // Visible to userC in #public: msgPublic (userA's) + the live null-sender
      // row. NOT the imported row.
      const got = res.rows[0]?.n;
      if (got === 2) {
        console.log(`OK    ${name}`);
      } else {
        miss();
        console.log(`MISS  ${name}\n        ↳ expected 2 unread, got ${got}`);
      }
    }

    // The predicate must NOT have learned about `kind` — it is shared with the
    // chat_message_actions policy, so narrowing it would silently kill reactions
    // and poll votes on every imported message.
    {
      await setAuth(signedIn(F.userAAuth));
      const res = await db.query(
        `select public.can_read_chat_message('${IMPORTED_MSG}'::uuid) as ok`,
      );
      const name =
        "can_read_chat_message still answers true for an imported row (reactions keep working)";
      if (res.rows[0].ok === true) {
        console.log(`OK    ${name}`);
      } else {
        miss();
        console.log(`MISS  ${name}\n        ↳ the kind rule leaked into the shared predicate`);
      }
    }

    // ─── members / financial_invoices: default-deny enforcement (#423) ───────
    //
    // The two tiers above cover the tables that carry a client-reachable
    // policy. These two carry none, and that is the point rather than a gap:
    //
    //   - `financial_invoices` has no policy anywhere in the tree.
    //   - `members`' only policy, `auth_admin_can_read_members`, is
    //     `to supabase_auth_admin`, the role Supabase Auth runs the
    //     custom-access-token hook as. It exists here since #1557 created that
    //     role, so the catalog check below excludes it by its roles, not by
    //     its absence.
    //
    // Under RLS, no reachable policy means default-deny, and per ADR-11 the API
    // reads both tables exclusively through the service-role client, which
    // bypasses RLS entirely. So the assertion that carries the value is the
    // negative one: a signed-in reader sees NOTHING, including in their own
    // chapter. The day a migration adds `using (true)`, or a chapter-scoped
    // policy whose tenant predicate is wrong, this tier goes red.
    //
    // NOTE this is deliberately NOT "at least one policy per table is exercised
    // as authenticated", the way #423's first acceptance criterion words it.
    // That phrasing presumes a policy that does not exist for either table; the
    // enforceable form of the same intent is the deny below.
    //
    // Scope, stated so nobody reads more into it than it proves: this covers
    // THESE TWO TABLES. A permissive policy added to any of the other ~46
    // RLS-enabled tables changes no assertion here — the every-public-table
    // invariant further up checks `relrowsecurity`, not what the policies do.
    // `chat_notification_preferences` is the known uncovered one: it carries a
    // client-reachable SELECT policy and only a name-set + tautology tripwire.
    //
    // A bare "sees zero rows" check would be worthless on its own — a missing
    // GRANT, a fixture that never inserted, or a typo'd table name each produce
    // zero just as convincingly as working RLS, and all three fail SILENTLY
    // green forever. So each table goes through guards in order: the privilege
    // is held, the rows exist when read as owner, the catalog carries no
    // client-reachable policy of any command shape, and only then that the
    // probe sees none of the rows.
    console.log("\n=== members / financial_invoices default-deny (black-box, SET ROLE) ===");
    // Seeded in its own savepoint. A future NOT NULL column on
    // financial_invoices would otherwise raise straight past the header just
    // printed, into the tier-wide catch, and the log would show this heading
    // with nothing under it — a reader scanning for the deny assertions sees
    // absence, not failure, and `missing` counts 1 instead of the dozen
    // assertions that never ran.
    let denySeeded = true;
    await db.exec("savepoint deny_seed;");
    try {
      await db.exec(`
        insert into financial_invoices (id, chapter_id, user_id, title, amount, due_date) values
          ('${F.invA}', '${F.chapA}', '${F.userAId}', 'Chapter A dues', 15000, '2026-01-31'),
          ('${F.invB}', '${F.chapB}', '${F.userBId}', 'Chapter B dues', 25000, '2026-01-31');
      `);
      await db.exec("release savepoint deny_seed;");
    } catch (e) {
      denySeeded = false;
      miss();
      await db.exec("rollback to savepoint deny_seed; release savepoint deny_seed;");
      console.log(
        `SKIP  members / financial_invoices default-deny — fixture seed failed, 0 of its assertions ran` +
          `\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
      );
    }

    const FIXTURE_CHAPTERS = `('${F.chapA}', '${F.chapB}')`;
    // Deliberately NOT a row-count assertion. The exact cardinality is not
    // load-bearing — the guard only needs "there is something to deny" — and
    // pinning it couples this tier to the shared chat fixture, which has grown
    // twice already (userE for the cross-chapter role_ids case, userF for the
    // uppercased one). A third addition would fail here, in a tier its author
    // never touched, with a message naming neither the seed block nor the
    // literal to bump.
    const DENY_TABLES = ["members", "financial_invoices"];

    const DENY_READERS = [
      { who: "a chapter-A member reading their own chapter", as: signedIn(F.userAAuth) },
      { who: "a chapter-B member (cross-tenant)", as: signedIn(F.userBAuth) },
      { who: "a chapter-A member holding the '*' wildcard", as: signedIn(F.userDAuth) },
      // Null uid AND auth.role() = 'anon'. Stubbing only the uid would leave
      // this indistinguishable from a signed-in reader, which is how an
      // `auth.role() = 'anon'` policy stays invisible.
      { who: "an anonymous reader (no JWT, auth.role() = 'anon')", as: ANON_CLAIM },
      { who: "the anon key (role anon, no JWT)", as: ANON_KEY },
    ];

    // Asserted once, before any table: every `reads 0 rows` line below is only
    // meaningful because each probe role is a MEMBER of the client role it
    // stands in for. Without that membership a `to authenticated` (or `to
    // anon`) policy simply does not bind the probe, so the read is answered by
    // default-deny and the assertion passes while testing nothing. The anon
    // probe must also NOT be a member of `authenticated`, or it is a second
    // signed-in reader under another name. Today the `authenticated`
    // membership is also load-bearing for the chat visibility sets, which
    // would fail loudly, but this tier must not borrow its validity from
    // another tier's failure.
    for (const [name, sql] of [
      [
        "rls_probe is a member of authenticated (so `to authenticated` policies bind it)",
        `select pg_has_role('rls_probe', 'authenticated', 'member') as ok`,
      ],
      [
        "rls_probe_anon is a member of anon and not of authenticated (so it binds exactly what the anon key binds)",
        `select pg_has_role('rls_probe_anon', 'anon', 'member')
                and not pg_has_role('rls_probe_anon', 'authenticated', 'member') as ok`,
      ],
    ]) {
      const res = await db.query(sql);
      if (res.rows[0].ok === true) {
        console.log(`OK    ${name}`);
      } else {
        miss();
        console.log(`MISS  ${name}\n        ↳ every deny assertion below is vacuous for such a policy`);
      }
    }

    for (const table of denySeeded ? DENY_TABLES : []) {
      // Both guards below `continue` on failure rather than falling through.
      // Printing four confident `OK ... reads 0 rows` lines underneath a MISS
      // that just declared them meaningless is worse than printing nothing:
      // `missing` goes up either way, but anyone reading the log — or grepping
      // it for the deny assertions — sees green on a property never tested.
      const privileged = await db.query(
        `select has_table_privilege('rls_probe', 'public.${table}', 'select')
                and has_table_privilege('rls_probe_anon', 'public.${table}', 'select') as ok`,
      );
      const privName = `both probe roles hold SELECT on ${table} (so a zero-row read means RLS, not a missing grant)`;
      if (privileged.rows[0].ok !== true) {
        miss();
        console.log(`MISS  ${privName}\n        ↳ skipping ${table}: its deny assertions would pass vacuously`);
        continue;
      }
      console.log(`OK    ${privName}`);

      const seeded = await db.query(
        `select count(*)::int as n from public.${table} where chapter_id in ${FIXTURE_CHAPTERS}`,
      );
      const seedName = `${table} holds fixture rows as owner (the deny below has something to deny)`;
      if (seeded.rows[0].n < 1) {
        miss();
        console.log(`MISS  ${seedName}\n        ↳ skipping ${table}: 0 rows, so denying them proves nothing`);
        continue;
      }
      console.log(`OK    ${seedName} — ${seeded.rows[0].n} row(s)`);

      // The read probe below is `select`-only, so it is structurally blind to
      // the WRITE half of default-deny: `for insert with check (true)` or
      // `for update using (true)` leaves every read assertion green. That
      // matters more than it sounds — Supabase's default
      // `grant all on all tables in schema public to anon, authenticated`
      // stands (no table-level revoke exists in supabase/migrations/), so on a
      // permissive UPDATE policy any signed-in client could rewrite
      // `members.role_ids` and grant itself permissions.
      //
      // Both tables are supposed to carry NO policy a client role can reach,
      // in any command shape, so assert exactly that from the catalog — it
      // covers INSERT/UPDATE/DELETE/ALL without needing a write probe per
      // command. A policy bound to `supabase_auth_admin` alone is excluded
      // (AUTH_ADMIN_ONLY): that is a Supabase-internal role, not a client, and
      // `members` legitimately carries one such policy.
      // `permissive = 'PERMISSIVE'` is not optional, and every sibling policy
      // check in this gate filters it for the same reason: a RESTRICTIVE policy
      // can only ever NARROW access, so flagging one would fail CI on a
      // legitimate hardening — e.g. `as restrictive for all to authenticated
      // using (false)` — and the path of least resistance out of a red build is
      // to delete the hardening.
      const clientPolicies = await db.query(
        `select policyname, cmd, roles::text as roles
           from pg_policies
          where schemaname = 'public' and tablename = '${table}'
            and permissive = 'PERMISSIVE'
            and roles::text <> '${AUTH_ADMIN_ONLY}'`,
      );
      const anyCmdName = `${table} carries no client-reachable policy of ANY command (covers the write path)`;
      if (clientPolicies.rows.length === 0) {
        console.log(`OK    ${anyCmdName}`);
      } else {
        miss();
        console.log(
          `MISS  ${anyCmdName}\n        ↳ ` +
            clientPolicies.rows
              .map((r) => `${r.policyname} [${r.cmd}] to ${r.roles}`)
              .join("\n        ↳ "),
        );
      }

      for (const s of DENY_READERS) {
        const probe = await probeAs(s.as, `select count(*)::int as n from public.${table}`);
        const failure = probe.failure;
        const seen = probe.rows?.[0]?.n;

        const name = `${table}: ${s.who} reads 0 rows`;
        if (failure !== null) {
          miss();
          // Still a failure, not an excuse: the table is supposed to be
          // default-deny, and a policy that errors is a policy that exists.
          console.log(`MISS  ${name}\n        ↳ the read raised instead: ${failure}`);
        } else if (seen === 0) {
          console.log(`OK    ${name}`);
        } else {
          miss();
          console.log(
            `MISS  ${name}\n        ↳ read ${seen} row(s) — a policy now exposes ${table} to a client role`,
          );
        }
      }
    }
  } catch (e) {
    miss();
    console.log(
      `ERR   black-box policy enforcement\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
    );
  }
} else {
  console.log("SKIP  seed failed above — black-box scenarios not run");
}

// Discard both tiers' fixtures (rows, the probe role, the stub redefinitions) so
// the validated schema is exactly what the migrations produced and anything
// appended after this does not inherit dirty state — same contract as the
// anonymize tier. Safe when the seed failed too: the transaction is already
// aborted, and rollback is what clears it.
await db.exec("rollback;");

// Restore the default stubs so any later assertions are unaffected.
await db.exec(`
  create or replace function auth.uid()  returns uuid language sql as $$ select null::uuid $$;
  create or replace function auth.role() returns text language sql as $$ select 'service_role'::text $$;
`);
