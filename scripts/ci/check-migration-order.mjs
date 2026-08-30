#!/usr/bin/env node
// Migration ORDERING gate — the `migration-order` required check.
//
// The question: does a migration this change introduces sort BEFORE a version
// the target database has already applied? If it does, the apply does not
// reorder it — it halts.
//
// ── The incident (#1373) ────────────────────────────────────────────────────
// `20260829000000_rollover_promote_new_members` merged after `20260829002000`
// had already been applied to staging. `supabase db push` refused, verbatim:
//
//   Found local migration files to be inserted before the last migration on
//   remote database. Rerun the command with `--include-all` flag to apply
//   these migrations.
//
// Staging's migration deploy halted. Because `migration-drift` was a required
// check at the time, every open PR in the repo became unmergeable until a human
// intervened. Nothing caught it pre-merge, and the information needed to catch
// it already existed: `check-migration-replay.mjs` computed exactly this set,
// called it `backDated`, and threw it away.
//
// Measured against the pinned CLI 2.77.0 on 2026-08-29, so this is not inferred
// from the docs: `supabase migration up` against a database holding
// `20260103000000`, with `20260102000000` pending, exits **1**, applies
// nothing, and leaves the ledger untouched. `db push` carries the same
// `--include-all` flag with the same description and refuses identically.
//
// ── Why it reads the CHANGE, not the whole pending set ──────────────────────
// This is the design decision that makes the gate safe to require, and it is
// the lesson of `migration-drift`'s demotion. A gate evaluating every pending
// migration answers a question about `main` and the deployed databases — a
// question no individual PR can act on — so it becomes a repo-wide merge freeze
// the moment anything drifts, which is precisely how #1373 turned one bad
// filename into "no PR in this repository can merge".
//
// So the comparison set is the migrations this change INTRODUCES: present in
// the head checkout, absent at the base ref. Those are the files the author can
// actually rename. Everything already on `main` is somebody else's problem, and
// `migration-replay` (at deploy time, against production's live state) and the
// scheduled drift monitor are the checks that own it.
//
// Two consequences worth stating, because they are the gate's whole value:
//
//   * A change touching no migrations introduces nothing, so the gate returns
//     in milliseconds having made ZERO network calls. It cannot block a PR over
//     unrelated state, and it cannot make repo-wide merge availability depend
//     on the Supabase API.
//   * A PR that FIXES an ordering problem turns its own check green, because
//     the renamed file is the introduced one. `migration-drift` could never do
//     that — it compared `origin/main` against staging on every run, so the PR
//     fixing the drift was blocked by the drift it was fixing.
//
// ── Why it checks staging AND production ────────────────────────────────────
// #1373 was invisible to `migration-replay` for a structural reason, not a
// logical one: the replay rebuilds PRODUCTION's applied state, and production
// had not yet applied `20260829002000`. Staging had. Production is deployed
// manually and is routinely behind, so the environment furthest ahead is the
// one that refuses first — and that is usually staging.
//
// Project refs come from `ci/environments.json` (not secret; a ref grants
// nothing without a token), so one Infisical injection for the account-level
// `SUPABASE_ACCESS_TOKEN` covers both reads.
//
// ── Read-only ───────────────────────────────────────────────────────────────
// One GET per environment to the Management API's migration-history endpoint,
// the same call `check-migration-drift.mjs` makes. No SQL is sent, ever.
//
// Env inputs:
//   SUPABASE_ACCESS_TOKEN   — required, Supabase Management API token
//   ORDER_GATE_BASE_REF     — required, the ref this change is measured against
//   GITHUB_STEP_SUMMARY     — optional, written when present
//
// Flags:
//   --probe        read both environments, print what they hold, assert nothing
//                  about the change. The rollout evidence a green gate run
//                  cannot give: a change introducing no migrations passes
//                  having made zero network calls.
//
// Exit codes:
//   0 — no introduced migration is back-dated against any environment
//   1 — one is, or an environment could not be read
//   2 — the invocation itself is wrong (bad base ref, unreadable config)
//
// Semantics: the pure functions below. Unit tests:
// `scripts/ci/__tests__/check-migration-order.test.mjs`.

