// Locks the seeded system actor display_name on Frapp.
//
// WHY THIS EXISTS. The actor at users.id = 00000000-0000-0000-0000-000000000000
// has had three names. The historical seed inserts `Frapp System`, leftover
// 1935 renamed it `Signet System` with a forward UPDATE, and ADR-25 step 3
// renamed it back with a second forward UPDATE. A later sweep can "fix" a
// migration that already ran, drop the newest UPDATE, rename
// system@frapp.local, or change the PGlite landmark without a product-copy
// test noticing. Chat cards do not print this name today, so a revert is
// silent on the UI. Until step 3 this lock was signet-system-display-name.
//
// SCOPE. The three migrations as written, the PGlite landmark, the newest
// rollback recipe, and the identifiers that stay Frapp (system@frapp.local,
// SYSTEM_SENDER_ID). Walk apps/ and packages/ so a live `Signet System`
// string cannot sneak in. Export filenames and the ICS PRODID are
// frapp-api-copy's.
//
// SYSTEM_SENDER_ID has one home: `@repo/validation` owns the literal so the
// mobile and web clients can hide Block on a system message, and the API's
// `domain/constants/chat.ts` re-exports it (packages cannot import apps, so
// the value cannot live in the API and be shared). The lock pins the literal
// where it lives and pins the API re-export, so neither a changed value nor a
// second, drifting copy in the API passes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const SIGNET_MIGRATION = "supabase/migrations/20260909120000_rename_system_user_display_name.sql";
const MIGRATION = "supabase/migrations/20260924190000_rename_system_actor_to_frapp.sql";
const SEED = "supabase/migrations/20260524120000_chapter_directory_requests.sql";
const LANDMARK = "scripts/check-pglite-migrations.mjs";
const ROLLBACK = "docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md";
const VALIDATION = "packages/validation/src/index.ts";
const CHAT = "apps/api/src/domain/constants/chat.ts";

export const SYSTEM_EMAIL = "system@frapp.local";
export const SYSTEM_SENDER_ID = "00000000-0000-0000-0000-000000000000";

