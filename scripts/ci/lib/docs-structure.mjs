#!/usr/bin/env node

/**
 * The docs/spec placement map — data, and nothing else.
 *
 * `docs/internal/DOCUMENTATION_CONVENTIONS.md` has always been the authoritative
 * placement map, but it was authoritative only to humans: the gate that cited it
 * (`scripts/check-docs-structure.mjs`) checked the diff for newly ADDED files at
 * the two tree roots and nothing else. It never read the map, never looked at a
 * file that already existed, and its `spec/` rule (`/^spec\/[^/]+$/`) matched only
 * root-level paths — so inventing `spec/whatever/` passed. The proof is on disk:
 * `docs/hooks/` and `docs/performance/` exist and appear nowhere in the map.
 *
 * This module is that map as data, so the gate can enforce it over the WHOLE tree
 * rather than trusting prose. `scripts/check-doc-tables.mjs` cross-checks the
 * table in DOCUMENTATION_CONVENTIONS.md against `DIRECTORIES` in both directions,
 * so the doc and the manifest cannot drift apart — the same trick that file
 * already plays on the required-check rosters in `required-checks.mjs`.
 *
 * Why this matters beyond tidiness: the corpus states the same fact three to six
 * times in different words, and the copies drift. In #1586 one wrong timestamp
 * reached five files in a single commit because a breakage list had been
 * duplicated six times. Hard rule 5 ("one canonical place per fact") is the
 * remedy; a declared, enforced structure is what makes moving toward it safe.
 *
 * LEGACY_NAMES is the migration device, and it is a RATCHET, not an amnesty: an
 * entry that no longer matches a tracked file FAILS the gate, exactly as a stale
 * `doc-paths-allowlist.json` entry does. So the list can only shrink. A rename
 * must delete its entry in the same commit, and nothing new can be added to the
 * legacy style without a reviewer seeing the list grow.
 *
 * Keep the arrays as top-level `export const NAME = [` declarations with one
 * entry per line — `check-doc-tables.mjs` parses THIS FILE AS SOURCE TEXT, the
 * same contract `required-checks.mjs` carries.
 */

// ── Naming ──────────────────────────────────────────────────────────────────
// One rule for the whole corpus: kebab-case, or `README.md`. Before this file
// existed there was no naming rule anywhere in the repo, and the corpus split
// clean along one seam — all 28 SCREAMING_SNAKE_CASE files are under
// `docs/internal/`, while `docs/guides/`, `docs/performance/` and every one of
// `spec/` were already kebab. The 28 are grandfathered in LEGACY_NAMES below.

export const NAMING_PATTERN = /^(?:README\.md|[a-z0-9]+(?:-[a-z0-9]+)*\.md)$/;

export const NAMING_RULE = "kebab-case `.md`, or `README.md`";

// ── Directories that may hold documentation ─────────────────────────────────
// `dir` is the exact tracked-path prefix. `purpose` mirrors the intent column of
// the placement map and is documentation only — the cross-check in
// check-doc-tables.mjs matches on `dir`, never on this prose.
// `index: true` means the directory must carry a README.md.

export const DIRECTORIES = [
  { dir: "docs/guides", purpose: "How to run locally / test / contribute", index: true },
  { dir: "docs/hooks", purpose: "Data-layer hook conventions (query keys, optimistic mutations)", index: true },
  { dir: "docs/internal", purpose: "Conventions and internal reference that is not a runbook", index: true },
  { dir: "docs/internal/ci-cd", purpose: "CI / agent infra / automations", index: false },
  { dir: "docs/internal/environment", purpose: "Env reference / secrets / local-dev / cloud sandbox / agent credentials", index: true },
  { dir: "docs/internal/mobile", purpose: "Mobile testing / smoke", index: false },
  { dir: "docs/internal/ops", purpose: "Ops runbooks (DB, incidents, branch protection, deploy)", index: false },
  { dir: "docs/internal/quality", purpose: "Accessibility / PR-review process", index: false },
  { dir: "docs/internal/security", purpose: "Security implementation notes / fixes log", index: true },
  { dir: "docs/internal/services", purpose: "Per-service performance notes", index: false },
  { dir: "docs/performance", purpose: "Per-optimization performance notes", index: true },
  { dir: "spec/architecture", purpose: "Architecture, data model, API patterns, ADRs", index: true },
  { dir: "spec/behavior", purpose: "Product behavior, rules, flows, invariants", index: true },
  { dir: "spec/behavior/chat", purpose: "Chat behavior (2+ files, so a folder with a README)", index: true },
  { dir: "spec/behavior/settings", purpose: "Settings behavior (2+ files, so a folder with a README)", index: true },
  { dir: "spec/environments", purpose: "Environments, CI/CD model", index: true },
  { dir: "spec/product", purpose: "Product features, surfaces, positioning, module catalog", index: true },
  { dir: "spec/ui", purpose: "UI requirements (design system, web, landing, mobile, brand, assets, resilience)", index: true },
  { dir: "spec/ui/design-system", purpose: "Design-system (tokens, typography, icons, microcopy, accent engine)", index: true },
  { dir: "spec/ui/design-system/reference", purpose: "Visual design reference (committed design exports)", index: false },
  { dir: "spec/ui/landing", purpose: "Landing-site UI requirements", index: true },
  { dir: "spec/ui/mobile", purpose: "Mobile UI requirements", index: true },
  { dir: "spec/ui/web-dashboard", purpose: "Web-dashboard UI requirements", index: true },
];