import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseMigrationFilename, readLocalMigrations } from "./check-migration-drift.mjs";
import {
  defaultRunGit,
  fetchAppliedWithRetry,
  MIGRATIONS_PREFIX,
} from "./check-migration-drift-gate.mjs";
import { ENVIRONMENTS, loadEnvironments } from "./lib/environments.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

export const RUNBOOK = "docs/internal/ops/DB_PROMOTION_RUNBOOK.md";

/**
 * The versioned migrations present in the tree at `ref` — ONE git call.
 *
 * Deliberately not `readMigrationsAtRef` from check-migration-drift-gate.mjs,
 * which is otherwise the same query. That function additionally runs
 * `git log -1 --format=%ct <ref> -- <path>` per file to date each migration's
 * arrival on main, which its grace window needs and this gate never reads —
 * 55 subprocesses instead of one, each walking history, on every PR and every
 * push, forever. The fields consumed here are `version` and `file`, and
 * `parseMigrationFilename` produces both from the listing alone.
 */
export function readMigrationVersionsAtRef({ ref, runGit = defaultRunGit }) {
  const listing = runGit(["ls-tree", "-r", "--name-only", ref, "--", MIGRATIONS_PREFIX]);
  return listing
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((path) => {
      const parsed = parseMigrationFilename(path.split("/").pop());
      return parsed ? { ...parsed, path } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.version.localeCompare(b.version));
}

// ── Pure semantics ──────────────────────────────────────────────────────────

/**
 * A migration version. Validated rather than assumed: every comparison below is
 * a plain string `<`, which is only meaningful between two fixed-width digit
 * strings. `localeCompare` on unvalidated remote text answers confidently and
 * wrongly — a version of `"9"` beats every date in this repo's history.
 */
export const VERSION_PATTERN = /^\d{14}$/;

/** The greatest of a set of validated versions, or null for an empty set. */
export function newestVersion(migrations) {
  return migrations.reduce(
    (max, m) => (max === null || m.version > max ? m.version : max),
    null,
  );
}

/**
 * The migrations this change introduces: in `head`, absent from `base`.
 *
 * Keyed on VERSION rather than filename, so renaming a file to fix its ordering
 * reads as "the old version left, a new one arrived" — which is what it is, and
 * is what lets the fix turn its own check green.
 */
export function introducedMigrations({ head, base }) {
  const baseVersions = new Set(base.map((m) => m.version));
  return head.filter((m) => !baseVersions.has(m.version));
}

/** The mirror: versions the change REMOVES. A rename produces one of each. */
export function removedMigrations({ head, base }) {
  const headVersions = new Set(head.map((m) => m.version));
  return base.filter((m) => !headVersions.has(m.version));
}

/**
 * The LOCAL ordering rule: no introduced migration may sort before a migration
 * the base ref already carries and this change keeps.
 *
 * This clause needs no database, so it runs on forks, during a Supabase outage,
 * and — the point — with no dependence on WHEN an environment happens to apply
 * things. That timing dependence is a real hole in the applied-floor rule below:
 *
 *   10:00  PR-A (`20260901120000`) and PR-B (`20260901090000`) are both green;
 *          neither sorts before staging's newest applied version.
 *   10:02  A merges. B rebases (branch protection is `strict: true`).
 *   10:03  B's gate re-runs. Staging has not applied A yet, so B is still green.
 *   10:06  `migrate-staging` applies A. Staging's newest is now `…120000`.
 *   10:20  B merges. `db push` refuses `…090000`. #1373, again.
 *
 * GitHub never expires a check that passed, so the applied-floor rule cannot
 * close that window. This rule closes it deterministically: at 10:02 B's BASE
 * already contains `…120000`, and no database is consulted.
 *
 * The floor is the SURVIVING set (base ∩ head), not the base set. A PR whose
 * whole purpose is to rename a bad far-future version out of the way removes it
 * from the floor, so the fix can turn its own check green.
 *
 * Accepted cost: it also fails PR-B above when neither migration has been
 * applied anywhere and a single `db push` would have swallowed both in sorted
 * order. That tolerance depends on a race B's author cannot observe, and the
 * remedy is a free rename of an unapplied file. The strictness is the point:
 * "every new migration sorts after everything on main" is an invariant a person
 * can hold in their head, where "after everything on main that some environment
 * has already applied, as of when your check happened to run" is not.
 */
export function classifyLocalOrder({ introduced, surviving }) {
  const floor = newestVersion(surviving);
  if (floor === null) return { floor, offending: [] };
  return { floor, offending: introduced.filter((m) => m.version < floor) };
}

/**
 * Per-environment rules, against what that database reports as applied.
 *
 *   offending — introduced, not applied here, sorting before the newest applied
 *               version. The CLI refuses these outright.
 *   stranded  — REMOVED by this change, but applied here. Merging it leaves a
 *               `schema_migrations` row no repo file explains — a foreign row,
 *               which blocks every later `db push` to that environment. This is
 *               the missing half of "a rename fixes ordering": renaming a
 *               migration that has already been applied somewhere does not fix
 *               anything, it bricks that environment.
 *   badVersions — applied rows whose version is not a 14-digit stamp. Reported,
 *               and excluded from the floor, because comparing against one is
 *               not meaningful.
 *
 * An introduced migration ALREADY applied here is not offending: it is not
 * pending, so the CLI never considers inserting it. That is the hand-applied
 * case, and failing it would redden a database already in the desired state.
 */
export function classifyOrder({ introduced, removed = [], applied }) {
  const badVersions = applied.filter((m) => !VERSION_PATTERN.test(m.version));
  const usable = applied.filter((m) => VERSION_PATTERN.test(m.version));
  const appliedVersions = new Set(usable.map((m) => m.version));

  const stranded = removed.filter((m) => appliedVersions.has(m.version));
  const newestApplied = newestVersion(usable);
  const offending =
    newestApplied === null
      ? []
      : introduced.filter(
          (m) => !appliedVersions.has(m.version) && m.version < newestApplied,
        );

  return { newestApplied, offending, stranded, badVersions };
}

/**
 * The next version that would sort cleanly, as a concrete suggestion.
 *
 * A remedy an operator can paste beats a remedy they have to derive. Built by
 * incrementing a 14-digit version by one second, which is always greater and
 * always still a valid version.
 */
export function suggestVersion(floor) {
  if (!VERSION_PATTERN.test(floor ?? "")) return null;
  const asDate = Date.UTC(
    Number(floor.slice(0, 4)),
    Number(floor.slice(4, 6)) - 1,
    Number(floor.slice(6, 8)),
    Number(floor.slice(8, 10)),
    Number(floor.slice(10, 12)),
    Number(floor.slice(12, 14)),
  );
  if (!Number.isFinite(asDate)) return null;
  const next = new Date(asDate + 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return (
    `${p(next.getUTCFullYear(), 4)}${p(next.getUTCMonth() + 1)}${p(next.getUTCDate())}` +
    `${p(next.getUTCHours())}${p(next.getUTCMinutes())}${p(next.getUTCSeconds())}`
  );
}

const CLI_REFUSAL =
  "Found local migration files to be inserted before the last migration on remote database.";

function renameRemedy(floor) {
  const suggestion = suggestVersion(floor);
  return (
    `Remedy: rename each to a version after \`${floor}\`` +
    (suggestion ? ` — e.g. \`${suggestion}_<same_name>.sql\`` : "") +
    `, keeping the name. Safe while the migration is unapplied everywhere, which is the ` +
    `ordinary case for one still in review.`
  );
}

/**
 * The verdict.
 *
 * Order matters. `stranded` outranks `offending`: a change that removes an
 * applied migration is about to create a foreign row, and telling its author to
 * rename something is the opposite of the advice they need.
 */
export function decideOrderOutcome({ local, results, introduced = [], removed = [], localOnly = false }) {
  // Clause 1 first, because it needs nothing and is never ambiguous.
  if (local && local.offending.length > 0) {
    const files = local.offending.map((m) => `  ~ ${m.file}`).join("\n");
    return {
      ok: false,
      code: "back-dated-against-base",
      message:
        `${local.offending.length} introduced migration(s) sort BEFORE \`${local.floor}\`, which is ` +
        `already on the base branch:\n${files}\n\n` +
        `${renameRemedy(local.floor)}\n\n` +
        `Why this is a failure even though no database has complained yet: once the base ` +
        `branch's migration is applied anywhere, the CLI refuses yours — "${CLI_REFUSAL}" — and ` +
        `whether that has happened at the moment your check ran is a race you cannot observe. ` +
        `Every new migration sorting after everything on the base branch is the invariant that ` +
        `makes the race impossible rather than merely unlikely.`,
    };
  }

  const unreadable = results.filter((r) => r.status === "unknown");
  if (unreadable.length > 0) {
    return {
      ok: false,
      code: "environment-unreadable",
      message:
        `Could not read the applied migrations for ${unreadable
          .map((r) => `\`${r.label}\``)
          .join(", ")}: ${unreadable.map((r) => r.error).join("; ")}. ` +
        `The gate cannot prove the ordering is safe, so it fails rather than passing ` +
        `unverified — an unverifiable database is the state this check exists to catch. ` +
        `This only ever blocks a change that adds or removes a migration.`,
    };
  }

  // Clause 6: something was introduced or removed and NOTHING was checked. A
  // verdict of "fine" reached without consulting anything is the false green
  // every gate in this repo is written to avoid.
  if (!localOnly && (introduced.length > 0 || removed.length > 0) && results.length === 0) {
    return {
      ok: false,
      code: "no-environment-checked",
      message:
        `This change adds or removes migrations, but no environment was checked. ` +
        `Refusing to report success having verified nothing.`,
    };
  }

  const stranding = results.filter((r) => r.stranded?.length > 0);
  if (stranding.length > 0) {
    const lines = [];
    for (const r of stranding) {
      lines.push(`\`${r.label}\` has already applied ${r.stranded.length} migration(s) this change removes:`);
      for (const m of r.stranded) lines.push(`  ! ${m.file}`);
    }
    return {
      ok: false,
      code: "stranded-migrations",
      message:
        `This change removes or renames migrations that a deployed database has already ` +
        `applied:\n\n${lines.join("\n")}\n\n` +
        `Merging it leaves a \`schema_migrations\` row that no repo file explains — a FOREIGN row — ` +
        `and \`supabase db push\` refuses to run against that environment at all from then on.\n\n` +
        `If you are renaming a migration to fix its ordering: that is the right fix only while it ` +
        `is unapplied everywhere, and it is not, so it is the wrong fix here. Land a forward ` +
        `migration instead, or repair the ledger first — ${RUNBOOK}.`,
    };
  }

  const failing = results.filter((r) => r.offending.length > 0);
  if (failing.length === 0) {
    return {
      ok: true,
      code: "order-ok",
      message:
        introduced.length === 0 && removed.length === 0
          ? "This change introduces no migrations — nothing to order."
          : localOnly
            ? `Every introduced migration sorts after everything on the base branch. ` +
              `The deployed databases were NOT checked (no credentials in this context).`
            : `Every introduced migration sorts after everything on the base branch and after ` +
              `the newest version applied to ${results.map((r) => `\`${r.label}\``).join(" and ")}.`,
    };
  }

  const lines = [];
  for (const result of failing) {
    lines.push(
      `\`${result.label}\` has already applied \`${result.newestApplied}\`, and this change ` +
        `introduces ${result.offending.length} migration(s) that sort before it:`,
    );
    for (const m of result.offending) lines.push(`  ~ ${m.file}`);
    lines.push(`  ${renameRemedy(result.newestApplied)}`);
  }

  return {
    ok: false,
    code: "back-dated-migrations",
    message:
      `${failing.reduce((n, r) => n + r.offending.length, 0)} introduced migration(s) would be ` +
      `REFUSED by the Supabase CLI, which halts rather than reordering:\n\n  ${CLI_REFUSAL}\n\n` +
      lines.join("\n") +
      `\n\nIf a listed migration has already been applied somewhere, renaming it strands that ` +
      `state and the rename is the wrong move — read ${RUNBOOK} § \`--include-all\` first.`,
  };
}

