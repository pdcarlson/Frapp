import { db, miss } from "../harness.mjs";

// ─── Fold and unfold a sidebar section (#2877) ──────────────────────────────
//
// `set_chat_sidebar_section_collapsed` is called only through a mocked
// repository in the Jest suites, so this is the one place its SQL runs. What
// each check pins, and the edit it catches:
// - the first fold creates the row with just that key;
// - folding a folded key appends nothing: dropping the `any(...)` guard lists
//   it twice;
// - unfolding removes only that key, and unfolding an unfolded one is a no-op
//   that still returns the row;
// - unfolding before any row exists creates an empty row, not a row holding
//   the key (a swapped `case` arm would fold it);
// - a fold touches only the caller's own (member, chapter) row.
try {
  const CH = "d0d0d0d0-0000-4000-8000-000000002877";
  const CH_OTHER = "d0d0d0d0-0000-4000-8000-000000012877";
  const U = {
    a: "d1d1d1d1-0000-4000-8000-0000000028a0",
    b: "d1d1d1d1-0000-4000-8000-0000000028b0",
  };
  await db.exec(`
    insert into chapters (id, name, university) values
      ('${CH}', 'Sidebar', 'U'), ('${CH_OTHER}', 'Sidebar other', 'U');
    insert into users (id, supabase_auth_id, email, display_name) values
      ('${U.a}', gen_random_uuid(), 'sidebar-a@example.com', 'A'),
      ('${U.b}', gen_random_uuid(), 'sidebar-b@example.com', 'B');
  `);
  const fold = async (user, chapter, key, collapsed) =>
    (
      await db.query(
        `select collapsed_sections::text[] as k from public.set_chat_sidebar_section_collapsed($1, $2, $3, $4)`,
        [user, chapter, key, collapsed],
      )
    ).rows;
  const keys = async (user, chapter) =>
    (
      await db.query(
        `select collapsed_sections::text[] as k from chat_sidebar_preferences where user_id = $1 and chapter_id = $2`,
        [user, chapter],
      )
    ).rows[0]?.k;
  const same = (got, want) =>
    Array.isArray(got) && got.join(",") === want.join(",");
  const checks = [];

  checks.push([
    same((await fold(U.a, CH, "direct", true))[0]?.k, ["direct"]),
    "the first fold creates the row with that key",
  ]);
  checks.push([
    same((await fold(U.a, CH, "pinned", true))[0]?.k, ["direct", "pinned"]),
    "a second fold appends",
  ]);
  checks.push([
    same((await fold(U.a, CH, "pinned", true))[0]?.k, ["direct", "pinned"]),
    "folding a folded key changes nothing",
  ]);
  checks.push([
    same((await fold(U.a, CH, "direct", false))[0]?.k, ["pinned"]),
    "unfolding removes only that key",
  ]);
  checks.push([
    same((await fold(U.a, CH, "direct", false))[0]?.k, ["pinned"]),
    "unfolding an unfolded key is a no-op that returns the row",
  ]);
  checks.push([
    same((await fold(U.b, CH, "channels", false))[0]?.k, []),
    "unfolding before any row exists creates an empty row",
  ]);
  checks.push(
    [same(await keys(U.a, CH), ["pinned"]), "another member's fold leaves this row alone"],
    [(await keys(U.a, CH_OTHER)) === undefined, "a fold writes no row in another chapter"],
  );

  for (const [ok, name] of checks) {
    if (ok) {
      console.log(`OK    ${name} (#2877)`);
    } else {
      miss();
      console.log(`MISS  ${name} (#2877)`);
    }
  }

  await db.exec(`
    delete from chapters where id in ('${CH}', '${CH_OTHER}');
    delete from users where id in ('${U.a}', '${U.b}');
  `);
} catch (e) {
  miss();
  console.log(
    `MISS  sidebar section folds (#2877)\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
