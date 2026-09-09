// Locks the seeded system actor display_name on Signet.
//
// WHY THIS EXISTS. Leftover 1935 adds a forward UPDATE so
// users.id = 00000000-0000-0000-0000-000000000000 reads `Signet System`.
// The historical seed still inserts `Frapp System` on purpose. A later
// leftover sweep can "fix" the seed, rename system@frapp.local, drop the
// UPDATE, or change the PGlite landmark without a product-copy test
// noticing. Chat cards do not print this name today, so a revert is
// silent on the UI.
//
// SCOPE. Forward migration SET, historical seed INSERT, the PGlite
// landmark, the rollback restore name, and the identifiers that must
// stay Frapp (system@frapp.local, SYSTEM_SENDER_ID). Walk apps/ and
// packages/ so a live `Frapp System` string cannot sneak in. Export
// filenames stay on leftover 1937. Calendar ICS stays on leftover 1929.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const MIGRATION = "supabase/migrations/20260909120000_rename_system_user_display_name.sql";
const SEED = "supabase/migrations/20260524120000_chapter_directory_requests.sql";
const LANDMARK = "scripts/check-pglite-migrations.mjs";
const ROLLBACK = "docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md";
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

export function systemIdentityProblems({ seed, chatConstant }) {
  const problems = [];
  if (!/system@frapp\.local/.test(seed)) {
    problems.push(`seed email must stay ${SYSTEM_EMAIL}`);
  }
  if (/system@signet\.local/.test(seed)) {
    problems.push("seed email must not become system@signet.local");
  }
  if (!new RegExp(`SYSTEM_SENDER_ID = '${SYSTEM_SENDER_ID}'`).test(chatConstant)) {
    problems.push("SYSTEM_SENDER_ID must stay the all-zeros id");
  }
  return problems;
}

export function productFrappSystemProblems(files) {
  return files
    .filter(({ source }) => /Frapp System/.test(source))
    .map(({ rel }) => rel);
}

test("forward migration sets Signet System, not Frapp System", () => {
  const sql = readRepo(MIGRATION);
  assert.match(sql, /set display_name = 'Signet System'/);
  assert.doesNotMatch(
    sql,
    /set display_name = 'Frapp System'/,
    `${MIGRATION} must not write the leftover name`,
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

test("PGlite landmark requires Signet System after replay", () => {
  const source = readRepo(LANDMARK);
  assert.match(source, /display_name === "Signet System"/);
  assert.match(source, /seeded system actor display_name is Signet System/);
});

test("system actor email and sender id stay Frapp identifiers", () => {
  assert.deepEqual(
    systemIdentityProblems({
      seed: readRepo(SEED),
      chatConstant: readRepo(CHAT),
    }),
    [],
  );
});

test("renaming the system email to system@signet.local fails", () => {
  const seed = readRepo(SEED).replaceAll(SYSTEM_EMAIL, "system@signet.local");
  const problems = systemIdentityProblems({
    seed,
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

test("rollback playbook restores Frapp System, not Signet System", () => {
  const source = readRepo(ROLLBACK);
  assert.match(
    source,
    /set display_name = 'Frapp System' where id = '00000000-0000-0000-0000-000000000000'/,
  );
  assert.doesNotMatch(
    source,
    /set display_name = 'Signet System' where id =/,
    `${ROLLBACK} undo must restore the historical name`,
  );
});

test("apps and packages have no live Frapp System copy", () => {
  const files = walkProductSources().map((rel) => ({ rel, source: readRepo(rel) }));
  assert.deepEqual(productFrappSystemProblems(files), []);
});

test("a live Frapp System string in product code fails the walk", () => {
  const problems = productFrappSystemProblems([
    {
      rel: "apps/api/src/application/services/chat.service.ts",
      source: "const label = 'Frapp System';\n",
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
