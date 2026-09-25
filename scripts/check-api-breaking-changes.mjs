#!/usr/bin/env node

/**
 * API breaking-change detection (oasdiff), in two modes with two postures.
 *
 * `--base <ref>` compares the committed `apps/api/openapi.json` against the
 * same file at `ref` (CI passes the PR's base) and reports every breaking
 * change between them. ADVISORY.
 *
 * `--shipped <registry>` compares it against the contract each shipped mobile
 * binary was built from, one `git show <sha>:apps/api/openapi.json` per SHA in
 * `apps/mobile/store/shipped-builds.json`. BLOCKING (#2619).
 *
 * ## Why this is separate from `check:api-contract`
 *
 * They answer different questions, and only one of them was already answered.
 * `check-api-contract-drift.mjs` asks *"is the committed contract stale?"* — it
 * regenerates both artifacts and diffs them. It says nothing about whether a
 * change is **compatible**: deleting an endpoint, removing a response field, or
 * making an optional request parameter required all regenerate perfectly
 * cleanly and pass that check while breaking every existing client.
 *
 * Worth stating plainly, because the plan this implements assumed otherwise:
 * a "regenerate the SDK and `git diff --exit-code`" gate would have been
 * **entirely redundant** — that is exactly what `check:api-contract` already
 * does, for both `openapi.json` and `packages/api-sdk/src/types.ts`, and it is
 * already a required check. Breaking-change detection is the part that was
 * genuinely missing.
 *
 * ## Why the base comparison reports rather than blocks
 *
 * `apps/web` regenerates from this repo and deploys with the change, so a
 * breaking change ships atomically with the web client that adapts to it. The
 * project is also mid-rebuild (legacy Frapp → Signet design system), where
 * removing endpoints is the intended work, not an accident. A hard gate on the
 * base diff would fire constantly on correct changes.
 *
 * ## Why the shipped comparison blocks
 *
 * A store binary is the independently deployed consumer the base comparison's
 * posture was waiting for. Every install keeps the API calls it was built with
 * until its owner updates from the store (ADR-24 decisions 6 (I5) and 8), so a
 * PR that removes a route it calls merges green and breaks every install. The
 * base diff can't see that: a route deleted in one PR and its replacement
 * renamed in the next each look fine against their own base. Comparing
 * against the contract **as shipped** can.
 *
 * With no builds listed it passes and says it compared against nothing, and
 * needs no oasdiff. With builds listed, nothing reads as a skipped green
 * (ADR-24 I4): a missing oasdiff, an invalid registry, a SHA whose contract
 * can't be read, or oasdiff failing to run each fail the check.
 *
 * It fails on oasdiff's ERR level: a removed route, a removed required
 * response field, a parameter made required. WARN-level changes, such as a
 * removed optional response field (which the generated SDK types as possibly
 * absent), are printed as a `::warning::` and don't block.
 *
 * A break to a route no shipped binary calls (a web-only route) is waived by a
 * line in `apps/mobile/store/api-breaking-ignore.txt`, handed to oasdiff's
 * `--err-ignore` with its `#` comment lines removed first: oasdiff has no
 * comment syntax, so a commented-out entry would otherwise still waive. When a
 * SHA may be dropped from the registry, and the ignore file's format:
 * apps/mobile/store/README.md § Shipped builds and the API contract.
 *
 * Usage:
 *   node scripts/check-api-breaking-changes.mjs --base <ref>
 *   node scripts/check-api-breaking-changes.mjs --shipped apps/mobile/store/shipped-builds.json
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isInvokedDirectly } from "./ci/lib/invoked-directly.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPEC_PATH = "apps/api/openapi.json";
const OASDIFF_BIN = path.join(REPO_ROOT, ".cache", "oasdiff", "oasdiff");
const IGNORE_PATH = "apps/mobile/store/api-breaking-ignore.txt";

const PLATFORMS = new Set(["ios", "android"]);
const ENTRY_KEYS = new Set(["platform", "version", "build", "sha", "recorded", "note"]);

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  const value = process.argv[idx + 1];
  if (value === undefined || value.startsWith("-")) return undefined;
  return value;
}

/** The spec as of `ref`, or null when it could not be read there. */
function specAtRef(ref) {
  try {
    return execFileSync("git", ["show", `${ref}:${SPEC_PATH}`], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/**
 * Run `oasdiff breaking` and classify the result.
 *
 * `--fail-on ERR` is required, not optional polish. Plain `oasdiff breaking`
 * exits **0** even when it reports breaking changes (measured against 1.11.7:
 * removing an endpoint prints "1 changes: 1 error" and exits 0), so keying off
 * the exit status without it means never detecting anything, and keying off
 * "is stdout non-empty" instead conflates a WARN-level note with a real break.
 * With the flag: 0 = no ERR-level breaking change, 1 = at least one, anything
 * else = oasdiff itself failed (102 for an unloadable spec, 121 for an
 * unreadable `--err-ignore` file).
 *
 * @returns {{ status: "clean" | "breaking" | "error", output: string }}
 */
export function runOasdiff({ bin, basePath, headPath, ignorePath }) {
  const args = ["breaking", basePath, headPath, "--format", "text", "--fail-on", "ERR"];
  if (ignorePath) args.push("--err-ignore", ignorePath);
  try {
    const output = execFileSync(bin, args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return { status: "clean", output: output.trim() };
  } catch (error) {
    if (error.status === 1) {
      return { status: "breaking", output: (error.stdout ?? "").toString().trim() };
    }
    return {
      status: "error",
      output: [
        `exit status: ${error.status ?? "unknown"}`,
        (error.stderr || error.message || "").toString().trim(),
      ].join("\n"),
    };
  }
}

/**
 * Parse and validate the shipped-builds registry.
 *
 * Strict on purpose. A typo'd key (`commit` for `sha`) or a short SHA that
 * parsed as "no builds" would turn a blocking gate into one that compares
 * against nothing, so every problem is an error rather than a skip.
 *
 * @returns {{ builds: Array<{platform: string, version: string, build: string, sha: string, recorded: string}> }}
 * @throws {Error} listing every problem found
 */
export function parseRegistry(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`not valid JSON: ${error.message}`);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("the top level must be an object with a `builds` array");
  }
  if (!Array.isArray(data.builds)) {
    throw new Error("`builds` must be an array (empty when nothing has shipped)");
  }

  const problems = [];
  const seen = new Set();
  data.builds.forEach((entry, i) => {
    const at = `builds[${i}]`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      problems.push(`${at} must be an object`);
      return;
    }
    for (const key of Object.keys(entry)) {
      if (!ENTRY_KEYS.has(key)) problems.push(`${at} has an unknown key \`${key}\``);
    }
    if (!PLATFORMS.has(entry.platform)) {
      problems.push(`${at}.platform must be "ios" or "android"`);
    }
    if (typeof entry.version !== "string" || !/^\d+\.\d+\.\d+$/.test(entry.version)) {
      problems.push(`${at}.version must be the store version, e.g. "1.0.0"`);
    }
    if (typeof entry.build !== "string" || !/^[1-9]\d*$/.test(entry.build)) {
      problems.push(`${at}.build must be the native build number as a string, e.g. "12"`);
    }
    if (typeof entry.sha !== "string" || !/^[0-9a-f]{40}$/.test(entry.sha)) {
      problems.push(`${at}.sha must be the full 40-character commit SHA the build was made from`);
    }
    if (typeof entry.recorded !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.recorded)) {
      problems.push(`${at}.recorded must be the date it was recorded, e.g. "2026-10-01"`);
    }
    if (entry.note !== undefined && typeof entry.note !== "string") {
      problems.push(`${at}.note must be a string when present`);
    }
    const id = `${entry.platform}/${entry.version}+${entry.build}`;
    if (seen.has(id)) problems.push(`${at} repeats ${id}`);
    seen.add(id);
  });

  if (problems.length > 0) throw new Error(problems.join("\n"));
  return { builds: data.builds };
}

