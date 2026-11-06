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
    // The Wikipedia seed's SQL is megabytes; the 1 MB default threw ENOBUFS.
    { encoding: "utf8", cwd: process.cwd(), maxBuffer: 64 * 1024 * 1024 },
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

  // Search (20261106200000_chapter_directory_search.sql), against the real
  // seed: the cases that sent Paul to the manual form on 2026-11-06.
  const search = async (q, limit = 20, university = null) =>
    (
      await db.query(
        `select org_name, chapter_designation, university
         from public.search_chapter_directory($1, $3, $2)`,
        [q, limit, university],
      )
    ).rows;
  const timed = async (q) => {
    const t = performance.now();
    await search(q);
    return Math.round(performance.now() - t);
  };
  const isTauNu = (r) =>
    r.org_name === "Phi Gamma Delta" &&
    r.chapter_designation === "Tau Nu" &&
    r.university === "Rensselaer Polytechnic Institute";
  // Every chapter at the school, so Tau Nu's place in the alphabet can't hide it.
  const byFullSchool = await search("Rensselaer", 50);
  const byAliases = await search("fiji rpi");
  const byPrefix = await search("phi gamma del");
  const byTypo = await search("phi gamma delta renselaer");
  const byNothing = await search("   ");
  // How people type names the directory spells with punctuation.
  const all = async (q, test) => (await search(q, 50)).filter(test).length;
  const atSchool = (re) => (r) => re.test(r.university);
  const apostrophe = await all("st johns", atSchool(/^St\. John's University/));
  const accents = await all("manoa", atSchool(/Mānoa/));
  const andForAmp = await all("william and mary", atSchool(/William & Mary/));
  const ampJoined = await all("texas am", atSchool(/^Texas A&M University$/));
  const ampSpaced = await all("texas a & m", atSchool(/^Texas A&M University$/));
  const joiningWord = await search("sigma chi at ohio state");
  // An organization's nickname names the organization, not the school: no
  // Kappa Kappa Gamma row ranks above Kappa Sigma's for "kappa sig".
  const nickname = await search("kappa sig");
  // The school filter, by full name and by short name, and on its own.
  const filtered = await search("phi gamma delta", 50, "Rensselaer");
  const filteredShort = await search("fiji", 50, "rpi");
  const browse = await search("", 50, "Rensselaer Polytechnic");
  // A pasted paragraph costs what a name does.
  const long = Array.from({ length: 400 }, (_, i) => `zq${i}xv`).join(" ");
  const longRows = await search(long);
  const ms = {
    "ph": await timed("ph"),
    "un": await timed("un"),
    "phi gamma delta": await timed("phi gamma delta"),
    "fiji rpi": await timed("fiji rpi"),
    "phi gamma delta renselaer": await timed("phi gamma delta renselaer"),
    "400 made-up words": await timed(long),
  };
  console.log(`      search timings (ms): ${JSON.stringify(ms)}`);

  // What a load does with rows the seed doesn't list:
  //   * one the loader owns and no chapter links is pruned (the hand-written
  //     first seed's "Pi Tau" at RPI was one);
  //   * one the loader owns that a chapter links is retired: kept, still
  //     linked, never offered by search;
  //   * one from another source is left alone.
  const LINKED = "00000000-0000-4000-8000-0000000c4a01";
  await db.exec(`
    insert into public.chapter_directory
      (org_letters, org_name, archetype, chapter_designation, university, university_short, source)
    values
      ('ΦΓΔ', 'Phi Gamma Delta', 'ifc', 'Pi Tau', 'RPI', 'RPI', 'seed'),
      ('ΦΓΔ', 'Phi Gamma Delta', 'ifc', 'Linked Placeholder', 'RPI', 'RPI', 'seed'),
      ('ΦΓΔ', 'Phi Gamma Delta', 'ifc', 'Hand Curated', 'RPI', 'RPI', 'manual');
    insert into chapters (id, name, university, directory_id)
      select '${LINKED}', 'Linked', 'RPI', id from public.chapter_directory
      where chapter_designation = 'Linked Placeholder';
  `);
  await db.exec(loadSql);
  const rowsNamed = async (designation) =>
    (
      await db.query(
        `select source from public.chapter_directory where chapter_designation = $1 and university = 'RPI'`,
        [designation],
      )
    ).rows.map((r) => r.source);
  const stale = await rowsNamed("Pi Tau");
  const linked = await rowsNamed("Linked Placeholder");
  const linkHolds = (
    await db.query(`select directory_id is not null as ok from chapters where id = '${LINKED}'`)
  ).rows[0]?.ok === true;
  const curated = await rowsNamed("Hand Curated");
  const retiredFound = (await search("fiji linked placeholder")).length;
  await db.exec(`delete from chapters where id = '${LINKED}'`);

  const checks = [
    [firstCount > 0, `seed loads rows (got ${firstCount})`],
    [byFullSchool.some(isTauNu), `"Rensselaer" finds Tau Nu at RPI (${byFullSchool.length} rows)`],
    [byAliases[0] && isTauNu(byAliases[0]), `"fiji rpi" puts Tau Nu first`],
    [
      byPrefix.length > 0 && byPrefix.every((r) => r.org_name === "Phi Gamma Delta"),
      `"phi gamma del" finds only Phi Gamma Delta chapters as typed (${byPrefix.length} rows)`,
    ],
    [byTypo[0] && isTauNu(byTypo[0]), `"phi gamma delta renselaer" forgives the typo`],
    [byNothing.length === 0, `a blank query finds nothing (${byNothing.length} rows)`],
    [apostrophe > 0, `"st johns" finds St. John's University (${apostrophe} rows)`],
    [accents > 0, `"manoa" finds Mānoa (${accents} rows)`],
    [andForAmp > 0, `"william and mary" finds William & Mary (${andForAmp} rows)`],
    [ampJoined > 0 && ampSpaced > 0, `"texas am" and "texas a & m" find Texas A&M (${ampJoined}, ${ampSpaced} rows)`],
    [
      joiningWord[0]?.org_name === "Sigma Chi" && joiningWord[0]?.university === "Ohio State University",
      `"sigma chi at ohio state" skips "at" and puts Sigma Chi there first`,
    ],
    [
      nickname.length > 0 && nickname[0].org_name === "Kappa Sigma",
      `"kappa sig" puts Kappa Sigma first (got ${nickname[0]?.org_name})`,
    ],
    [
      filtered.length > 0 && filtered.some(isTauNu) &&
        filtered.every((r) => r.university === "Rensselaer Polytechnic Institute"),
      `the school filter narrows by full name (${filtered.length} rows)`,
    ],
    [filteredShort.some(isTauNu) && filteredShort.length === filtered.length, "the school filter narrows by short name"],
    [
      browse.some(isTauNu) && browse.every((r) => r.university === "Rensselaer Polytechnic Institute"),
      `a school filter with no query lists its chapters (${browse.length} rows)`,
    ],
    [longRows.length === 0, "a 400-word query finds nothing and returns"],
    [stale.length === 0, "a stale unlinked seed row is pruned on load"],
    [
      linked.length === 1 && linked[0] === "retired" && linkHolds,
      `a stale seed row a chapter links is retired and stays linked (${linked.join(",") || "gone"})`,
    ],
    [retiredFound === 0, "a retired row is never offered by search"],
    [curated.length === 1 && curated[0] === "manual", "a row from another source is left alone"],
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
