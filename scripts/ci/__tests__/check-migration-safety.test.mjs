import { test } from "node:test";
import assert from "node:assert/strict";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");


// check-migration-safety.mjs is a general-purpose script under scripts/ (a peer
// of the other check-*.mjs gates); its test lives here so the existing
// `test:ci-scripts` glob (scripts/ci/__tests__/*.test.mjs) runs it — hence the
// ../../ reach up.
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import {
  LEDGER_ENTRY_PATTERNS,
  MIGRATION_DOCS,
  RATCHET_VERSION_CEILING,
  UNLEDGERED,
  ledgerCoverageProblems,
  ratchetViolations,
  ledgerEntries,
  satisfiesPromotionDocs,
  staleDocs,
} from "../../check-migration-safety.mjs";

const PROMOTION = MIGRATION_DOCS[0];
const ROLLBACK = MIGRATION_DOCS[1];

// Two tests below mutate the REAL worktree — the gate resolves its roots from
// its own location, so there is no temp tree to point it at. A `finally` covers
// a thrown assertion; it does NOT cover an interrupted run, and an interrupted
// run leaves DB_ROLLBACK_PLAYBOOK.md renamed or a probe migration on disk, so
// every later `check:migration-safety` in that checkout fails on state no author
// created.
//
// `exit` alone is not enough for that: Node does not emit it when a signal
// terminates the process, which is the likely interruption here (Ctrl-C during
// the ~80ms the test blocks in spawnSync). Verified — a script that registers an
// `exit` restore and then receives SIGINT dies at 130 with the file still moved.
// So sweep on the signals too, then re-raise so the exit code still reports the
// signal rather than masking it as a clean exit.
const exitCleanups = new Set();

function sweepCleanups() {
  for (const cleanup of exitCleanups) {
    try {
      cleanup();
    } catch {
      // Best-effort only: preserve the original test result during process exit.
    }
  }
  exitCleanups.clear();
}

process.once("exit", sweepCleanups);
for (const signal of ["SIGINT", "SIGTERM"]) {
  // `once` removes this listener before the re-raise, so the second delivery
  // hits Node's default handler and terminates with the conventional code.
  process.once(signal, () => {
    sweepCleanups();
    process.kill(process.pid, signal);
  });
}

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

test("the promotion runbook's SECOND entry shape counts", () => {
  // The defect this file shipped with: reading only `###` headings scored the
  // runbook at 21/70 and marked 14 migrations as having no recoverable
  // promotion history — while their dated records sat on the page in this
  // shape. A doc may record an entry more than one way.
  const entries = ledgerEntries(
    PROMOTION,
    "## 2026-08-09: Activation funnel — `chapter_activation_milestones` (#267)\n" +
      "* **Migration**: `20260809001500_chapter_activation_milestones.sql`\n",
  );
  assert.deepEqual([...entries], ["20260809001500_chapter_activation_milestones.sql"]);
});

test("the rollback playbook's heading entry shape counts", () => {
  const entries = ledgerEntries(
    ROLLBACK,
    "## Rollback Chunk 05 migration (20260527120000_chat_notification_preferences.sql)\n",
  );
  assert.deepEqual([...entries], ["20260527120000_chat_notification_preferences.sql"]);
});

test("a `-` list marker is read the same as `*`", () => {
  // Prettier normalizes unordered list markers to `-`, and nothing in this repo
  // stops it running over a .md. Pinning only `* ` meant one format-on-save
  // would zero every rollback entry and turn a REQUIRED check red repo-wide,
  // telling 55 authors their migration "needs an entry" that was never removed.
  for (const doc of [PROMOTION, ROLLBACK]) {
    assert.deepEqual(
      [...ledgerEntries(doc, "- **Migration**: `20260901183000_orphan_president_claim.sql`\n")],
      ["20260901183000_orphan_president_claim.sql"],
      doc,
    );
  }
});

// ── Ledger coverage: the ratchet ────────────────────────────────────────────

