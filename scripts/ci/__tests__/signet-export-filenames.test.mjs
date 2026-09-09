// Locks customer-facing CSV/PDF download filenames on Signet.
//
// WHY THIS EXISTS. #1937 renames the browser Save-as prefix from frapp- to
// signet-. Those strings sit next to storage object keys that must stay
// unprefixed (`${kind}-${day}-${uuid}.pdf`) and next to identifiers that
// must stay Frapp (`frapp://`, bundle ids). A later "fix the leftover
// Frapp" sweep can flip the wrong token, or a merge can put `frapp-${kind}`
// back, without a product-copy test noticing.
//
// SCOPE. The download filename templates only. Do not assert storage paths,
// OpenAPI title (#1930), or calendar ICS PRODID (#1929).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const SITES = [
  {
    rel: "apps/web/lib/utils.ts",
    wanted: "`signet-${filenamePrefix}-",
    banned: "`frapp-${filenamePrefix}-",
  },
  {
    rel: "apps/api/src/application/services/report-export.service.ts",
    wanted: "`signet-${kind}-report-",
    banned: "`frapp-${kind}-report-",
  },
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readRepo(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

test("CSV and PDF download filenames ship signet-, not frapp-", () => {
  for (const site of SITES) {
    const source = readRepo(site.rel);
    assert.match(source, new RegExp(escapeRegExp(site.wanted)), site.rel);
    assert.doesNotMatch(
      source,
      new RegExp(escapeRegExp(site.banned)),
      `${site.rel} must not keep ${site.banned}`,
    );
  }
});
