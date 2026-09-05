#!/usr/bin/env node

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Resolved from this file, never `process.cwd()`. Every path this gate reasons
// about is repo-root-relative — `git diff --name-only` emits them that way, and
// the migrations live at a fixed place in the tree — so anchoring on the cwd
// only creates a second root for the same question. Run from a subdirectory the
// cwd form died with ENOENT on `supabase/migrations`, which reads as a broken
// checkout rather than "you are standing in the wrong folder".
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const MIGRATION_FILENAME = /^\d{14}_[a-z0-9_]+\.sql$/;

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("-")) {
    console.error(`Error: flag ${name} requires a value.`);
    process.exit(2);
  }
  return value;
}

function getChangedFiles(base, head) {
  if (!base || !head) return [];

  const ranges = [`${base}...${head}`, `${base}..${head}`];

  for (const range of ranges) {
    try {
      const output = execSync(`git diff --name-only ${range}`, {
        encoding: "utf8",
      }).trim();
      if (!output) return [];
      return output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      // Try next range expression.
    }
  }

  try {
    execSync(`git fetch --no-tags --depth=500 origin ${base} ${head}`, {
      stdio: "ignore",
    });
  } catch {
    // Best-effort fetch; fall through to final failure message.
  }

  for (const range of ranges) {
    try {
      const output = execSync(`git diff --name-only ${range}`, {
        encoding: "utf8",
      }).trim();
      if (!output) return [];
      return output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      // Try next range expression.
    }
  }

  throw new Error(
    `Unable to diff changed files for base=${base} head=${head}. Ensure checkout fetch-depth is 0 or these refs are fetched.`,
  );
}

/** The migrations on disk, listed once and shared by every validator below. */
function readMigrationFilenames() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

function validateMigrationFiles(migrationFiles) {
  const invalid = migrationFiles.filter((file) => !MIGRATION_FILENAME.test(file));
  if (invalid.length > 0) {
    console.error("Migration safety check failed: invalid migration filename(s).");
    for (const file of invalid) {
      console.error(`- ${file}`);
    }
    console.error(
      "Expected format: 14-digit timestamp prefix + snake_case name (e.g. 20260304120000_add_users.sql).",
    );
    process.exit(1);
  }

  // Two migrations sharing the same 14-digit version prefix collide in
  // Supabase's `schema_migrations` (its primary key is the version): applying
  // the second raises a duplicate-key error, breaking `supabase start` /
  // `db reset` on a fresh DB and skipping the second file on an
  // already-migrated DB. Dedupe on the version prefix, not the full filename
  // (filenames are unique on disk, so the old filename check could never fire).
  // This is exactly the #634/#635 collision (FRA-288).
  const versions = migrationFiles.map((file) => file.slice(0, 14));
  const duplicateVersions = [
    ...new Set(
      versions.filter((version, index) => versions.indexOf(version) !== index),
    ),
  ];
  if (duplicateVersions.length > 0) {
    console.error(
      "Migration safety check failed: duplicate migration version prefix(es).",
    );
    for (const version of duplicateVersions) {
      const colliders = migrationFiles.filter((file) =>
        file.startsWith(`${version}_`),
      );
      console.error(`- ${version}: ${colliders.join(", ")}`);
    }
    console.error(
      "Each migration needs a unique 14-digit version prefix; Supabase keys schema_migrations by it.",
    );
    process.exit(1);
  }
}

/**
 * The docs a migration change must update. Declared once, and checked for
 * staleness on every run before the gate judges any PR (see
 * `validateDocManifest`).
 *
 * That inversion is the point. Hardcoded `===` paths inside a REQUIRED check
 * have two failure modes on a rename and both are bad: the gate blocks every
 * migration PR in the repository because the author updated the *renamed* file
 * and matched none of the literals, or it quietly stops requiring anything at
 * all. Checking the manifest first turns both into one loud failure that names
 * this constant, so the rename gets fixed instead of the blameless PR.
 *
 * `spec/environments/` used to be a third disjunct: touching ANY environments
 * doc satisfied the gate. Measured over the last 400 commits on `main` it was
 * dead weight rather than the leak — 28 migration commits touched a runbook
 * directly and NONE was carried by that prefix alone — so dropping it costs no
 * existing workflow. Do not read more into its removal than that.
 *
 * The ledger hole it was blamed for was this list's own shape: either entry
 * satisfies the gate, so a migration PR that updates only the rollback playbook
 * never touched the promotion log. Of the 28 migration commits measured,
 * nineteen touched the rollback playbook alone and two the promotion runbook
 * alone, which is how the promotion log fell behind the tree.
 *
 * That hole is CLOSED, below: `validateLedgerCoverage` asserts per-migration
 * coverage in both docs by entry shape, whole-tree. This predicate remains as
 * the cheap PR-time half — it catches "you changed a migration and touched
 * neither runbook" with a diff instead of a parse — but it is no longer what
 * proves the ledger complete. Do not restore an "either doc is enough" reading
 * from this comment alone.
 */
