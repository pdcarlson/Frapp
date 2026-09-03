import { test } from "node:test";
import assert from "node:assert/strict";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");


// check-migration-safety.mjs is a general-purpose script under scripts/ (a peer
// of the other check-*.mjs gates); its test lives here so the existing
// `test:ci-scripts` glob (scripts/ci/__tests__/*.test.mjs) runs it — hence the
// ../../ reach up.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MIGRATION_DOCS,
  satisfiesPromotionDocs,
  staleDocs,
} from "../../check-migration-safety.mjs";

// ── The base contract ───────────────────────────────────────────────────────

test("touching either declared runbook satisfies the gate", () => {
  for (const doc of MIGRATION_DOCS) {
    assert.equal(
      satisfiesPromotionDocs(["supabase/migrations/20260101000000_x.sql", doc]),
      true,
      `${doc} should satisfy the gate`,
    );
  }
});

test("a migration with no doc touch does not satisfy the gate", () => {
  assert.equal(
    satisfiesPromotionDocs(["supabase/migrations/20260101000000_x.sql"]),
    false,
  );
});

// ── The fail-open that used to be here ──────────────────────────────────────
// `file.startsWith("spec/environments/")` was a third disjunct until this test
// existed: touching ANY environments doc satisfied the gate. Measured, nothing
// relied on it — it was dead weight, not the cause of the ledger drift (that is
// the two-entry list itself: the rollback playbook alone satisfies the gate).
// Pin the removed arm shut so it cannot creep back.

test("an environments doc alone no longer satisfies the gate", () => {
  assert.equal(
    satisfiesPromotionDocs([
      "supabase/migrations/20260101000000_x.sql",
      "spec/environments/README.md",
    ]),
    false,
  );
});

test("no declared doc is satisfied by a path prefix, only by exact match", () => {
  // A nested file under the same directory must NOT count: the gate asks for
  // the ledger itself, not for anything filed near it.
  assert.equal(
    satisfiesPromotionDocs(["docs/internal/ops/incident-response.md"]),
    false,
  );
});

// ── The manifest ratchet ────────────────────────────────────────────────────
// Hardcoded `===` paths in a REQUIRED check fail badly on a rename: the gate
// blocks every migration PR in the repo because the author updated the renamed
// file and matched no literal. `staleDocs()` exists so that failure names the
// manifest instead of the blameless PR.

test("every declared doc is tracked today", () => {
  // Deliberately calls staleDocs() with NO injected predicate: the shipped
  // resolver is the one branch CI actually runs, and re-implementing the
  // lookup here would leave it with zero coverage while still going green.
  const missing = staleDocs();
  assert.deepEqual(
    missing,
    [],
    `MIGRATION_DOCS names ${missing.join(", ")}, which are no longer tracked. ` +
      "Repoint the list in the same change set as the rename.",
  );
});

test("the whole gate runs from any directory, not just the repo root", () => {
  // Not merely the manifest: MIGRATIONS_DIR was cwd-relative too, so running
  // the gate from a subdirectory died with ENOENT on supabase/migrations —
  // a broken-checkout message for what was really "you are standing in the
  // wrong folder". Both roots are resolved from the script now; pin it.
  const script = join(REPO_ROOT, "scripts", "check-migration-safety.mjs");
  const out = execFileSync(process.execPath, [script], {
    cwd: join(REPO_ROOT, "scripts"),
    encoding: "utf8",
  });
  assert.match(out, /Migration safety check passed\./);
});

test("the shipped resolver is repo-root anchored, not cwd-relative", () => {
  // `git diff --name-only` yields repo-root-relative paths whatever the cwd, so
  // the manifest must resolve the same way or the gate misdiagnoses a plain
  // subdirectory run as a rename.
  const cwd = process.cwd();
  try {
    process.chdir(join(cwd, "scripts"));
    assert.deepEqual(staleDocs(), []);
  } finally {
    process.chdir(cwd);
  }
});

test("staleDocs reports a renamed doc rather than passing silently", () => {
  // Simulate the rename the docs restructure will perform.
  const renamed = staleDocs((doc) => doc !== MIGRATION_DOCS[0]);
  assert.deepEqual(renamed, [MIGRATION_DOCS[0]]);
});

test("staleDocs is empty when the manifest matches the tree", () => {
  assert.deepEqual(
    staleDocs(() => true),
    [],
  );
});

test("staleDocs reports every missing entry, not just the first", () => {
  assert.deepEqual(staleDocs(() => false), MIGRATION_DOCS);
});
