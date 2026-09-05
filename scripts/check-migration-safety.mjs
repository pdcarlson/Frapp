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

function validateMigrationFiles() {
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

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
 * The ledger hole it was blamed for is still open, and it is this list's own
 * shape: either entry satisfies the gate, so a migration PR that updates only
 * the rollback playbook never touches the promotion log. That is what actually
 * happened — of those 28, nineteen touched the rollback playbook alone and two
 * the promotion runbook alone, which is how the promotion log came to hold 28
 * dated entries against 69 migrations on disk. Closing it needs per-migration
 * coverage asserted both ways, not a shorter list; #1598 tracks that.
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
 * This distinction is the whole reason the ledger hole survived being measured
 * twice. A `grep -F <filename>` over the promotion runbook answers 37 of 70;
 * the runbook only holds 21 promotion entries. The other sixteen are prose
 * cross-references — "`20260824120000_discord_import.sql` gave the importer its
 * own..." — narrative asides inside somebody else's entry. A mention is not a
 * promotion record, and a gate that accepts one grades the wrong thing.
 *
 * So each doc declares the one line shape that constitutes an entry:
 *
 * - promotion runbook: an `### <migration>.sql` log heading.
 * - rollback playbook: a `* **Migration**: `<migration>.sql`` recipe subject.
 *
 * Capture group 1 is the migration filename. The rollback pattern deliberately
 * anchors to the FIRST backtick after the label, because two recipes carry a
 * `(supersedes `<older>.sql`)` parenthetical — the recipe's subject is what the
 * playbook covers, and the superseded migration must not be credited by sitting
 * in someone else's parentheses.
 */
const LEDGER_ENTRY_PATTERNS = new Map([
  [
    "docs/internal/ops/DB_PROMOTION_RUNBOOK.md",
    /^### (\d{14}_[a-z0-9_]+\.sql)[ \t]*$/gm,
  ],
  [
    "docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md",
    /^\* \*\*Migration\*\*: `(\d{14}_[a-z0-9_]+\.sql)`/gm,
  ],
]);

/**
 * Migrations that predate this coverage gate and carry no entry in the named
 * doc. A SHRINK-ONLY ratchet: entries may leave, none may be added.
 *
 * Why an allowlist and not a backfill. The promotion runbook is a record of
 * what was actually promoted to a hosted database, on what date, by whom.
 * Forty-nine of those promotions happened before anything required the entry,
 * and their real history is not reconstructible from the repository. Inventing
 * plausible dates to turn a gate green would corrupt an operational record —
 * strictly worse than an honest, visibly-shrinking gap. Backfilling one of
 * these is human work, done when someone actually knows the answer; deleting
 * its line here is how the ratchet records that.
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
      "20250226120000_add_get_points_report_rpc.sql",
      "20260417120000_point_transactions_chapter_created_at_idx.sql",
      "20260417140000_backfill_polls_view_all_system_roles.sql",
      "20260417150000_backfill_members_view_vp_secretary.sql",
      "20260417180000_add_poll_list_vote_aggregate_rpcs.sql",
      "20260531120000_member_custom_field_values.sql",
      "20260602210000_add_confirm_task_completion_rpc.sql",
      "20260603120000_add_approve_service_entry_rpc.sql",
      "20260603140000_add_check_in_event_rpc.sql",
      "20260604120000_add_transfer_presidency_rpc.sql",
      "20260604121000_chapter_last_stripe_webhook_at.sql",
      "20260604140000_get_points_report_window_filter.sql",
      "20260802120000_active_chapter_jwt_claim.sql",
      "20260803120000_invoice_payment_rpc_and_indexes.sql",
      "20260803140000_account_deletion_anonymize_user_rpc.sql",
      "20260803150000_chat_message_actions_membership_rls.sql",
      "20260803231500_service_proof_bucket.sql",
      "20260804230000_member_custom_role_ids.sql",
      "20260805133000_reports_bucket.sql",
      "20260805140000_scheduled_notification_dispatches.sql",
      "20260805150000_stripe_webhook_events.sql",
      "20260806220000_role_system_key.sql",
      "20260807150000_study_session_pause_grace.sql",
      "20260807220000_role_gated_required_permissions.sql",
      "20260808204500_declare_dashboard_created_buckets.sql",
      "20260809001500_chapter_activation_milestones.sql",
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
      "20260524120000_chapter_directory_requests.sql",
      "20260527120000_chat_notification_preferences.sql",
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

/** Migration filenames the given doc text records as ledger entries. */
export function ledgerEntries(doc, text) {
  const pattern = LEDGER_ENTRY_PATTERNS.get(doc);
  if (!pattern) return new Set();
  // Fresh regex per call: a /g literal carries mutable lastIndex, so sharing
  // one across calls makes the second call start mid-file and drop entries.
  return new Set(
    [...text.matchAll(new RegExp(pattern.source, pattern.flags))].map(
      (match) => match[1],
    ),
  );
}

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
 *                   which is why it is cheap to start asserting now.
 */
export function ledgerCoverageProblems(migrations, entriesByDoc) {
  const onDisk = new Set(migrations);
  const problems = [];

  for (const doc of MIGRATION_DOCS) {
    const entries = entriesByDoc.get(doc) ?? new Set();
    const allowed = new Set(UNLEDGERED.get(doc) ?? []);

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
 * Every declared doc must also declare how it records an entry.
 *
 * Without this, adding a third doc to MIGRATION_DOCS — or renaming one — leaves
 * `ledgerEntries` with no pattern for it, so it returns the empty set and the
 * coverage check reads "nothing is covered". That direction is loud, not
 * silent, so it self-reports; the genuinely dangerous half is UNLEDGERED, whose
 * missing key would be read as "no migration is exempt". Either way the gate is
 * grading a doc it does not understand, which is the thing this file keeps
 * relearning. Exit 2: the gate cannot do its job, and no author caused it.
 */
function validateLedgerManifest() {
  const undeclared = MIGRATION_DOCS.filter(
    (doc) => !LEDGER_ENTRY_PATTERNS.has(doc) || !UNLEDGERED.has(doc),
  );
  if (undeclared.length === 0) return;

  console.error(
    "Migration safety check failed: a declared doc has no ledger contract.",
  );
  for (const doc of undeclared) {
    console.error(`- ${doc} is in MIGRATION_DOCS but missing from LEDGER_ENTRY_PATTERNS and/or UNLEDGERED.`);
  }
  console.error(
    "Declare the entry shape and the allowlist for it in " +
      "scripts/check-migration-safety.mjs, in the same change set.",
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
 * alone, which is how the promotion log came to hold 21 entries against 70
 * migrations on disk. The most recent migration on `main` exhibits it exactly —
 * `20260905010000_discord_import_archive_quota.sql` has a rollback recipe and
 * no promotion entry.
 *
 * Whole-tree rather than diff-scoped, and unconditional like the manifest check
 * above, for the same reason: the PR that breaks the ratchet is often not a
 * migration PR at all (deleting an allowlist line is a docs edit), and a
 * ratchet only checked on the PRs it constrains is not a ratchet.
 */
function validateLedgerCoverage() {
  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const entriesByDoc = new Map(
    MIGRATION_DOCS.map((doc) => [
      doc,
      ledgerEntries(doc, readFileSync(join(REPO_ROOT, doc), "utf8")),
    ]),
  );

  const problems = ledgerCoverageProblems(migrations, entriesByDoc);
  if (problems.length === 0) return;

  const remedy = {
    missing: (doc) =>
      `needs an entry in ${doc} (or, if its history is genuinely unrecoverable, a line in UNLEDGERED — which is shrink-only, so expect to justify it)`,
    covered: (doc) =>
      `is now recorded in ${doc}: delete its line from UNLEDGERED in scripts/check-migration-safety.mjs`,
    absent: (doc) =>
      `is listed in UNLEDGERED for ${doc} but is not on disk: delete the stale line`,
    orphan: (doc) => `is recorded in ${doc} but is not on disk: the entry names a migration that no longer exists`,
  };

  console.error("Migration safety check failed: ledger coverage.");
  for (const { kind, doc, migration } of problems) {
    console.error(`- ${migration} ${remedy[kind](doc)}.`);
  }
  console.error(
    "Every migration owes BOTH a promotion-log entry and a rollback recipe. " +
      "See docs/internal/ops/DB_PROMOTION_RUNBOOK.md and " +
      "docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md for the entry shapes.",
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
    validateMigrationFiles();
    validateDocManifest();
    validateLedgerManifest();
    validateLedgerCoverage();
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