/** One baseline per distinct SHA, naming every build made from it. */
export function baselinesFor(builds) {
  const bySha = new Map();
  for (const b of builds) {
    const label = `${b.platform}/${b.version}+${b.build}`;
    if (!bySha.has(b.sha)) bySha.set(b.sha, []);
    bySha.get(b.sha).push(label);
  }
  return [...bySha].map(([sha, labels]) => ({ sha, labels }));
}

/**
 * The ignore file's entries, without its comments and blank lines.
 *
 * oasdiff's `--err-ignore` has no comment syntax: any line holding
 * `METHOD /path` and the change text waives that change, `#` or not. So the
 * file oasdiff reads is these lines only, and `#` means what it looks like.
 */
export function waiverLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/**
 * The blocking comparison against every shipped build's contract.
 *
 * Dependencies are injected so the tests can drive every branch without git
 * history or an oasdiff binary.
 *
 * @returns {0 | 1 | 2} 0 = compatible with every shipped build (or none
 *   listed), 1 = at least one breaking change, 2 = the check could not run
 */
export function checkShipped({
  registryText,
  registryLabel,
  headPath,
  oasdiffBin,
  ignoreText = null,
  exists = existsSync,
  specAt = specAtRef,
  oasdiff = runOasdiff,
  workDir = () => mkdtempSync(path.join(tmpdir(), "oasdiff-shipped-")),
  log = console.log,
  error = console.error,
}) {
  let registry;
  try {
    registry = parseRegistry(registryText);
  } catch (e) {
    log(`::error::${registryLabel} is invalid, so the shipped-contract check cannot run.`);
    error(e.message);
    return 2;
  }

  const baselines = baselinesFor(registry.builds);
  if (baselines.length === 0) {
    log(
      `No shipped mobile builds are listed in ${registryLabel}, so this compared against nothing. ` +
        "It passes until the first binary ships and its SHA is recorded.",
    );
    return 0;
  }

  if (!exists(oasdiffBin)) {
    log(
      `::error::oasdiff is not installed, and ${baselines.length} shipped contract(s) need checking. ` +
        "This check does not skip. Run: bash scripts/install-oasdiff.sh",
    );
    return 2;
  }
  if (!exists(headPath)) {
    log(`::error::${SPEC_PATH} not found in the working tree.`);
    return 2;
  }
  const dir = workDir();
  const waivers = ignoreText === null ? [] : waiverLines(ignoreText);
  let ignore;
  if (waivers.length > 0) {
    ignore = path.join(dir, "err-ignore.txt");
    writeFileSync(ignore, `${waivers.join("\n")}\n`, "utf8");
  }
  let failed = false;
  let broken = false;
  for (const { sha, labels } of baselines) {
    const names = labels.join(", ");
    const spec = specAt(sha);
    if (spec === null) {
      log(
        `::error::Cannot read ${SPEC_PATH} at ${sha} (${names}). A shallow clone, a SHA that ` +
          "isn't in this repository's history, or a commit before the file existed. " +
          "This check does not skip it: record the main commit the build was made from.",
      );
      failed = true;
      continue;
    }
    const basePath = path.join(dir, `${sha}.json`);
    writeFileSync(basePath, spec, "utf8");

    const result = oasdiff({ bin: oasdiffBin, basePath, headPath, ignorePath: ignore });
    if (result.status === "error") {
      log(`::error::oasdiff failed to run against ${sha} (${names}).`);
      error(result.output);
      failed = true;
    } else if (result.status === "breaking") {
      log(
        `::error::Breaking API change(s) against shipped mobile build(s) ${names} (built from ${sha}).`,
      );
      log("");
      log(`Breaking API changes against ${names} (${sha}):`);
      log("");
      log(result.output);
      log("");
      broken = true;
    } else {
      log(`Compatible with ${names} (${sha}).`);
      // Exit 0 with output means WARN-level changes only (a removed optional
      // response field, say). They don't block, but a reviewer should see them.
      if (result.output !== "" && !/^No breaking changes/i.test(result.output)) {
        log(
          `::warning::Lower-severity API changes against shipped mobile build(s) ${names} (${sha}). ` +
            "Not blocking; check the shipped binary tolerates each one.",
        );
        log(result.output);
      }
    }
  }

  if (broken) {
    log(
      "Every install of those builds keeps the API calls it was built with. Keep the route, field or " +
        `parameter, or, if no shipped binary uses it, waive the change in ${IGNORE_PATH}. ` +
        "See apps/mobile/store/README.md § Shipped builds and the API contract.",
    );
  }
  if (failed) return 2;
  return broken ? 1 : 0;
}

