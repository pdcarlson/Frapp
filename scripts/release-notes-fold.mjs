#!/usr/bin/env node
// Folds the What's new lines waiting in `packages/validation/release-notes/`
// into `RELEASE_NOTES` and deletes their files. Why lines wait in files, and
// how the What's new fold workflow uses this: that folder's README.
//
// Where a line goes: the newest entry when it is dated `--date` (default:
// today, UTC) or later, after its last line, which the notes file's rule
// allows ("a second release on the same day appends lines"); otherwise a new
// entry dated `--date` at the top, under a plain title anyone may reword.
// Lines fold in file-name order.
//
// The notes file is edited as text, keeping `date:` and `changes: [...]`
// literal, one string per line, as `scripts/ci/release-notes-freshness.mjs`
// reads it. A line is written with `JSON.stringify`, so no line text can end
// the string it sits in. The writing rules are the notes file's own
// `releaseNoteLineProblem`; a bad or misnamed line file fails here before
// anything is written, and on every PR through
// `scripts/ci/__tests__/release-notes-fold.test.mjs`.
//
//   node scripts/release-notes-fold.mjs              fold, write, delete files
//   node scripts/release-notes-fold.mjs --check      only check the waiting lines
//   node scripts/release-notes-fold.mjs --date 2026-11-12

import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { releaseNoteLineProblem } from "../packages/validation/src/release-notes.ts";
import { isInvokedDirectly } from "./ci/lib/invoked-directly.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const LINES_DIR = join(ROOT, "packages/validation/release-notes");
export const NOTES_PATH = join(
  ROOT,
  "packages/validation/src/release-notes.ts",
);
/** The title a new entry gets until someone writes a better one. */
export const DEFAULT_TITLE = "New in this update";
/** A line file's name: lowercase, ending `.md`. */
const LINE_FILE = /^[a-z0-9][a-z0-9._-]*\.md$/;

/**
 * The folder's line files in name order, and the names that can't be one
 * (another extension, upper case, a subfolder), which would otherwise sit
 * there unread while their author thinks the line is in.
 */
export function lineFiles(dir = LINES_DIR) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return { files: [], stray: [] };
  }
  const files = [];
  const stray = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name === "README.md") continue;
    if (entry.isFile() && LINE_FILE.test(entry.name)) files.push(entry.name);
    else stray.push(entry.name);
  }
  return { files: files.sort(), stray: stray.sort() };
}

/** Reads and checks the waiting lines; throws naming every bad file. */
export function readLines(dir = LINES_DIR) {
  const { files, stray } = lineFiles(dir);
  const problems = stray.map(
    (name) =>
      `${name} isn't a line file: name it like \`short-name.md\`, lowercase`,
  );
  const lines = files.map((name) => {
    const text = readFileSync(join(dir, name), "utf8");
    const problem = releaseNoteLineProblem(text);
    if (problem) problems.push(`${name} ${problem}`);
    return { name, line: text.trim() };
  });
  if (problems.length > 0) {
    throw new Error(
      `What's new line files that need fixing:\n- ${problems.join("\n- ")}`,
    );
  }
  return lines;
}

/** Index of the `]` that closes the `[` at `open`, skipping strings and comments. */
export function closingBracket(source, open) {
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

const DATE = /\bdate:\s*["'](\d{4}-\d{2}-\d{2})["']/g;
const CHANGES = /\bchanges:\s*\[/g;

/**
 * The notes source with `lines` folded in under `date` (`YYYY-MM-DD`). Throws
 * when the file isn't the shape it expects, rather than guessing.
 */
export function foldLines(source, lines, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Not a YYYY-MM-DD date: ${date}`);
  }
  if (lines.length === 0) return source;
  const freeze = source.indexOf(
    "Object.freeze([",
    source.indexOf("RELEASE_NOTES"),
  );
  if (freeze === -1) throw new Error("No RELEASE_NOTES list found");
  const listOpen = freeze + "Object.freeze(".length;
  const strings = lines.map((line) => `      ${JSON.stringify(line)},`);

  DATE.lastIndex = listOpen;
  const newest = DATE.exec(source);
  if (newest && newest[1] >= date) {
    // The newest entry runs to the next entry's date, or the end of the list.
    const next = DATE.exec(source);
    const entryEnd = next ? next.index : source.length;
    CHANGES.lastIndex = newest.index;
    const changes = CHANGES.exec(source);
    if (!changes || changes.index >= entryEnd) {
      throw new Error(`The ${newest[1]} entry has no changes list`);
    }
    const open = changes.index + changes[0].length - 1;
    const close = closingBracket(source, open);
    if (close === -1 || close >= entryEnd) {
      throw new Error(`The ${newest[1]} entry's changes list never closes`);
    }
    // After the last element (or the `[` of an empty list), adding the comma
    // that element may lack; the `]` moves to a line of its own if it shared one.
    let last = close - 1;
    while (/\s/.test(source[last])) last -= 1;
    const comma = source[last] === "," || source[last] === "[" ? "" : ",";
    const sameLine = !source.slice(last + 1, close).includes("\n");
    return (
      source.slice(0, last + 1) +
      comma +
      "\n" +
      strings.join("\n") +
      (sameLine ? "\n    " : "") +
      source.slice(last + 1)
    );
  }

  const entry =
    `  {\n    date: "${date}",\n    title: ${JSON.stringify(DEFAULT_TITLE)},\n    changes: [\n` +
    `${strings.join("\n")}\n    ],\n  },\n`;
  const after = source.indexOf("\n", listOpen) + 1;
  return source.slice(0, after) + entry + source.slice(after);
}

export function todayUtc(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function runCli(
  argv = process.argv.slice(2),
  {
    dir = LINES_DIR,
    notesPath = NOTES_PATH,
    now = new Date(),
    log = console.log,
  } = {},
) {
  const dateAt = argv.indexOf("--date");
  const date = dateAt === -1 ? todayUtc(now) : argv[dateAt + 1];
  const lines = readLines(dir);
  if (argv.includes("--check")) {
    log(
      `${lines.length} waiting What's new line(s), all following the writing rules.`,
    );
    return 0;
  }
  if (lines.length === 0) {
    log("No waiting What's new lines.");
    return 0;
  }
  const source = readFileSync(notesPath, "utf8");
  writeFileSync(
    notesPath,
    foldLines(
      source,
      lines.map((l) => l.line),
      date,
    ),
  );
  for (const { name } of lines) rmSync(join(dir, name));
  log(`Folded ${lines.length} What's new line(s) under ${date}.`);
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