export function buildOrderSummary({ introduced, removed = [], local, results, outcome, baseRef, localOnly = false }) {
  const lines = [
    `## Migration order gate`,
    "",
    outcome.ok ? "✅ **PASS**" : "❌ **FAIL**",
    "",
    `Introduced by this change (vs \`${baseRef}\`): **${introduced.length}**`,
  ];
  for (const m of introduced) lines.push(`- \`${m.file}\``);
  if (removed.length > 0) {
    lines.push("", `Removed by this change: **${removed.length}**`);
    for (const m of removed) lines.push(`- \`${m.file}\``);
  }
  if (local) {
    lines.push(
      "",
      `Newest migration already on the base branch: \`${local.floor ?? "none"}\` — ` +
        `${local.offending.length} introduced migration(s) sort before it.`,
    );
  }
  if (localOnly) {
    lines.push(
      "",
      "> The deployed databases were **not** checked: this context has no Supabase credentials",
      "> (a fork PR). The ordering rule against the base branch still ran, and it is the one that",
      "> does not depend on when an environment happens to apply anything.",
    );
  } else if (results.length > 0) {
    lines.push(
      "",
      "| Environment | Newest applied | Back-dated introductions | Removed-but-applied |",
      "| --- | --- | --- | --- |",
      ...results.map(
        (r) =>
          `| \`${r.label}\` | ${r.status === "unknown" ? "—" : `\`${r.newestApplied ?? "none"}\``} | ` +
          `${r.status === "unknown" ? `could not read: ${r.error}` : r.offending.length} | ` +
          `${r.status === "unknown" ? "—" : (r.stranded?.length ?? 0)} |`,
      ),
    );
  }
  lines.push("", outcome.message);
  return lines.join("\n");
}

// ── Orchestration ───────────────────────────────────────────────────────────

function defaultWriteSummary(text) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  try {
    appendFileSync(path, `${text}\n`);
  } catch {
    /* a summary that cannot be written must not fail the gate */
  }
}

/**
 * Read both environments and report what they hold, asserting nothing about the
 * change.
 *
 * This exists for one job: proving, before `migration-order` is promoted to a
 * required context, that the credentials in CI can actually read BOTH projects.
 * The gate's own green run is not that evidence — a change introducing no
 * migrations returns green having made zero network calls, so it proves the job
 * starts and nothing more. A dispatch on `main` is exactly that case, which
 * made the obvious "just dispatch it" instruction useless.
 *
 * Exits 0 only when every environment answered. A project-scoped token or a
 * wrong ref surfaces here, deliberately, rather than as a hard block on the
 * first migration PR after the check starts blocking.
 */
export async function probeEnvironments({
  accessToken = process.env.SUPABASE_ACCESS_TOKEN,
  environments,
  fetchImpl = fetch,
  writeSummary = defaultWriteSummary,
  log = console.log,
  error = console.error,
} = {}) {
  let resolved;
  try {
    resolved = environments ?? loadEnvironments();
  } catch (thrown) {
    error(`::error::Could not resolve environment identity: ${thrown.message}`);
    return 2;
  }

  const rows = [];
  let allOk = true;
  for (const label of ENVIRONMENTS) {
    const target = resolved[label];
    if (!target) continue;
    const applied = await fetchAppliedWithRetry({
      accessToken,
      projectRef: target.supabaseProjectRef,
      fetchImpl,
      log,
    });
    if (!applied.ok) {
      allOk = false;
      rows.push(`| \`${label}\` | \`${target.supabaseProjectRef}\` | — | ❌ ${applied.error} |`);
      error(`::error::${label} (${target.supabaseProjectRef}) could not be read: ${applied.error}`);
      continue;
    }
    const newest = newestVersion(applied.migrations.filter((m) => VERSION_PATTERN.test(m.version)));
    rows.push(
      `| \`${label}\` | \`${target.supabaseProjectRef}\` | ${applied.migrations.length} | \`${newest ?? "none"}\` |`,
    );
    log(`  ${label} (${target.supabaseProjectRef}): ${applied.migrations.length} applied, newest ${newest}.`);
  }

  writeSummary(
    [
      "## Migration order gate — credential probe",
      "",
      allOk ? "✅ Both environments were read." : "❌ At least one environment could not be read.",
      "",
      "| Environment | Project ref | Applied | Newest |",
      "| --- | --- | --- | --- |",
      ...rows,
      "",
      "Asserts nothing about any change — this run exists to prove the credentials reach both",
      "projects before `migration-order` is promoted to a required check.",
    ].join("\n"),
  );
  return allOk ? 0 : 1;
}

