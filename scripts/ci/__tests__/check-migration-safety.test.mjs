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

import { readFileSync, readdirSync } from "node:fs";

import {
  MIGRATION_DOCS,
  UNLEDGERED,
  ledgerCoverageProblems,
  ledgerEntries,
  satisfiesPromotionDocs,
  staleDocs,
} from "../../check-migration-safety.mjs";

const PROMOTION = MIGRATION_DOCS[0];
const ROLLBACK = MIGRATION_DOCS[1];

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

// ── Ledger coverage: entry shapes ───────────────────────────────────────────
// The gate used to answer "is this migration in the runbook?" with a substring
// search, which counts prose cross-references. That is how the promotion
// runbook measured 37 of 70 while holding 21 actual entries. These tests pin
// the shape, because the substring version passes all of them but the third.

test("a promotion log heading is an entry", () => {
  const entries = ledgerEntries(
    PROMOTION,
    "### 20260831220000_chapter_documents_metadata.sql\n\nPromoted 2026-08-31.\n",
  );
  assert.deepEqual([...entries], ["20260831220000_chapter_documents_metadata.sql"]);
});

test("a prose mention of a migration is NOT a promotion entry", () => {
  // Lifted from the shape of the real runbook, where sixteen migrations appear
  // only like this — inside somebody else's entry. A mention is not a record.
  const entries = ledgerEntries(
    PROMOTION,
    "### 20260823120000_chat_message_authors.sql\n\n" +
      "no longer true.** `20260824120000_discord_import.sql` gave the importer its\n" +
      "own path, so the note above is stale.\n",
  );
  assert.deepEqual([...entries], ["20260823120000_chat_message_authors.sql"]);
});

test("a heading at the wrong level or indented is not an entry", () => {
  for (const text of [
    "## 20260831220000_chapter_documents_metadata.sql\n",
    "#### 20260831220000_chapter_documents_metadata.sql\n",
    "  ### 20260831220000_chapter_documents_metadata.sql\n",
    "### 20260831220000_chapter_documents_metadata.sql (superseded)\n",
  ]) {
    assert.deepEqual([...ledgerEntries(PROMOTION, text)], [], text);
  }
});

test("a rollback recipe subject is an entry", () => {
  const entries = ledgerEntries(
    ROLLBACK,
    "* **Migration**: `20260901183000_orphan_president_claim.sql`\n",
  );
  assert.deepEqual([...entries], ["20260901183000_orphan_president_claim.sql"]);
});

test("a superseded migration in a parenthetical is NOT credited", () => {
  // Two real recipes carry `(supersedes ...)`. The subject is what the playbook
  // covers; crediting the parenthetical would mark an uncovered migration
  // covered and silently shrink the ratchet's job.
  const entries = ledgerEntries(
    ROLLBACK,
    "* **Migration**: `20260604140000_get_points_report_window_filter.sql` " +
      "(supersedes `20250226120000_add_get_points_report_rpc.sql`)\n",
  );
  assert.deepEqual([...entries], [
    "20260604140000_get_points_report_window_filter.sql",
  ]);
});

test("ledgerEntries is not stateful across calls", () => {
  // A shared /g regex carries lastIndex, so the second call would start
  // mid-file and silently drop entries — a fail-open that only shows up on the
  // second doc parsed, which is exactly how CI would see it.
  const text = "### 20260831220000_chapter_documents_metadata.sql\n";
  assert.deepEqual(ledgerEntries(PROMOTION, text), ledgerEntries(PROMOTION, text));
});

// ── Ledger coverage: the ratchet ────────────────────────────────────────────

test("a migration with no entry and no allowlist line fails", () => {
  const problems = ledgerCoverageProblems(
    ["20260906000000_brand_new.sql"],
    new Map([[PROMOTION, new Set()], [ROLLBACK, new Set()]]),
  );
  // Scoped to the migration under test: the fixture's migration list omits the
  // real allowlisted files, so they correctly report `absent` here and would
  // drown the assertion.
  assert.deepEqual(
    problems
      .filter((p) => p.migration === "20260906000000_brand_new.sql")
      .map((p) => [p.kind, p.doc]),
    [["missing", PROMOTION], ["missing", ROLLBACK]],
    "a new migration owes BOTH ledgers",
  );
});

