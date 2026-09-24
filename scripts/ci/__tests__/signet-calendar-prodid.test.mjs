// Locks customer-facing calendar ICS branding on Signet, surface by surface.
//
// WHY THIS EXISTS. Leftover 1929 renamed ICS PRODID and the empty-title
// .ics fallback from Frapp to Signet. Those strings sit next to the UID
// host `@frapp.live`, which must stay. A later leftover sweep can flip
// the host to `@signet.live`, or a merge can put the wrong PRODID back,
// without a product-copy test noticing.
//
// ADR-25 NAMES THE PRODUCT FRAPP and renames it one surface at a time, so
// each surface leaves this lock with its own step. Step 2 took the mobile
// PRODID and filename fallback to frapp-mobile-copy.test.mjs. The API
// PRODID flips with step 3 and the web fallback with step 4. The UID host
// is a permanent identifier on every surface and stays here.
//
// SCOPE. PRODID lines, the empty-title filename fallback, and the UID
// host. Do not assert scheme or bundle id. Export CSV/PDF prefixes stay
// on their own lock (signet-export-filenames).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const SITES = [
  {
    rel: "apps/api/src/application/services/event.service.ts",
    prodid: "PRODID:-//Signet//Events//EN",
    banned: "PRODID:-//Frapp//Events//EN",
  },
];

const FILENAME_SITES = [
  {
    rel: "apps/web/components/events/event-detail-sheet.tsx",
    wanted: '"signet-event"',
    banned: '"frapp-event"',
  },
];

function readRepo(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

test("ICS PRODID sites ship Signet, not Frapp", () => {
  for (const site of SITES) {
    const source = readRepo(site.rel);
    assert.match(source, new RegExp(site.prodid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), site.rel);
    assert.doesNotMatch(
      source,
      new RegExp(site.banned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${site.rel} must not keep ${site.banned}`,
    );
  }
});

test("empty-title ICS fallback filename is signet-event, not frapp-event", () => {
  for (const site of FILENAME_SITES) {
    const source = readRepo(site.rel);
    assert.match(source, new RegExp(site.wanted), site.rel);
    assert.doesNotMatch(source, new RegExp(site.banned), `${site.rel} must not fall back to ${site.banned}`);
  }
});

export const UID_HOST = "@frapp.live";
export const UID_SITES = [
  "apps/api/src/application/services/event.service.ts",
  "apps/mobile/lib/calendar-export.ts",
];

export function uidHostProblems(source) {
  const problems = [];
  if (!/@frapp\.live/.test(source)) {
    problems.push(`UID host must stay ${UID_HOST}`);
  }
  if (/@signet\.live/.test(source)) {
    problems.push("UID host must not become @signet.live");
  }
  return problems;
}

test("ICS UID host stays @frapp.live", () => {
  for (const rel of UID_SITES) {
    assert.deepEqual(uidHostProblems(readRepo(rel)), [], rel);
  }
});

test("renaming the ICS UID host to @signet.live fails", () => {
  for (const rel of UID_SITES) {
    const flipped = readRepo(rel).replaceAll("@frapp.live", "@signet.live");
    const problems = uidHostProblems(flipped);
    assert.ok(
      problems.some((problem) => problem.includes("@signet.live")),
      `${rel}: ${problems.join("; ")}`,
    );
    assert.ok(
      problems.some((problem) => problem.includes(UID_HOST)),
      `${rel}: ${problems.join("; ")}`,
    );
  }
});

test("refuses a GitHub closer next to an issue number", () => {
  const lock = readFileSync(fileURLToPath(import.meta.url), "utf8");
  assert.doesNotMatch(
    lock,
    /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i,
  );
});
