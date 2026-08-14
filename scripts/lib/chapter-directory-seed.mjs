// Shared reader + validator for supabase/seed/chapter_directory.csv.
//
// One implementation, three consumers, deliberately:
//   * scripts/check-chapter-directory-seed.mjs — the CI gate (no database)
//   * scripts/load-chapter-directory.mjs       — the loader (needs a database)
//   * scripts/check-pglite-migrations.mjs      — the CI job that HAS a database
//
// They must agree on what a valid row is. A validator that accepts a row the
// loader then rejects (or vice versa) is worse than no validator, so the parse
// and the rules live here and nowhere else.
//
// Why a module and not `supabase/seed.sql`: the CSV is the source of truth and
// #232 grows it to ~2,000 rows. Consuming it from seed.sql would mean either
// `\copy` (a psql meta-command resolving paths against the caller's cwd — the
// fragility class PR #801 spent four review rounds removing) or inlining every
// row, which duplicates the source of truth and does not scale.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Canonical location of the seed, relative to the repo root. */
export const SEED_RELATIVE_PATH = join(
  "supabase",
  "seed",
  "chapter_directory.csv",
);

/**
 * The archetype values a row may carry. Mirrors the `ArchetypeKey` union at
 * packages/org-archetypes/src/index.ts. Kept as a literal rather than imported
 * because this module is plain ESM run by node directly (no TS transform, no
 * workspace build step) and must work from a bare `node scripts/...` in a
 * bootstrap script before anything is built.
 *
 * If ArchetypeKey gains a member, add it here — the validator failing on a
 * legitimate new archetype is the intended way to notice the drift.
 */
export const VALID_ARCHETYPES = Object.freeze([
  "ifc",
  "npc",
  "nphc",
  "mgc",
  "professional",
  "service",
  "honor",
  "colony",
]);

/**
 * Canonical hex form: `#` + exactly six UPPERCASE hex digits.
 *
 * Deliberately stricter than `packages/chapter-theme`'s HEX_RE, which also
 * accepts the 3-digit shorthand and either case. That looseness is right for
 * runtime input (chapters type their own colors); it is wrong for a checked-in
 * data file, where one canonical spelling keeps diffs honest and matches what
 * derivePalette normalises to internally via `.toUpperCase()`.
 */
export const CANONICAL_HEX_RE = /^#[0-9A-F]{6}$/;

/** The header this file must carry, in this order. */
export const EXPECTED_HEADER = Object.freeze([
  "org_letters",
  "org_name",
  "archetype",
  "chapter_designation",
  "university",
  "university_short",
  "founded_year",
  "default_colors",
  "website",
  "source",
]);

/**
 * RFC 4180 CSV reader.
 *
 * Hand-rolled rather than pulled from npm because both bootstrap scripts run
 * this before `npm install` is guaranteed to have happened, so it cannot
 * depend on node_modules. The grammar it needs is small and fully covered by
 * the seed: quoted fields, embedded commas, and `""` as an escaped quote —
 * `default_colors` uses all three at once.
 *
 * Returns rows of raw string cells. Blank trailing lines are dropped; a blank
 * line in the middle is preserved as an empty row so the caller can report its
 * line number rather than silently renumbering everything after it.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // `""` inside a quoted field is a literal quote, not the terminator.
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // Swallow CR so CRLF files parse identically to LF ones.
      i += 1;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // A file not ending in a newline still has a final row pending.
  if (field !== "" || row.length > 0) pushRow();

  // Drop trailing empty rows produced by a file-final newline (or several). Only
  // trailing ones: a blank line in the middle survives as an empty row, so loadSeed
  // reports its real line number instead of silently renumbering everything after it.
  while (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === "") rows.pop();
    else break;
  }

  return rows;
}

/**
 * The identity that makes loading idempotent.
 *
 * A directory entry is one organisation at one campus, so the natural key is
 * (org_letters, university, chapter_designation). `chapter_designation` is
 * nullable in the schema, and two rows for the same org+campus with no
 * designation are the same row — NULL is normalised to the empty string here
 * so they collide in the dedupe check rather than slipping through as two
 * "distinct" NULLs (SQL's NULL != NULL would otherwise let a unique index miss
 * them too).
 */
export function rowKey(row) {
  // JSON.stringify rather than joining on a separator character. Any plausible
  // printable separator can legitimately occur inside a university name, so a
  // naive join invents false duplicates: ["A B", "C"] and ["A", "B C"] collapse
  // to the same key. JSON quotes and escapes each part, so the encoding is
  // unambiguous — and unlike a control-character separator it stays printable,
  // which keeps this file a text diff instead of a blob git refuses to show.
  return JSON.stringify([
    row.org_letters,
    row.university,
    row.chapter_designation ?? "",
  ]);
}

