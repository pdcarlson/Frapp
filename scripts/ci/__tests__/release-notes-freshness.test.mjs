// Pins `release-notes-freshness.mjs` (#3804): Deploy production warns, before
// the approval, when something members could notice changed since
// production's release tag but What's new gained neither a new entry nor new
// lines. A warning only; it never fails the run, and a rollback is skipped.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  RELEASE_NOTES_PATH,
  checkReleaseNotes,
  countArrayElements,
  memberFacingChanges,
  newestReleaseNote,
  releaseNotesVerdict,
  runCli,
} from "../release-notes-freshness.mjs";
import {
  RELEASE_NOTES,
  releaseNoteLineCount,
} from "../../../packages/validation/src/release-notes.ts";
import { workflowSteps } from "./helpers/workflow-yaml.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CALLER = join(ROOT, ".github", "workflows", "deploy-production.yml");

// Entries as `[date, ...changes]`, newest first.
const notesFile = (...entries) =>
  `export const RELEASE_NOTES = Object.freeze([\n${entries
    .map(([d, ...changes]) => `  { date: "${d}", title: "t", changes: ${JSON.stringify(changes.length ? changes : ["c"])} },`)
    .join("\n")}\n]);\n`;

describe("newestReleaseNote", () => {
  it("reads the real file's newest entry, which the apps show first", () => {
    const source = readFileSync(join(ROOT, RELEASE_NOTES_PATH), "utf8");
    assert.deepEqual(newestReleaseNote(source), {
      date: RELEASE_NOTES[0].date,
      lines: releaseNoteLineCount(RELEASE_NOTES[0]),
    });
  });

  it("counts the newest entry's web and phone lines, and none of an older entry's", () => {
    const source =
      `export const RELEASE_NOTES = Object.freeze([\n` +
      `  { date: "2026-11-12", title: "t", changes: ["a"], web: ["b", "c"], phone: ["d"] },\n` +
      `  { date: "2026-11-11", title: "t", changes: ["e"], web: ["f"] },\n]);\n`;
    assert.deepEqual(newestReleaseNote(source), { date: "2026-11-12", lines: 4 });
    const onlyChanges = source.replace(`, web: ["b", "c"], phone: ["d"]`, "");
    assert.deepEqual(newestReleaseNote(onlyChanges), { date: "2026-11-12", lines: 1 });
  });

  it("reads the first entry inside the list, not a date in a comment above it", () => {
    const source = `// date: "1999-01-01"\n${notesFile(["2026-11-09", "a", "b"], ["2026-11-07", "c"])}`;
    assert.deepEqual(newestReleaseNote(source), { date: "2026-11-09", lines: 2 });
  });

  it("counts the same lines however they're formatted", () => {
    const wrapped = `export const RELEASE_NOTES = [
  {
    date: '2026-11-09',
    title: "t",
    changes: [
      // a comment, with "quotes" and [brackets]
      "It's here, with a ] inside.",
      \`Two\`,
    ],
  },
];`;
    assert.deepEqual(newestReleaseNote(wrapped), { date: "2026-11-09", lines: 2 });
  });

  it("is null for a file that isn't there or has no list", () => {
    assert.equal(newestReleaseNote(null), null);
    assert.equal(newestReleaseNote("export const X = 1;"), null);
  });
});

describe("countArrayElements", () => {
  it("counts elements, however each is written, and null if it never closes", () => {
    assert.equal(countArrayElements('["a", ["b", "c"], "d\\"e"]', 0), 3);
    assert.equal(countArrayElements('["a" +\n "b", "c",]', 0), 2);
    assert.equal(countArrayElements('[...more, line, "x"]', 0), 3);
    assert.equal(countArrayElements("[]", 0), 0);
    assert.equal(countArrayElements('["a", "b"', 0), null);
  });
});

