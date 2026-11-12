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
// Which list it joins is its folder: `web/` and `phone/` hold lines only true
// there, the folder itself lines true on both (`changes`); the notes file's
// `RELEASE_NOTE_PLACES` owns the places and their order. A line in `web/` or
// `phone/` that still opens "On the web, " or "On your phone, " loses those
// words, since the subheading says it. A line at the top written the old way
// (the rule before the split) moves when it opens with its place: "On the
// web, " to `web` and "On your phone, " to `phone` without those words, and
// "On Android, ", "On iPhone, " or "On iOS, " to `phone` keeping them. One
// that names its place mid-sentence stays with the lines for both, words
// intact, which still reads true there.
//
// The notes file is edited as text, keeping `date:` and `changes: [...]`,
// `web: [...]` and `phone: [...]` literal, one string per line, as
// `scripts/ci/release-notes-freshness.mjs` reads it. A line is written with `JSON.stringify`, so no line text can end
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

import {
  RELEASE_NOTE_PLACES,
  releaseNoteLineProblem,
} from "../packages/validation/src/release-notes.ts";
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

/** The folders that hold one place's lines: `web/`, `phone/`. */
const PLACE_FOLDERS = new Set(
  RELEASE_NOTE_PLACES.filter(({ place }) => place !== "everywhere").map(
    ({ key }) => key,
  ),
);
/** The opening that names a place, which its folder or subheading now says. */
const OWN_PREFIX = Object.freeze({
  web: "On the web, ",
  phone: "On your phone, ",
});
/** Old-way openings that name a phone without being the whole phone app. */
const KEPT_PHONE_PREFIX = /^On (Android|iPhone|iOS), /;

function readDir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * The line files in name order, as paths under `dir` (`a.md`, `web/b.md`),
 * and the names that can't be one (another extension, upper case, a folder
 * other than `web/` and `phone/`), which would otherwise sit there unread
 * while their author thinks the line is in.
 */
export function lineFiles(dir = LINES_DIR) {
  const files = [];
  const stray = [];
  for (const entry of readDir(dir)) {
    if (entry.isFile() && entry.name === "README.md") continue;
    if (entry.isFile() && LINE_FILE.test(entry.name)) files.push(entry.name);
    else if (entry.isDirectory() && PLACE_FOLDERS.has(entry.name)) {
      for (const inner of readDir(join(dir, entry.name))) {
        const name = `${entry.name}/${inner.name}`;
        if (inner.isFile() && LINE_FILE.test(inner.name)) files.push(name);
        else stray.push(name);
      }
    } else stray.push(entry.name);
  }
  return { files: files.sort(), stray: stray.sort() };
}

/** `text` without `prefix`, its first word capitalised unless it is "iPhone"-like. */
function withoutPrefix(text, prefix) {
  const rest = text.slice(prefix.length);
  return /^[a-z](?![A-Z])/.test(rest)
    ? rest[0].toUpperCase() + rest.slice(1)
    : rest;
}

/** A line file's place and text, from its folder or an old-style opening. */
export function placeOf(name, text) {
  const folder = name.includes("/") ? name.slice(0, name.indexOf("/")) : null;
  if (folder) {
    const prefix = OWN_PREFIX[folder];
    const line =
      prefix && text.startsWith(prefix) && text.length > prefix.length
        ? withoutPrefix(text, prefix)
        : text;
    return { place: folder, line };
  }
  for (const [place, prefix] of Object.entries(OWN_PREFIX)) {
    if (text.startsWith(prefix) && text.length > prefix.length) {
      return { place, line: withoutPrefix(text, prefix) };
    }
  }
  if (KEPT_PHONE_PREFIX.test(text)) return { place: "phone", line: text };
  return { place: "everywhere", line: text };
}

/**
 * What's wrong with a line for its place, or `null`: a `web/` or `phone/`
 * line that still names its own place where the subheading would say it.
 */
function placeProblem({ place, line }) {
  if (place === "web" && /^on the web\b/i.test(line)) {
    return 'opens "On the web": the Web subheading says it, so start with what changed';
  }
  if (place === "phone" && /^on your phone\b/i.test(line)) {
    return 'opens "On your phone": the Mobile subheading says it, so start with what changed';
  }
  return null;
}