// ── Files allowed at a tree root ────────────────────────────────────────────
// Hard rule 1: never create a new top-level file, never invent a top-level folder.

export const ROOT_FILES = [
  "docs/README.md",
  "spec/README.md",
  "spec/engineering.md",
];

// ── Paths that must not come back ───────────────────────────────────────────

export const BANNED = [
  { pattern: "spec/**/chunks/", reason: "'chunks/' folders are retired; merge canon into the real spec, track delivery in GitHub Issues" },
  { pattern: "docs/archive/", reason: "docs/archive/ is retired; git history is the archive" },
  { pattern: "docs/backlog/", reason: "docs/backlog/ is retired; work tracking lives in GitHub Issues (see docs/internal/ci-cd/GITHUB_PM.md)" },
];

// ── Non-markdown documentation that is exempt from the naming rule ──────────
// Committed Claude-Design canvas exports. `signet-cutover` treats these as
// visual truth; they are build artifacts of a design tool, not prose, so they
// keep the tool's naming.

export const EXEMPT_EXTENSIONS = [".dc.html"];

// ── The shrinking legacy list ───────────────────────────────────────────────
// 28 SCREAMING_SNAKE_CASE files that predate NAMING_RULE. Every one is under
// `docs/internal/`. A stale entry here fails the gate, so this list can only
// shrink — deleting an entry is part of the rename that retires it.

export const LEGACY_NAMES = [
  "docs/internal/ADMIN_DASHBOARD.md",
  "docs/internal/DOCUMENTATION_CONVENTIONS.md",
  "docs/internal/ci-cd/AGENT_INFRA.md",
  "docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md",
  "docs/internal/ci-cd/DOCS_CI.md",
  "docs/internal/ci-cd/GITHUB_PM.md",
  "docs/internal/ci-cd/QUALITY_GATES.md",
  "docs/internal/ci-cd/ROUTINES.md",
  "docs/internal/ci-cd/SECRET_SCANNING.md",
  "docs/internal/environment/AGENT_CREDENTIALS.md",
  "docs/internal/environment/CLOUD_SANDBOX.md",
  "docs/internal/environment/ENV_REFERENCE.md",
  "docs/internal/environment/LOCAL_DEV.md",
  "docs/internal/environment/SECRETS_MANAGEMENT.md",
  "docs/internal/mobile/MOBILE_INTERACTION_SMOKE_CHECKLIST.md",
  "docs/internal/mobile/MOBILE_TESTING.md",
  "docs/internal/ops/ALERT_ROUTING.md",
  "docs/internal/ops/DB_PROMOTION_RUNBOOK.md",
  "docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md",
  "docs/internal/ops/DEPLOYMENT.md",
  "docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md",
  "docs/internal/ops/INCIDENT_RESPONSE_API_DOWN.md",
  "docs/internal/ops/INCIDENT_RESPONSE_DB_LATENCY.md",
  "docs/internal/ops/INCIDENT_RESPONSE_WEBHOOK_FAILURES.md",
  "docs/internal/quality/ACCESSIBILITY_TESTING_PROTOCOL.md",
  "docs/internal/quality/PR_REVIEW_PROCESS.md",
  "docs/internal/security/AUTHORIZATION_MODEL.md",
  "docs/internal/security/SECURITY_FIXES.md",
];
