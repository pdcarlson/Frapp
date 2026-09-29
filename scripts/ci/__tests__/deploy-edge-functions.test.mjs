// deploy-edge-functions.mjs: what it deploys, the ref fence, the credential,
// and where `_deploy.yml` runs it (#2848).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  deployAll,
  deployArgs,
  listFunctions,
  validateInputs,
} from "../deploy-edge-functions.mjs";
import { getEnvironment } from "../lib/environments.mjs";
import { workflowSteps } from "./helpers/workflow-yaml.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEPLOY_WORKFLOW = join(REPO_ROOT, ".github", "workflows", "_deploy.yml");

const STAGING = { name: "staging", supabaseProjectRef: "aaaaaaaaaaaaaaa", supabaseProjectName: "frapp-staging" };
const lookup = (name) => {
  if (name === "staging") return STAGING;
  throw new Error(`Unknown environment "${name}".`);
};
const env = (overrides = {}) => ({
  TARGET_ENVIRONMENT: "staging",
  SUPABASE_PROJECT_REF: STAGING.supabaseProjectRef,
  SUPABASE_FUNCTIONS_DEPLOY_TOKEN: "sbp_deploy",
  SUPABASE_ACCESS_TOKEN: "sbp_read_only",
  ...overrides,
});

describe("listFunctions", () => {
  it("lists directories holding an index.ts, skipping shared and hidden ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "functions-"));
    try {
      for (const [name, entry] of [
        ["b-copy", "index.ts"],
        ["a-copy", "index.ts"],
        ["_shared", "index.ts"],
        [".hidden", "index.ts"],
        ["no-entry", "handler.ts"],
      ]) {
        mkdirSync(join(dir, name));
        writeFileSync(join(dir, name, entry), "");
      }
      writeFileSync(join(dir, "README.md"), "");
      assert.deepEqual(listFunctions(dir), ["a-copy", "b-copy"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds nothing where there is no functions directory (an older commit)", () => {
    assert.deepEqual(listFunctions(join(tmpdir(), "does-not-exist-2848")), []);
  });

  it("finds the committed function", () => {
    const committed = listFunctions(join(REPO_ROOT, "supabase", "functions"));
    assert.ok(committed.includes("discord-attachment-copy"), committed.join(","));
  });
});

describe("validateInputs", () => {
  it("accepts the environment's own ref and the deploy token", () => {
    assert.deepEqual(validateInputs({ env: env(), hasFunctions: true, lookupEnvironment: lookup }), {
      ok: true,
      projectRef: STAGING.supabaseProjectRef,
      token: "sbp_deploy",
    });
  });

  it("refuses a ref that belongs to another environment", () => {
    const result = validateInputs({
      env: env({ SUPABASE_PROJECT_REF: "bbbbbbbbbbbbbbb" }),
      hasFunctions: true,
      lookupEnvironment: lookup,
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /does not match the 'staging' environment/);
  });

  it("refuses an unknown environment and a missing or malformed ref", () => {
    for (const overrides of [
      { TARGET_ENVIRONMENT: "preview" },
      { TARGET_ENVIRONMENT: undefined },
      { SUPABASE_PROJECT_REF: undefined },
      { SUPABASE_PROJECT_REF: "Not-A-Ref" },
    ]) {
      const result = validateInputs({ env: env(overrides), hasFunctions: true, lookupEnvironment: lookup });
      assert.equal(result.ok, false, JSON.stringify(overrides));
    }
  });

  // The read-only SUPABASE_ACCESS_TOKEN is present in every deploy job, and it
  // must not be mistaken for a credential that can deploy.
  it("requires the deploy token even when the read-only one is present", () => {
    const result = validateInputs({
      env: env({ SUPABASE_FUNCTIONS_DEPLOY_TOKEN: undefined }),
      hasFunctions: true,
      lookupEnvironment: lookup,
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /SUPABASE_FUNCTIONS_DEPLOY_TOKEN is not set/);
    assert.match(result.message, /ENV_REFERENCE\.md/);
  });

  it("does not require the deploy token when there is nothing to deploy", () => {
    const result = validateInputs({
      env: env({ SUPABASE_FUNCTIONS_DEPLOY_TOKEN: undefined }),
      hasFunctions: false,
      lookupEnvironment: lookup,
    });
    assert.equal(result.ok, true);
  });

  it("fences against the committed config by default", () => {
    const committed = getEnvironment("production");
    const result = validateInputs({
      env: env({ TARGET_ENVIRONMENT: "production", SUPABASE_PROJECT_REF: getEnvironment("staging").supabaseProjectRef }),
      hasFunctions: true,
    });
    assert.equal(result.ok, false);
    assert.match(result.message, new RegExp(committed.supabaseProjectRef));
  });
});

describe("deployAll", () => {
  it("deploys each function by name, server-side bundled, with the deploy token as the CLI's", () => {
    const calls = [];
    const code = deployAll({
      functions: ["a-copy", "b-copy"],
      projectRef: "aaaaaaaaaaaaaaa",
      token: "sbp_deploy",
      env: { PATH: "/bin", SUPABASE_ACCESS_TOKEN: "sbp_read_only" },
      run: (command, args, options) => {
        calls.push({ command, args, token: options.env.SUPABASE_ACCESS_TOKEN });
        return { status: 0 };
      },
      log: () => {},
    });
    assert.equal(code, 0);
    assert.deepEqual(calls, [
      { command: "supabase", args: deployArgs("a-copy", "aaaaaaaaaaaaaaa"), token: "sbp_deploy" },
      { command: "supabase", args: deployArgs("b-copy", "aaaaaaaaaaaaaaa"), token: "sbp_deploy" },
    ]);
    assert.deepEqual(deployArgs("a-copy", "aaaaaaaaaaaaaaa"), [
      "functions",
      "deploy",
      "a-copy",
      "--use-api",
      "--project-ref",
      "aaaaaaaaaaaaaaa",
    ]);
  });

  it("stops at the first failure and says which function", () => {
    const logged = [];
    let calls = 0;
    const code = deployAll({
      functions: ["a-copy", "b-copy"],
      projectRef: "aaaaaaaaaaaaaaa",
      token: "sbp_deploy",
      run: () => {
        calls += 1;
        return { status: 1 };
      },
      log: (line) => logged.push(line),
    });
    assert.equal(code, 1);
    assert.equal(calls, 1);
    assert.match(logged.join("\n"), /Deploying Edge Function a-copy failed/);
  });
});

// Where the deploy job runs it. The order is the contract: the API calls the
// functions, so they deploy after the migrations and before the API does.
describe("_deploy.yml", () => {
  const steps = workflowSteps(DEPLOY_WORKFLOW);
  const index = (name) => {
    const i = steps.findIndex((step) => step.name === name);
    assert.ok(i >= 0, `no step named "${name}"`);
    return i;
  };

  for (const [environment, render] of [
    ["staging", "Deploy the commit to Render (staging)"],
    ["production", "Deploy the commit to Render (production)"],
  ]) {
    it(`deploys the functions to ${environment} after the migrations and before the API`, () => {
      const step = steps[index(`Deploy the Edge Functions (${environment})`)];
      assert.match(step.body, /run: node scripts\/ci\/deploy-edge-functions\.mjs/);
      assert.equal(step.env.get("TARGET_ENVIRONMENT"), environment);
      assert.ok(index("Run migrations (apply)") < index(step.name));
      assert.ok(index(step.name) < index(render));
      // A rollback to a commit from before the functions skips the step
      // rather than failing on a script that commit does not have.
      assert.match(step.body, /hashFiles\('supabase\/functions\/\*\/index\.ts'\) != ''/);
    });
  }

  it("gates staging on the plan and production on a real, full run", () => {
    const staging = steps[index("Deploy the Edge Functions (staging)")];
    assert.match(staging.body, /inputs\.environment == 'staging'/);
    assert.match(staging.body, /steps\.plan\.outputs\.plan != 'stale'/);
    const production = steps[index("Deploy the Edge Functions (production)")];
    assert.match(production.body, /inputs\.environment == 'production'/);
    assert.match(production.body, /!inputs\.dry_run/);
    assert.match(production.body, /inputs\.scope != 'migrations-only'/);
  });
});
