import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * Pins that every machine-readable mirror of `REQUIRED_ENV_VARS` still names
 * the same roster. The array in `apps/api/src/config/env.validation.ts` is
 * the source of truth for what the API needs at boot; the mirrors below are
 * restated by hand, and until this suite nothing compared them (#1768).
 *
 * Adding a name to the array without updating a mirror used to stay green in
 * CI: `api-tests` and `api-docker-build` go red (those two are exercised), but
 * `docker-compose.yml` is run by no workflow, and `render.yaml` is explicitly
 * not applied to the live services. The next `docker compose up` or service
 * recreation then exits on `Missing required environment variables`.
 *
 * `render.yaml` is included even though blueprint edits do not reach the
 * already-created services (`render.yaml:3-8`). The failure this check exists
 * for is a *recreation*, not a dashboard sync: live Render env is asserted by
 * `production-guardrails.mjs`, not this roster. Excluding the blueprint would
 * leave the exact silent-wrong case the issue named.
 *
 * Docs prose (`docs/guides/docker.md`, `DB_PROMOTION_RUNBOOK.md`) is out of
 * scope — a parser over English checklists is a second failure mode. Parsed by
 * hand rather than with a YAML library: this directory's other workflow-reading
 * suites do the same, and `yaml` is a transitive override, not a declared
 * dependency of these tests.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const ENV_VALIDATION = join(
  REPO_ROOT,
  "apps/api/src/config/env.validation.ts",
);
const CI_YML = join(REPO_ROOT, ".github/workflows/ci.yml");
const COMPOSE = join(REPO_ROOT, "docker-compose.yml");
const RENDER = join(REPO_ROOT, "render.yaml");
const SETUP_E2E = join(REPO_ROOT, "apps/api/test/setup-e2e.ts");
const CONTRACT_DRIFT = join(REPO_ROOT, "scripts/check-api-contract-drift.mjs");

function read(path) {
  return readFileSync(path, "utf8");
}

export function parseRequiredEnvVars(source) {
  const match = source.match(/const REQUIRED_ENV_VARS = \[([\s\S]*?)\] as const;/);
  assert.ok(match, "REQUIRED_ENV_VARS array not found in env.validation.ts");
  const names = [...match[1].matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1]);
  assert.ok(
    names.length > 0,
    "REQUIRED_ENV_VARS parsed empty — the array regex no longer matches the source",
  );
  return names;
}

/** `api-docker-build` job body; next sibling job is `api-contract-check`. */
function extractCiJob(yaml, jobId) {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => line === `  ${jobId}:`);
  assert.notEqual(start, -1, `${jobId} job not found in ci.yml`);
  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^  [A-Za-z0-9_-]+:/.test(line)) break;
    body.push(line);
  }
  return body.join("\n");
}

export function parseApiDockerBuildEnvFlags(yaml) {
  const job = extractCiJob(yaml, "api-docker-build");
  const names = [...job.matchAll(/-e ([A-Z][A-Z0-9_]*)=/g)].map((m) => m[1]);
  assert.ok(
    names.length > 0,
    "api-docker-build boot probe has no `-e NAME=` flags",
  );
  return names;
}

export function parseComposeApiEnvironment(yaml) {
  const lines = yaml.split("\n");
  const api = lines.findIndex((line) => line === "  api:");
  assert.notEqual(api, -1, "docker-compose.yml has no `api:` service");
  const envStart = lines.findIndex(
    (line, i) => i > api && line === "    environment:",
  );
  assert.notEqual(envStart, -1, "docker-compose.yml `api` has no `environment:` list");
  const names = [];
  for (let i = envStart + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const item = line.match(/^      - ([A-Z][A-Z0-9_]*)=/);
    if (item) {
      names.push(item[1]);
      continue;
    }
    if (line.trim() === "") continue;
    if (!line.startsWith("      ")) break;
  }
  assert.ok(names.length > 0, "docker-compose.yml `api.environment` parsed empty");
  return names;
}

