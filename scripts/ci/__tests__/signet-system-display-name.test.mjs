// Locks the seeded system actor display_name on Signet.
//
// WHY THIS EXISTS. #1935 adds a forward UPDATE so
// users.id = 00000000-0000-0000-0000-000000000000 reads `Signet System`.
// The historical seed still inserts `Frapp System` on purpose. A later
// leftover sweep can "fix" the seed, drop the UPDATE, or change the
// PGlite landmark without a product-copy test noticing. Chat cards do
// not print this name today, so a revert is silent on the UI.
//
// SCOPE. Forward migration SET, historical seed INSERT, and the PGlite
// landmark. Do not assert rollback playbook text (it names Frapp System
// on purpose). Leave system@frapp.local, SYSTEM_SENDER_ID, and frapp://
// alone. Export filenames are #1937. Calendar ICS is #1929.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const MIGRATION = "supabase/migrations/20260909120000_rename_system_user_display_name.sql";
const SEED = "supabase/migrations/20260524120000_chapter_directory_requests.sql";
const LANDMARK = "scripts/check-pglite-migrations.mjs";

function readRepo(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
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
