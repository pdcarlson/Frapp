// Pins `release-notes-freshness.mjs` (#3804): Deploy production warns, before
// the approval, when the apps changed since production's release tag but What's
// new has no new entry. A warning only; it never fails the run.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  RELEASE_NOTES_PATH,
  appFacingChanges,
  checkReleaseNotes,
  newestReleaseNoteDate,
  releaseNotesVerdict,
  runCli,
} from "../release-notes-freshness.mjs";
import { RELEASE_NOTES } from "../../../packages/validation/src/release-notes.ts";
import { workflowSteps } from "./helpers/workflow-yaml.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CALLER = join(ROOT, ".github", "workflows", "deploy-production.yml");

const notesFile = (...dates) =>
  `export const RELEASE_NOTES = Object.freeze([\n${dates
    .map((d) => `  { date: "${d}", title: "t", changes: ["c"] },`)
    .join("\n")}\n]);\n`;

describe("newestReleaseNoteDate", () => {
  it("reads the real file's newest entry, which the apps show first", () => {
    const source = readFileSync(join(ROOT, RELEASE_NOTES_PATH), "utf8");
    assert.equal(newestReleaseNoteDate(source), RELEASE_NOTES[0].date);
  });

  it("reads the first date inside the list, not one in a comment above it", () => {
    const source = `// date: "1999-01-01"\n${notesFile("2026-11-09", "2026-11-07")}`;
    assert.equal(newestReleaseNoteDate(source), "2026-11-09");
  });

  it("is null for a file that isn't there or has no list", () => {
    assert.equal(newestReleaseNoteDate(null), null);
    assert.equal(newestReleaseNoteDate("export const X = 1;"), null);
  });
});

describe("appFacingChanges", () => {
  it("keeps app code and drops tests, docs and the shipped-builds registry", () => {
    assert.deepEqual(
      appFacingChanges([
        "apps/mobile/app/(app)/whats-new.tsx",
        "apps/web/components/x.tsx",
        "apps/mobile/lib/whats-new.spec.ts",
        "apps/web/lib/y.test.tsx",
        "apps/mobile/README.md",
        "apps/mobile/store/shipped-builds.json",
        "apps/api/src/main.ts",
        "docs/ci-cd/routines.md",
      ]),
      ["apps/mobile/app/(app)/whats-new.tsx", "apps/web/components/x.tsx"],
    );
  });
});

describe("releaseNotesVerdict", () => {
  const base = { tag: "v1.2.3", floorDate: "2026-11-07" };

  it("warns when the apps changed and the newest entry didn't move", () => {
    const verdict = releaseNotesVerdict({
      ...base,
      shipDate: "2026-11-07",
      changedFiles: ["apps/mobile/app/index.tsx"],
    });
    assert.equal(verdict.stale, true);
    assert.match(verdict.message, /1 app file changed since v1\.2\.3/);
    assert.match(verdict.message, /still 2026-11-07/);
  });

  it("is quiet when a new entry was added", () => {
    const verdict = releaseNotesVerdict({
      ...base,
      shipDate: "2026-11-09",
      changedFiles: ["apps/mobile/app/index.tsx"],
    });
    assert.equal(verdict.stale, false);
  });

  it("is quiet when nothing a member sees changed", () => {
    const verdict = releaseNotesVerdict({
      ...base,
      shipDate: "2026-11-07",
      changedFiles: ["apps/api/src/main.ts", "apps/mobile/x.spec.ts"],
    });
    assert.equal(verdict.stale, false);
  });

  it("counts a first-ever entry as new when production had none", () => {
    const verdict = releaseNotesVerdict({
      tag: "v1.0.0",
      floorDate: null,
      shipDate: "2026-11-07",
      changedFiles: ["apps/web/app/page.tsx"],
    });
    assert.equal(verdict.stale, false);
  });
});

function fakeGit({ tags = "v1.2.3\nv1.2.2\n", files = {}, diff = "", diffThrows = false } = {}) {
  return (args) => {
    if (args[0] === "tag") return tags;
    if (args[0] === "show") {
      const [ref, ...rest] = args[1].split(":");
      const content = files[`${ref}:${rest.join(":")}`];
      if (content === undefined) throw new Error("not there");
      return content;
    }
    if (args[0] === "diff") {
      if (diffThrows) throw new Error("bad object");
      return diff;
    }
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
}

describe("checkReleaseNotes", () => {
  const SHA = "c".repeat(40);

  it("compares the release tag's notes with the deployed commit's", () => {
    const git = fakeGit({
      files: {
        [`v1.2.3:${RELEASE_NOTES_PATH}`]: notesFile("2026-11-07"),
        [`${SHA}:${RELEASE_NOTES_PATH}`]: notesFile("2026-11-07"),
      },
      diff: "apps/mobile/app/index.tsx\n",
    });
    assert.equal(checkReleaseNotes({ sha: SHA, git }).stale, true);
  });

  it("skips, never throws, when there is no release tag or git fails", () => {
    assert.match(checkReleaseNotes({ sha: SHA, git: fakeGit({ tags: "" }) }).skipped, /release tag is unknown/);
    assert.match(checkReleaseNotes({ sha: SHA, git: fakeGit({ diffThrows: true }) }).skipped, /could not compare/);
  });
});

describe("runCli", () => {
  it("prints a ::warning:: when stale and always exits 0", () => {
    const lines = [];
    const git = fakeGit({
      files: {
        [`v1.2.3:${RELEASE_NOTES_PATH}`]: notesFile("2026-11-07"),
        [`${"c".repeat(40)}:${RELEASE_NOTES_PATH}`]: notesFile("2026-11-07"),
      },
      diff: "apps/web/app/page.tsx\n",
    });
    const code = runCli({ env: { DEPLOY_SHA: "c".repeat(40) }, git, log: (l) => lines.push(l) });
    assert.equal(code, 0);
    assert.match(lines[0], /^::warning title=No new What's new entry::/);
  });

  it("says it skipped with no DEPLOY_SHA, and exits 0", () => {
    const lines = [];
    assert.equal(runCli({ env: {}, git: fakeGit(), log: (l) => lines.push(l) }), 0);
    assert.match(lines[0], /skipped: DEPLOY_SHA is empty/);
  });
});

describe("deploy-production.yml wiring", () => {
  const validate = () => workflowSteps(CALLER).filter((s) => s.jobId === "validate");
  const STEP = "Check What's new has an entry for this release";

  it("runs in validate, after the commit is validated, on the deployed SHA", () => {
    const names = validate().map((s) => s.name);
    assert.ok(names.includes(STEP), "validate has no What's new step");
    assert.ok(names.indexOf(STEP) > names.indexOf("Validate the commit"));
    const step = validate().find((s) => s.name === STEP);
    assert.equal(step.env.get("DEPLOY_SHA"), "${{ steps.sha.outputs.sha }}");
    assert.match(step.body, /node scripts\/ci\/release-notes-freshness\.mjs/);
    assert.match(step.body, /refs\/tags\/v\*/, "the release tag must be fetched first");
  });

  it("can never stop a deploy", () => {
    const step = validate().find((s) => s.name === STEP);
    assert.match(step.body, /^\s*continue-on-error:\s*true\s*$/m);
  });
});