/** Reads and checks the waiting lines; throws naming every bad file. */
export function readLines(dir = LINES_DIR) {
  const { files, stray } = lineFiles(dir);
  const problems = stray.map(
    (name) =>
      `${name} isn't a line file: name it like \`short-name.md\`, lowercase, at the top or in web/ or phone/`,
  );
  const lines = files.map((name) => {
    const text = readFileSync(join(dir, name), "utf8");
    const placed = placeOf(name, text.trim());
    const problem = releaseNoteLineProblem(text) ?? placeProblem(placed);
    if (problem) problems.push(`${name} ${problem}`);
    return { name, ...placed };
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

/** `lines` as `{place, line}`; a bare string is a line for both. */
function byPlace(lines) {
  const groups = Object.fromEntries(
    RELEASE_NOTE_PLACES.map(({ place }) => [place, []]),
  );
  for (const item of lines) {
    const { place, line } =
      typeof item === "string" ? { place: "everywhere", line: item } : item;
    if (!groups[place]) throw new Error(`Not a place: ${place}`);
    groups[place].push(line);
  }
  return groups;
}

const quoted = (lines) => lines.map((line) => `      ${JSON.stringify(line)},`);

/** Where the list `key: [` opens and closes inside `[from, to)`, or null. */
function listIn(source, key, from, to) {
  const pattern = new RegExp(`\\b${key}:\\s*\\[`, "g");
  pattern.lastIndex = from;
  const found = pattern.exec(source);
  if (!found || found.index >= to) return null;
  const open = found.index + found[0].length - 1;
  const close = closingBracket(source, open);
  if (close === -1 || close >= to) {
    throw new Error(`A ${key} list never closes`);
  }
  return { open, close };
}

/** `source` with `strings` after the last element of the list closing at `close`. */
function appendTo(source, close, strings) {
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

/**
 * The notes source with `lines` folded in under `date` (`YYYY-MM-DD`). Each
 * line is `{place, line}` (`everywhere`, `web` or `phone`), or a string for a
 * line true on both. Throws when the file isn't the shape it expects, rather
 * than guessing.
 */
export function foldLines(source, lines, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Not a YYYY-MM-DD date: ${date}`);
  }
  if (lines.length === 0) return source;
  const groups = byPlace(lines);
  const freeze = source.indexOf(
    "Object.freeze([",
    source.indexOf("RELEASE_NOTES"),
  );
  if (freeze === -1) throw new Error("No RELEASE_NOTES list found");
  const listOpen = freeze + "Object.freeze(".length;

  DATE.lastIndex = listOpen;
  const newest = DATE.exec(source);
  if (newest && newest[1] >= date) {
    let out = source;
    // One place at a time, finding the entry again after each edit.
    RELEASE_NOTE_PLACES.forEach(({ place, key }, index) => {
      if (groups[place].length === 0) return;
      const start = newest.index;
      DATE.lastIndex = start + 1;
      const next = DATE.exec(out);
      const end = next ? next.index : out.length;
      if (!listIn(out, "changes", start, end)) {
        throw new Error(`The ${newest[1]} entry has no changes list`);
      }
      const list = listIn(out, key, start, end);
      if (list) {
        out = appendTo(out, list.close, quoted(groups[place]));
        return;
      }
      // No list for this place yet: open one after the last list before it.
      const after = RELEASE_NOTE_PLACES.slice(0, index)
        .map((earlier) => listIn(out, earlier.key, start, end)?.close ?? -1)
        .reduce((a, b) => Math.max(a, b), -1);
      const comma = out[after + 1] === "," ? after + 2 : after + 1;
      out =
        out.slice(0, comma) +
        `${out[after + 1] === "," ? "" : ","}\n    ${key}: [\n${quoted(groups[place]).join("\n")}\n    ],` +
        out.slice(comma);
    });
    return out;
  }

  // `changes` always, even empty, since the deploy check and the type expect it.
  const lists = RELEASE_NOTE_PLACES.filter(
    ({ place, key }) => key === "changes" || groups[place].length > 0,
  ).map(
    ({ place, key }) =>
      `    ${key}: [\n${quoted(groups[place])
        .map((l) => `${l}\n`)
        .join("")}    ],\n`,
  );
  const entry =
    `  {\n    date: "${date}",\n    title: ${JSON.stringify(DEFAULT_TITLE)},\n` +
    `${lists.join("")}  },\n`;
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
      lines.map(({ place, line }) => ({ place, line })),
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
