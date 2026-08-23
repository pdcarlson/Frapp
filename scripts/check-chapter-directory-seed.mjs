#!/usr/bin/env node

// Validates supabase/seed/chapter_directory.csv without needing a database.
//
// This exists because of issue #840: the seed shipped with 50 of its 100 color
// values missing the leading `#`, and nothing noticed. It could not notice —
// nothing loaded the file at all, and the accent engine degrades an unparseable
// hex to the house seed silently (it never throws — see `deriveSignetPalette`),
// so even once loaded a bad value produces a plausible-looking wrong brand
// color rather than an error.
//
// Runs in CI as the `chapter-directory-seed` job. Deliberately DB-free: no CI
// job in this repo stands up Postgres (checked all of ci.yml), so a check that
// needed one could not run on pull requests at all. The loader's actual
// execution is covered separately in `pglite-migrations`, the one CI job that
// does have a database.

import { loadSeed, SEED_RELATIVE_PATH } from "./lib/chapter-directory-seed.mjs";

function main() {
  const repoRoot = process.cwd();

  let result;
  try {
    result = loadSeed(repoRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Chapter directory seed check failed: ${message}`);
    process.exit(1);
  }

  const { rows, problems } = result;

  if (problems.length > 0) {
    console.error(
      `Chapter directory seed check FAILED — ${problems.length} problem(s) in ${SEED_RELATIVE_PATH}:\n`,
    );
    for (const p of problems) {
      console.error(`  ${SEED_RELATIVE_PATH}:${p.line}  [${p.field}]  ${p.message}`);
    }
    console.error(
      "\nEvery default_colors value must be canonical #RRGGBB with uppercase hex digits.",
    );
    console.error(
      "A malformed value does not fail loudly at runtime — the accent engine substitutes",
    );
    console.error(
      "house gold (#F2B72E) and the chapter silently gets the wrong brand color. That is why",
    );
    console.error("this is a blocking check rather than a lint warning.");
    process.exit(1);
  }

  if (rows.length === 0) {
    console.error(
      `Chapter directory seed check FAILED — ${SEED_RELATIVE_PATH} parsed clean but has no rows.`,
    );
    console.error(
      "An empty directory means onboarding autofill matches nothing, which is the",
    );
    console.error("original #840 symptom. If this is intentional, update this check.");
    process.exit(1);
  }

  const orgs = new Set(rows.map((r) => r.org_letters)).size;
  const universities = new Set(rows.map((r) => r.university)).size;

  console.log(
    `Chapter directory seed check passed — ${rows.length} rows, ` +
      `${orgs} organisations, ${universities} universities, ` +
      // One colour per row since #1225 dropped `default_colors.dark`; this read
      // `rows.length * 2` while it was a `{ dark, accent }` pair.
      `${rows.length} color values all canonical #RRGGBB.`,
  );
}

main();
