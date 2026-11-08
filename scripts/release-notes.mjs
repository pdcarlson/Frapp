#!/usr/bin/env node
// Prints What's new for beta testers, from the same list the apps show
// (packages/validation/src/release-notes.ts), ready to paste:
//
//   npm run -s release-notes            the newest entry
//   npm run -s release-notes -- --all   every entry, newest first
//
// Paste the same block into TestFlight's "What to Test" and Play Console's
// "Release notes". Play caps a language's notes at 500 characters, so the
// script says when the block is longer and prints a short version to use
// there (the title plus as many lines as fit).
import {
  RELEASE_NOTES,
  releaseNoteText,
} from "../packages/validation/src/release-notes.ts";

const PLAY_LIMIT = 500;

const all = process.argv.includes("--all");
const notes = all ? RELEASE_NOTES : RELEASE_NOTES.slice(0, 1);
if (notes.length === 0) {
  console.error(
    "No release notes yet: add one to packages/validation/src/release-notes.ts.",
  );
  process.exit(1);
}

console.log(notes.map(releaseNoteText).join("\n\n"));

if (!all) {
  const [note] = notes;
  const full = releaseNoteText(note);
  if (full.length > PLAY_LIMIT) {
    let short = { ...note, changes: [] };
    for (const change of note.changes) {
      const next = { ...short, changes: [...short.changes, change] };
      if (releaseNoteText(next).length > PLAY_LIMIT) break;
      short = next;
    }
    console.log(
      `\n---- Google Play (the block above is ${full.length} characters; Play takes ${PLAY_LIMIT}) ----\n`,
    );
    console.log(releaseNoteText(short));
  }
}
