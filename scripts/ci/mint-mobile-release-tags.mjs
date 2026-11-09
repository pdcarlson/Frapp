#!/usr/bin/env node

// Give every store version its own tag and GitHub Release: `mobile-vX.Y.Z`.
//
// ── Why a second tag set ────────────────────────────────────────────────────
// The plain `vX.Y.Z` tags count production deploys of the web app and the API
// (`release.yml`, one per Deploy production run, bumped by `release:*` labels).
// The store version is `expo.version` in `apps/mobile/app.json`, which moves
// only when native code changes, because OTA updates are keyed to it
// (`spec/environments/README.md`). The two counters can't be merged without
// forcing a store build on every deploy, so the stores' numbers get their own
// tags instead: `mobile-v0.10.0` is the commit that became iOS and Android
// 0.10.0, whatever `v*` tag that commit also carries. Decided by Paul,
// 2026-11-06.
//
// `mobile-v*` does not match the `v*` glob the deploy and build workflows use
// to find "what production serves", and its Releases are made with
// `--latest=false`, so the latest Release on GitHub stays the live deploy.
//
// ── Source of truth ─────────────────────────────────────────────────────────
// `apps/mobile/store/shipped-builds.json`, read from `main`. Every uploaded
// store build lands there through the record PR (`record-shipped-builds.mjs`),
// so this runs when that file changes on `main` and is idempotent: it mints
// the tags and Releases that are missing and rewrites a Release body that no
// longer lists every recorded build (the second platform recorded later).
// A tag is never moved. When a version's builds came from different commits
// the tag goes on the first one recorded and the Release names each commit.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

import { parseRegistry } from "./lib/shipped-builds-registry.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";

export const TAG_PREFIX = "mobile-v";
const PLATFORM_NAMES = { ios: "iOS", android: "Android" };
const VERSION_RE = /^\d+\.\d+\.\d+$/;

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * One entry per store version, oldest first: its tag, the commit the tag goes
 * on, and the Release title and body.
 */
export function planMobileReleases(registry, { repo }) {
  const builds = Array.isArray(registry?.builds) ? registry.builds : [];
  const byVersion = new Map();
  for (const build of builds) {
    if (!VERSION_RE.test(String(build.version ?? ""))) {
      throw new Error(
        `shipped-builds.json has an entry with no X.Y.Z version: ${JSON.stringify(build)}`,
      );
    }
    if (!/^[0-9a-f]{40}$/.test(String(build.sha ?? ""))) {
      throw new Error(
        `shipped-builds.json entry ${build.platform} ${build.version} has no full commit SHA.`,
      );
    }
    if (!byVersion.has(build.version)) byVersion.set(build.version, []);
    byVersion.get(build.version).push(build);
  }

  const versions = [...byVersion.keys()].sort(compareVersions);
  return versions.map((version, index) => {
    const entries = byVersion.get(version);
    const tag = `${TAG_PREFIX}${version}`;
    const sha = entries[0].sha;
    const previous = index > 0 ? `${TAG_PREFIX}${versions[index - 1]}` : null;
    const builds = entries
      .map(
        (b) => `${PLATFORM_NAMES[b.platform] ?? b.platform} build ${b.build}`,
      )
      .join(", ");

    const lines = [
      `Frapp ${version} as uploaded to the stores.`,
      "",
      "| Platform | Build | Commit | Recorded |",
      "| --- | --- | --- | --- |",
      ...entries.map(
        (b) =>
          `| ${PLATFORM_NAMES[b.platform] ?? b.platform} | ${b.build} | \`${b.sha.slice(0, 8)}\` | ${b.recorded ?? ""} |`,
      ),
    ];
    const notes = entries.filter((b) => b.note);
    if (notes.length > 0) {
      lines.push(
        "",
        ...notes.map(
          (b) => `- ${PLATFORM_NAMES[b.platform] ?? b.platform}: ${b.note}`,
        ),
      );
    }
    if (previous) {
      lines.push(
        "",
        `Changes since ${previous}: https://github.com/${repo}/compare/${previous}...${tag}`,
      );
    }
    lines.push(
      "",
      "Web and API deploys are tagged separately as `vX.Y.Z`. Source: `apps/mobile/store/shipped-builds.json`.",
    );

    return {
      version,
      tag,
      sha,
      title: `Mobile ${version} (${builds})`,
      body: `${lines.join("\n")}\n`,
    };
  });
}

function gh(args, { input } = {}) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "inherit"],
  }).trim();
}

