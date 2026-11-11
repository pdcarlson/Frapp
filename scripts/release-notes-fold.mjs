#!/usr/bin/env node
// Moves What's new lines waiting in `packages/validation/release-notes/` into
// `RELEASE_NOTES` (`packages/validation/src/release-notes.ts`), so nobody has to
// write the notes at deploy time.
//
// Why lines wait in their own files: the PR that changes what members see is
// the one that knows what changed, so it writes the line. If every PR edited
// the one list, parallel PRs would conflict on it all day; one file per line
// never conflicts. This script, run by `.github/workflows/release-notes-fold.yml`
// after each merge to `main`, folds the waiting lines into the list and deletes
// their files, in a bot PR that merges itself once CI is green.
//
// Where a line goes: the newest entry when it is dated `--date` (default: today,
// UTC) or later, appended after its lines, which the notes file's rule allows
// ("a second release on the same day appends lines"); otherwise a new entry
// dated `--date` at the top. Lines fold in file-name order. A new entry gets a
// plain title; rewording a title or a line later is fine and isn't news.
//
// The notes file is edited as text and keeps `date:` and `changes: [...]`
// literal, one string per line, as `scripts/ci/release-notes-freshness.mjs`
// needs. A waiting line breaking the notes' writing rules fails here, before
// anything is written; `scripts/ci/__tests__/release-notes-fold.test.mjs` runs
// the same check on every PR, so a bad line fails in the PR that adds it.
//
//   node scripts/release-notes-fold.mjs              fold, write, delete files
//   node scripts/release-notes-fold.mjs --check      only check the waiting lines
//   node scripts/release-notes-fold.mjs --date 2026-11-12

import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isInvokedDirectly } from "./ci/lib/invoked-directly.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const LINES_DIR = join(ROOT, "packages/validation/release-notes");
export const NOTES_PATH = join(
  ROOT,
  "packages/validation/src/release-notes.ts",
);
/** The title a new day's entry gets until someone writes a better one. */
export const DEFAULT_TITLE = "New in this update";

// The writing rules `packages/validation/src/release-notes.spec.ts` checks on
// every entry: no emoji, no issue numbers, versions or internal names, no em
// dashes. Kept in step with that spec by hand; both are small.
const EMOJI = /\p{Extended_Pictographic}/u;
const INTERNALS = /#\d|\bv?\d+\.\d+\.\d+\b|signet|\bPR\b|\bOTA\b|\bAPI\b/i;

/** Waiting line files: every `.md` file in the folder except its README. */
export function lineFiles(dir = LINES_DIR) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter(
      (name) => name.endsWith(".md") && name.toLowerCase() !== "readme.md",
    )
    .sort();
}

/** The problem with one line file's text, or `null` when it is a good line. */
export function lineProblem(text) {
  const line = text.trim();
  if (line === "") return "is empty";
  if (line.includes("\n")) return "has more than one line; write one sentence";
  if (EMOJI.test(line)) return "has an emoji";
  if (INTERNALS.test(line))
    return "names an issue number, a version or an internal term";
  if (line.includes("—")) return "has an em dash";
  return null;
}

/** Reads and checks the waiting lines; throws naming every bad file. */
export function readLines(dir = LINES_DIR) {
  const files = lineFiles(dir);
  const problems = [];
  const lines = files.map((name) => {
    const text = readFileSync(join(dir, name), "utf8");
    const problem = lineProblem(text);
    if (problem) problems.push(`${name} ${problem}`);
    return { name, line: text.trim() };
  });
  if (problems.length > 0) {
    throw new Error(
      `What's new lines that break the writing rules:\n- ${problems.join("\n- ")}`,
    );
  }
  return lines;
}

/** Index of the `]` that closes the `[` at `open`, skipping strings and comments. */
function closingBracket(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "/" && source[i + 1] === "/") {
      i = source.indexOf("\n", i);
      if (i === -1) return -1;
    } else if (ch === "/" && source[i + 1] === "*") {
      i = source.indexOf("*/", i + 2);
      if (i === -1) return -1;
      i += 1;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      for (i += 1; i < source.length && source[i] !== ch; i += 1) {
        if (source[i] === "\\") i += 1;
      }
    } else if (ch === "[") {
      depth += 1;
    } else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * The notes source with `lines` folded in under `date` (`YYYY-MM-DD`). Throws
 * when the file isn't the shape it expects, rather than guessing.
 */
export function foldLines(source, lines, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error(`Not a YYYY-MM-DD date: ${date}`);
  if (lines.length === 0) return source;
  const listStart = source.indexOf("RELEASE_NOTES");
  const freeze = source.indexOf("Object.freeze([", listStart);
  if (listStart === -1 || freeze === -1)
    throw new Error("No RELEASE_NOTES list found");
  const listOpen = freeze + "Object.freeze(".length;
  const strings = lines.map((line) => JSON.stringify(line));

  const newest = /date: "(\d{4}-\d{2}-\d{2})"/.exec(source.slice(listOpen));
  if (newest && newest[1] >= date) {
    const at = listOpen + newest.index;
    const changes = source.indexOf("changes: [", at);
    if (changes === -1)
      throw new Error(`The ${newest[1]} entry has no changes list`);
    const close = closingBracket(source, changes + "changes: ".length);
    if (close === -1)
      throw new Error(`The ${newest[1]} entry's changes list never closes`);
    // Insert before the line that holds the closing `]`.
    const lineStart = source.lastIndexOf("\n", close) + 1;
    const added = strings.map((s) => `      ${s},\n`).join("");
    return source.slice(0, lineStart) + added + source.slice(lineStart);
  }

  const entry =
    `  {\n    date: "${date}",\n    title: ${JSON.stringify(DEFAULT_TITLE)},\n    changes: [\n` +
    strings.map((s) => `      ${s},\n`).join("") +
    "    ],\n  },\n";
  const after = source.indexOf("\n", listOpen) + 1;
  return source.slice(0, after) + entry + source.slice(after);
}

export function todayUtc(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function runCli(argv = process.argv.slice(2)) {
  const check = argv.includes("--check");
  const dateAt = argv.indexOf("--date");
  const date = dateAt === -1 ? todayUtc() : argv[dateAt + 1];
  const lines = readLines();
  if (check) {
    console.log(
      `${lines.length} waiting What's new line(s), all following the writing rules.`,
    );
    return 0;
  }
  if (lines.length === 0) {
    console.log("No waiting What's new lines.");
    return 0;
  }
  const source = readFileSync(NOTES_PATH, "utf8");
  writeFileSync(
    NOTES_PATH,
    foldLines(
      source,
      lines.map((l) => l.line),
      date,
    ),
  );
  for (const { name } of lines) rmSync(join(LINES_DIR, name));
  console.log(`Folded ${lines.length} What's new line(s) under ${date}.`);
  return 0;
}

if (isInvokedDirectly(import.meta.url)) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