test("a migration with no entry and no allowlist line fails", () => {
  const problems = ledgerCoverageProblems(
    ["20260906000000_brand_new.sql"],
    new Map([[PROMOTION, new Set()], [ROLLBACK, new Set()]]),
    new Map([[PROMOTION, []], [ROLLBACK, []]]),
  );
  assert.deepEqual(
    problems.map((p) => [p.kind, p.doc]),
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
    new Map([[PROMOTION, []], [ROLLBACK, []]]),
  );
  assert.deepEqual(
    problems.map((p) => [p.kind, p.doc]),
    [["missing", PROMOTION]],
  );
});

test("an allowlisted migration that is now covered must lose its line", () => {
  // Uses a synthetic allowlist-shaped fixture rather than indexing the real
  // list positionally: the real list is designed to shrink to zero, and a test
  // that reads [0]/[1] fails on the ratchet's own success.
  const migration = "20260101000000_fixture.sql";
  const problems = ledgerCoverageProblems(
    [migration],
    new Map([[PROMOTION, new Set([migration])], [ROLLBACK, new Set([migration])]]),
    new Map([[PROMOTION, [migration]], [ROLLBACK, []]]),
  );
  assert.deepEqual(
    problems.filter((p) => p.migration === migration).map((p) => [p.kind, p.doc]),
    [["covered", PROMOTION]],
    "without this the allowlist only ever goes stale — it is the ratchet's teeth",
  );
});

test("an allowlist line for a migration not on disk is stale", () => {
  const problems = ledgerCoverageProblems(
    [],
    new Map([[PROMOTION, new Set()], [ROLLBACK, new Set()]]),
    new Map([[PROMOTION, ["20260101000000_renamed_away.sql"]], [ROLLBACK, []]]),
  );
  assert.deepEqual(
    problems.map((p) => [p.kind, p.migration]),
    [["absent", "20260101000000_renamed_away.sql"]],
  );
});

test("a rollback recipe for a migration not on disk is an orphan", () => {
  const problems = ledgerCoverageProblems(
    [],
    new Map([[PROMOTION, new Set()], [ROLLBACK, new Set(["20260906000000_deleted.sql"])]]),
    new Map([[PROMOTION, []], [ROLLBACK, []]]),
  );
  assert.deepEqual(
    problems.map((p) => [p.kind, p.doc]),
    [["orphan", ROLLBACK]],
  );
});

test("a promotion entry for a migration not on disk is NOT an orphan", () => {
  // The promotion runbook is a dated record of what was actually promoted. A
  // squash or a revert removes the file but not the fact, and demanding the
  // entry be deleted to get CI green would destroy the operational history this
  // gate exists to protect.
  const problems = ledgerCoverageProblems(
    [],
    new Map([[PROMOTION, new Set(["20260906000000_deleted.sql"])], [ROLLBACK, new Set()]]),
    new Map([[PROMOTION, []], [ROLLBACK, []]]),
  );
  assert.deepEqual(problems, []);
});

// ── Ledger coverage: the shipped state ──────────────────────────────────────

test("every declared doc declares at least one entry shape", () => {
  // A doc with no pattern makes ledgerEntries return the empty set, so every
  // migration in the tree reports `missing` — loud, but it blames every author
  // in the repo for a manifest mistake.
  for (const doc of MIGRATION_DOCS) {
    const patterns = LEDGER_ENTRY_PATTERNS.get(doc);
    assert.ok(patterns?.length > 0, `${doc} declares no entry shape`);
    for (const pattern of patterns) {
      assert.ok(pattern.flags.includes("g"), `${pattern} must be global for matchAll`);
    }
  }
});