export const MIGRATION_DOCS = [
  "docs/internal/ops/DB_PROMOTION_RUNBOOK.md",
  "docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md",
];

/** Does this change set update one of the docs a migration owes? */
export function satisfiesPromotionDocs(changedFiles) {
  return changedFiles.some((file) => MIGRATION_DOCS.includes(file));
}

/**
 * Where each ledger actually records a migration — as a SHAPE, not a substring.
 *
 * This distinction is why the hole survived being measured twice. A
 * `grep -F <filename>` over the promotion runbook answers 37 of 70, but a
 * filename also appears in prose cross-references — "`2026...discord_import.sql`
 * gave the importer its own..." — narrative asides inside somebody else's
 * entry. A mention is not a promotion record, and a gate that accepts one
 * grades the wrong thing.
 *
 * A doc may record an entry in MORE THAN ONE shape, and the promotion runbook
 * does. Reading only the first shape is the mistake this list was written with:
 * 21 entries are `### <migration>.sql` headings, but 14 more are real, dated
 * promotion records written the other way — `## 2026-08-09: Activation funnel`
 * followed by a `* **Migration**: `<file>.sql`` bullet. Missing them understated
 * coverage as 21/70 when it is 35/70, and wrongly marked 14 migrations as
 * having no recoverable promotion history when their dates are on the page. So
 * each doc declares a LIST of shapes, and a match on any of them is an entry.
 *
 * Capture group 1 is the migration filename in every pattern. The bullet
 * patterns deliberately anchor to the FIRST backtick after the label, because
 * two rollback recipes carry a `(supersedes `<older>.sql`)` parenthetical — the
 * subject is what the doc covers, and the superseded migration must not be
 * credited by sitting in someone else's parentheses.
 */
export const LEDGER_ENTRY_PATTERNS = new Map([
  [
    "docs/internal/ops/DB_PROMOTION_RUNBOOK.md",
    [
      /^### (\d{14}_[a-z0-9_]+\.sql)[ \t]*$/gm,
      /^[*-] \*\*Migration\*\*: `(\d{14}_[a-z0-9_]+\.sql)`/gm,
    ],
  ],
  [
    "docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md",
    [
      /^[*-] \*\*Migration\*\*: `(\d{14}_[a-z0-9_]+\.sql)`/gm,
      /^## Rollback .*\((\d{14}_[a-z0-9_]+\.sql)\)[ \t]*$/gm,
    ],
  ],
]);

/**
 * The version prefix at which this ratchet was installed. No allowlist entry
 * may name a migration newer than this.
 *
 * This is what makes "shrink-only" a rule rather than a comment. Every
 * migration filename carries a sortable 14-digit version, so a migration
 * created after the ratchet cannot be exempted: the only way past the gate for
 * new work is a real ledger entry. Without it the escape hatch is two lines in
 * a list nobody re-reads — an author blocked by the gate appends their new
 * filename here and CI goes green, which is the gate being satisfied by adding
 * debt.
 *
 * Raising this constant re-opens that hatch, so treat it as a decision, not a
 * fix. It is pinned by test, and there is no legitimate reason to move it.
 */
export const RATCHET_VERSION_CEILING = "20260905010000";