export async function runOrderGate({
  accessToken = process.env.SUPABASE_ACCESS_TOKEN,
  baseRef = process.env.ORDER_GATE_BASE_REF,
  localOnly = process.env.ORDER_GATE_LOCAL_ONLY === "true",
  migrationsDir = MIGRATIONS_DIR,
  environments,
  readBase,
  readHead = () => readLocalMigrations(migrationsDir),
  fetchImpl = fetch,
  writeSummary = defaultWriteSummary,
  log = console.log,
  error = console.error,
} = {}) {
  if (!baseRef) {
    error("::error::ORDER_GATE_BASE_REF is required — the gate measures a change against a base.");
    return 2;
  }

  const head = readHead();
  if (head.length === 0) {
    // `git ls-tree` and an empty directory both answer "nothing" with exit 0, so
    // this cannot be caught by checking an exit status. Zero migrations in the
    // head checkout is a broken checkout, not a change that introduces nothing.
    error(
      `::error::No migrations found in ${migrationsDir}. That is a broken checkout, not a clean change.`,
    );
    return 2;
  }

  let base;
  try {
    base = (readBase ?? ((ref) => readMigrationVersionsAtRef({ ref })))(baseRef);
  } catch (thrown) {
    error(`::error::Could not read migrations at \`${baseRef}\`: ${thrown.message}`);
    return 2;
  }
  if (base.length === 0) {
    error(
      `::error::No migrations found at \`${baseRef}\`. Every migration would read as newly ` +
        `introduced, which is a bad ref or a shallow clone rather than a real change. ` +
        `Ensure the workflow checks out with fetch-depth: 0.`,
    );
    return 2;
  }

  const introduced = introducedMigrations({ head, base });
  const removed = removedMigrations({ head, base });
  const headVersions = new Set(head.map((m) => m.version));
  const surviving = base.filter((m) => headVersions.has(m.version));

  log(`  ${introduced.length} migration(s) introduced against ${baseRef}.`);
  for (const m of introduced) log(`    + ${m.file}`);
  for (const m of removed) log(`    - ${m.file} (removed)`);

  // Clause 1 — no database needed, so it runs everywhere and always.
  const local = classifyLocalOrder({ introduced, surviving });
  log(`  Newest migration already on the base branch: ${local.floor ?? "none"}.`);

  const finish = (results) => {
    const outcome = decideOrderOutcome({ local, results, introduced, removed, localOnly });
    writeSummary(buildOrderSummary({ introduced, removed, local, results, outcome, baseRef, localOnly }));
    if (!outcome.ok) {
      error(`::error::${outcome.message.split("\n")[0]}`);
      error(outcome.message);
      return 1;
    }
    log(`\n✅ ${outcome.message}`);
    return 0;
  };

  if (local.offending.length > 0) return finish([]);

  // The property that makes this safe to require: a change that neither adds nor
  // removes a migration makes ZERO network calls, so the gate cannot fail over
  // an environment's availability or over state the change did not cause.
  if (introduced.length === 0 && removed.length === 0) return finish([]);

  // A fork PR gets no secrets. Reporting Success there having skipped the whole
  // job is what the old job-level `if:` did; running clause 1 and saying plainly
  // that the databases were not consulted is strictly more than that.
  if (localOnly) {
    log("  ORDER_GATE_LOCAL_ONLY is set — the deployed databases are not being read.");
    return finish([]);
  }

  let resolved;
  try {
    resolved = environments ?? loadEnvironments();
  } catch (thrown) {
    error(`::error::Could not resolve environment identity: ${thrown.message}`);
    return 2;
  }

  const results = [];
  for (const label of ENVIRONMENTS) {
    const target = resolved[label];
    if (!target) continue;
    const applied = await fetchAppliedWithRetry({
      accessToken,
      projectRef: target.supabaseProjectRef,
      fetchImpl,
      log,
    });
    if (!applied.ok) {
      results.push({ label, status: "unknown", error: applied.error, newestApplied: null, offending: [], stranded: [] });
      continue;
    }
    // An EMPTY applied list is not "a database that cannot be offended" — it is
    // a database that answered nothing. Both real projects permanently hold
    // `00000000000000_initial_schema`, so empty means a wrong ref, a token
    // scoped elsewhere that answers 200 with nothing, or a reset project. Left
    // as "clean" it is a silent false pass on the one read the gate depends on.
    if (applied.migrations.length === 0 && !target.allowEmptyMigrationHistory) {
      results.push({
        label,
        status: "unknown",
        error:
          "the Management API returned an EMPTY migration history. Every real project here holds " +
          "at least `00000000000000_initial_schema`, so this is a wrong project ref, a token " +
          "scoped elsewhere, or a reset project — not a clean database. If the project really is " +
          'brand new, set "allowEmptyMigrationHistory": true for it in ci/environments.json.',
        newestApplied: null,
        offending: [],
        stranded: [],
      });
      continue;
    }

    const { newestApplied, offending, stranded, badVersions } = classifyOrder({
      introduced,
      removed,
      applied: applied.migrations,
    });
    for (const bad of badVersions) {
      log(
        `::warning::${label} reports an applied version that is not a 14-digit stamp ` +
          `(${JSON.stringify(bad.version)}). It is excluded from the ordering floor; ` +
          `\`migration-drift\` owns reconciling it.`,
      );
    }
    log(
      `  ${label}: ${applied.migrations.length} applied, newest ${newestApplied}, ` +
        `${offending.length} back-dated introduction(s), ${stranded.length} removed-but-applied.`,
    );
    results.push({ label, status: "ok", error: null, newestApplied, offending, stranded });
  }

  return finish(results);
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function getArg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith("--")) {
    console.error(`Error: ${name} requires a value.`);
    process.exit(2);
  }
  return v;
}

