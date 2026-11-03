import { db, miss } from "../harness.mjs";

// ─── Add and remove a PRIVATE channel's members (#1302) ─────────────────────
//
// `add_private_channel_member`, `remove_private_channel_member` and
// `remove_user_from_private_channels` are called only through mocked
// repositories in the Jest suites, so this is the one place their SQL runs.
// What each check pins, and the edit it catches:
// - an add appends once: dropping the `any(...)` guard lists a member twice;
// - an add repairs a NULL list (a PRIVATE row from before #1008);
// - the last-member guard counts current members of THIS chapter: dropping it
//   lets a removal empty the channel, counting array entries instead lets a
//   removal leave only an id whose member has left, and dropping its chapter
//   filter lets a member of another chapter count (U.gone is one). Each is
//   #1008's defect again;
// - an id whose member has left the chapter can always be removed, even when
//   nobody would remain, since it admits nobody;
// - removing someone not listed is a no-op that still returns the row, on a
//   NULL list too;
// - add and remove match only a PRIVATE channel in the named chapter (the
//   remove probe uses a no-op removal, which returns the row whenever the
//   chapter predicate is missing);
// - the chapter-removal prune takes the member off this chapter's PRIVATE
//   channels only: no Group DM, no other chapter.
try {
  const CH = "d0d0d0d0-0000-4000-8000-000000001302";
  const CH_OTHER = "d0d0d0d0-0000-4000-8000-000000011302";
  const U = {
    a: "d1d1d1d1-0000-4000-8000-0000000013a0",
    b: "d1d1d1d1-0000-4000-8000-0000000013b0",
    gone: "d1d1d1d1-0000-4000-8000-0000000013f0",
  };
  const PRIV = "d2d2d2d2-0000-4000-8000-000000001302";
  const PRIV_NULL = "d2d2d2d2-0000-4000-8000-000000011302";
  const PRIV_NULL_2 = "d2d2d2d2-0000-4000-8000-000000041302";
  const PRIV_STALE = "d2d2d2d2-0000-4000-8000-000000051302";
  const PRIV_ONLY_STALE = "d2d2d2d2-0000-4000-8000-000000061302";
  const GROUP = "d2d2d2d2-0000-4000-8000-000000021302";
  const PRIV_FOREIGN = "d2d2d2d2-0000-4000-8000-000000031302";
  await db.exec(`
    insert into chapters (id, name, university) values
      ('${CH}', 'Private members', 'U'), ('${CH_OTHER}', 'Private members other', 'U');
    insert into users (id, supabase_auth_id, email, display_name) values
      ('${U.a}', gen_random_uuid(), 'priv-a@example.com', 'A'),
      ('${U.b}', gen_random_uuid(), 'priv-b@example.com', 'B'),
      ('${U.gone}', gen_random_uuid(), 'priv-gone@example.com', 'Gone');
    -- U.gone has left CH but is still a member of CH_OTHER, so a guard
    -- that forgot its chapter filter would count them as someone remaining.
    insert into members (user_id, chapter_id) values
      ('${U.a}', '${CH}'), ('${U.b}', '${CH}'),
      ('${U.a}', '${CH_OTHER}'), ('${U.b}', '${CH_OTHER}'),
      ('${U.gone}', '${CH_OTHER}');
    insert into chat_channels (id, chapter_id, name, type, member_ids) values
      ('${PRIV}', '${CH}', 'exec', 'PRIVATE', array['${U.a}']::uuid[]),
      ('${PRIV_NULL}', '${CH}', 'legacy', 'PRIVATE', null),
      ('${PRIV_NULL_2}', '${CH}', 'legacy-2', 'PRIVATE', null),
      ('${PRIV_STALE}', '${CH}', 'stale', 'PRIVATE', array['${U.a}', '${U.gone}']::uuid[]),
      ('${PRIV_ONLY_STALE}', '${CH}', 'only-stale', 'PRIVATE', array['${U.gone}']::uuid[]),
      ('${GROUP}', '${CH}', 'group-dm', 'GROUP_DM', array['${U.a}', '${U.b}']::uuid[]),
      ('${PRIV_FOREIGN}', '${CH_OTHER}', 'exec', 'PRIVATE', array['${U.a}', '${U.b}']::uuid[]);
  `);
  const call = async (fn, channel, user, chapter = CH) =>
    (
      await db.query(`select member_ids::text[] as m from public.${fn}($1, $2, $3)`, [
        channel,
        chapter,
        user,
      ])
    ).rows;
  const add = (channel, user, chapter) =>
    call("add_private_channel_member", channel, user, chapter);
  const remove = (channel, user, chapter) =>
    call("remove_private_channel_member", channel, user, chapter);
  const members = async (channel) =>
    (
      await db.query(`select member_ids::text[] as m from chat_channels where id = $1`, [
        channel,
      ])
    ).rows[0].m;
  const same = (got, want) =>
    Array.isArray(got) && got.join(",") === want.join(",");
  const checks = [];

  checks.push([
    same((await add(PRIV, U.b))[0]?.m, [U.a, U.b]),
    "an add appends the member",
  ]);
  checks.push([
    same((await add(PRIV, U.b))[0]?.m, [U.a, U.b]),
    "adding a listed member changes nothing and still returns the row",
  ]);
  checks.push([
    same((await add(PRIV_NULL, U.b))[0]?.m, [U.b]),
    "an add repairs a NULL list",
  ]);
  checks.push(
    [(await add(GROUP, U.a)).length === 0, "an add never matches a Group DM"],
    [
      (await add(PRIV_FOREIGN, U.b, CH)).length === 0,
      "an add never matches a channel named under another chapter",
    ],
  );

  checks.push([
    same((await remove(PRIV, U.b))[0]?.m, [U.a]),
    "a removal drops the member",
  ]);
  checks.push([
    same((await remove(PRIV, U.b))[0]?.m, [U.a]),
    "removing someone not listed is a no-op that returns the row",
  ]);
  const nullRemove = await remove(PRIV_NULL_2, U.b);
  checks.push([
    nullRemove.length === 1 && nullRemove[0].m === null,
    "removing from a NULL list is a no-op that returns the row",
  ]);
  checks.push(
    [
      (await remove(PRIV, U.a)).length === 0,
      "removing the last member is refused",
    ],
    [same(await members(PRIV), [U.a]), "the refused removal changed nothing"],
    [
      (await remove(PRIV_STALE, U.a)).length === 0,
      "a removal that leaves only an id whose member has left is refused",
    ],
    [
      same(await members(PRIV_STALE), [U.a, U.gone]),
      "the refused stale-id removal changed nothing",
    ],
    [
      same((await remove(PRIV_STALE, U.gone))[0]?.m, [U.a]),
      "an id whose member has left can be removed",
    ],
    [
      same((await remove(PRIV_ONLY_STALE, U.gone))[0]?.m, []),
      "an id whose member has left can be removed even when nobody remains",
    ],
    [
      (await remove(GROUP, U.b)).length === 0,
      "a removal never matches a Group DM",
    ],
    [
      (await remove(PRIV_FOREIGN, U.gone, CH)).length === 0,
      "a removal never matches a channel named under another chapter",
    ],
    [
      same(await members(PRIV_FOREIGN), [U.a, U.b]),
      "the foreign chapter's channel is untouched",
    ],
  );

  // Chapter removal: U.b is listed in PRIV (re-added), PRIV_NULL, GROUP and
  // the other chapter's PRIV_FOREIGN.
  await add(PRIV, U.b);
  const pruned = (
    await db.query(
      `select c::text as id from public.remove_user_from_private_channels($1, $2) as c`,
      [CH, U.b],
    )
  ).rows
    .map((r) => r.id)
    .sort()
    .join(",");
  checks.push(
    [
      pruned === [PRIV, PRIV_NULL].sort().join(","),
      "the prune returns exactly the chapter's PRIVATE channels it changed",
    ],
    [same(await members(PRIV), [U.a]), "the prune takes the member off"],
    [
      same(await members(PRIV_NULL), []),
      "the prune empties a channel whose only member leaves",
    ],
    [
      same(await members(GROUP), [U.a, U.b]),
      "the prune leaves Group DMs alone",
    ],
    [
      same(await members(PRIV_FOREIGN), [U.a, U.b]),
      "the prune leaves other chapters alone",
    ],
  );

  for (const [ok, name] of checks) {
    if (ok) {
      console.log(`OK    ${name} (#1302)`);
    } else {
      miss();
      console.log(`MISS  ${name} (#1302)`);
    }
  }

  await db.exec(`
    delete from chapters where id in ('${CH}', '${CH_OTHER}');
    delete from users where id in ('${U.a}', '${U.b}', '${U.gone}');
  `);
} catch (e) {
  miss();
  console.log(
    `MISS  private channel members (#1302)\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