test("a migration covered in only one ledger still fails for the other", () => {
  // The exact hole this change closes. It is the state the newest migration on
  // `main` is actually in — `20260905010000_discord_import_archive_quota.sql`
  // has a rollback recipe and no promotion entry — but that one is allowlisted
  // as pre-existing debt, so the assertion uses a synthetic migration to prove
  // the rule applies to anything NEW.
  const problems = ledgerCoverageProblems(
    ["20260906000000_brand_new.sql"],
    new Map([
      [PROMOTION, new Set()],
      [ROLLBACK, new Set(["20260906000000_brand_new.sql"])],
    ]),
  );
  assert.deepEqual(
    problems
      .filter((p) => p.migration === "20260906000000_brand_new.sql")
      .map((p) => [p.kind, p.doc]),
    [["missing", PROMOTION]],
  );
});

test("an allowlisted migration that is now covered must lose its line", () => {
  const allowlisted = UNLEDGERED.get(PROMOTION)[1];
  const problems = ledgerCoverageProblems(
    [allowlisted],
    new Map([[PROMOTION, new Set([allowlisted])], [ROLLBACK, new Set([allowlisted])]]),
  );
  assert.deepEqual(
    problems
      .filter((p) => p.doc === PROMOTION && p.migration === allowlisted)
      .map((p) => p.kind),
    ["covered"],
    "without this the allowlist only ever goes stale — it is the ratchet's teeth",
  );
});

test("an allowlist line for a migration not on disk is stale", () => {
  const allowlisted = UNLEDGERED.get(PROMOTION)[0];
  const problems = ledgerCoverageProblems(
    [],
    new Map([[PROMOTION, new Set()], [ROLLBACK, new Set()]]),
  );
  assert.equal(
    problems.some((p) => p.kind === "absent" && p.migration === allowlisted),
    true,
  );
});

test("a ledger entry naming a migration not on disk is an orphan", () => {
  const problems = ledgerCoverageProblems(
    [],
    new Map([
      [PROMOTION, new Set(["20260906000000_deleted.sql"])],
      [ROLLBACK, new Set()],
    ]),
  );
  assert.equal(
    problems.some((p) => p.kind === "orphan" && p.migration === "20260906000000_deleted.sql"),
    true,
  );
});

// ── Ledger coverage: the shipped state ──────────────────────────────────────

test("every declared doc declares an allowlist", () => {
  // A doc in MIGRATION_DOCS with no UNLEDGERED key reads as "nothing is
  // exempt", which fails closed and loudly — but the reverse, a doc whose
  // pattern is missing, reads as "nothing is covered". Pin both.
  for (const doc of MIGRATION_DOCS) {
    assert.equal(UNLEDGERED.has(doc), true, `${doc} has no UNLEDGERED entry`);
  }
});

test("the ratchet holds against the real corpus", () => {
  // The one test that would catch a stale allowlist line drifting in. Reads the
  // live tree deliberately: this gate is REQUIRED, so a green run here is the
  // claim that main is not blocked.
  const migrations = readdirSync(join(REPO_ROOT, "supabase", "migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const entriesByDoc = new Map(
    MIGRATION_DOCS.map((doc) => [
      doc,
      ledgerEntries(doc, readFileSync(join(REPO_ROOT, doc), "utf8")),
    ]),
  );

  const problems = ledgerCoverageProblems(migrations, entriesByDoc);
  assert.deepEqual(
    problems.map((p) => `${p.kind}: ${p.migration} (${p.doc})`),
    [],
  );
});

test("the allowlists describe real gaps, not padding", () => {
  // A line here claims "this migration is genuinely unrecorded". If one is in
  // fact recorded, the previous test fails; if one names nothing on disk, so
  // does this. Guards against the list being grown to silence a failure.
  const onDisk = new Set(
    readdirSync(join(REPO_ROOT, "supabase", "migrations")).filter((f) =>
      f.endsWith(".sql"),
    ),
  );
  for (const [doc, allowed] of UNLEDGERED) {
    for (const migration of allowed) {
      assert.equal(onDisk.has(migration), true, `${migration} (${doc}) is not on disk`);
    }
    assert.equal(new Set(allowed).size, allowed.length, `${doc} allowlist has duplicates`);
  }
});
