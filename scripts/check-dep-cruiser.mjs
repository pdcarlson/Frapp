#!/usr/bin/env node

/**
 * Architectural boundary gate (dependency-cruiser).
 *
 * Runs depcruise once per workspace, normalises every reported path back to
 * repo-root-relative, and fails on any violation not present in the committed
 * baseline.
 *
 * ## Why per-workspace, and why this script exists at all
 *
 * `apps/web` and `apps/mobile` each map `@/*` to their OWN root, so no single
 * alias table resolves both, and a tsconfig's `include` globs resolve relative
 * to the cwd rather than to the tsconfig — so passing `--ts-config
 * apps/web/tsconfig.json` from the repo root fails outright with TS18003. The
 * only correct resolution is one run per workspace with that workspace as cwd.
 *
 * The failure this avoids is silent rather than loud: cruising everything from
 * the repo root "worked" and reported **792 unresolvable-module violations**
 * that were purely `@/*` failing to resolve. Baselining that run would have
 * grandfathered 792 phantoms and left the real rules asleep underneath them.
 * Resolved correctly, `apps/web` cruises clean.
 *
 * ## Why the baseline is ours rather than `--ignore-known`
 *
 * depcruise's native `--ignore-known` compares the paths a run reports, which
 * here are workspace-relative — so `src/index.ts` would be ambiguous across 17
 * workspaces, and one shared file could not express which one it meant. Paths
 * are normalised to repo-root-relative first and matched here instead, which
 * keeps a single greppable baseline and makes the matching unit-testable
 * (scripts/ci/__tests__/check-dep-cruiser.test.mjs). The rollout posture is the
 * one `--ignore-known` is for: hard gate immediately, existing violations
 * grandfathered.
 *
 * Usage:
 *   node scripts/check-dep-cruiser.mjs                  # check (CI + local)
 *   node scripts/check-dep-cruiser.mjs --update-baseline # re-record
 *   node scripts/check-dep-cruiser.mjs --workspace apps/api
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = path.join(REPO_ROOT, "scripts/dependency-cruiser-known-violations.json");
const CONFIG_PATH = path.join(REPO_ROOT, "scripts/dependency-cruiser.cjs");

/** Workspace globs, matching the root package.json `workspaces` field. */
const WORKSPACE_ROOTS = ["apps", "packages"];

/** Extensions depcruise reports for resolved source modules. */
const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".vue",
  ".svelte",
]);

/**
 * A violation's identity for baseline purposes: the rule plus the edge it
 * fired on. Deliberately NOT line numbers — a baseline keyed on lines churns on
 * every unrelated edit above the import, which is how a grandfather file turns
 * into noise nobody re-records.
 */
export function violationKey({ rule, from, to }) {
  return `${rule}\u0000${from}\u0000${to}`;
}

/**
 * Rewrite a workspace-relative path to repo-root-relative.
 *
 * depcruise reports paths relative to its cwd, so an import that leaves the
 * workspace comes back as `../../packages/hooks/src/x.ts`. Resolving against
 * the workspace and re-relativising against the repo root collapses both forms
 * to one canonical spelling, which is what makes a single baseline possible.
 */
export function toRepoRelative(workspace, filePath) {
  if (!filePath) return filePath;

  // Anything not explicitly relative or absolute is ambiguous by shape:
  // depcruise reports a local file as bare `src/domain/user.ts`, which is
  // structurally identical to the bare specifier `fs/promises`. The
  // distinguishing feature is the extension — depcruise reports resolved
  // source files with one, and bare specifiers almost never carry one.
  //
  // Worth spelling out because two more obvious rules are both wrong. Matching
  // on "has a slash" turns `fs/promises` into `apps/api/fs/promises`, writing a
  // fabricated path into the baseline key. Testing existence on disk is
  // accurate but makes normalisation filesystem-dependent, so the same input
  // normalises differently depending on what happens to be checked out.
  if (!filePath.startsWith(".") && !filePath.startsWith("/")) {
    // Not workspace-owned: node_modules resolves against the hoisted root, and
    // a scope or an unresolved `@/…` alias is a specifier, not a path.
    if (filePath.startsWith("node_modules/") || filePath.startsWith("@")) return filePath;
    if (!SOURCE_EXTENSIONS.has(path.extname(filePath))) return filePath;
  }

  const absolute = path.resolve(REPO_ROOT, workspace, filePath);
  return path.relative(REPO_ROOT, absolute).split(path.sep).join("/");
}