export function parseRenderServiceEnvVars(yaml) {
  const chunks = yaml.split(/\n  - type: /).slice(1);
  assert.ok(chunks.length > 0, "render.yaml has no `- type:` services");
  return chunks.map((chunk) => {
    const name = chunk.match(/\n    name: (\S+)/)?.[1];
    const keys = [...chunk.matchAll(/- key: ([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]);
    return { name, keys };
  });
}

export function parseSetupE2eDefaults(source) {
  const names = [...source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)\s*\|\|=/g)].map(
    (m) => m[1],
  );
  assert.ok(names.length > 0, "setup-e2e.ts has no `process.env.NAME ||=` defaults");
  return names;
}

export function parseContractDriftPlaceholders(source) {
  const names = [
    ...source.matchAll(/^ {6}([A-Z][A-Z0-9_]+):\s*process\.env\./gm),
  ].map((m) => m[1]);
  assert.ok(
    names.length > 0,
    "check-api-contract-drift.mjs has no `NAME: process.env.NAME` placeholders",
  );
  return names;
}

function missingFrom(required, found) {
  return required.filter((name) => !found.includes(name));
}

function assertCovers(required, found, label) {
  const missing = missingFrom(required, found);
  assert.deepEqual(
    missing,
    [],
    `${label} is missing ${missing.join(", ")} — add them there when adding to ` +
      "REQUIRED_ENV_VARS (apps/api/src/config/env.validation.ts). See #1768.",
  );
}

function mirrors() {
  const render = parseRenderServiceEnvVars(read(RENDER));
  return [
    {
      label: ".github/workflows/ci.yml api-docker-build `-e` flags",
      found: parseApiDockerBuildEnvFlags(read(CI_YML)),
    },
    {
      label: "docker-compose.yml api.environment",
      found: parseComposeApiEnvironment(read(COMPOSE)),
    },
    ...render.map((service) => ({
      label: `render.yaml ${service.name} envVars`,
      found: service.keys,
    })),
    {
      label: "apps/api/test/setup-e2e.ts",
      found: parseSetupE2eDefaults(read(SETUP_E2E)),
    },
    {
      label: "scripts/check-api-contract-drift.mjs placeholders",
      found: parseContractDriftPlaceholders(read(CONTRACT_DRIFT)),
    },
  ];
}

test("REQUIRED_ENV_VARS parses as a non-empty roster from env.validation.ts", () => {
  const required = parseRequiredEnvVars(read(ENV_VALIDATION));
  assert.ok(required.length >= 5);
  assert.ok(required.includes("SUPABASE_URL"));
  assert.ok(required.includes("STRIPE_PRICE_ID"));
  assert.ok(
    !required.includes("SUPABASE_ANON_KEY"),
    "the API holds no anon-key client — requiring it here is the #1711 regression",
  );
});

test("render.yaml is in the roster — recreation, not live dashboard sync", () => {
  const services = parseRenderServiceEnvVars(read(RENDER));
  const names = services.map((s) => s.name).sort();
  assert.deepEqual(names, ["frapp-api-prod", "frapp-api-staging"]);
});

test("every machine-readable REQUIRED_ENV_VARS mirror covers the array", () => {
  const required = parseRequiredEnvVars(read(ENV_VALIDATION));
  for (const { label, found } of mirrors()) {
    assertCovers(required, found, label);
  }
});

test("a new required name without a mirror update is named per stale mirror — #1768", () => {
  const required = [
    ...parseRequiredEnvVars(read(ENV_VALIDATION)),
    "FAKE_REQUIRED_FOR_MIRROR_TEST",
  ];
  const reports = [];
  for (const { label, found } of mirrors()) {
    const missing = missingFrom(required, found);
    if (missing.length > 0) reports.push(`${label} is missing ${missing.join(", ")}`);
  }
  assert.ok(
    reports.length >= 5,
    `expected every mirror to lack the canary, got ${reports.length}: ${reports.join("; ")}`,
  );
  for (const report of reports) {
    assert.match(report, /FAKE_REQUIRED_FOR_MIRROR_TEST/);
  }
});
