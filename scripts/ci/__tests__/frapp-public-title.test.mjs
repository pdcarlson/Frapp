// Locks the customer-facing OpenAPI / Swagger title and description.
//
// WHY THIS EXISTS. #1930 renamed DocumentBuilder.setTitle to Signet API, and
// ADR-25 step 3 renamed it again to Frapp API and regenerated openapi.json. A
// later `npm run openapi:export` from a stale setTitle, or a copy-paste revert
// of either source site, puts the wrong name back on /docs without touching
// product copy. The contract check only diffs the artifact against itself; it
// does not care what the title says.
//
// The description is here for the same reason. It carried the retired "The
// Operating System for Greek Life" pitch until step 3 (#2467). The two
// builders set the same string, and a drift between them is its own defect.
//
// SCOPE. The public title and description only. Calendar ICS PRODID and the
// rest of the API's copy are frapp-api-copy's. Developer README / guide
// headings that name the apps/api workspace are not this surface.
// pdf.setTitle in the report renderer is a document title, not this surface.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const TITLE = "Frapp API";
const BANNED = "Signet API";
const RETIRED_TAGLINE = "The Operating System for Greek Life";

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

/** The one string literal passed to `.setDescription(...)`, however Prettier wraps it. */
export function builderDescription(slice) {
  const match = slice.match(/\.setDescription\(\s*'([^']*)',?\s*\)/);
  return match ? match[1] : null;
}

test("openapi.json info.title is Frapp API", () => {
  const spec = JSON.parse(readRepo("apps/api/openapi.json"));
  assert.equal(spec.info?.title, TITLE);
});

test("DocumentBuilder setTitle sites ship Frapp API, not Signet API", () => {
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

test("both builders and openapi.json carry one description, never the retired tagline", () => {
  const descriptions = SET_TITLE_SITES.map((rel) =>
    builderDescription(documentBuilderSlice(readRepo(rel), rel)),
  );
  for (const [index, description] of descriptions.entries()) {
    assert.ok(description, `${SET_TITLE_SITES[index]} must .setDescription('…')`);
  }
  assert.equal(descriptions[1], descriptions[0], "main.ts and export-openapi.ts must set the same description");
  const spec = JSON.parse(readRepo("apps/api/openapi.json"));
  assert.equal(spec.info?.description, descriptions[0], "openapi.json is stale; run npm run openapi:export -w apps/api");
  for (const description of [...descriptions, spec.info?.description]) {
    assert.ok(!description.includes(RETIRED_TAGLINE), "the retired tagline must stay gone");
    assert.doesNotMatch(description, /\bSignet\b/);
  }
});

test("builderDescription reads a wrapped or one-line call", () => {
  assert.equal(builderDescription(".setDescription('One line.')"), "One line.");
  assert.equal(builderDescription(".setDescription(\n      'Wrapped by Prettier.',\n    )"), "Wrapped by Prettier.");
  assert.equal(builderDescription(".setTitle('Frapp API')"), null);
});
