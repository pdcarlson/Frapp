#!/usr/bin/env node
// Prints What's new for beta testers, from the same list the apps show
// (packages/validation/src/release-notes.ts), ready to paste:
//
//   npm run -s release-notes            the newest entry
//   npm run -s release-notes -- --all   every entry, newest first
//
// The first block is the whole entry, for a group chat. When the entry has
// web-only lines, a second block leaves them out: paste that one into
// TestFlight's "What to Test" and Play Console's "Release notes", which only
// phone testers read. Play caps a language's notes at 500 characters, so the
// script says when the store block is longer and prints a short version to
// use there (the title plus as many lines as fit).
import {
  RELEASE_NOTES,
  releaseNoteGroups,
  releaseNoteText,
} from "../packages/validation/src/release-notes.ts";

const PLAY_LIMIT = 500;

const all = process.argv.includes("--all");
const notes = all ? RELEASE_NOTES : RELEASE_NOTES.slice(0, 1);
if (notes.length === 0) {
  console.error(
    "No release notes yet: add a line as a file in packages/validation/release-notes/ (its README says how).",
  );
  process.exit(1);
}

console.log(notes.map((note) => releaseNoteText(note)).join("\n\n"));

if (!all) {
  const [note] = notes;
  const phone = ["everywhere", "phone"];
  const store = releaseNoteText(note, phone);
  if (note.web?.length) {
    console.log(
      "\n---- TestFlight and Google Play (leaves out the web-only lines) ----\n",
    );
    console.log(store);
  }
  if (store.length > PLAY_LIMIT) {
    // Lines in the order the block shows them, until the next would not fit.
    let short = { ...note, changes: [], web: [], phone: [] };
    for (const group of releaseNoteGroups(note, phone)) {
      const key = group.place === "everywhere" ? "changes" : group.place;
      let full = false;
      for (const change of group.lines) {
        const next = { ...short, [key]: [...short[key], change] };
        if (releaseNoteText(next, phone).length > PLAY_LIMIT) {
          full = true;
          break;
        }
        short = next;
      }
      if (full) break;
    }
    console.log(
      `\n---- Google Play (the store block is ${store.length} characters; Play takes ${PLAY_LIMIT}) ----\n`,
    );
    console.log(releaseNoteText(short, phone));
  }
}
