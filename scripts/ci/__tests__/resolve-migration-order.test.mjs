import { test } from "node:test";
import assert from "node:assert/strict";

import { planMigrationRenames, planRenumberTree } from "../resolve-migration-order.mjs";

const NOW = new Date("2026-11-06T20:00:00Z");
const added = (filename) => ({ filename, status: "added" });

test("only the branch's own new migrations count, and they move only when one sorts too early", () => {
  const files = [
    added("supabase/migrations/20261112150000_a.sql"),
    { filename: "supabase/migrations/20261101000000_old.sql", status: "modified" },
    { filename: "supabase/migrations/20261112170000_gone.sql", status: "removed" },
    added("supabase/migrations/README.md"),
  ];
  const base = ["20261101000000_old.sql", "20261112160000_b.sql"];
  const { introduced, renames } = planMigrationRenames({ files, baseMigrations: base, now: NOW });
  assert.deepEqual(introduced, ["20261112150000_a.sql"]);
  assert.deepEqual(renames, [{ from: "20261112150000_a.sql", to: "20261112160001_a.sql" }]);

  const later = planMigrationRenames({ files, baseMigrations: ["20261112140000_b.sql"], now: NOW });
  assert.deepEqual(later.renames, []);
});

test("versions this sweep already handed out are kept clear", () => {
  const { renames } = planMigrationRenames({
    files: [added("supabase/migrations/20261112150000_a.sql")],
    baseMigrations: ["20261112160000_b.sql"],
    taken: ["20261112160001"],
    now: NOW,
  });
  assert.deepEqual(renames, [{ from: "20261112150000_a.sql", to: "20261112160002_a.sql" }]);
});

test("versions handed out this sweep never make an in-order PR move", () => {
  const { renames } = planMigrationRenames({
    files: [added("supabase/migrations/20261112170000_b.sql")],
    baseMigrations: ["20261112160000_m.sql"],
    taken: ["20261112180000"],
    now: NOW,
  });
  assert.deepEqual(renames, []);
});

const blob = (sha, mode = "100644") => ({ sha, mode });
const renames = [{ from: "20261112150000_a.sql", to: "20261112160001_a.sql" }];

test("moves the migration and its page, rewrites references, and keeps file modes", () => {
  const tree = new Map([
    ["supabase/migrations/20261112150000_a.sql", blob("s1")],
    ["docs/ops/database/migrations/20261112150000_a.md", blob("s2")],
    ["scripts/seed.sh", blob("s3", "100755")],
    ["logo.png", blob("s4")],
  ]);
  const texts = new Map([
    ["supabase/migrations/20261112150000_a.sql", "-- a\n"],
    ["scripts/seed.sh", "psql -f 20261112150000_a.sql\n"],
    ["logo.png", null],
  ]);
  const plan = planRenumberTree({ renames, tree, texts });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.rewritten, ["scripts/seed.sh"]);
  assert.deepEqual(
    plan.entries,
    [
      { path: "supabase/migrations/20261112150000_a.sql", mode: "100644", type: "blob", sha: null },
      { path: "supabase/migrations/20261112160001_a.sql", mode: "100644", type: "blob", sha: "s1" },
      { path: "scripts/seed.sh", mode: "100755", type: "blob", content: "psql -f 20261112160001_a.sql\n" },
      // The page was not among the changed files, and still moves.
      { path: "docs/ops/database/migrations/20261112150000_a.md", mode: "100644", type: "blob", sha: null },
      { path: "docs/ops/database/migrations/20261112160001_a.md", mode: "100644", type: "blob", sha: "s2" },
    ],
  );
});

test("refuses when a target already exists or a workflow would change", () => {
  const tree = new Map([
    ["supabase/migrations/20261112150000_a.sql", blob("s1")],
    ["supabase/migrations/20261112160001_a.sql", blob("s9")],
  ]);
  const taken = planRenumberTree({ renames, tree, texts: new Map() });
  assert.equal(taken.ok, false);
  assert.match(taken.reason, /already exists/);

  const workflow = planRenumberTree({
    renames,
    tree: new Map([
      ["supabase/migrations/20261112150000_a.sql", blob("s1")],
      [".github/workflows/x.yml", blob("s2")],
    ]),
    texts: new Map([[".github/workflows/x.yml", "run: 20261112150000_a\n"]]),
  });
  assert.equal(workflow.ok, false);
  assert.match(workflow.reason, /workflow files/);
});

test("refuses when a bare old version is left, which may be main's", () => {
  const plan = planRenumberTree({
    renames,
    tree: new Map([
      ["supabase/migrations/20261112150000_a.sql", blob("s1")],
      ["docs/x.md", blob("s2")],
    ]),
    texts: new Map([["docs/x.md", "see 20261112150000\n"]]),
  });
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /docs\/x\.md \(20261112150000\)/);
});
