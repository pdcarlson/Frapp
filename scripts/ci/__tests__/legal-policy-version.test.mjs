// Locks LEGAL_POLICY_VERSION to the legal text it stamps (#2306).
//
// WHY THIS EXISTS. The constant is the consent record's answer to "which text
// did they agree to" (spec/behavior/legal.md § Acceptance record). It sat at
// "2026-03" while the Privacy Policy was rewritten and dated September 2026
// (#1797), so a chapter onboarded in that window carries a stamp naming a
// revision its officer never saw. Then #2480 rewrote the Privacy and FERPA text
// again without moving either date. Nothing read the constant, the dates or the
// text together, so every one of those drifts shipped green.
//
// THE RULES.
// - `LEGAL_POLICY_VERSION` is `YYYY-MM`, the month of the newer of the Terms
//   and Privacy `lastUpdated`. The acceptance checkbox covers both pages, so
//   either one moving moves the constant, which asks every member again.
// - FERPA is a notice nobody accepts, so it has a date but no constant.
// - Each page's text is pinned below with its date. Editing a page's text
//   fails until its pin is updated, which forces the call nothing else made:
//   a material change also moves the page's date (and, for Terms or Privacy,
//   the constant); one that isn't (a typo fix) updates only the pin, and the
//   PR says so. This lock doesn't judge what is material. It makes someone
//   decide. Whether a name-only change bumps the constant is the owner's call
//   (ADR-25).
//
// SCOPE. Reads source files, never the module, so the API specs' mocks of
// `@repo/validation` (`'test-version'`, `'current-version'`) can't satisfy it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const VALIDATION = "packages/validation/src/index.ts";

/** The pages the acceptance checkbox covers. The constant follows the newer. */
const ACCEPTED_PAGES = ["terms", "privacy"];

/**
 * Each legal page's served date and text fingerprint. Update a row only
 * together with the decision the header describes.
 */
