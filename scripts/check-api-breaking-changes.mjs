#!/usr/bin/env node

/**
 * API breaking-change detection (oasdiff).
 *
 * Compares the committed `apps/api/openapi.json` against the same file on the
 * base branch and reports every breaking change between them.
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
 * ## Why this reports rather than blocks
 *
 * ADVISORY on purpose. Every consumer of this API — `apps/web`, `apps/mobile`
 * — lives in this repo and regenerates from the same commit, so a breaking
 * change ships atomically with the clients that adapt to it. The project is
 * also mid-rebuild (Frapp → Signet), where removing endpoints is the intended
 * work, not an accident. A hard gate would therefore fire constantly on correct
 * changes and need an escape hatch immediately.
 *
 * Flip it to blocking (`--fail-on-breaking`) if an external or independently
 * deployed consumer ever appears — that is the trigger to revisit.
 *
 * Usage:
 *   node scripts/check-api-breaking-changes.mjs --base <ref>
 *   node scripts/check-api-breaking-changes.mjs --base <ref> --fail-on-breaking
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPEC_PATH = "apps/api/openapi.json";
const OASDIFF_BIN = path.join(REPO_ROOT, ".cache", "oasdiff", "oasdiff");

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  const value = process.argv[idx + 1];
  if (value === undefined || value.startsWith("-")) return undefined;
  return value;
}

/** The spec as of `ref`, or null when it did not exist there. */
function specAtRef(ref) {
  try {
    return execSync(`git show ${ref}:${SPEC_PATH}`, {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function main() {
  const base = getArg("--base");
  const failOnBreaking = process.argv.includes("--fail-on-breaking");

  if (!base) {
    console.error("check-api-breaking-changes: --base <ref> is required.");
    return 2;
  }

  if (!existsSync(OASDIFF_BIN)) {
    console.error(
      "check-api-breaking-changes: oasdiff is not installed.\n" +
        "Run: bash scripts/install-oasdiff.sh",
    );
    return 2;
  }

  const baseSpec = specAtRef(base);
  if (baseSpec === null) {
    // A base without the spec is not a breaking change — it is a base that
    // predates the file, or a shallow clone. Reporting "everything is new"
    // would be noise.
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

  let output = "";
  let breaking = false;
  try {
    // `--fail-on ERR` is required, not optional polish. Plain `oasdiff breaking`
    // exits **0** even when it reports breaking changes (measured against 1.11.7:
    // removing an endpoint prints "1 changes: 1 error" and exits 0), so keying off
    // the exit status without it means never detecting anything, and keying off
    // "is stdout non-empty" instead conflates a WARN-level note with a real break.
    // With the flag: 0 = no ERR-level breaking change, 1 = at least one, anything
    // else = oasdiff itself failed (102 for an unloadable spec).
    output = execFileSync(
      OASDIFF_BIN,
      ["breaking", basePath, headPath, "--format", "text", "--fail-on", "ERR"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (error) {
    if (error.status === 1) {
      breaking = true;
      output = error.stdout ?? "";
    } else {
      console.error("check-api-breaking-changes: oasdiff failed to run.");
      console.error(`  exit status: ${error.status ?? "unknown"}`);
      console.error((error.stderr || error.message || "").toString().trim());
      return 2;
    }
  }

  const trimmed = output.trim();

  if (!breaking) {
    // Exit 0 with output means WARN-level findings only — worth printing, but
    // not the thing this check exists to flag.
    if (trimmed !== "" && !/^No breaking changes/i.test(trimmed)) {
      console.log(`No ERR-level breaking changes against ${base}. Lower-severity notes:`);
      console.log("");
      console.log(trimmed);
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
  console.log(trimmed);
  console.log("");
  console.log(
    "ADVISORY: every consumer (apps/web, apps/mobile) regenerates from this repo, so a",
  );
  console.log(
    "breaking change ships with the clients that adapt to it. Confirm those clients were",
  );
  console.log("updated in this change set. See docs/internal/ci-cd/QUALITY_GATES.md.");

  return failOnBreaking ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith("check-api-breaking-changes.mjs")) {
  process.exit(main());
}