/**
 * Migrations that predate this coverage gate and carry no entry in the named
 * doc. A SHRINK-ONLY ratchet: entries may leave, none may be added — enforced
 * by RATCHET_VERSION_CEILING above, not merely asserted here.
 *
 * Why an allowlist and not a backfill. The promotion runbook records what was
 * actually promoted to a hosted database and when. These promotions happened
 * before anything required the entry, and the repository does not carry the
 * dates. Inventing plausible ones to turn a gate green would corrupt an
 * operational record — strictly worse than an honest, visibly-shrinking gap.
 * Backfilling one is human work, done when someone actually knows the answer;
 * deleting its line here is how the ratchet records that.
 *
 * This list was initially 49 entries because the parser read only the
 * runbook's `###` shape and missed 14 dated records written as a `## <date>:`
 * heading plus a `* **Migration**:` bullet. Those 14 are NOT here: their
 * history was on the page the whole time. If this list grows again, suspect the
 * parser before believing the gap.
 *
 * The rollback list is shorter for a structural reason worth keeping: a
 * rollback recipe is derivable from the migration's own DDL, so those gaps are
 * genuinely fillable by whoever next touches the area.
 */
export const UNLEDGERED = new Map([
  [
    "docs/internal/ops/DB_PROMOTION_RUNBOOK.md",
    [
      "00000000000000_initial_schema.sql",
      "20260531120000_member_custom_field_values.sql",
      "20260602210000_add_confirm_task_completion_rpc.sql",
      "20260603120000_add_approve_service_entry_rpc.sql",
      "20260603140000_add_check_in_event_rpc.sql",
      "20260604121000_chapter_last_stripe_webhook_at.sql",
      "20260804230000_member_custom_role_ids.sql",
      "20260805133000_reports_bucket.sql",
      "20260805140000_scheduled_notification_dispatches.sql",
      "20260806220000_role_system_key.sql",
      "20260807150000_study_session_pause_grace.sql",
      "20260807220000_role_gated_required_permissions.sql",
      "20260808204500_declare_dashboard_created_buckets.sql",
      "20260809120000_chapter_document_folders.sql",
      "20260809124500_service_hours_config_and_leaderboard.sql",
      "20260816140000_realtime_carrier_repair.sql",
      "20260817170000_event_check_in_zone.sql",
      "20260827190000_secdef_search_path_pg_temp.sql",
      "20260829000000_rollover_promote_new_members.sql",
      "20260829002000_search_vectors_backwork_events_members.sql",
      "20260829011200_chat_notif_prefs_channel_upsert_target.sql",
      "20260901020000_study_session_location_reject_streak.sql",
      "20260901170000_realtime_ping_swallow_warning.sql",
      "20260901173000_lock_down_public_rpc_execute.sql",
      "20260901180000_chat_channels_archived_at.sql",
      "20260901183000_orphan_president_claim.sql",
      "20260902010000_poll_expiry_dispatch.sql",
      "20260902010001_get_points_report_until.sql",
      "20260902040000_event_reminder_dispatch_threshold.sql",
      "20260902120000_chat_message_bookmarks.sql",
      "20260902160000_anonymize_user_purge_bookmarks.sql",
      "20260902170000_chat_notif_prefs_kind_upsert_target.sql",
      "20260902170001_chapter_points_config.sql",
      "20260902170002_chapter_default_invite_role.sql",
      "20260905010000_discord_import_archive_quota.sql",
    ],
  ],
  [
    "docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md",
    [
      "00000000000000_initial_schema.sql",
      "20250226120000_add_get_points_report_rpc.sql",
      "20260523120000_chapter_customization.sql",
      "20260523130000_audit_log.sql",
      "20260523140000_chapter_directory.sql",
      "20260523150000_chat_hotpath.sql",
      "20260803120000_invoice_payment_rpc_and_indexes.sql",
      "20260803140000_account_deletion_anonymize_user_rpc.sql",
      "20260809120000_chapter_document_folders.sql",
      "20260809124500_service_hours_config_and_leaderboard.sql",
      "20260814120000_backfill_chapter_accent_color_from_branding.sql",
      "20260817170000_event_check_in_zone.sql",
      "20260901020000_study_session_location_reject_streak.sql",
      "20260902120000_chat_message_bookmarks.sql",
      "20260902160000_anonymize_user_purge_bookmarks.sql",
    ],
  ],
]);

/**
 * Migration filenames the given doc text records as ledger entries, under any
 * of the shapes that doc declares.
 *
 * `matchAll` clones its regex internally and never advances the source's
 * `lastIndex`, so reusing these `/g` literals across calls and docs is safe —
 * no defensive copy needed. (It does throw on a non-global regex, which is why
 * every pattern above carries `g`.)
 */
