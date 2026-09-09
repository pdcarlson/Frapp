// Locks customer-facing calendar ICS branding on Signet.
//
// WHY THIS EXISTS. #1929 renames ICS PRODID and the empty-title .ics fallback
// from Frapp to Signet. Those strings sit next to identifiers that must stay
// Frapp (`UID` host `@frapp.live`, `frapp://`). A later "fix the leftover
// Frapp" sweep can flip the wrong token, or a merge can put `PRODID:-//Frapp`
// back, without a product-copy test noticing.
//
// SCOPE. PRODID lines and the empty-title filename fallback only. Do not
// assert UID, scheme, or bundle id. OpenAPI title is #1930. Export CSV/PDF
// prefixes are #1937.

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
