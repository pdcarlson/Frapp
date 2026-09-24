// Locks the customer-facing OpenAPI / Swagger title and description.
//
// WHY THIS EXISTS. #1930 renamed DocumentBuilder.setTitle to Signet API, and
// ADR-25 step 3 renamed it again to Frapp API and regenerated openapi.json. A
// later `npm run openapi:export` from a stale builder, or a copy-paste revert,
// puts the wrong name back on /docs without touching product copy. The
// contract check only diffs the artifact against itself; it does not care
// what the title says.
//
// The description is here for the same reason. It carried the retired "The
// Operating System for Greek Life" pitch until step 3 (#2467).
//
// ONE BUILDER. main.ts (which serves /docs) and export-openapi.ts (which
// writes openapi.json) used to hold two copies of the DocumentBuilder chain,
// and CI builds only the exported one. Step 3 moved the chain into
// openapi-config.ts, so this lock also fails a second DocumentBuilder in the
// API or an entry point that stops calling the shared one.
//
// SCOPE. The public title and description only. Calendar ICS PRODID and the
// rest of the API's copy are frapp-api-copy's. Developer README / guide
// headings that name the apps/api workspace are not this surface.
// pdf.setTitle in the report renderer is a document title, not this surface.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const TITLE = "Frapp API";
const BANNED = "Signet API";
const RETIRED_TAGLINE = "The Operating System for Greek Life";

const CONFIG = "apps/api/src/openapi-config.ts";
const ENTRY_POINTS = ["apps/api/src/main.ts", "apps/api/src/export-openapi.ts"];

function readRepo(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

/** The one string literal passed to `.setDescription(...)`, however Prettier wraps it. */
export function builderDescription(source) {
  const match = source.match(/\.setDescription\(\s*'([^']*)',?\s*\)/);
  return match ? match[1] : null;
}

/** Non-spec .ts files under apps/api/src that construct a DocumentBuilder. */
export function documentBuilderSites(root = join(REPO_ROOT, "apps/api/src")) {
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...documentBuilderSites(path));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts")) {
      if (/new DocumentBuilder\(\)/.test(readFileSync(path, "utf8"))) {
        out.push(relative(REPO_ROOT, path).replaceAll("\\", "/"));
      }
    }
  }
  return out;
}

test("openapi.json info.title is Frapp API", () => {
  const spec = JSON.parse(readRepo("apps/api/openapi.json"));
  assert.equal(spec.info?.title, TITLE);
});

test("the one DocumentBuilder is openapi-config.ts, and it sets Frapp API", () => {
  assert.deepEqual(documentBuilderSites(), [CONFIG]);
  const source = readRepo(CONFIG);
  assert.match(source, new RegExp(`\\.setTitle\\('${TITLE}'\\)`), `${CONFIG} must .setTitle('${TITLE}')`);
  assert.doesNotMatch(source, new RegExp(`\\.setTitle\\('${BANNED}'\\)`));
});

test("both entry points build their document from the shared config", () => {
  for (const rel of ENTRY_POINTS) {
    const source = readRepo(rel);
    assert.match(source, /import \{ buildOpenApiConfig \} from '\.\/openapi-config';/, `${rel} must import buildOpenApiConfig`);
    assert.match(source, /SwaggerModule\.createDocument\(\s*app,\s*buildOpenApiConfig\(\),?\s*\)/, `${rel} must pass buildOpenApiConfig() to createDocument`);
  }
});

test("openapi.json carries the builder's description, never the retired tagline", () => {
  const description = builderDescription(readRepo(CONFIG));
  assert.ok(description, `${CONFIG} must .setDescription('…')`);
  const spec = JSON.parse(readRepo("apps/api/openapi.json"));
  assert.equal(spec.info?.description, description, "openapi.json is stale; run npm run openapi:export -w apps/api");
  assert.ok(!description.includes(RETIRED_TAGLINE), "the retired tagline must stay gone");
  assert.doesNotMatch(description, /\bSignet\b/);
});

test("builderDescription reads a wrapped or one-line call", () => {
  assert.equal(builderDescription(".setDescription('One line.')"), "One line.");
  assert.equal(builderDescription(".setDescription(\n      'Wrapped by Prettier.',\n    )"), "Wrapped by Prettier.");
  assert.equal(builderDescription(".setTitle('Frapp API')"), null);
});
