// Locks the @frapp.live ICS UID host on every surface that writes an .ics.
//
// WHY THIS EXISTS. Leftover 1929 renamed the ICS PRODID and the empty-title
// .ics fallback from Frapp to Signet. Those strings sit next to the UID host
// `@frapp.live`, which must stay. A later sweep can flip the host to
// `@signet.live` without a product-copy test noticing.
//
// ADR-25 NAMES THE PRODUCT FRAPP and renamed it one surface at a time. This
// lock was signet-calendar-prodid, and each step took its surface's PRODID
// and filename fallback to that surface's own copy lock: step 2 to
// frapp-mobile-copy, step 3 to frapp-api-copy, and step 4 (the web fallback)
// to frapp-web-copy. The UID host is a permanent identifier (ADR-25), not
// copy, so it is all that stays here.
//
// SCOPE. The UID host only. Do not assert the scheme, the bundle id, a PRODID
// or a download name.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function readRepo(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

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
