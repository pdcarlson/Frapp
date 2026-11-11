// Pins `scripts/release-notes-fold.mjs`: What's new lines wait in their own
// files and a bot folds them into RELEASE_NOTES after each merge. Also checks
// the lines waiting in this checkout, so a bad line fails in the PR that adds it.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_TITLE,
  NOTES_PATH,
  foldLines,
  lineFiles,
  lineProblem,
  readLines,
} from "../../release-notes-fold.mjs";
import { newestReleaseNote } from "../release-notes-freshness.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOW = join(ROOT, ".github", "workflows", "release-notes-fold.yml");

const NOTES = `/** header */
export const RELEASE_NOTES: readonly ReleaseNote[] = Object.freeze([
  {
    date: "2026-11-11",
    title: "Today",
    changes: [
      "First line, with a ] in it.",
      "Second line.",
    ],
  },
  {
    date: "2026-11-10",
    title: "Yesterday",
    changes: ["Old line."],
  },
]);
`;

describe("the lines waiting in this checkout", () => {
  it("each follow the writing rules", () => {
    assert.doesNotThrow(() => readLines());
  });
});

describe("lineProblem", () => {
  it("passes a plain member sentence", () => {
    assert.equal(
      lineProblem("On your phone, polls can allow more than one choice.\n"),
      null,
    );
  });

  it("names what's wrong", () => {
    assert.match(lineProblem("  \n"), /empty/);
    assert.match(lineProblem("One.\nTwo."), /more than one line/);
    assert.match(lineProblem("Fixed #123."), /issue number/);
    assert.match(lineProblem("Now in v1.2.3."), /version/);
    assert.match(lineProblem("A new API."), /internal/);
    assert.match(lineProblem("Fast — really."), /em dash/);
    assert.match(lineProblem("Party \u{1F389}"), /emoji/);
  });
});

describe("lineFiles", () => {
  it("lists .md files other than the README, in name order", () => {
    const dir = mkdtempSync(join(tmpdir(), "notes-"));
    for (const name of ["b.md", "a.md", "README.md", "notes.txt"]) {
      writeFileSync(join(dir, name), "Line.");
    }
    assert.deepEqual(lineFiles(dir), ["a.md", "b.md"]);
  });

  it("is empty when the folder is missing", () => {
    assert.deepEqual(lineFiles(join(tmpdir(), "no-such-folder-here")), []);
  });

  it("readLines refuses a bad line and names its file", () => {
    const dir = mkdtempSync(join(tmpdir(), "notes-"));
    writeFileSync(join(dir, "good.md"), "Fine.");
    writeFileSync(join(dir, "bad.md"), "See #42.");
    assert.throws(() => readLines(dir), /bad\.md/);
  });
});

describe("foldLines", () => {
  it("appends to the newest entry when it is the same day", () => {
    const out = foldLines(NOTES, ['New "quoted" line.'], "2026-11-11");
    assert.deepEqual(newestReleaseNote(out), { date: "2026-11-11", lines: 3 });
    assert.ok(
      out.includes(
        '      "Second line.",\n      "New \\"quoted\\" line.",\n    ],',
      ),
    );
  });

  it("starts a new entry at the top on a later day", () => {
    const out = foldLines(NOTES, ["A.", "B."], "2026-11-12");
    assert.deepEqual(newestReleaseNote(out), { date: "2026-11-12", lines: 2 });
    assert.ok(out.includes(`title: ${JSON.stringify(DEFAULT_TITLE)}`));
    assert.ok(out.indexOf('"2026-11-12"') < out.indexOf('"2026-11-11"'));
  });

  it("keeps newest-first when the clock is behind the newest entry", () => {
    const out = foldLines(NOTES, ["A."], "2026-11-09");
    assert.deepEqual(newestReleaseNote(out), { date: "2026-11-11", lines: 3 });
  });

  it("changes nothing with no lines", () => {
    assert.equal(foldLines(NOTES, [], "2026-11-12"), NOTES);
  });

  it("works on the real notes file, which the deploy check can still read", () => {
    const source = readFileSync(NOTES_PATH, "utf8");
    const before = newestReleaseNote(source);
    const same = foldLines(source, ["A."], before.date);
    assert.deepEqual(newestReleaseNote(same), {
      date: before.date,
      lines: before.lines + 1,
    });
    const next = foldLines(source, ["A."], "2999-01-01");
    assert.deepEqual(newestReleaseNote(next), { date: "2999-01-01", lines: 1 });
  });

  it("refuses a bad date", () => {
    assert.throws(() => foldLines(NOTES, ["A."], "11/12/2026"), /YYYY-MM-DD/);
  });
});

describe("release-notes-fold.yml", () => {
  const text = readFileSync(WORKFLOW, "utf8");

  it("runs after a merge to main that touches the waiting lines", () => {
    assert.match(text, /push:\s*\n\s*branches: \[main\]/);
    assert.match(text, /packages\/validation\/release-notes\/\*\*/);
  });

  it("runs the fold script and pushes only the bot's own branch", () => {
    assert.match(text, /node scripts\/release-notes-fold\.mjs/);
    assert.match(text, /BRANCH: bot\/whats-new/);
  });
});