function mainBase(base) {
  if (!existsSync(OASDIFF_BIN)) {
    // A workflow command, not just stderr: this step runs under
    // continue-on-error, so without it the skip reads as a green run (ADR-24 I4).
    console.log(
      `::warning::Advisory comparison against ${base} skipped: oasdiff is not installed ` +
        "(its download failed?). Run: bash scripts/install-oasdiff.sh",
    );
    return 2;
  }

  const baseSpec = specAtRef(base);
  if (baseSpec === null) {
    // A base without the spec is not a breaking change — it is a base that
    // predates the file, or a shallow clone. Reporting "everything is new"
    // would be noise. (The shipped mode refuses this case instead.)
    console.log(
      `No ${SPEC_PATH} at ${base} — nothing to compare against. Skipping.`,
    );
    return 0;
  }

  const workDir = mkdtempSync(path.join(tmpdir(), "oasdiff-"));
  const basePath = path.join(workDir, "base-openapi.json");
  writeFileSync(basePath, baseSpec, "utf8");

  const headPath = path.join(REPO_ROOT, SPEC_PATH);
  if (!existsSync(headPath)) {
    console.error(`check-api-breaking-changes: ${SPEC_PATH} not found in the working tree.`);
    return 2;
  }

  const result = runOasdiff({ bin: OASDIFF_BIN, basePath, headPath });

  if (result.status === "error") {
    console.log(`::warning::Advisory comparison against ${base} skipped: oasdiff failed to run.`);
    console.error(result.output);
    return 2;
  }

  if (result.status === "clean") {
    // Exit 0 with output means WARN-level findings only — worth printing, but
    // not the thing this check exists to flag.
    if (result.output !== "" && !/^No breaking changes/i.test(result.output)) {
      console.log(`No ERR-level breaking changes against ${base}. Lower-severity notes:`);
      console.log("");
      console.log(result.output);
      return 0;
    }
    console.log(`No breaking API changes against ${base}.`);
    return 0;
  }

  // `::warning::` puts this in the run summary and the Checks UI. Without it an
  // advisory finding is a green check nobody opens.
  console.log(
    `::warning::Breaking API change(s) detected against ${base} — review before merging.`,
  );
  console.log("");
  console.log(`Breaking API changes against ${base}:`);
  console.log("");
  console.log(result.output);
  console.log("");
  console.log(
    "ADVISORY against the PR base: apps/web regenerates from this repo and deploys with the",
  );
  console.log(
    "change, so confirm it was updated in this change set. Shipped mobile builds are checked",
  );
  console.log(
    "separately, and that check blocks. See docs/internal/ci-cd/QUALITY_GATES.md.",
  );

  return 0;
}

function main() {
  const base = getArg("--base");
  const shipped = getArg("--shipped");

  if (Boolean(base) === Boolean(shipped)) {
    console.error(
      "check-api-breaking-changes: pass exactly one of --base <ref> or --shipped <registry>.",
    );
    return 2;
  }

  if (base) return mainBase(base);

  const registryPath = path.resolve(REPO_ROOT, shipped);
  let registryText;
  try {
    registryText = readFileSync(registryPath, "utf8");
  } catch (e) {
    console.log(`::error::Cannot read ${shipped}: ${e.message}`);
    return 2;
  }
  const ignorePath = path.join(REPO_ROOT, IGNORE_PATH);
  return checkShipped({
    registryText,
    registryLabel: shipped,
    headPath: path.join(REPO_ROOT, SPEC_PATH),
    oasdiffBin: OASDIFF_BIN,
    ignoreText: existsSync(ignorePath) ? readFileSync(ignorePath, "utf8") : null,
  });
}

if (isInvokedDirectly(import.meta.url)) {
  process.exit(main());
}