const PRODUCT_ROOTS = ["apps/web", "apps/api", "apps/mobile", "packages"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", "coverage"]);
const SOURCE_EXT = /\.(?:ts|tsx|js|mjs)$/;

function readRepo(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

export function walkProductSources(root = REPO_ROOT) {
  const files = [];
  const walk = (relDir) => {
    for (const entry of readdirSync(join(root, relDir), { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const rel = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(rel);
        continue;
      }
      if (SOURCE_EXT.test(entry.name)) files.push(rel);
    }
  };
  for (const productRoot of PRODUCT_ROOTS) walk(productRoot);
  return files.sort();
}

export function systemIdentityProblems({
  seed,
  validationSource,
  chatConstant,
}) {
  const problems = [];
  if (!/system@frapp\.local/.test(seed)) {
    problems.push(`seed email must stay ${SYSTEM_EMAIL}`);
  }
  if (/system@signet\.local/.test(seed)) {
    problems.push("seed email must not become system@signet.local");
  }
  if (
    !new RegExp(
      `export const SYSTEM_SENDER_ID = ["']${SYSTEM_SENDER_ID}["']`,
    ).test(validationSource)
  ) {
    problems.push(
      `SYSTEM_SENDER_ID must stay the all-zeros id in ${VALIDATION}`,
    );
  }
  if (
    !/export \{ SYSTEM_SENDER_ID \} from ['"]@repo\/validation['"]/.test(
      chatConstant,
    )
  ) {
    problems.push(
      `${CHAT} must re-export SYSTEM_SENDER_ID from @repo/validation`,
    );
  }
  if (/SYSTEM_SENDER_ID\s*=/.test(chatConstant)) {
    problems.push(`${CHAT} must not keep its own SYSTEM_SENDER_ID copy`);
  }
  return problems;
}

export function productSignetSystemProblems(files) {
  return files
    .filter(({ source }) => /Signet System/.test(source))
    .map(({ rel }) => rel);
}

/** The body of one `## Rollback …` recipe, up to the next `## ` heading. */
export function rollbackSection(source, heading) {
  const start = source.indexOf(`## ${heading}\n`);
  if (start === -1) return "";
  const next = source.indexOf("\n## ", start + 3);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

test("the newest forward migration sets Frapp System, not Signet System", () => {
  const sql = readRepo(MIGRATION);
  assert.match(sql, /set display_name = 'Frapp System'/);
  assert.match(sql, /where id = '00000000-0000-0000-0000-000000000000'/);
  assert.doesNotMatch(
    sql,
    /set display_name = 'Signet System'/,
    `${MIGRATION} must not write the leftover name`,
  );
});

test("the 2026-09-09 migration still sets Signet System, as it ran", () => {
  const sql = readRepo(SIGNET_MIGRATION);
  assert.match(sql, /set display_name = 'Signet System'/);
  assert.doesNotMatch(
    sql,
    /set display_name = 'Frapp System'/,
    `${SIGNET_MIGRATION} already ran on hosted projects; rename with a new migration, not by editing it`,
  );
});

test("historical seed still inserts Frapp System", () => {
  const sql = readRepo(SEED);
  assert.match(sql, /'Frapp System'/);
  assert.doesNotMatch(
    sql,
    /'Signet System'/,
    `${SEED} is the insert record; do not rewrite it`,
  );
});

test("PGlite landmark requires Frapp System after replay", () => {
  const source = readRepo(LANDMARK);
  assert.match(source, /display_name === "Frapp System"/);
  assert.match(source, /seeded system actor display_name is Frapp System/);
  assert.doesNotMatch(source, /display_name === "Signet System"/);
});

test("system actor email and sender id stay Frapp identifiers", () => {
  assert.deepEqual(
    systemIdentityProblems({
      seed: readRepo(SEED),
      validationSource: readRepo(VALIDATION),
      chatConstant: readRepo(CHAT),
    }),
    [],
  );
});

test("a changed sender id, or a second copy in the API, fails", () => {
  const changed = systemIdentityProblems({
    seed: readRepo(SEED),
    validationSource: readRepo(VALIDATION).replace(
      SYSTEM_SENDER_ID,
      "00000000-0000-0000-0000-000000000001",
    ),
    chatConstant: readRepo(CHAT),
  });
  assert.ok(
    changed.some((problem) => problem.includes("all-zeros id")),
    changed.join("; "),
  );

  const forked = systemIdentityProblems({
    seed: readRepo(SEED),
    validationSource: readRepo(VALIDATION),
    chatConstant: `export const SYSTEM_SENDER_ID = '${SYSTEM_SENDER_ID}';\n`,
  });
  assert.ok(
    forked.some((problem) => problem.includes("re-export")),
    forked.join("; "),
  );
  assert.ok(
    forked.some((problem) => problem.includes("own SYSTEM_SENDER_ID copy")),
    forked.join("; "),
  );
});

test("renaming the system email to system@signet.local fails", () => {
  const seed = readRepo(SEED).replaceAll(SYSTEM_EMAIL, "system@signet.local");
  const problems = systemIdentityProblems({
    seed,
    validationSource: readRepo(VALIDATION),
    chatConstant: readRepo(CHAT),
  });
  assert.ok(
    problems.some((problem) => problem.includes("system@signet.local")),
    problems.join("; "),
  );
  assert.ok(
    problems.some((problem) => problem.includes(SYSTEM_EMAIL)),
    problems.join("; "),
  );
});

test("the Frapp System rollback recipe restores Signet System and names its migration", () => {
  const recipe = rollbackSection(readRepo(ROLLBACK), "Rollback the Frapp System display_name");
  assert.ok(recipe, `${ROLLBACK} must keep § Rollback the Frapp System display_name`);
  assert.match(recipe, new RegExp(`\\* \\*\\*Migration\\*\\*: \`${MIGRATION.split("/").pop()}\``));
  assert.match(
    recipe,
    /set display_name = 'Signet System' where id = '00000000-0000-0000-0000-000000000000'/,
  );
  assert.doesNotMatch(recipe, /set display_name = 'Frapp System' where id =/);
});

test("rollbackSection stops at the next recipe", () => {
  const source = "## Rollback a\n* one\n## Rollback b\n* two\n";
  assert.equal(rollbackSection(source, "Rollback a"), "## Rollback a\n* one");
  assert.equal(rollbackSection(source, "Rollback b"), "## Rollback b\n* two\n");
  assert.equal(rollbackSection(source, "Rollback c"), "");
});

test("apps and packages have no live Signet System copy", () => {
  const files = walkProductSources().map((rel) => ({ rel, source: readRepo(rel) }));
  assert.deepEqual(productSignetSystemProblems(files), []);
});

test("a live Signet System string in product code fails the walk", () => {
  const problems = productSignetSystemProblems([
    {
      rel: "apps/api/src/application/services/chat.service.ts",
      source: "const label = 'Signet System';\n",
    },
  ]);
  assert.deepEqual(problems, ["apps/api/src/application/services/chat.service.ts"]);
});

test("refuses a GitHub closer next to an issue number", () => {
  const lock = readFileSync(fileURLToPath(import.meta.url), "utf8");
  assert.doesNotMatch(
    lock,
    /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i,
  );
});
