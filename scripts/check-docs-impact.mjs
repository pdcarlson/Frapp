#!/usr/bin/env node

// Docs/spec sync gate: a PR touching a path outside `docs/` and `spec/` must
// also touch at least one path under one of them. See
// docs/internal/ci-cd/DOCS_CI.md for the full contract and its exemptions.
//
// Pure helpers are exported for scripts/ci/__tests__/check-docs-impact.test.mjs.

import { execSync } from "node:child_process";

const DOCS_OR_SPEC = ["docs/", "spec/"];

// Opt-out label. The gate is required under `enforce_admins: true`, so a PR
// with genuinely no docs impact — a pure-code consolidation that moves an
// implementation without changing behaviour any doc describes — has no way to
// satisfy it and is unmergeable rather than merely red.
//
// Applying a label needs write access, so this is not a self-serve bypass for
// an outside contributor, and it lands in the PR timeline as a named, reviewable
// act rather than a silent skip. The gate still runs and still prints the paths
// it would have required a doc for, so the waiver is auditable in the log.
export const EXEMPT_LABEL = "no-doc-change-needed";

/**
 * Whether the PR's labels waive the gate. Accepts the shape GitHub Actions
 * hands over — `toJSON(github.event.pull_request.labels.*.name)` — plus the
 * empty/absent cases that a push build and a local run produce.
 */
export function hasExemptLabel(labels) {
  if (!Array.isArray(labels)) return false;
  return labels.some(
    (name) => typeof name === "string" && name.trim() === EXEMPT_LABEL,
  );
}

/**
 * Parse the label list out of the environment. Passed as JSON through `env:`
 * rather than interpolated into the `run:` string, so a label named to look
 * like shell syntax cannot break out of the command.
 */
export function parseLabels(raw) {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // A malformed value must not silently waive the gate, and must not crash a
    // required check either. Treat it as "no labels" — the gate stays enforced.
    console.warn("check-docs-impact: could not parse PR_LABELS_JSON; ignoring it.");
    return [];
  }
}

// Prefixes that are neither code nor documentation, so a change under them has
// no docs impact to sync. These are *ignored*, never counted as the doc touch —
// a PR that edits code plus one of these still owes a `docs/` or `spec/` edit.
//
// Keep this list short. Every entry weakens a gate that is required under
// `enforce_admins: true`, so a prefix earns a place here only when nothing
// beneath it can change behaviour a doc describes.
//
// `.buildpad/` is a periodically-synced export of the product-planning canvas
// (`blobs/`, `documents/`, `notes/`) that agents read as background. It is
// explicitly not a spec source of truth and holds no code. Without the
// exemption every sync would read to the gate as "N non-doc files changed, no
// docs updated" and fail a required check — the same permanently-unmergeable
// trap the Dependabot exemption in .github/workflows/docs.yml exists to avoid.
export const NON_CODE_PREFIXES = [".buildpad/"];

const hasPrefix = (p, prefixes) => prefixes.some((prefix) => p.startsWith(prefix));

/**
 * Split a PR's changed paths into the three buckets the gate reasons about:
 * the doc/spec edits that can satisfy it, the exempt paths it ignores, and
 * everything else — the changes that oblige a doc/spec edit.
 */
export function classifyChanges(changed) {
  const docsOrSpec = [];
  const exempt = [];
  const requiresDocs = [];

  for (const p of changed) {
    if (hasPrefix(p, DOCS_OR_SPEC)) docsOrSpec.push(p);
    else if (hasPrefix(p, NON_CODE_PREFIXES)) exempt.push(p);
    else requiresDocs.push(p);
  }

  return { docsOrSpec, exempt, requiresDocs };
}

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: "utf8" }).trim();
}

function main() {
  const base = getArg("--base");
  const head = getArg("--head");

  if (!base || !head) {
    console.error(
      [
        "check-docs-impact: missing required args.",
        "Usage: node scripts/check-docs-impact.mjs --base <sha> --head <sha>",
      ].join("\n"),
    );
    return 2;
  }

  const changed = git(`diff --name-only ${base}...${head}`)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const { docsOrSpec, exempt, requiresDocs } = classifyChanges(changed);

  if (requiresDocs.length > 0 && docsOrSpec.length === 0) {
    // Print what the gate would have demanded before waiving it, so the waiver
    // is reviewable from the check's log rather than only from the label.
    if (hasExemptLabel(parseLabels(process.env.PR_LABELS_JSON))) {
      // A waived run reports plain green, so without an annotation it is
      // indistinguishable from a PR that genuinely had no docs to update — and
      // the label sits among the routine area:*/P2/in-review labels every PR
      // carries. `::warning::` surfaces it in the run summary and the Checks UI,
      // which is where a reviewer would actually notice it. Ignored outside
      // Actions, so local runs just see the lines below.
      console.log(
        `::warning::Docs/spec sync waived by the \`${EXEMPT_LABEL}\` label — ${requiresDocs.length} non-doc path(s) changed with no docs/spec update.`,
      );
      console.log(`Docs/spec sync check waived by the \`${EXEMPT_LABEL}\` label.`);
      console.log("");
      console.log("Changes that would otherwise have required a docs/spec update:");
      for (const p of requiresDocs) console.log(`- ${p}`);
      return 0;
    }

    console.error("Docs/spec sync check failed.");
    console.error("");
    console.error(
      "You changed repository files outside `docs/` and `spec/`, but didn't update `docs/` or `spec/` in the same PR.",
    );
    console.error("");
    console.error("Changes requiring docs/spec updates:");
    for (const p of requiresDocs) console.error(`- ${p}`);
    console.error("");
    console.error(
      "Fix: add or update related files under `docs/` (e.g. docs/guides/) and/or `spec/`.",
    );
    console.error(
      `If this change genuinely has no docs impact, label the PR \`${EXEMPT_LABEL}\` and it will re-run.`,
    );
    // Naming the CI remedy alone is useless in the terminal a developer is looking
    // at: locally there may be no PR yet, and nothing re-runs. The env var is the
    // same one the workflow sets, and `npm run ci:local-gate` inherits it.
    console.error(
      `Running this locally? \`PR_LABELS_JSON='["${EXEMPT_LABEL}"]' npm run ci:local-gate\` waives it there too.`,
    );
    return 1;
  }

  if (exempt.length > 0) {
    console.log(
      `Ignored ${exempt.length} path(s) under ${NON_CODE_PREFIXES.join(", ")} — neither code nor documentation.`,
    );
  }
  console.log("Docs/spec sync check passed.");
  return 0;
}

// Only run when invoked directly, so the test can import the helpers.
if (process.argv[1] && process.argv[1].endsWith("check-docs-impact.mjs")) {
  process.exit(main());
}
