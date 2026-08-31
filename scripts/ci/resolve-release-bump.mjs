#!/usr/bin/env node

// Work out the next version for a production deploy.
//
// ── What changed and why ────────────────────────────────────────────────────
// `release.yml` used to fire on a push to `production` and read ONE PR number
// out of ONE merge-commit message — the promotion PR — then read that PR's
// `release:*` label. With no promotion branch there is no promotion PR and no
// merge commit to read, so the bump now comes from every PR merged since the
// last release tag.
//
// That moves the release label off a single promotion PR and onto ordinary PRs,
// which is why `.github/pull_request_template.md` no longer scopes its release
// label section to "main -> production only".
//
// ── The parsing trap this file exists to avoid ─────────────────────────────
// The old extraction was `grep -oP '#\K[0-9]+' | head -1` over the WHOLE commit
// message. `main`'s history contains both shapes:
//
//   Merge pull request #1337 from pdcarlson/claude/next-steps-7s3mz5
//   Exempt URGENT from the notification category gate (#1325)
//
// and squashed bodies routinely reference ISSUES before they reference their own
// PR ("...the failure #1293 documents...", "#643", "#1330"). First-`#`-wins over
// the full message therefore reads an issue number as a PR number and fetches
// some unrelated issue's labels. So: parse the SUBJECT LINE only, and handle
// both shapes explicitly.
//
// Semantics: the pure functions below. Unit tests:
// `scripts/ci/__tests__/resolve-release-bump.test.mjs`.

import { appendFileSync } from "node:fs";
import { requireEnv } from "./lib/env.mjs";
import { githubHeaders } from "./lib/github.mjs";

const MERGE_SUBJECT = /^Merge pull request #(\d+)\b/;
const SQUASH_SUBJECT = /\(#(\d+)\)\s*$/;

export const BUMP_RANK = { patch: 0, minor: 1, major: 2 };

/**
 * The PR number a commit subject names, or null.
 *
 * Subject line only — never the body. See the header.
 */
export function prNumberFromSubject(subject) {
  if (typeof subject !== "string") return null;
  const line = subject.split("\n", 1)[0].trim();

  const merge = line.match(MERGE_SUBJECT);
  if (merge) return Number(merge[1]);

  const squash = line.match(SQUASH_SUBJECT);
  if (squash) return Number(squash[1]);

  return null;
}

/** Every distinct PR number named by these commit subjects, in order. */
export function prNumbersFromSubjects(subjects) {
  const seen = new Set();
  const out = [];
  for (const subject of subjects) {
    const number = prNumberFromSubject(subject);
    if (number !== null && !seen.has(number)) {
      seen.add(number);
      out.push(number);
    }
  }
  return out;
}

/** The strongest bump any of these label sets asks for. */
export function highestBump(labelSets) {
  let best = "patch";
  for (const labels of labelSets) {
    const names = Array.isArray(labels) ? labels : [];
    const asked = names.includes("release:major")
      ? "major"
      : names.includes("release:minor")
        ? "minor"
        : "patch";
    if (BUMP_RANK[asked] > BUMP_RANK[best]) best = asked;
  }
  return best;
}

/** Apply a bump to `major.minor.patch`. */
export function applyBump(currentVersion, bump) {
  const [major = 0, minor = 0, patch = 0] = String(currentVersion)
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);

  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * Labels on one PR.
 *
 * A 404 THROWS rather than returning `[]`. Returning an empty list would read
 * as "no release label", i.e. a silent downgrade to `patch` — a `release:major`
 * PR could ship as a patch because a token lacked a scope. The whole point of
 * reading labels is that the answer is trustworthy.
 */
export async function fetchPrLabels({ repo, prNumber, token, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, {
    headers: githubHeaders({ token }),
  });
  if (!response.ok) {
    throw new Error(`GitHub API returned HTTP ${response.status} for PR #${prNumber}`);
  }
  const body = await response.json();
  if (!Array.isArray(body?.labels)) {
    throw new Error(`Unexpected pull request payload for PR #${prNumber}`);
  }
  return body.labels.map((label) => label?.name).filter(Boolean);
}

/**
 * `{bump, version, prNumbers}` for a release.
 *
 * `override` short-circuits the scan entirely — that is the dispatch input, and
 * an operator naming a bump should not be second-guessed by label archaeology.
 */
export async function resolveReleaseBump({
  currentVersion,
  subjects,
  repo,
  token,
  override = "auto",
  fetchImpl = fetch,
  logger = console,
}) {
  if (override && override !== "auto") {
    logger.log?.(`Bump overridden on the dispatch: ${override}`);
    return { bump: override, version: applyBump(currentVersion, override), prNumbers: [] };
  }

  const prNumbers = prNumbersFromSubjects(subjects);
  if (prNumbers.length === 0) {
    logger.log?.("No PR numbers found in range — defaulting to a patch bump.");
    return { bump: "patch", version: applyBump(currentVersion, "patch"), prNumbers: [] };
  }

  const labelSets = [];
  for (const prNumber of prNumbers) {
    const labels = await fetchPrLabels({ repo, prNumber, token, fetchImpl });
    logger.log?.(`PR #${prNumber} labels: ${labels.join(", ") || "(none)"}`);
    labelSets.push(labels);
  }

  const bump = highestBump(labelSets);
  return { bump, version: applyBump(currentVersion, bump), prNumbers };
}

// ── CLI entry ───────────────────────────────────────────────────────────────

function appendOutput(lines) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  appendFileSync(file, `${lines.join("\n")}\n`);
}

async function main() {
  // Subjects arrive newline-separated on stdin: `git log --format=%s A..B`.
  // Through stdin rather than argv so a commit subject containing anything at
  // all cannot be re-read as an argument.
  const raw = await new Promise((resolve) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (buffer += chunk));
    process.stdin.on("end", () => resolve(buffer));
  });

  const subjects = raw.split("\n").map((line) => line.trim()).filter(Boolean);

  const result = await resolveReleaseBump({
    currentVersion: process.env.CURRENT_VERSION || "0.0.0",
    subjects,
    repo: requireEnv("GITHUB_REPOSITORY"),
    token: requireEnv("GITHUB_TOKEN"),
    override: process.env.BUMP_OVERRIDE ?? "auto",
  });

  console.log(`bump=${result.bump}`);
  console.log(`version=${result.version}`);
  appendOutput([`bump=${result.bump}`, `version=${result.version}`]);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`::error::Could not resolve the release bump: ${error.message}`);
    process.exit(1);
  });
}