export function ledgerEntries(doc, text) {
  const patterns = LEDGER_ENTRY_PATTERNS.get(doc) ?? [];
  const found = new Set();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.add(match[1]);
  }
  return found;
}

/**
 * Ledgers whose entries are a HISTORICAL record and may outlive the file on
 * disk, so an entry naming an absent migration is correct rather than orphaned.
 *
 * The promotion runbook is a dated log of what was actually promoted to a
 * hosted database. Squash a baseline or revert a bad migration and its file
 * leaves the tree, but the promotion still happened — demanding the entry be
 * deleted to get CI green would destroy the operational record this gate exists
 * to protect. The rollback playbook is the opposite: a recipe for a migration
 * that no longer exists is dead weight, and worth reporting.
 */
const HISTORICAL_LEDGERS = new Set(["docs/internal/ops/DB_PROMOTION_RUNBOOK.md"]);

/**
 * The whole-tree ledger contract, as a pure function so the tests can drive it
 * with fixtures instead of the live corpus.
 *
 * Four ways to be wrong, all actionable by the author who caused them:
 *
 * 1. `missing`    — a migration with no entry and no allowlist line. The new
 *                   debt this gate exists to refuse.
 * 2. `covered`    — an allowlist line for a migration that now HAS an entry.
 *                   The ratchet's teeth: without this, the list only ever grows
 *                   stale and stops describing anything.
 * 3. `absent`     — an allowlist line naming a migration not on disk (a rename).
 * 4. `orphan`     — a ledger entry naming a migration not on disk. Zero today,
 *                   which is why it is cheap to start asserting now. Skipped for
 *                   HISTORICAL_LEDGERS, where it is not a defect.
 */
export function ledgerCoverageProblems(
  migrations,
  entriesByDoc,
  unledgered = UNLEDGERED,
) {
  const onDisk = new Set(migrations);
  const problems = [];

  for (const doc of MIGRATION_DOCS) {
    const entries = entriesByDoc.get(doc) ?? new Set();
    const allowed = new Set(unledgered.get(doc) ?? []);

    for (const migration of migrations) {
      if (entries.has(migration) || allowed.has(migration)) continue;
      problems.push({ kind: "missing", doc, migration });
    }

    for (const migration of allowed) {
      if (entries.has(migration)) {
        problems.push({ kind: "covered", doc, migration });
      } else if (!onDisk.has(migration)) {
        problems.push({ kind: "absent", doc, migration });
      }
    }

    if (HISTORICAL_LEDGERS.has(doc)) continue;

    for (const migration of entries) {
      if (!onDisk.has(migration)) {
        problems.push({ kind: "orphan", doc, migration });
      }
    }
  }

  return problems;
}

/**
 * Declared docs that are no longer tracked — a renamed runbook lands here.
 *
 * Tracked, not merely present on disk: a `git mv` that leaves the old filename
 * behind untracked would otherwise satisfy the manifest locally and fail in
 * CI's clean checkout. Any gate with a hand-kept path list needs the same
 * answer: ask git what is tracked, never the filesystem.
 */
export function staleDocs(isTracked = tracked) {
  return MIGRATION_DOCS.filter((doc) => !isTracked(doc));
}