/**
 * `--applied-from <file>` replays a recorded applied-migration list instead of
 * calling the Management API, the same harness `check-migration-replay.mjs`
 * uses. It is what makes an incident reproducible offline: the state that
 * produced a failure is a moment in time, and once the database moves on the
 * run that failed can never be re-run against the real API.
 *
 * The recorded list answers for EVERY environment, which is what a
 * single-environment incident fixture wants.
 */
function fetchFromFile(path) {
  const rows = JSON.parse(readFileSync(path, "utf8"));
  const migrations = Array.isArray(rows) ? rows : rows.migrations;
  return async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ migrations }),
  });
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith("check-migration-order.mjs");
if (isDirectRun) {
  const appliedFrom = getArg("--applied-from");
  if (process.argv.includes("--probe")) {
    process.exit(
      await probeEnvironments({
        fetchImpl: appliedFrom ? fetchFromFile(appliedFrom) : fetch,
        accessToken: appliedFrom ? "offline" : process.env.SUPABASE_ACCESS_TOKEN,
      }),
    );
  }
  process.exit(
    await runOrderGate({
      baseRef: getArg("--base") ?? process.env.ORDER_GATE_BASE_REF,
      localOnly: process.argv.includes("--local-only") || process.env.ORDER_GATE_LOCAL_ONLY === "true",
      fetchImpl: appliedFrom ? fetchFromFile(appliedFrom) : fetch,
      accessToken: appliedFrom ? "offline" : process.env.SUPABASE_ACCESS_TOKEN,
    }),
  );
}