test("no allowlist entry is newer than the ratchet ceiling", () => {
  // The shrink-only rule, enforced rather than asserted in a comment. Without
  // it an author blocked by the gate can append their new migration to
  // UNLEDGERED and go green — satisfying a REQUIRED check by adding debt.
  for (const [doc, allowed] of UNLEDGERED) {
    for (const migration of allowed) {
      assert.ok(
        migration.slice(0, 14) <= RATCHET_VERSION_CEILING,
        `${migration} (${doc}) is newer than ${RATCHET_VERSION_CEILING} and cannot be grandfathered`,
      );
    }
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

// ── The ratchet's own enforcement, driven through the shipped CLI ────────────
// Round-2 review proved these were unpinned: mutating `process.exit(2)` to
// `exit(1)`, or `grown.length === 0` to `>= 0`, left the whole suite green.
// Unit-testing the constant is not enough either — a test that reads
// RATCHET_VERSION_CEILING re-derives the rule from the value it should pin, so
// raising the ceiling and appending a filename passed. Pin the literal, and run
// the real gate in a subprocess so exit codes are observed, not assumed.

const GATE = join(REPO_ROOT, "scripts", "check-migration-safety.mjs");

function runGate(env = {}) {
  const result = spawnSync(process.execPath, [GATE], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

test("RATCHET_VERSION_CEILING is pinned to its literal value", () => {
  // Deliberately a literal, not a re-read of the constant. Raising the ceiling
  // re-opens the allowlist escape hatch, so it must be a visible decision in a
  // diff rather than a one-line edit that keeps CI green.
  assert.equal(RATCHET_VERSION_CEILING, "20260905010000");
});

test("no allowlist entry is newer than the pinned ceiling", () => {
  for (const [doc, allowed] of UNLEDGERED) {
    for (const migration of allowed) {
      assert.ok(
        migration.slice(0, 14) <= "20260905010000",
        `${migration} (${doc}) is newer than the ratchet ceiling`,
      );
    }
  }
});

test("the shipped gate passes on the current tree", () => {
  const { status, out } = runGate();
  assert.equal(status, 0, out);
});

test("the shipped gate exits 2, not 1, when a declared ledger cannot be read", () => {
  // Exit 1 means "your change broke a rule"; this is "the gate cannot do its
  // job". validateDocManifest asks git what is TRACKED, so a doc present in the
  // index but absent from the worktree reaches the read and used to surface as
  // a raw ENOENT at exit 1, blaming a blameless author.
  const ledger = join(REPO_ROOT, MIGRATION_DOCS[1]);
  const moved = `${ledger}.moved`;
  // Idempotent: a restore that threw stays registered, so the sweep re-runs it.
  const restoreLedger = () => {
    if (existsSync(moved)) renameSync(moved, ledger);
  };
  exitCleanups.add(restoreLedger);
  renameSync(ledger, moved);
  try {
    const { status, out } = runGate();
    assert.equal(status, 2, out);
    assert.match(out, /declared ledger is unreadable/);
  } finally {
    restoreLedger();
    exitCleanups.delete(restoreLedger);
  }
});

test("the shipped gate exits 1 when a migration has no ledger entry", () => {
  const probe = join(REPO_ROOT, "supabase", "migrations", "29990101000000_ledger_probe.sql");
  const removeProbe = () => rmSync(probe, { force: true });
  exitCleanups.add(removeProbe);
  writeFileSync(probe, "-- fixture\n");
  try {
    const { status, out } = runGate();
    assert.equal(status, 1, out);
    assert.match(out, /29990101000000_ledger_probe\.sql needs an entry/);
    // Both ledgers, not just one — the whole point of the change.
    assert.match(out, /DB_PROMOTION_RUNBOOK\.md/);
    assert.match(out, /DB_ROLLBACK_PLAYBOOK\.md/);
  } finally {
    removeProbe();
    exitCleanups.delete(removeProbe);
  }
});

test("ratchetViolations rejects an entry newer than the ceiling", () => {
  const violations = ratchetViolations(
    new Map([["doc.md", ["20260101000000_old.sql", "20990101000000_new.sql"]]]),
    "20260905010000",
  );
  assert.deepEqual(
    violations,
    [{ doc: "doc.md", migration: "20990101000000_new.sql" }],
    "only the post-ceiling entry is a violation",
  );
});

test("ratchetViolations accepts the shipped allowlists", () => {
  assert.deepEqual(ratchetViolations(), []);
});
