import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { EXPECTED_HEADER, parseCsv } from "../../lib/chapter-directory-seed.mjs";

// Direct coverage for the hand-rolled RFC 4180 reader behind the required
// `chapter-directory-seed` CI job.
//
// It had none before #1225. The grammar was exercised only incidentally, by the
// real seed flowing through `npm run check:chapter-directory-seed` on every PR —
// and `default_colors` happened to use every branch at once, because
// `{"dark":"#…","accent":"#…"}` is a quoted field containing both an embedded
// comma and escaped quotes.
//
// #1225 dropped the dead `dark` half, which removed the only embedded comma in
// the file. The comma branch would have gone from "covered by accident" to
// "covered by nothing", so it is covered on purpose here instead. Data-shaped
// coverage is worth exactly as much as the data's current shape; that is the
// lesson worth keeping, not the fixture.

const SEED_PATH = fileURLToPath(
  new URL("../../../supabase/seed/chapter_directory.csv", import.meta.url),
);

test("parses a quoted field containing an embedded comma", () => {
  // The branch #1225 stopped exercising with real data.
  assert.deepEqual(parseCsv('a,"b,c",d\n'), [["a", "b,c", "d"]]);
});

test('parses `""` as one literal quote inside a quoted field', () => {
  assert.deepEqual(parseCsv('a,"say ""hi""",b\n'), [["a", 'say "hi"', "b"]]);
});

test("parses a quoted JSON object using both branches at once", () => {
  // The exact shape `default_colors` carried before #1225, kept as a fixture so
  // the reader stays proven against it even though the file no longer has one.
  const [row] = parseCsv('x,"{""dark"":""#4B0082"",""accent"":""#C9A56F""}",y\n');
  assert.equal(row[1], '{"dark":"#4B0082","accent":"#C9A56F"}');
  assert.deepEqual(JSON.parse(row[1]), { dark: "#4B0082", accent: "#C9A56F" });
});

test("parses the single-key shape the seed carries today", () => {
  const [row] = parseCsv('x,"{""accent"":""#C9A56F""}",y\n');
  assert.deepEqual(JSON.parse(row[1]), { accent: "#C9A56F" });
});

test("treats CRLF identically to LF", () => {
  assert.deepEqual(parseCsv("a,b\r\nc,d\r\n"), parseCsv("a,b\nc,d\n"));
});

test("keeps a final row on a file with no trailing newline", () => {
  assert.deepEqual(parseCsv("a,b\nc,d"), [
    ["a", "b"],
    ["c", "d"],
  ]);
});

test("drops trailing blank lines but keeps a blank line in the middle", () => {
  // loadSeed reports real line numbers, so an interior blank row must survive
  // rather than silently renumbering everything after it.
  assert.deepEqual(parseCsv("a\n\nb\n\n\n"), [["a"], [""], ["b"]]);
});

test("the shipped seed parses to the expected header and the Wikipedia build's rows", () => {
  // Thousands of rows since #232 replaced the 50-row hand-written seed. The
  // floor catches a build that silently read almost nothing.
  const rows = parseCsv(readFileSync(SEED_PATH, "utf8"));
  assert.deepEqual(rows[0], [...EXPECTED_HEADER]);
  assert.ok(rows.length - 1 > 5000, `only ${rows.length - 1} rows`);
  for (const [i, row] of rows.entries()) {
    assert.equal(row.length, EXPECTED_HEADER.length, `row ${i} column count`);
  }
});

test("every seeded default_colors holds accent and nothing else (#1225)", () => {
  // The regression guard for #1225: `dark` was write-only data that a required
  // CI gate still validated. Re-adding it should fail here, not sit unread.
  const rows = parseCsv(readFileSync(SEED_PATH, "utf8"));
  const colorsIndex = EXPECTED_HEADER.indexOf("default_colors");

  for (const row of rows.slice(1)) {
    const colors = JSON.parse(row[colorsIndex]);
    assert.deepEqual(Object.keys(colors), ["accent"], row[0]);
    assert.match(colors.accent, /^#[0-9A-F]{6}$/);
  }
});

test("the seed has the RPI chapter the first seed got wrong, findable by its school's names", () => {
  // The hand-written seed listed Phi Gamma Delta at RPI as "Pi Tau", a chapter
  // that doesn't exist, and stored the school only as "RPI" (2026-11-06).
  const rows = parseCsv(readFileSync(SEED_PATH, "utf8"));
  const at = (name) => EXPECTED_HEADER.indexOf(name);
  const tauNu = rows.find(
    (r) => r[at("org_name")] === "Phi Gamma Delta" && r[at("chapter_designation")] === "Tau Nu",
  );
  assert.ok(tauNu, "Tau Nu missing");
  assert.equal(tauNu[at("university")], "Rensselaer Polytechnic Institute");
  assert.equal(tauNu[at("university_short")], "RPI");
  assert.deepEqual(tauNu[at("aliases")].split("|").sort(), ["RPI", "Rensselaer"]);
  assert.deepEqual(tauNu[at("org_aliases")].split("|").sort(), ["FIJI", "Phi Gam"]);
  assert.ok(!rows.some((r) => r[at("chapter_designation")] === "Pi Tau" && r[at("university")] === "RPI"));
});
