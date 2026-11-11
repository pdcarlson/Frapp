import { readFileSync } from "node:fs";
import { join } from "node:path";

import { db, miss } from "../harness.mjs";
import { setAuth } from "../probe.mjs";

// ─── Functional: who can see and post (20261111230000, #3722) ───────────────
//
// Replay runs the backfill against an empty `chat_channels`, so replay alone
// proves nothing about it. This tier seeds a chapter the way it looked before
// the lists: roles with permission strings, channels gated by
// `required_permissions` and `is_read_only`, and no lists. It writes them
// with the migration's checks dropped and its bridge trigger off, so the rows
// sit there exactly as an unmigrated database holds them, then runs the whole
// migration file over them: the backfill, the category backfill and the
// VALIDATE of every check, as staging and production will. It checks the
// migration's promise that every member sees and posts exactly where they
// did, and that the bridge trigger converts a row the same way. Then the rest
// of what it leaves in place: the checks that keep `type` and `is_read_only`
// equal to the lists, a category's change reaching only the channels that
// matched it, a deleted role or tier leaving every list, the bridge on an old
// writer's update, `can_read_chat_channel` on a tier entry, and a second run
// of the whole file changing nothing.
//
// Everything runs inside one transaction and is rolled back.
console.log("\n=== Functional: who can see and post (20261111230000) ===");
{
  const CH = "c3722000-0000-4000-8000-00000000000a";
  const T_EXEC = "c3722000-0000-4000-8000-0000000000e1";
  const T_MEMBERS = "c3722000-0000-4000-8000-0000000000e3";
  const R_PRES = "c3722000-0000-4000-8000-000000000001";
  const R_TREAS = "c3722000-0000-4000-8000-000000000002";
  const R_BRO = "c3722000-0000-4000-8000-000000000005";
  const R_ALUM = "c3722000-0000-4000-8000-000000000007";
  const R_RUSH = "c3722000-0000-4000-8000-000000000009";
  const U_TREAS = "c3722000-0000-4000-8000-0000000000a2";
  const A_TREAS = "c3722000-0000-4000-8000-0000000000b2";
  const U_BRO = "c3722000-0000-4000-8000-0000000000a5";
  const A_BRO = "c3722000-0000-4000-8000-0000000000b5";
  const CAT = "c3722000-0000-4000-8000-0000000000ca";
  const CAT_EMPTY = "c3722000-0000-4000-8000-0000000000cb";
  const CH_OTHER = "c3722000-0000-4000-8000-00000000000b";
  const ch = (n) =>
    `c3722000-0000-4000-8000-0000000c${String(n).padStart(4, "0")}`;
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20261111230000_chat_channel_access_lists.sql",
    ),
    "utf8",
  );
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const rows = async (text, params = []) => (await db.query(text, params)).rows;
  const channel = async (id) =>
    (
      await rows(
        `select type, is_read_only, who_can_see, who_can_post from chat_channels where id = $1`,
        [id],
      )
    )[0];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const sorted = (...entries) => [...entries].sort();
  const refused = async (text) => {
    await db.exec("savepoint expect_refusal");
    try {
      await db.exec(text);
      await db.exec("release savepoint expect_refusal");
      return false;
    } catch {
      await db.exec("rollback to savepoint expect_refusal");
      return true;
    }
  };

  try {
    // Roles hold their permission lists as given: the tier sync triggers
    // would recompute them from tiers, which this tier is not about.
    await db.exec(`
      begin;
      drop trigger if exists trg_roles_sync_permissions on roles;
      drop trigger if exists trg_role_tiers_sync_roles on role_tiers;
      insert into chapters (id, name, university) values ('${CH}', 'Access', 'U');
      insert into role_tiers (id, chapter_id, position, name, permissions) values
        ('${T_EXEC}', '${CH}', 1, 'Exec board', '{}'),
        ('${T_MEMBERS}', '${CH}', 2, 'Members', '{}');
      insert into roles (id, chapter_id, name, system_key, tier_id, display_order, permissions) values
        ('${R_PRES}', '${CH}', 'President', 'PRESIDENT', '${T_EXEC}', 1, '{*}'),
        ('${R_TREAS}', '${CH}', 'Treasurer', 'TREASURER', '${T_EXEC}', 2, '{members:view,announcements:post,finances:read}'),
        ('${R_BRO}', '${CH}', 'Brother', 'MEMBER', '${T_MEMBERS}', 5, '{members:view}'),
        ('${R_ALUM}', '${CH}', 'Alumni', 'ALUMNI', null, 7, '{members:view,alumni:post,announcements:post}'),
        ('${R_RUSH}', '${CH}', 'Rush chair', null, null, 8, '{channels:read:rush}');
      insert into users (id, supabase_auth_id, email) values
        ('${U_TREAS}', '${A_TREAS}', 'treasurer@test.local'),
        ('${U_BRO}', '${A_BRO}', 'brother@test.local');
      insert into members (user_id, chapter_id, role_ids) values
        ('${U_TREAS}', '${CH}', '{${R_TREAS}}'),
        ('${U_BRO}', '${CH}', '{${R_BRO}}');
      insert into chapters (id, name, university) values ('${CH_OTHER}', 'Other', 'U');
      insert into chat_channel_categories (id, chapter_id, name) values
        ('${CAT}', '${CH}', 'Exec'),
        ('${CAT_EMPTY}', '${CH}', 'Empty');
      -- An unmigrated database: no checks on the lists, no bridge.
      alter table chat_channels
        drop constraint chat_channels_access_lists_where_they_apply,
        drop constraint chat_channels_type_follows_who_can_see,
        drop constraint chat_channels_read_only_follows_who_can_post;
      alter table chat_channels disable trigger chat_channels_legacy_access;
      -- What an API from before #3722 writes: no lists.
      insert into chat_channels (id, chapter_id, name, type, is_read_only, is_audit_log, required_permissions, category_id) values
        ('${ch(1)}', '${CH}', 'general', 'PUBLIC', false, false, null, null),
        ('${ch(2)}', '${CH}', 'announcements', 'PUBLIC', true, false, null, null),
        ('${ch(3)}', '${CH}', 'chapter-audit', 'PUBLIC', true, true, null, '${CAT}'),
        ('${ch(4)}', '${CH}', 'treasury', 'ROLE_GATED', false, false, '{finances:read}', '${CAT}'),
        ('${ch(5)}', '${CH}', 'alumni', 'ROLE_GATED', false, false, '{members:view,alumni:post}', null),
        ('${ch(6)}', '${CH}', 'actives', 'ROLE_GATED', false, false, '{members:view}', null),
        ('${ch(7)}', '${CH}', 'rush', 'ROLE_GATED', false, false, '{channels:read:rush}', '${CAT}'),
        ('${ch(8)}', '${CH}', 'exec-news', 'ROLE_GATED', true, false, '{finances:read}', '${CAT}'),
        ('${ch(9)}', '${CH}', 'nobody', 'ROLE_GATED', false, false, '{}', null);
      insert into chat_channels (id, chapter_id, name, type, is_read_only, member_ids) values
        ('${ch(10)}', '${CH}', 'exec-private', 'PRIVATE', true, '{${U_TREAS},${U_BRO}}'),
        ('${ch(11)}', '${CH}', 'friends', 'PRIVATE', false, '{${U_TREAS},${U_BRO}}');
      -- Another chapter's channel filed under this chapter's empty category,
      -- which nothing has ever refused: it must not set that category's lists.
      insert into chat_channels (id, chapter_id, name, type, is_read_only, required_permissions, category_id) values
        ('${ch(12)}', '${CH_OTHER}', 'stray', 'ROLE_GATED', false, '{}', '${CAT_EMPTY}');
    `);
    await db.exec(sql);

    const role = (id) => `role:${id}`;
    const expected = {
      [ch(1)]: {
        type: "PUBLIC",
        is_read_only: false,
        who_can_see: null,
        who_can_post: null,
      },
      // Read-only: the roles holding announcements:post, minus Alumni (whose
      // rule kept them out of a channel that is not alumni-postable).
      [ch(2)]: {
        type: "PUBLIC",
        is_read_only: true,
        who_can_see: null,
        who_can_post: [role(R_TREAS)],
      },
      [ch(3)]: {
        type: "PUBLIC",
        is_read_only: true,
        who_can_see: null,
        who_can_post: [],
      },
      [ch(4)]: {
        type: "ROLE_GATED",
        is_read_only: false,
        who_can_see: [role(R_TREAS)],
        who_can_post: null,
      },
      // Alumni-postable: Alumni on who can see, anyone who sees may post.
      [ch(5)]: {
        type: "ROLE_GATED",
        is_read_only: false,
        who_can_see: sorted(role(R_TREAS), role(R_BRO), role(R_ALUM)),
        who_can_post: null,
      },
      // Not alumni-postable, though Alumni hold members:view: they keep
      // reading, and posting goes to everyone else who sees it.
      [ch(6)]: {
        type: "ROLE_GATED",
        is_read_only: true,
        who_can_see: sorted(role(R_TREAS), role(R_BRO), role(R_ALUM)),
        who_can_post: sorted(role(R_TREAS), role(R_BRO)),
      },
      [ch(7)]: {
        type: "ROLE_GATED",
        is_read_only: false,
        who_can_see: [role(R_RUSH)],
        who_can_post: null,
      },
      [ch(8)]: {
        type: "ROLE_GATED",
        is_read_only: true,
        who_can_see: [role(R_TREAS)],
        who_can_post: [role(R_TREAS)],
      },
      [ch(9)]: {
        type: "ROLE_GATED",
        is_read_only: false,
        who_can_see: [],
        who_can_post: null,
      },
      // Read-only private: its members still decide who reads it, and the
      // roles that could post there still can.
      [ch(10)]: {
        type: "PRIVATE",
        is_read_only: true,
        who_can_see: null,
        who_can_post: [role(R_TREAS)],
      },
      [ch(11)]: {
        type: "PRIVATE",
        is_read_only: false,
        who_can_see: null,
        who_can_post: null,
      },
    };
    const converted = {};
    for (const id of Object.keys(expected)) converted[id] = await channel(id);
    for (const [id, want] of Object.entries(expected)) {
      check(
        `an old channel converts as it was: ${id.slice(-2)}`,
        same(converted[id], want),
        { got: converted[id], want },
      );
    }

    check(
      "a category is never set from another chapter's channel",
      same(
        (
          await rows(
            `select who_can_see, who_can_post from chat_channel_categories where id = $1`,
            [CAT_EMPTY],
          )
        )[0],
        { who_can_see: null, who_can_post: null },
      ),
      {},
    );

    // The bridge trigger converts a row the way the backfill did.
    await db.exec(`
      insert into chat_channels (id, chapter_id, name, type, is_read_only, required_permissions) values
        ('${ch(20)}', '${CH}', 'actives-2', 'ROLE_GATED', false, '{members:view}'),
        ('${ch(21)}', '${CH}', 'exec-private-2', 'PRIVATE', true, null);
    `);
    check(
      "the bridge trigger converts as the backfill did",
      same(await channel(ch(20)), expected[ch(6)]) &&
        same(await channel(ch(21)), expected[ch(10)]),
      { actives: await channel(ch(20)), privateLocked: await channel(ch(21)) },
    );
    await db.query(`delete from chat_channels where id = any($1)`, [
      [ch(20), ch(21)],
    ]);

    // The backfill run again over converted rows is a no-op, and the
    // category it agrees on for `Exec` stays unset (its channels disagree).
    await db.exec(sql);
    const rerun = {};
    for (const id of Object.keys(expected)) rerun[id] = await channel(id);
    const category = async () =>
      (
        await rows(
          `select who_can_see, who_can_post from chat_channel_categories where id = $1`,
          [CAT],
        )
      )[0];
    check(
      "running the migration again changes no channel",
      same(rerun, converted),
      { rerun },
    );
    check(
      "a category whose channels disagree keeps everyone",
      same(await category(), { who_can_see: null, who_can_post: null }),
      await category(),
    );

    check(
      "type must follow who can see, and read-only who can post",
      (await refused(
        `update chat_channels set who_can_see = null where id = '${ch(4)}'`,
      )) &&
        (await refused(
          `update chat_channels set who_can_post = null where id = '${ch(2)}'`,
        )),
      {},
    );
    check(
      "an entry must be tier:<uuid> or role:<uuid>",
      await refused(
        `update chat_channels set who_can_see = '{members:view}', type = 'ROLE_GATED' where id = '${ch(1)}'`,
      ),
      {},
    );
    check(
      "a private channel takes no lists",
      await refused(
        `insert into chat_channels (chapter_id, name, type, member_ids, who_can_see) values
           ('${CH}', 'secret', 'PRIVATE', '{${U_BRO}}', '{role:${R_BRO}}')`,
      ),
      {},
    );

    // Category sync: point `treasury` and `rush` at the category's lists by
    // hand, as the API's "match" writes them, then change the category.
    await db.query(
      `update chat_channel_categories set who_can_see = $2 where id = $1`,
      [CAT, [`tier:${T_EXEC}`]],
    );
    await db.query(
      `update chat_channels set who_can_see = $2, type = 'ROLE_GATED' where id = any($1)`,
      [[ch(4), ch(7)], [`tier:${T_EXEC}`]],
    );
    const followed = (
      await rows(`select set_chat_category_access($1, $2, $3, $4) as id`, [
        CH,
        CAT,
        [`tier:${T_EXEC}`, `tier:${T_MEMBERS}`],
        [`tier:${T_EXEC}`],
      ])
    )
      .map((r) => r.id)
      .sort();
    check(
      "a category's change reaches exactly the channels that matched it",
      same(followed, [ch(4), ch(7)].sort()) &&
        same(
          (await channel(ch(4))).who_can_see,
          sorted(`tier:${T_EXEC}`, `tier:${T_MEMBERS}`),
        ) &&
        (await channel(ch(4))).is_read_only === true &&
        same((await channel(ch(8))).who_can_see, [role(R_TREAS)]) &&
        same((await channel(ch(3))).who_can_post, []),
      {
        followed,
        treasury: await channel(ch(4)),
        execNews: await channel(ch(8)),
      },
    );

    // can_read_chat_channel reads tier entries through the member's roles.
    await setAuth({ uid: A_BRO, jwtRole: "authenticated" });
    const broReads = (
      await rows(`select can_read_chat_channel($1) as ok`, [ch(4)])
    )[0].ok;
    await setAuth({ uid: A_TREAS, jwtRole: "authenticated" });
    const treasReadsTier = (
      await rows(`select can_read_chat_channel($1) as ok`, [ch(4)])
    )[0].ok;
    await db.query(
      `update chat_channels set who_can_see = $2, who_can_post = null, is_read_only = false where id = $1`,
      [ch(7), [`tier:${T_EXEC}`]],
    );
    const treasReadsExecOnly = (
      await rows(`select can_read_chat_channel($1) as ok`, [ch(7)])
    )[0].ok;
    await setAuth({ uid: A_BRO, jwtRole: "authenticated" });
    const broReadsExecOnly = (
      await rows(`select can_read_chat_channel($1) as ok`, [ch(7)])
    )[0].ok;
    await setAuth({ uid: null, jwtRole: "service_role" });
    check(
      "can_read_chat_channel admits a holder of a listed tier and no one else",
      broReads === true &&
        treasReadsTier === true &&
        treasReadsExecOnly === true &&
        broReadsExecOnly === false,
      { broReads, treasReadsTier, treasReadsExecOnly, broReadsExecOnly },
    );

    // An old writer flips read-only: the bridge re-derives who can post.
    await db.query(
      `update chat_channels set is_read_only = true where id = $1`,
      [ch(1)],
    );
    check(
      "an old writer's read-only switch becomes a who-can-post list",
      same(await channel(ch(1)), {
        type: "PUBLIC",
        is_read_only: true,
        who_can_see: null,
        who_can_post: [role(R_TREAS)],
      }),
      await channel(ch(1)),
    );

    // Deleting a role or a tier takes its entry off every list.
    await db.query(`delete from roles where id = $1`, [R_TREAS]);
    await db.query(`update roles set tier_id = null where tier_id = $1`, [
      T_MEMBERS,
    ]);
    await db.query(`delete from role_tiers where id = $1`, [T_MEMBERS]);
    const afterDelete = {
      announcements: await channel(ch(2)),
      treasury: await channel(ch(4)),
      category: await category(),
    };
    check(
      "a deleted role or tier leaves every channel and category list",
      same(afterDelete.announcements.who_can_post, []) &&
        same(afterDelete.treasury.who_can_see, [`tier:${T_EXEC}`]) &&
        same(afterDelete.category.who_can_see, [`tier:${T_EXEC}`]),
      afterDelete,
    );
  } catch (e) {
    check("the tier ran to the end", false, {
      error: String(e?.message ?? e).split("\n")[0],
    });
  } finally {
    await db.exec("rollback");
    await setAuth({ uid: null, jwtRole: "service_role" });
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
