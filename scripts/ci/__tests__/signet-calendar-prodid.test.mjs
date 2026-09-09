// Locks customer-facing calendar ICS branding on Signet.
//
// WHY THIS EXISTS. Leftover 1929 renames ICS PRODID and the empty-title
// .ics fallback from Frapp to Signet. Those strings sit next to the UID
// host `@frapp.live`, which must stay. A later leftover sweep can flip
// the host to `@signet.live`, or a merge can put `PRODID:-//Frapp` back,
// without a product-copy test noticing.
//
// SCOPE. PRODID lines, the empty-title filename fallback, and the UID
// host. Do not assert scheme or bundle id. OpenAPI title stays on its
// own leftover (1930). Export CSV/PDF prefixes stay on their own
// leftover (1937).

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
  {
    rel: "apps/mobile/lib/calendar-export.ts",
    prodid: "PRODID:-//Signet//Chapter Events//EN",
    banned: "PRODID:-//Frapp//Chapter Events//EN",
  },
];

const FILENAME_SITES = [
  {
    rel: "apps/mobile/lib/calendar-export.ts",
    wanted: '"signet-event"',
    banned: '"frapp-event"',
  },
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