describe("memberFacingChanges", () => {
  it("keeps shipped code from the apps, the API, the packages and supabase", () => {
    const shipped = [
      "apps/mobile/app/(app)/whats-new.tsx",
      "apps/web/components/x.tsx",
      "apps/api/src/notifications/notify.ts",
      "packages/hooks/src/use-unread.ts",
      "packages/validation/src/notification-categories.ts",
      "supabase/migrations/20261109000000_x.sql",
      "supabase/data-fixes/20261108_fix.sql",
      "supabase/functions/copy-attachment/index.ts",
      "apps/mobile/app.config.js",
      "apps/web/next.config.js",
      "apps/web/tailwind.config.ts",
    ];
    assert.deepEqual(memberFacingChanges(shipped), shipped);
  });

  it("drops tests, test helpers, tool config, docs and the shipped-builds registry", () => {
    assert.deepEqual(
      memberFacingChanges([
        "apps/mobile/lib/whats-new.spec.ts",
        "apps/web/lib/y.test.tsx",
        "apps/api/test/app.e2e-spec.ts",
        "apps/mobile/test/react-native-stub.ts",
        "apps/web/tests/setup.ts",
        "apps/web/e2e/sign-in.ts",
        "apps/mobile/vitest.setup.ts",
        "apps/mobile/vitest.config.ts",
        "apps/web/playwright.config.ts",
        "apps/web/eslint.config.js",
        "apps/web/tsconfig.json",
        "packages/hooks/tsconfig.build.json",
        "apps/api/.prettierrc",
        "packages/eslint-config/base.js",
        "packages/typescript-config/base.json",
        "apps/mobile/README.md",
        "apps/mobile/store/shipped-builds.json",
        "docs/ci-cd/routines.md",
        "scripts/ci/x.mjs",
        "supabase/config.toml",
        "supabase/seed.sql",
        "supabase/seed/chapter_directory.csv",
        RELEASE_NOTES_PATH,
      ]),
      [],
    );
  });
});

describe("releaseNotesVerdict", () => {
  const entry = (date, lines = 8) => ({ date, lines });
  const base = { tag: "v1.2.3", floor: entry("2026-11-07") };
  const app = ["apps/mobile/app/index.tsx"];

  it("warns when members could notice a change and What's new gained nothing", () => {
    const verdict = releaseNotesVerdict({ ...base, ship: entry("2026-11-07"), changedFiles: app });
    assert.equal(verdict.stale, true);
    assert.match(verdict.message, /1 file members could notice changed since v1\.2\.3/);
    assert.match(verdict.message, /no new entry or lines \(newest: 2026-11-07\)/);
  });

  it("warns for a change shipped only through the API, a package or a data fix", () => {
    for (const file of ["apps/api/src/x.ts", "packages/chat-core/src/y.ts", "supabase/data-fixes/z.sql"]) {
      assert.equal(releaseNotesVerdict({ ...base, ship: entry("2026-11-07"), changedFiles: [file] }).stale, true, file);
    }
  });

  it("is quiet when a new entry was added", () => {
    assert.equal(releaseNotesVerdict({ ...base, ship: entry("2026-11-09"), changedFiles: app }).stale, false);
  });

  it("is quiet when the same day's entry gained lines, since dates are unique", () => {
    const verdict = releaseNotesVerdict({ ...base, ship: entry("2026-11-07", 9), changedFiles: app });
    assert.equal(verdict.stale, false);
    assert.match(verdict.message, /new lines in its 2026-11-07 entry/);
  });

  it("still warns when the newest entry was only reworded, which members aren't shown", () => {
    assert.equal(releaseNotesVerdict({ ...base, ship: entry("2026-11-07", 8), changedFiles: app }).stale, true);
  });

  it("warns when the same day's entry got shorter, even with nothing else changed", () => {
    const verdict = releaseNotesVerdict({ ...base, ship: entry("2026-11-07", 6), changedFiles: [] });
    assert.equal(verdict.stale, true);
    assert.match(verdict.message, /fewer than the 8 production shipped/);
  });

  it("is quiet when nothing members could notice changed", () => {
    const verdict = releaseNotesVerdict({ ...base, ship: entry("2026-11-07"), changedFiles: ["apps/mobile/x.spec.ts", "docs/a.md"] });
    assert.equal(verdict.stale, false);
  });

  it("counts a first-ever entry as new when production had none", () => {
    const verdict = releaseNotesVerdict({ tag: "v1.0.0", floor: null, ship: entry("2026-11-07"), changedFiles: ["apps/web/app/page.tsx"] });
    assert.equal(verdict.stale, false);
  });
});