function discoverWorkspaces() {
  const found = [];
  for (const root of WORKSPACE_ROOTS) {
    const dir = path.join(REPO_ROOT, root);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const workspace = `${root}/${entry.name}`;
      if (!existsSync(path.join(REPO_ROOT, workspace, "package.json"))) continue;
      found.push(workspace);
    }
  }
  return found.sort();
}

/**
 * Whether the workspace has any source worth cruising.
 *
 * A workspace with no JS/TS at all (`packages/brand-assets`, `packages/typescript-config`)
 * must be skipped, because depcruise errors on an empty input set rather than
 * reporting nothing. But the test has to be "does it contain source", not "does
 * it have a src/ directory": `packages/eslint-config` keeps real JavaScript at
 * its package root (`base.js`, `next.js`), which every app's flat config
 * imports. A directory-name check skipped it, and because each cruise drops
 * violations from outside its own workspace, its files were then covered by
 * nothing at all.
 */
function hasCruisableSource(workspace) {
  const dir = path.join(REPO_ROOT, workspace);
  const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", ".expo", ".turbo"]);

  const walk = (current, depth) => {
    if (depth > 3) return false;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (walk(path.join(current, entry.name), depth + 1)) return true;
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        return true;
      }
    }
    return false;
  };

  return walk(dir, 0);
}

function cruise(workspace, allWorkspaces) {
  const cwd = path.join(REPO_ROOT, workspace);
  const args = [".", "--config", CONFIG_PATH, "--output-type", "json"];

  const siblingApps = workspace.startsWith("apps/")
    ? allWorkspaces
        .filter((w) => w.startsWith("apps/") && w !== workspace)
        .map((w) => w.slice("apps/".length))
    : [];

  // Only pass a tsconfig when the workspace has one; depcruise resolves its
  // `include` globs against the cwd, which is exactly why cwd is the workspace.
  if (existsSync(path.join(cwd, "tsconfig.json"))) {
    args.push("--ts-config", "tsconfig.json");
  }

  let stdout;
  try {
    stdout = execFileSync("npx", ["depcruise", ...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      env: {
        ...process.env,
        DEPCRUISE_WORKSPACE: workspace,
        DEPCRUISE_SIBLING_APPS: siblingApps.join(","),
      },
    });
  } catch (error) {
    // depcruise exits non-zero when it finds violations — that is the normal
    // path here, and stdout still holds the JSON report.
    stdout = error.stdout;
    if (!stdout || !stdout.trim().startsWith("{")) {
      const detail = (error.stderr || error.stdout || error.message || "").toString().trim();
      throw new Error(`depcruise failed in ${workspace}:\n${detail}`);
    }
  }

  const report = JSON.parse(stdout);
  return (
    (report.summary?.violations ?? [])
      .map((v) => ({
        rule: v.rule.name,
        severity: v.rule.severity,
        workspace,
        from: toRepoRelative(workspace, v.from),
        to: toRepoRelative(workspace, v.to),
        // A cycle's value is the loop it names, which from/to alone does not show.
        cycle: v.cycle
          ? v.cycle.map((step) => (typeof step === "string" ? step : step.name))
          : undefined,
      }))
      // Each workspace answers only for its OWN files. depcruise follows imports
      // into `packages/*`, so cruising apps/web also evaluates every rule against
      // packages/hooks — reporting the same violation once per consuming app,
      // under whichever rule set that app happened to enable. Owning only what
      // lives here removes the duplicates at the source instead of dedup'ing
      // them afterwards, and keeps a package's violations attributed to the
      // package rather than to whoever imported it. Nothing is lost: every
      // workspace gets its own cruise.
      .filter((v) => v.from.startsWith(`${workspace}/`))
  );
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    // Fail loudly. A malformed baseline read as "empty" would fail every
    // grandfathered violation at once and look like a mass regression; read as
    // "everything known" it would disarm the gate. Neither guess is safe.
    throw new Error(`Could not parse ${path.relative(REPO_ROOT, BASELINE_PATH)}: ${error.message}`);
  }
}