function tracked(doc) {
  try {
    execSync(`git ls-files --error-unmatch -- ${JSON.stringify(doc)}`, {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fail if the manifest itself went stale. Runs UNCONDITIONALLY, from `main()`.
 *
 * It has to. Every guard in `validatePromotionDocs` — no commit range, no
 * migration touched, requirement already satisfied — is a path the renaming PR
 * itself takes, and that is precisely the PR that must not merge green. Checked
 * only there, the ratchet would stay silent through the rename and fire days
 * later on the next migration PR, blaming an author who did everything right:
 * the exact misattribution this manifest exists to prevent.
 *
 * Exit 2, not 1. In this repo 1 means "the change violates the rule" and 2 means
 * "the gate cannot do its job" — see the malformed-flag exit above. A repo-wide
 * blocker triaged as one author's oversight is how this gets lost.
 */
function validateDocManifest() {
  const missing = staleDocs();
  if (missing.length === 0) return;

  console.error("Migration safety check failed: MIGRATION_DOCS is stale.");
  for (const doc of missing) {
    console.error(`- ${doc} is declared but is not a tracked file.`);
  }
  console.error(
    "A promotion/rollback doc was renamed, moved or deleted without updating " +
      "MIGRATION_DOCS in scripts/check-migration-safety.mjs. Repoint the list " +
      "in the same change set as the rename — until then this REQUIRED check " +
      "blocks every migration PR in the repository.",
  );
  process.exit(2);
}

/**
 * Every declared doc must declare how it records an entry, and no allowlist may
 * exempt a migration created after the ratchet was installed.
 *
 * The first half: a doc in MIGRATION_DOCS with no LEDGER_ENTRY_PATTERNS entry
 * makes `ledgerEntries` return the empty set, so the coverage check reports
 * every migration in the tree as `missing` — loud, but it blames every author
 * in the repo for a manifest mistake. Naming the real cause is the whole job of
 * this family of checks. A missing UNLEDGERED key is NOT an error: it reads as
 * "this doc exempts nothing", which is both correct and the desired end state.
 *
 * The second half is what makes "shrink-only" enforceable. Filenames sort by
 * their 14-digit version, so anything newer than RATCHET_VERSION_CEILING was
 * created after the rule existed and cannot be grandfathered. Without it the
 * allowlist is an open door: the gate's own `missing` message points at it, and
 * an author blocked at 2am will take it.
 *
 * Exit 2 throughout: the gate cannot do its job, and no single author caused it.
 */
function validateLedgerManifest() {
  const undeclared = MIGRATION_DOCS.filter(
    (doc) => !LEDGER_ENTRY_PATTERNS.has(doc),
  );
  if (undeclared.length > 0) {
    console.error(
      "Migration safety check failed: a declared doc has no ledger contract.",
    );
    for (const doc of undeclared) {
      console.error(
        `- ${doc} is in MIGRATION_DOCS but missing from LEDGER_ENTRY_PATTERNS.`,
      );
    }
    console.error(
      "Declare the entry shape(s) for it in scripts/check-migration-safety.mjs, " +
        "in the same change set.",
    );
    process.exit(2);
  }

  const grown = [...UNLEDGERED].flatMap(([doc, allowed]) =>
    allowed
      .filter((migration) => migration.slice(0, 14) > RATCHET_VERSION_CEILING)
      .map((migration) => ({ doc, migration })),
  );
  if (grown.length === 0) return;

  console.error("Migration safety check failed: UNLEDGERED grew.");
  for (const { doc, migration } of grown) {
    console.error(
      `- ${migration} is newer than the ratchet ceiling ${RATCHET_VERSION_CEILING}, so it cannot be exempted for ${doc}.`,
    );
  }
  console.error(
    "UNLEDGERED is shrink-only: it grandfathers migrations that predate this " +
      "gate, not new ones. Write the ledger entry instead.",
  );
  process.exit(2);
}

/**
 * Per-migration ledger coverage, asserted BOTH ways, over the whole tree.
 *
 * This is the half `satisfiesPromotionDocs` cannot do. That predicate asks only
 * "was one of the two runbooks touched?", so a migration PR that adds a
 * rollback recipe and nothing else passes while the promotion log never learns
 * the migration exists. Measured over the last 400 commits: nineteen migration
 * commits touched the rollback playbook alone and two the promotion runbook
 * alone, which is how the promotion log came to hold 35 entries against 70
 * migrations on disk (55 of 70 have a rollback recipe; only 25 have both). The
 * most recent migration on `main` exhibits it exactly —
 * `20260905010000_discord_import_archive_quota.sql` has a rollback recipe and
 * no promotion entry.
 *
 * Whole-tree rather than diff-scoped, and unconditional like the manifest check
 * above, for the same reason: the PR that breaks the ratchet is often not a
 * migration PR at all (deleting an allowlist line is a docs edit), and a
 * ratchet only checked on the PRs it constrains is not a ratchet.
 */
function validateLedgerCoverage(migrations) {
  const entriesByDoc = new Map(
    MIGRATION_DOCS.map((doc) => {
      const path = join(REPO_ROOT, doc);
      let text;
      try {
        text = readFileSync(path, "utf8");
      } catch (error) {
        // validateDocManifest asks git what is TRACKED, so a doc in the index
        // but missing from the worktree reaches here. A raw ENOENT relabelled
        // as exit 1 tells the author their change broke a rule; it did not.
        console.error(
          "Migration safety check failed: a declared ledger is unreadable.",
        );
        console.error(`- ${doc}: ${error instanceof Error ? error.message : error}`);
        console.error(
          "The file is tracked but could not be read. Restore it (or repoint " +
            "MIGRATION_DOCS if it moved) — this REQUIRED check cannot grade " +
            "ledger coverage without it.",
        );
        process.exit(2);
      }
      return [doc, ledgerEntries(doc, text)];
    }),
  );

  const problems = ledgerCoverageProblems(migrations, entriesByDoc);
  if (problems.length === 0) return;

  const remedy = {
    missing: (doc) => `needs an entry in ${doc}`,
    covered: (doc) =>
      `is now recorded in ${doc}: delete its line from UNLEDGERED in scripts/check-migration-safety.mjs`,
    absent: (doc) =>
      `is listed in UNLEDGERED for ${doc} but is not on disk: delete the stale line`,
    orphan: (doc) => `is recorded in ${doc} but is not on disk`,
  };
  // An unmapped kind must not throw: main()'s catch would relabel a gate crash
  // as the author's rule violation and swallow every real problem in the list.
  const describe = (kind, doc) =>
    (remedy[kind] ?? ((d) => `has ledger problem "${kind}" in ${d}`))(doc);

  console.error("Migration safety check failed: ledger coverage.");
  for (const { kind, doc, migration } of problems) {
    console.error(`- ${migration} ${describe(kind, doc)}.`);
  }
  console.error(
    "\nEvery migration owes BOTH a promotion-log entry and a rollback recipe.\n" +
      "Write one of these lines, exactly (the marker may be * or -):\n" +
      "  DB_PROMOTION_RUNBOOK.md   ### <migration>.sql\n" +
      "                            (or, under a `## <date>: <what>` heading)\n" +
      "                            * **Migration**: `<migration>.sql`\n" +
      "  DB_ROLLBACK_PLAYBOOK.md   * **Migration**: `<migration>.sql`\n" +
      "                            (under a `## Rollback <what>` heading)\n" +
      "A filename mentioned in prose does not count — the shape is what is read.",
  );
  process.exit(1);
}

function validatePromotionDocs(base, head) {
  if (!base || !head) {
    const missing = [!base && "--base", !head && "--head"].filter(Boolean).join(" and ");
    console.log(
      `Migration safety check: ${missing} not given, skipping the promotion-docs check ` +
        "(cannot diff for a supabase/migrations/ change without a commit range).",
    );
    return;
  }

  const changedFiles = getChangedFiles(base, head);
  if (changedFiles.length === 0) return;

  const migrationChanged = changedFiles.some((file) =>
    file.startsWith("supabase/migrations/"),
  );
  if (!migrationChanged) return;

  if (satisfiesPromotionDocs(changedFiles)) return;

  // The manifest is already known good — validateDocManifest() ran first — so
  // reaching here really is the author owing a doc edit.
  console.error("Migration safety check failed.");
  console.error(
    "You changed migration files without updating promotion/rollback docs.",
  );
  console.error(
    `Update one of ${MIGRATION_DOCS.join(" or ")} in the same change set.`,
  );
  process.exit(1);
}

function main() {
  try {
    const migrations = readMigrationFilenames();
    validateMigrationFiles(migrations);
    validateDocManifest();
    validateLedgerManifest();
    validateLedgerCoverage(migrations);
    validatePromotionDocs(getArg("--base"), getArg("--head"));
    console.log("Migration safety check passed.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Migration safety check failed: ${message}`);
    process.exit(1);
  }
}

// Import-safe: `main()` runs only as a CLI entry point, so the unit tests can
// import MIGRATION_DOCS and the two predicates without executing the gate.
//
// realpathSync BOTH sides, per scripts/check-npm-audit.mjs: Node symlink-resolves
// the ESM entry's `import.meta.url` by default but never `process.argv[1]`, and
// with --preserve-symlinks-main it resolves neither — either asymmetry would
// silently skip main(), this REQUIRED gate exiting 0 having checked nothing.
function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) {
  main();
}
