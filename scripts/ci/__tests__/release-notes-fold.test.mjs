// Pins `scripts/release-notes-fold.mjs` and its workflow: What's new lines
// wait in their own files and a bot PR folds them into RELEASE_NOTES. Also
// checks the lines waiting in this checkout, so a bad line or a misnamed file
// fails in the PR that adds it.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_TITLE,
  NOTES_PATH,
  closingBracket,
  foldLines,
  lineFiles,
  placeOf,
  readLines,
  runCli,
  todayUtc,
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

/** Evaluates a folded notes file's list, which proves it still parses. */
function parseNotes(source) {
  const list = source.slice(
    source.indexOf("Object.freeze(") + "Object.freeze(".length,
  );
  return new Function(`return (${list.slice(0, list.lastIndexOf(")"))});`)();
}

function scratch(files) {
  const dir = mkdtempSync(join(tmpdir(), "notes-"));
  for (const [name, text] of Object.entries(files))
    writeFileSync(join(dir, name), text);
  return dir;
}

describe("the lines waiting in this checkout", () => {
  it("are all well-named line files that follow the writing rules", () => {
    assert.doesNotThrow(() => readLines());
  });
});

describe("lineFiles and readLines", () => {
  it("list lowercase .md files in name order, skipping the README", () => {
    const dir = scratch({
      "b.md": "B.",
      "a.md": "A.",
      "README.md": "Not a line.",
    });
    assert.deepEqual(lineFiles(dir), { files: ["a.md", "b.md"], stray: [] });
  });

  it("refuse any file that can't be a line file, so it doesn't sit there unread", () => {
    const dir = scratch({
      "ok.md": "Fine.",
      "Polls.MD": "A.",
      "polls.txt": "B.",
      polls: "C.",
    });
    mkdirSync(join(dir, "sub"));
    assert.deepEqual(lineFiles(dir).stray, [
      "Polls.MD",
      "polls",
      "polls.txt",
      "sub",
    ]);
    assert.throws(() => readLines(dir), /Polls\.MD isn't a line file/);
  });

  it("refuse a line that breaks the writing rules, naming its file", () => {
    const dir = scratch({ "good.md": "Fine.", "bad.md": "See #42." });
    assert.throws(() => readLines(dir), /bad\.md names an issue number/);
  });

  it("trim the newline an editor leaves at the end", () => {
    const dir = scratch({ "a.md": "A line.\n" });
    assert.deepEqual(readLines(dir), [
      { name: "a.md", place: "everywhere", line: "A line." },
    ]);
  });

  it("read web/ and phone/ as those places, and refuse anything else in them", () => {
    const dir = scratch({ "a.md": "Both." });
    for (const place of ["web", "phone"]) {
      mkdirSync(join(dir, place));
      writeFileSync(join(dir, place, "b.md"), `Only ${place}.\n`);
    }
    writeFileSync(join(dir, "web", "Bad.txt"), "X.");
    assert.deepEqual(lineFiles(dir), {
      files: ["a.md", "phone/b.md", "web/b.md"],
      stray: ["web/Bad.txt"],
    });
    assert.throws(() => readLines(dir), /web\/Bad\.txt isn't a line file/);
  });

  it("are empty when the folder is missing", () => {
    assert.deepEqual(readLines(join(tmpdir(), "no-such-folder-here")), []);
  });
});

describe("placeOf", () => {
  it("takes the place from the folder, keeping the words", () => {
    assert.deepEqual(placeOf("web/a.md", "On the web, a thing."), {
      place: "web",
      line: "On the web, a thing.",
    });
  });

  it("moves a line written the old way under its heading, without those words", () => {
    assert.deepEqual(placeOf("a.md", "On the web, officers can now X."), {
      place: "web",
      line: "Officers can now X.",
    });
    assert.deepEqual(placeOf("a.md", "On your phone, tap a row."), {
      place: "phone",
      line: "Tap a row.",
    });
    assert.deepEqual(placeOf("a.md", "Polls, on the web and on your phone."), {
      place: "everywhere",
      line: "Polls, on the web and on your phone.",
    });
  });
});

describe("closingBracket", () => {
  it("skips brackets inside strings, escapes and comments", () => {
    const source = `[ "a ] \\" ]", // ] here\n /* ] */ 'b' ]`;
    assert.equal(closingBracket(source, 0), source.length - 1);
  });
});

describe("foldLines", () => {
  it("appends to the newest entry when it is the same day", () => {
    const out = foldLines(NOTES, ['New "quoted" line.'], "2026-11-11");
    assert.deepEqual(newestReleaseNote(out), { date: "2026-11-11", lines: 3 });
    assert.deepEqual(parseNotes(out)[0].changes, [
      "First line, with a ] in it.",
      "Second line.",
      'New "quoted" line.',
    ]);
  });

  it("starts a new entry at the top on a later day", () => {
    const out = foldLines(NOTES, ["A.", "B."], "2026-11-12");
    const notes = parseNotes(out);
    assert.deepEqual(notes[0], {
      date: "2026-11-12",
      title: DEFAULT_TITLE,
      changes: ["A.", "B."],
    });
    assert.equal(notes[1].date, "2026-11-11");
    assert.deepEqual(newestReleaseNote(out), { date: "2026-11-12", lines: 2 });
  });

  it("keeps newest-first when the clock is behind the newest entry", () => {
    assert.deepEqual(
      newestReleaseNote(foldLines(NOTES, ["A."], "2026-11-09")),
      {
        date: "2026-11-11",
        lines: 3,
      },
    );
  });

  it("handles a one-line list, a missing trailing comma and single quotes", () => {
    const tight = NOTES.replace(
      /date: "2026-11-11",[\s\S]*?\],/,
      `date: '2026-11-11',\n    title: "Today",\n    changes: ["Only line."],`,
    );
    assert.deepEqual(
      parseNotes(foldLines(tight, ["A."], "2026-11-11"))[0].changes,
      ["Only line.", "A."],
    );
    const noComma = NOTES.replace('"Second line.",', '"Second line."');
    assert.deepEqual(
      parseNotes(foldLines(noComma, ["A."], "2026-11-11"))[0].changes.slice(1),
      ["Second line.", "A."],
    );
  });

  it("never reaches into an older entry's list", () => {
    const noList = NOTES.replace(
      /changes: \[\n[\s\S]*?\n    \],/,
      "changes: EMPTY,",
    );
    assert.throws(
      () => foldLines(noList, ["A."], "2026-11-11"),
      /no changes list/,
    );
  });

  it("opens a web or phone list on the newest entry when it has none, and appends to one it has", () => {
    let out = foldLines(
      NOTES,
      [
        { place: "phone", line: "P." },
        { place: "web", line: "W." },
        "E.",
      ],
      "2026-11-11",
    );
    let [newest] = parseNotes(out);
    assert.deepEqual(newest.changes.slice(-1), ["E."]);
    assert.deepEqual(newest.web, ["W."]);
    assert.deepEqual(newest.phone, ["P."]);
    assert.deepEqual(Object.keys(newest), ["date", "title", "changes", "web", "phone"]);
    out = foldLines(out, [{ place: "web", line: "W2." }], "2026-11-11");
    [newest] = parseNotes(out);
    assert.deepEqual(newest.web, ["W.", "W2."]);
    assert.deepEqual(newestReleaseNote(out), { date: "2026-11-11", lines: 6 });
    assert.equal(parseNotes(out)[1].web, undefined);
  });

  it("opens phone after web on an entry that has only web", () => {
    const withWeb = foldLines(NOTES, [{ place: "web", line: "W." }], "2026-11-11");
    const [newest] = parseNotes(
      foldLines(withWeb, [{ place: "phone", line: "P." }], "2026-11-11"),
    );
    assert.deepEqual(Object.keys(newest), ["date", "title", "changes", "web", "phone"]);
  });

  it("starts a new entry with only the places it has", () => {
    const [newest] = parseNotes(
      foldLines(NOTES, [{ place: "phone", line: "P." }], "2026-11-12"),
    );
    assert.deepEqual(newest, {
      date: "2026-11-12",
      title: DEFAULT_TITLE,
      changes: [],
      phone: ["P."],
    });
  });

  it("changes nothing with no lines, and refuses a bad date", () => {
    assert.equal(foldLines(NOTES, [], "2026-11-12"), NOTES);
    assert.throws(() => foldLines(NOTES, ["A."], "11/12/2026"), /YYYY-MM-DD/);
  });

  it("works on the real notes file, which the deploy check can still read", () => {
    const source = readFileSync(NOTES_PATH, "utf8");
    const before = newestReleaseNote(source);
    assert.deepEqual(
      newestReleaseNote(foldLines(source, ["A."], before.date)),
      {
        date: before.date,
        lines: before.lines + 1,
      },
    );
    assert.deepEqual(
      newestReleaseNote(foldLines(source, ["A."], "2999-01-01")),
      {
        date: "2999-01-01",
        lines: 1,
      },
    );
  });
});

describe("runCli", () => {
  const setup = () => {
    const dir = scratch({
      "b.md": "B.\n",
      "a.md": "A.\n",
      "README.md": "Readme.",
    });
    const notesPath = join(
      mkdtempSync(join(tmpdir(), "notes-file-")),
      "release-notes.ts",
    );
    writeFileSync(notesPath, NOTES);
    return { dir, notesPath, log: () => {} };
  };

  it("folds web/ and phone/ files into their lists and deletes them", () => {
    const opts = { ...setup(), now: new Date("2026-11-12T03:00:00Z") };
    mkdirSync(join(opts.dir, "web"));
    writeFileSync(join(opts.dir, "web", "c.md"), "C.\n");
    writeFileSync(join(opts.dir, "d.md"), "On your phone, d.\n");
    runCli([], opts);
    const [newest] = parseNotes(readFileSync(opts.notesPath, "utf8"));
    assert.deepEqual(newest.changes, ["A.", "B."]);
    assert.deepEqual(newest.web, ["C."]);
    assert.deepEqual(newest.phone, ["D."]);
    assert.deepEqual(readdirSync(join(opts.dir, "web")), []);
  });

  it("folds under today's UTC date and deletes only the line files", () => {
    const opts = { ...setup(), now: new Date("2026-11-12T03:00:00Z") };
    assert.equal(runCli([], opts), 0);
    const notes = parseNotes(readFileSync(opts.notesPath, "utf8"));
    assert.deepEqual(notes[0], {
      date: "2026-11-12",
      title: DEFAULT_TITLE,
      changes: ["A.", "B."],
    });
    assert.deepEqual(readdirSync(opts.dir), ["README.md"]);
  });

  it("takes --date", () => {
    const opts = setup();
    runCli(["--date", "2026-11-11"], opts);
    assert.deepEqual(
      parseNotes(readFileSync(opts.notesPath, "utf8"))[0].changes.slice(-2),
      ["A.", "B."],
    );
  });

  it("--check reads and writes nothing", () => {
    const opts = setup();
    runCli(["--check"], opts);
    assert.equal(readFileSync(opts.notesPath, "utf8"), NOTES);
    assert.ok(existsSync(join(opts.dir, "a.md")));
  });

  it("todayUtc is the UTC day", () => {
    assert.equal(todayUtc(new Date("2026-11-12T23:30:00-05:00")), "2026-11-13");
  });
});

describe("release-notes-fold.yml", () => {
  const text = readFileSync(WORKFLOW, "utf8");
  // One step's text: from its `- name:` line to the next step's.
  const step = (name) => {
    const start = text.indexOf(`      - name: ${name}\n`);
    assert.notEqual(start, -1, `no step named ${name}`);
    const next = text.indexOf("\n      - name: ", start + 1);
    return text.slice(start, next === -1 ? undefined : next);
  };

  it("runs when a line file or the notes change on main", () => {
    assert.match(text, /push:\s*\n\s*branches: \[main\]/);
    assert.match(text, /"packages\/validation\/release-notes\/\*\*"/);
    assert.match(text, /"packages\/validation\/src\/release-notes\.ts"/);
  });

  it("turns on squash auto-merge for the bot PR (Paul, 2026-11-12)", () => {
    assert.match(text, /AUTO_MERGE: "true"/);
    assert.match(step("Push the fold and open its PR"), /gh pr merge "\$PR" --repo "\$GITHUB_REPOSITORY" --auto --squash/);
  });

  it("finds its PR by owner and branch, never a fork's same-named branch", () => {
    assert.match(
      step("Fold the waiting lines"),
      /head=\$\{GITHUB_REPOSITORY_OWNER\}:\$\{BRANCH\}/,
    );
    assert.match(text, /BRANCH: bot\/whats-new/);
  });

  it("pushes, opens and closes with the App token, which starts CI", () => {
    for (const name of [
      "Push the fold and open its PR",
      "Close the bot PR when nothing is waiting",
    ]) {
      assert.match(
        step(name),
        /GH_TOKEN: \$\{\{ steps\.app-token\.outputs\.token \}\}/,
      );
    }
    assert.match(
      step("Push the fold and open its PR"),
      /git push --force .*HEAD:refs\/heads\/\$\{BRANCH\}/,
    );
    assert.match(
      step("Fold the waiting lines"),
      /node scripts\/release-notes-fold\.mjs/,
    );
  });
});
