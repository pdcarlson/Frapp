import { join } from "node:path";

import { db, miss } from "../harness.mjs";

// ─── Chapter directory seed load (#840) ─────────────────────────────────────
// The loader's SQL runs against a real Postgres nowhere else in CI: no job here
// stands up a database, so `chapter-directory-seed` can only validate the CSV
// statically. This is where the generated SQL actually executes.
//
// Two properties are asserted, and idempotency is the one that matters. The
// obvious delete-then-insert loader would satisfy "row count is stable" while
// silently nulling `chapters.directory_id` on every bootstrap — that column is
// `on delete set null` — so the second run additionally proves row ids survive.
console.log("\n=== chapter directory seed load (#840) ===");
try {
  const { execFileSync } = await import("node:child_process");
  const loadSql = execFileSync(
    process.execPath,
    [join(process.cwd(), "scripts", "load-chapter-directory.mjs")],
    { encoding: "utf8", cwd: process.cwd() },
  );

  const idsOf = async () => {
    const r = await db.query(
      `select id::text from public.chapter_directory order by org_letters, university, coalesce(chapter_designation,'')`,
    );
    return r.rows.map((x) => x.id).join(",");
  };

  await db.exec(loadSql);
  const firstCount = (
    await db.query(`select count(*)::int as n from public.chapter_directory`)
  ).rows[0].n;
  const firstIds = await idsOf();

  await db.exec(loadSql);
  const secondCount = (
    await db.query(`select count(*)::int as n from public.chapter_directory`)
  ).rows[0].n;
  const secondIds = await idsOf();

  const badColors = (
    await db.query(
      // `accent` is the only key in `default_colors` since #1225; the `dark`
      // half went with #1224's removal of `branding.colors.dark`. Asserting it
      // here would have been quietly useless anyway: `->>'dark'` on a row
      // without the key is NULL, and `NULL !~ pattern` is NULL rather than
      // true, so a missing key never counted.
      `select count(*)::int as n from public.chapter_directory
       where default_colors->>'accent' !~ '^#[0-9A-F]{6}$'`,
    )
  ).rows[0].n;

  const checks = [
    [firstCount > 0, `seed loads rows (got ${firstCount})`],
    [
      secondCount === firstCount,
      `re-running is idempotent (${firstCount} → ${secondCount} rows)`,
    ],
    [
      secondIds === firstIds && firstIds !== "",
      "row ids survive a re-run (chapters.directory_id stays valid)",
    ],
    [badColors === 0, `every loaded color is canonical #RRGGBB (${badColors} bad)`],
  ];

  for (const [ok, name] of checks) {
    if (ok) {
      console.log(`OK    ${name}`);
    } else {
      miss();
      console.log(`MISS  ${name}`);
    }
  }

  // Leave the schema as the migrations produced it — same contract as the tiers
  // above, so anything appended later does not inherit seeded rows.
  await db.exec("delete from public.chapter_directory;");
} catch (e) {
  // Same contract as the tiers above: a thrown error becomes a counted MISS with a
  // one-line reason, not a stack trace that buries the other 40-odd assertions. The
  // generator exits non-zero on an invalid seed, and execFileSync turns that into a
  // throw — which is a legitimate failure to report, not a crash to propagate.
  miss();
  console.log(
    `MISS  chapter directory seed load\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