/** Violations not covered by the baseline — the ones that fail the gate. */
export function newViolations(violations, baseline) {
  const known = new Set(baseline.map(violationKey));
  return violations.filter((v) => !known.has(violationKey(v)));
}

/** Baseline entries that no longer match anything, so the file can shrink. */
export function staleBaselineEntries(violations, baseline) {
  const current = new Set(violations.map(violationKey));
  return baseline.filter((entry) => !current.has(violationKey(entry)));
}

function main() {
  const updateBaseline = process.argv.includes("--update-baseline");
  const onlyIndex = process.argv.indexOf("--workspace");
  const only = onlyIndex === -1 ? undefined : process.argv[onlyIndex + 1];

  const workspaces = discoverWorkspaces()
    .filter((w) => (only ? w === only : true))
    .filter(hasCruisableSource);

  if (workspaces.length === 0) {
    console.error("check-dep-cruiser: no cruisable workspaces found.");
    return 2;
  }

  const allWorkspaces = discoverWorkspaces();
  const seen = new Set();
  const violations = [];
  for (const workspace of workspaces) {
    for (const v of cruise(workspace, allWorkspaces)) {
      const key = violationKey(v);
      if (seen.has(key)) continue;
      seen.add(key);
      violations.push(v);
    }
  }
  violations.sort((a, b) => violationKey(a).localeCompare(violationKey(b)));

  if (updateBaseline) {
    const entries = violations.map(({ rule, from, to }) => ({ rule, from, to }));
    writeFileSync(BASELINE_PATH, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
    console.log(
      `Recorded ${entries.length} known violation(s) across ${workspaces.length} workspace(s) ` +
        `to ${path.relative(REPO_ROOT, BASELINE_PATH)}.`,
    );
    return 0;
  }

  const baseline = loadBaseline();
  const introduced = newViolations(violations, baseline);
  const stale = staleBaselineEntries(violations, baseline);

  console.log(
    `Cruised ${workspaces.length} workspace(s): ${violations.length} violation(s), ` +
      `${baseline.length} baselined, ${introduced.length} new.`,
  );

  if (stale.length > 0) {
    // Informational, never a failure: a stale entry means someone FIXED a
    // violation, and failing them for it is precisely backwards.
    console.log("");
    console.log(
      `${stale.length} baseline entry/entries no longer match — run ` +
        `\`npm run check:dep-cruiser -- --update-baseline\` to shrink the baseline.`,
    );
  }

  if (introduced.length === 0) {
    console.log("");
    console.log("Dependency boundary check passed.");
    return 0;
  }

  console.error("");
  console.error("Dependency boundary check failed — new violation(s):");
  console.error("");
  for (const v of introduced) {
    console.error(`  ${v.rule}: ${v.from} → ${v.to}`);
    if (v.cycle) console.error(`    cycle: ${v.cycle.join(" → ")}`);
  }
  console.error("");
  console.error("These are NOT in the baseline, so this change introduced them.");
  console.error("Fix the import, or — if the boundary itself is wrong — change the rule in");
  console.error("scripts/dependency-cruiser.cjs and say why. Do not re-record the baseline to grow it:");
  console.error("it exists to shrink. See docs/internal/ci-cd/QUALITY_GATES.md.");
  return 1;
}

if (process.argv[1] && process.argv[1].endsWith("check-dep-cruiser.mjs")) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`check-dep-cruiser: ${error.message}`);
    process.exit(2);
  }
}
