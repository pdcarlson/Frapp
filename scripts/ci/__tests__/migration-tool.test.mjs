// scripts/migration.mjs: versions for new migrations, and the renames that move
// a branch's migrations after main. Lives here so `test:ci-scripts` runs it.
import { test } from "node:test";
import assert from "node:assert/strict";

import { freshVersion, nextVersion, planRenames, versionOf } from "../../migration.mjs";

const NOW = new Date(Date.UTC(2026, 10, 12, 19, 30, 5));

test("versionOf writes a 14-digit UTC stamp", () => {
  assert.equal(versionOf(NOW), "20261112193005");
});

test("nextVersion adds a second, and still sorts after a hand-picked hour 25", () => {
  assert.equal(nextVersion("20261112193059"), "20261112193100");
  const after = nextVersion("20261112250000");
  assert.ok(after > "20261112250000", after);
  assert.match(after, /^\d{14}$/);
});

test("freshVersion is the clock when nothing is newer", () => {
  assert.equal(freshVersion(["20261112120000"], NOW), "20261112193005");
});

test("freshVersion goes past a future-dated version on main", () => {
  const v = freshVersion(["20261112120000", "20261112260000"], NOW);
  assert.ok(v > "20261112260000", v);
});

test("planRenames leaves a branch alone when its migrations already sort last", () => {
  assert.deepEqual(
    planRenames(["20261112200000_mine.sql"], ["20261112120000_main.sql"], NOW),
    [],
  );
});

test("planRenames moves a migration that main overtook", () => {
  const renames = planRenames(
    ["20261112150000_mine.sql"],
    ["20261112150000_users_phone.sql", "20261112170000_flags.sql"],
    NOW,
  );
  assert.deepEqual(renames, [
    { from: "20261112150000_mine.sql", to: "20261112193005_mine.sql" },
  ]);
});

test("planRenames keeps a branch's migrations in their order, one second apart", () => {
  const renames = planRenames(
    ["20261112100000_b.sql", "20261112090000_a.sql"],
    ["20261112180000_main.sql"],
    NOW,
  );
  assert.deepEqual(renames, [
    { from: "20261112090000_a.sql", to: "20261112193005_a.sql" },
    { from: "20261112100000_b.sql", to: "20261112193006_b.sql" },
  ]);
});

test("planRenames splits two of the branch's own migrations that share a version", () => {
  const renames = planRenames(
    ["20261112200000_a.sql", "20261112200000_b.sql"],
    ["20261112120000_main.sql"],
    NOW,
  );
  assert.equal(new Set(renames.map((r) => r.to.slice(0, 14))).size, 2);
});