/**
 * Parse the seed into typed records, collecting every problem rather than
 * throwing on the first. Callers decide whether problems are fatal.
 *
 * @returns {{rows: object[], problems: {line: number, field: string, message: string}[]}}
 */
export function loadSeed(repoRoot) {
  const path = join(repoRoot, SEED_RELATIVE_PATH);
  const text = readFileSync(path, "utf8");
  const table = parseCsv(text);
  const problems = [];
  const rows = [];

  if (table.length === 0) {
    problems.push({ line: 0, field: "-", message: "seed file is empty" });
    return { rows, problems };
  }

  const header = table[0];
  if (header.length !== EXPECTED_HEADER.length ||
      !EXPECTED_HEADER.every((h, idx) => header[idx] === h)) {
    problems.push({
      line: 1,
      field: "-",
      message:
        `header mismatch\n  expected: ${EXPECTED_HEADER.join(",")}\n  actual:   ${header.join(",")}`,
    });
    // Without a trustworthy header the column offsets below are meaningless.
    return { rows, problems };
  }

  const seen = new Map();

  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    const line = r + 1; // 1-based, counting the header
    const at = (field, message) => problems.push({ line, field, message });

    if (cells.length !== EXPECTED_HEADER.length) {
      at("-", `expected ${EXPECTED_HEADER.length} columns, found ${cells.length}`);
      continue;
    }

    const [
      org_letters,
      org_name,
      archetype,
      chapter_designation,
      university,
      university_short,
      founded_year,
      default_colors,
      website,
      source,
    ] = cells;

    // NOT NULL columns per the migration. Empty string is absence, not a value.
    for (const [field, value] of [
      ["org_letters", org_letters],
      ["org_name", org_name],
      ["archetype", archetype],
      ["university", university],
      ["university_short", university_short],
      ["source", source],
    ]) {
      if (value.trim() === "") at(field, "required, but empty");
    }

    if (!VALID_ARCHETYPES.includes(archetype)) {
      at(
        "archetype",
        `"${archetype}" is not an ArchetypeKey (expected one of: ${VALID_ARCHETYPES.join(", ")})`,
      );
    }

    let year = null;
    if (founded_year.trim() !== "") {
      // Reject "1885.0" and "18a5" — Number.parseInt would accept both.
      if (!/^\d{3,4}$/.test(founded_year.trim())) {
        at("founded_year", `"${founded_year}" is not a plain 3-4 digit year`);
      } else {
        year = Number(founded_year);
      }
    }

    let colors = null;
    if (default_colors.trim() === "") {
      at("default_colors", "required, but empty");
    } else {
      try {
        colors = JSON.parse(default_colors);
      } catch (err) {
        at("default_colors", `not valid JSON: ${err.message}`);
      }
    }

    if (colors !== null) {
      if (typeof colors !== "object" || Array.isArray(colors)) {
        at("default_colors", "must be a JSON object");
      } else {
        // This is the check the whole gate exists for: issue #840 shipped with
        // 50 of 100 values missing the leading `#`, which degrades silently to
        // bronze inside derivePalette rather than failing.
        for (const key of ["dark", "accent"]) {
          const value = colors[key];
          if (typeof value !== "string") {
            at("default_colors", `missing "${key}"`);
          } else if (!CANONICAL_HEX_RE.test(value)) {
            at(
              "default_colors",
              `"${key}":"${value}" is not canonical #RRGGBB (uppercase). ` +
                (/^[0-9A-Fa-f]{6}$/.test(value)
                  ? "It is missing the leading '#'."
                  : /^#[0-9A-Fa-f]{6}$/.test(value)
                    ? "It must be uppercase."
                    : "Expected '#' followed by six hex digits."),
            );
          }
        }
      }
    }

    const row = {
      org_letters,
      org_name,
      archetype,
      chapter_designation: chapter_designation.trim() === "" ? null : chapter_designation,
      university,
      university_short,
      founded_year: year,
      default_colors: colors,
      website: website.trim() === "" ? null : website,
      source,
    };

    const key = rowKey(row);
    if (seen.has(key)) {
      at(
        "-",
        `duplicate of line ${seen.get(key)} — same (org_letters, university, chapter_designation). ` +
          "Loading is keyed on that triple, so one of these would silently overwrite the other.",
      );
    } else {
      seen.set(key, line);
    }

    rows.push(row);
  }

  return { rows, problems };
}
