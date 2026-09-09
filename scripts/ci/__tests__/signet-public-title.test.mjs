// Locks the customer-facing OpenAPI / Swagger title on Signet.
//
// WHY THIS EXISTS. #1930 renamed DocumentBuilder.setTitle and regenerated
// openapi.json. A later `npm run openapi:export` from a stale setTitle, or a
// copy-paste revert of either source site, puts `Frapp API` back on /docs
// without touching product copy. The contract check only diffs the artifact
// against itself — it does not care what the title says.
//
// SCOPE. This is the public title only. Calendar ICS PRODID is #1929.
// Developer README / guide headings that name the apps/api workspace stay
// Frapp on purpose. pdf.setTitle in the report renderer is a document
// filename, not this surface.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const TITLE = "Signet API";
const BANNED = "Frapp API";

const SET_TITLE_SITES = [
  "apps/api/src/main.ts",
  "apps/api/src/export-openapi.ts",
];

function readRepo(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

/**
 * The DocumentBuilder block that actually ships the title. Slicing here keeps
 * pdf.setTitle and logger strings out of the assertion.
 */
function documentBuilderSlice(source, where) {
  const start = source.indexOf("new DocumentBuilder()");
  assert.ok(start >= 0, `${where} has no DocumentBuilder()`);
  const built = source.indexOf(".build()", start);
  assert.ok(built > start, `${where} DocumentBuilder has no .build()`);
  return source.slice(start, built);
}

test("openapi.json info.title is Signet API", () => {
  const spec = JSON.parse(readRepo("apps/api/openapi.json"));
  assert.equal(spec.info?.title, TITLE);
});

test("DocumentBuilder setTitle sites ship Signet API, not Frapp API", () => {
  for (const rel of SET_TITLE_SITES) {
    const slice = documentBuilderSlice(readRepo(rel), rel);
    assert.match(
      slice,
      new RegExp(`\\.setTitle\\('${TITLE}'\\)`),
      `${rel} must .setTitle('${TITLE}')`,
    );
    assert.doesNotMatch(
      slice,
      new RegExp(`\\.setTitle\\('${BANNED}'\\)`),
      `${rel} must not .setTitle('${BANNED}')`,
    );
  }
});