export const PINNED_PAGES = {
  terms: {
    path: "apps/landing/app/terms/page.tsx",
    lastUpdated: "September 2026",
    fingerprint: "3e73b4406a9956c2",
  },
  privacy: {
    path: "apps/landing/app/privacy/page.tsx",
    lastUpdated: "September 2026",
    fingerprint: "65adf7c03a68f38d",
  },
  ferpa: {
    path: "apps/landing/app/ferpa/page.tsx",
    lastUpdated: "September 2026",
    fingerprint: "e2975174cc90ae6c",
  },
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function readRepo(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

/** The one `LEGAL_POLICY_VERSION` assignment's value. Throws on zero or several. */
export function readPolicyVersion(source) {
  const matches = [
    ...source.matchAll(/^export const LEGAL_POLICY_VERSION\s*=\s*(["'`])([^"'`]*)\1;?$/gm),
  ];
  const mentions = source.match(/\bLEGAL_POLICY_VERSION\s*=/g) ?? [];
  if (matches.length !== 1 || mentions.length !== 1) {
    throw new Error(
      `expected exactly one \`export const LEGAL_POLICY_VERSION = "YYYY-MM";\` line, found ${matches.length} (and ${mentions.length} assignments)`,
    );
  }
  return matches[0][2];
}

/** The one `lastUpdated="…"` prop's value. Throws on zero or several. */
export function readLastUpdated(source) {
  const matches = [...source.matchAll(/\blastUpdated\s*=\s*(?:\{\s*)?(["'`])([^"'`]*)\1/g)];
  const mentions = source.match(/\blastUpdated\s*=/g) ?? [];
  if (matches.length !== 1 || mentions.length !== 1) {
    throw new Error(
      `expected exactly one literal lastUpdated="<Month> <YYYY>" prop, found ${matches.length} (and ${mentions.length} assignments)`,
    );
  }
  return matches[0][2];
}

/** "September 2026" → "2026-09". Throws on anything else. */
export function monthOf(lastUpdated) {
  const match = /^([A-Z][a-z]+) (\d{4})$/.exec(lastUpdated);
  const index = match ? MONTHS.indexOf(match[1]) : -1;
  if (index === -1) {
    throw new Error(`lastUpdated must read "<Month> <YYYY>", got ${JSON.stringify(lastUpdated)}`);
  }
  return `${match[2]}-${String(index + 1).padStart(2, "0")}`;
}

/**
 * A hash of what a reader is served: the `title` prop and the `sections`
 * array, with whitespace collapsed so reformatting doesn't count as an edit.
 * Comments and imports are outside it.
 */
export function textFingerprint(source) {
  const title = /\btitle\s*=\s*"([^"]*)"/.exec(source);
  const sections = /^const sections = (\[[\s\S]*?^\]);$/m.exec(source);
  if (!title || !sections) {
    throw new Error("expected a literal title=\"…\" prop and a top-level `const sections = [ … ];`");
  }
  const served = `${title[1]}\n${sections[1]}`.replace(/\s+/g, " ");
  return createHash("sha256").update(served).digest("hex").slice(0, 16);
}

/** The constant the pages' dates require: the newer accepted page's month. */
export function requiredPolicyVersion(datesByPage) {
  return ACCEPTED_PAGES.map((page) => monthOf(datesByPage[page])).sort().at(-1);
}

function readPages() {
  return Object.fromEntries(
    Object.entries(PINNED_PAGES).map(([page, pin]) => [page, readRepo(pin.path)]),
  );
}

test("LEGAL_POLICY_VERSION is the month of the newer Terms or Privacy date", () => {
  const version = readPolicyVersion(readRepo(VALIDATION));
  assert.match(version, /^\d{4}-(0[1-9]|1[0-2])$/, "LEGAL_POLICY_VERSION must be YYYY-MM");
  const pages = readPages();
  const dates = Object.fromEntries(
    ACCEPTED_PAGES.map((page) => [page, readLastUpdated(pages[page])]),
  );
  assert.equal(
    version,
    requiredPolicyVersion(dates),
    `LEGAL_POLICY_VERSION (${version}) must equal the month of the newer of Terms (${dates.terms}) and Privacy (${dates.privacy}). ` +
      "A page whose date moved needs the constant moved with it, which asks every member to accept again; " +
      "a constant that moved needs the page date that justifies it. spec/behavior/legal.md § Acceptance record.",
  );
});

for (const [page, pin] of Object.entries(PINNED_PAGES)) {
  test(`${page}: the served date and text match their pin`, () => {
    const source = readRepo(pin.path);
    const lastUpdated = readLastUpdated(source);
    monthOf(lastUpdated);
    const fingerprint = textFingerprint(source);
    const accepted = ACCEPTED_PAGES.includes(page);
    assert.equal(
      fingerprint,
      pin.fingerprint,
      `${pin.path}: the served text changed (fingerprint ${fingerprint}, pinned ${pin.fingerprint}). ` +
        "Decide whether the change is material. If it is, move lastUpdated" +
        (accepted ? " and LEGAL_POLICY_VERSION (which asks every member to accept again)" : "") +
        ". If it isn't, leave the date alone. Either way, update this page's row in PINNED_PAGES " +
        "(scripts/ci/__tests__/legal-policy-version.test.mjs) and say which you chose in the PR.",
    );
    assert.equal(
      lastUpdated,
      pin.lastUpdated,
      `${pin.path}: lastUpdated moved to "${lastUpdated}" (pinned "${pin.lastUpdated}"). ` +
        "Update this page's row in PINNED_PAGES with the date" +
        (accepted ? ", and move LEGAL_POLICY_VERSION with it" : "") +
        ".",
    );
  });
}

test("the rules fail on the drifts they exist for", () => {
  // The #2306 case: Privacy dated September, the constant still March.
  assert.equal(requiredPolicyVersion({ terms: "March 2026", privacy: "September 2026" }), "2026-09");
  assert.notEqual(requiredPolicyVersion({ terms: "March 2026", privacy: "September 2026" }), "2026-03");
  // A year boundary compares by year first.
  assert.equal(requiredPolicyVersion({ terms: "December 2026", privacy: "January 2027" }), "2027-01");
  assert.throws(() => monthOf("Sept 2026"), /<Month> <YYYY>/);
  assert.throws(() => monthOf("2026-09"), /<Month> <YYYY>/);

  // The #2480 case: the text moves and the date doesn't.
  const page = (paragraph) =>
    `const sections = [\n  { heading: "1. A", paragraphs: ["${paragraph}"] },\n];\n` +
    `export default function P() { return <LegalDocument title="T" lastUpdated="March 2026" sections={sections} />; }\n`;
  assert.notEqual(textFingerprint(page("old wording")), textFingerprint(page("new wording")));
  // Reformatting isn't an edit.
  assert.equal(
    textFingerprint(page("same")),
    textFingerprint(page("same").replace("{ heading", "{\n    heading")),
  );

  // A second or computed date can't slip past the reader.
  assert.throws(() => readLastUpdated(`lastUpdated="March 2026" lastUpdated="May 2026"`), /exactly one/);
  assert.throws(() => readLastUpdated(`lastUpdated={DATE}`), /exactly one/);
  assert.equal(readLastUpdated(`lastUpdated={"May 2026"}`), "May 2026");
  assert.throws(
    () => readPolicyVersion(`export const LEGAL_POLICY_VERSION = "2026-09";\nLEGAL_POLICY_VERSION = "x";`),
    /exactly one/,
  );
  assert.throws(() => readPolicyVersion(`export const LEGAL_POLICY_VERSION = VERSION;`), /exactly one/);
});