// `null` only when GitHub says the thing doesn't exist. Any other failure (a
// 5xx, a rate limit, a bad token) is rethrown, so it can't pass for "missing"
// and send the script off to create something that is already there.
function ghMaybe(args) {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    const stderr = String(err.stderr ?? "");
    if (/HTTP 404|release not found|Not Found/i.test(stderr)) return null;
    process.stderr.write(stderr);
    throw err;
  }
}

function existingTagCommit(repo, tag) {
  const ref = ghMaybe([
    "api",
    `repos/${repo}/git/ref/tags/${tag}`,
    "--jq",
    '.object.type + " " + .object.sha',
  ]);
  if (!ref) return null;
  const [type, sha] = ref.split(" ");
  if (type === "commit") return sha;
  return gh(["api", `repos/${repo}/git/tags/${sha}`, "--jq", ".object.sha"]);
}

function mintTag(repo, { tag, sha, version }) {
  // Same route as release.yml's Create tag: an annotated tag object, then the
  // ref through the Contents API, never receive-pack (trap 4 in release.yml).
  const object = gh([
    "api",
    "--method",
    "POST",
    `repos/${repo}/git/tags`,
    "-f",
    `tag=${tag}`,
    "-f",
    `message=Frapp ${version} store builds`,
    "-f",
    `object=${sha}`,
    "-f",
    "type=commit",
    "--jq",
    ".sha",
  ]);
  try {
    gh([
      "api",
      "--method",
      "POST",
      `repos/${repo}/git/refs`,
      "-f",
      `ref=refs/tags/${tag}`,
      "-f",
      `sha=${object}`,
    ]);
  } catch (err) {
    console.log(
      `::error::Made the ${tag} tag object (${object}) but GitHub refused refs/tags/${tag}. ` +
        "When the recorded commit's .github/workflows differs from main, only RELEASE_GITHUB_TOKEN " +
        "(automation environment; a user PAT with Contents and Workflows, read and write) may create it. " +
        "Fix the token and run Mobile release tags again (trap 4 in release.yml).",
    );
    throw err;
  }
}

/**
 * Every uploaded build in the registry's text, oldest recorded first (a stable
 * sort, so a moved entry keeps its place among its version's).
 *
 * Through the registry's own parse, so a key repeated inside one entry fails
 * here rather than tagging whichever value JSON.parse kept (#3783). Dropped
 * builds are included: a dropped build was still uploaded, so dropping one must
 * not rewrite the title, body or "Changes since" link of a published Release.
 */
export function uploadedBuilds(text) {
  const { builds, dropped } = parseRegistry(text);
  return [...builds, ...dropped].sort((a, b) => a.recorded.localeCompare(b.recorded));
}

export function run({ registryPath, repo, log = console.log }) {
  const plan = planMobileReleases({ builds: uploadedBuilds(readFileSync(registryPath, "utf8")) }, { repo });
  let warnings = 0;

  for (const release of plan) {
    const tagged = existingTagCommit(repo, release.tag);
    if (!tagged) {
      mintTag(repo, release);
      log(`Minted ${release.tag} on ${release.sha}.`);
    } else if (tagged !== release.sha) {
      warnings += 1;
      log(
        `::warning::${release.tag} is on ${tagged}, not ${release.sha}, the first recorded ${release.version} build. Left as it is: a tag is never moved.`,
      );
    }

    const current = ghMaybe([
      "release",
      "view",
      release.tag,
      "--repo",
      repo,
      "--json",
      "body,name",
    ]);
    if (current === null) {
      gh(
        [
          "release",
          "create",
          release.tag,
          "--repo",
          repo,
          "--title",
          release.title,
          "--notes-file",
          "-",
          "--latest=false",
          "--verify-tag",
        ],
        { input: release.body },
      );
      log(`Created the ${release.tag} Release.`);
    } else {
      const { name, body } = JSON.parse(current);
      if (
        name !== release.title ||
        String(body).replace(/\r\n/g, "\n").trim() !== release.body.trim()
      ) {
        gh(
          [
            "release",
            "edit",
            release.tag,
            "--repo",
            repo,
            "--title",
            release.title,
            "--notes-file",
            "-",
          ],
          { input: release.body },
        );
        log(`Updated the ${release.tag} Release.`);
      } else {
        log(`${release.tag} is up to date.`);
      }
    }
  }
  return { plan, warnings };
}

if (isInvokedDirectly(import.meta.url)) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    console.error("GITHUB_REPOSITORY is not set.");
    process.exit(1);
  }
  run({
    registryPath:
      process.env.SHIPPED_BUILDS ?? "apps/mobile/store/shipped-builds.json",
    repo,
  });
}