function gitError(status) {
  return Object.assign(new Error(`git exited ${status}`), { status });
}

function fakeGit({ tags = "v1.2.3\nv1.2.2\n", files = {}, diff = "", diffThrows = false, ahead = true } = {}) {
  return (args) => {
    if (args[0] === "tag") return tags;
    if (args[0] === "merge-base") {
      if (ahead === "error") throw gitError(128);
      if (!ahead) throw gitError(1);
      return "";
    }
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

const SHA = "c".repeat(40);
const sameNotes = {
  [`v1.2.3:${RELEASE_NOTES_PATH}`]: notesFile(["2026-11-07"]),
  [`${SHA}:${RELEASE_NOTES_PATH}`]: notesFile(["2026-11-07"]),
};

describe("checkReleaseNotes", () => {
  it("compares the release tag's notes with the deployed commit's", () => {
    const git = fakeGit({ files: sameNotes, diff: "apps/mobile/app/index.tsx\n" });
    assert.equal(checkReleaseNotes({ sha: SHA, git }).stale, true);
  });

  it("reads the tag's notes and the deployed commit's separately", () => {
    const files = {
      [`v1.2.3:${RELEASE_NOTES_PATH}`]: notesFile(["2026-11-07"]),
      [`${SHA}:${RELEASE_NOTES_PATH}`]: notesFile(["2026-11-09"], ["2026-11-07"]),
    };
    const result = checkReleaseNotes({ sha: SHA, git: fakeGit({ files, diff: "apps/mobile/app/index.tsx\n" }) });
    assert.equal(result.stale, false);
    assert.match(result.message, /a new entry \(2026-11-09\)/);
    const longer = {
      [`v1.2.3:${RELEASE_NOTES_PATH}`]: notesFile(["2026-11-07", "a"]),
      [`${SHA}:${RELEASE_NOTES_PATH}`]: notesFile(["2026-11-07", "a", "b"]),
    };
    const appended = checkReleaseNotes({ sha: SHA, git: fakeGit({ files: longer, diff: "apps/mobile/app/index.tsx\n" }) });
    assert.match(appended.message, /new lines in its 2026-11-07 entry/);
  });

  it("skips a commit that isn't ahead of the release tag (a rollback)", () => {
    const git = fakeGit({ files: sameNotes, diff: "apps/mobile/app/index.tsx\n", ahead: false });
    const result = checkReleaseNotes({ sha: SHA, git });
    assert.equal(result.stale, false);
    assert.match(result.skipped, /not ahead of production's v1\.2\.3/);
  });

  it("says it couldn't compare, not that it's a rollback, when git can't tell", () => {
    const result = checkReleaseNotes({ sha: SHA, git: fakeGit({ ahead: "error" }) });
    assert.equal(result.stale, false);
    assert.match(result.skipped, /could not compare/);
  });

  it("skips, never throws, when there is no release tag or git fails", () => {
    assert.match(checkReleaseNotes({ sha: SHA, git: fakeGit({ tags: "" }) }).skipped, /release tag is unknown/);
    assert.match(checkReleaseNotes({ sha: SHA, git: fakeGit({ diffThrows: true }) }).skipped, /could not compare/);
  });
});

describe("runCli", () => {
  it("prints a ::warning:: when stale and always exits 0", () => {
    const lines = [];
    const git = fakeGit({ files: sameNotes, diff: "apps/web/app/page.tsx\n" });
    const code = runCli({ env: { DEPLOY_SHA: SHA }, git, log: (l) => lines.push(l) });
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
    assert.match(step.body, /node (--\S+ )*scripts\/ci\/release-notes-freshness\.mjs/);
    assert.match(step.body, /refs\/tags\/v\*/, "the release tag must be fetched first");
  });

  it("can never stop a deploy", () => {
    const step = validate().find((s) => s.name === STEP);
    assert.match(step.body, /^\s*continue-on-error:\s*true\s*$/m);
  });
});
