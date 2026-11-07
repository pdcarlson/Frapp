import { test } from "node:test";
import assert from "node:assert/strict";

import { firstLink, isBold, plainText, readChapterTemplates, readTables } from "../../chapter-directory/wikitext.mjs";
import { canonicalSchools, schoolKey, schoolNames } from "../../chapter-directory/school-names.mjs";

// The table shapes the "List of … chapters" articles use, as
// build-from-wikipedia.mjs reads them. Each case is one that produced a wrong
// or missing row before it was handled.

test("plainText keeps a link's label and drops refs, templates and sort keys", () => {
  assert.equal(
    plainText(`'''<span style="display:none">0307</span>Eta Gamma'''<ref name="x">cite</ref>{{Efn|note}}`),
    "Eta Gamma",
  );
  assert.equal(plainText("[[Rensselaer Polytechnic Institute|RPI]]"), "RPI");
  assert.equal(plainText("{{lang|grc|ΦΓΔ}}"), "ΦΓΔ");
  assert.equal(plainText("|Tau Chi"), "Tau Chi");
});

test("firstLink returns the target and label, decoding entities", () => {
  assert.deepEqual(firstLink("[[University of Wisconsin&ndash;Madison|Wisconsin]]"), {
    target: "University of Wisconsin–Madison",
    text: "Wisconsin",
  });
  assert.equal(firstLink("no link"), null);
});

test("isBold reads the active-chapter convention", () => {
  assert.equal(isBold("'''Tau Nu'''"), true);
  assert.equal(isBold("''Pi Tau''"), false);
});

test("readTables reads headers, rows, inline cells and rowspans", () => {
  const text = `== Undergraduate chapters ==
{| class="wikitable"
!Chapter
!Institution
!Status
|-
| rowspan="2" | '''Alpha''' || [[Cornell University]] || Active
|-
| [[Ithaca College]] || Inactive
|}`;
  const [t] = readTables(text);
  assert.equal(t.section, "Undergraduate chapters");
  assert.deepEqual(t.header, ["Chapter", "Institution", "Status"]);
  assert.equal(t.rows.length, 2);
  assert.deepEqual(t.rows[1].map(plainText), ["Alpha", "Ithaca College", "Inactive"]);
});

test("readChapterTemplates reads {{FratChapter}} lists", () => {
  const text = `====Collegiate chapters====
{{FratChapterStart}}
{{FratChapter|Chapter Name=Alpha|Founded=April 15, 1914|School=[[Howard University]]|Location=[[Washington, D.C.]]|Status=Active|Reference=<ref>x</ref>}}
`;
  const [t] = readChapterTemplates(text);
  assert.equal(t.section, "Collegiate chapters");
  assert.deepEqual(t.rows[0].map(plainText), ["Alpha", "April 15, 1914", "Howard University", "Active"]);
});

test("schoolNames gives RPI its short name and the names people type", () => {
  assert.deepEqual(schoolNames("Rensselaer Polytechnic Institute", "Rensselaer Polytechnic Institute"), {
    short: "RPI",
    aliases: ["RPI", "Rensselaer"],
  });
  // Unlisted: initials of a long name, else the name without "University".
  assert.equal(schoolNames("Stephen F. Austin State University").short, "SFASU");
  assert.equal(schoolNames("Duke University").short, "Duke");
  assert.equal(schoolNames("University of Idaho").short, "Idaho");
});

test("canonicalSchools spells one school one way", () => {
  assert.equal(schoolKey("Washington & Lee University"), schoolKey("Washington And Lee University"));
  assert.equal(schoolKey("San José State University"), schoolKey("San Jose State University"));
  assert.equal(schoolKey("St. John's University"), "st johns university");
  const names = [
    "Washington and Lee University",
    "Washington and Lee University",
    "Washington & Lee University",
    "Washington And Lee University",
    "San Jose State University",
    "San José State University",
  ];
  const spelling = canonicalSchools(names);
  // The spelling most rows use wins; on a tie, the school's own accents.
  assert.equal(spelling.get("Washington & Lee University"), "Washington and Lee University");
  assert.equal(spelling.get("Washington And Lee University"), "Washington and Lee University");
  assert.equal(spelling.get("San Jose State University"), "San José State University");
  // A spelling KNOWN doesn't hold still finds its names.
  assert.equal(schoolNames("College of William and Mary").short, "William & Mary");
});

