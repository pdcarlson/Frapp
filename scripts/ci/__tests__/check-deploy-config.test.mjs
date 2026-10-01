// Pins #3112: `_deploy.yml` refuses a config it would fail on later, before
// anything is written. `check-deploy-config.mjs` runs the deployed commit's
// built boot check (`validateEnv`) on what Infisical injected, and requires the
// two secrets later steps read, by name and never by value.
//
// Every value below is fake and distinctive (`leak-canary`), so a test can look
// for it in everything the script printed. The boot checks are stand-in
// modules written into a throwaway tree, laid out where the API's build puts
// the real one, because these tests run without that build. What the real one
// refuses is pinned by `apps/api/src/config/env.validation.spec.ts`.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BOOT_CHECK_BUILD,
  BOOT_CHECK_SOURCE,
  OWN_INPUTS,
  checkDeployConfig,
  formatSummary,
  redact,
  runBootCheck,
  splitByBaseline,
  thrownSummary,
} from "../check-deploy-config.mjs";
import { workflowSteps } from "./helpers/workflow-yaml.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = join(REPO, "scripts", "ci", "check-deploy-config.mjs");
const DEPLOY = join(REPO, ".github", "workflows", "_deploy.yml");

const CANARY = "leak-canary";
// Staging's real ref (`.github/environments.json`, copied into each tree):
// `validateInputs` fences the functions deploy to it. A ref is not a secret.
const STAGING_REF = "hnoyzpidbmizhbqaiity";
const STORE = Object.freeze({
  SUPABASE_PROJECT_REF: STAGING_REF,
  SUPABASE_URL: `https://${CANARY}-0001.supabase.co`,
  SUPABASE_SERVICE_ROLE_KEY: `sb_publishable_${CANARY}-0002`,
  STRIPE_SECRET_KEY: `sk_test_${CANARY}-0003`,
  STRIPE_WEBHOOK_SECRET: `whsec_${CANARY}-0004`,
  STRIPE_PRICE_ID: `price_${CANARY}-0005`,
  SUPABASE_FUNCTIONS_DEPLOY_TOKEN: `sbp_${CANARY}-0006`,
  API_HEALTHCHECK_URL: `https://${CANARY}-0007.example/health`,
});

const CHILD_ENV = Object.freeze({ PATH: process.env.PATH });

// Stand-in boot checks, as CommonJS like the API's build output.
const BOOT = {
  accepts: "exports.validateEnv = () => {};",
  refusesByName:
    "exports.validateEnv = (c) => { if (!c.STRIPE_PRICE_ID) throw new Error('Missing required environment variables: STRIPE_PRICE_ID'); };",
  echoesValue:
    "exports.validateEnv = (c) => { throw new Error('SUPABASE_SERVICE_ROLE_KEY holds a client key: ' + c.SUPABASE_SERVICE_ROLE_KEY); };",
  // A fragment, which no exact-match mask catches: what JSON.parse's messages quote.
  typeErrorWithFragment:
    "exports.validateEnv = (c) => { throw new TypeError('bad token near ' + c.STRIPE_SECRET_KEY.slice(8, 19)); };",
  throwsValue: "exports.validateEnv = (c) => { throw c.STRIPE_SECRET_KEY; };",
  doesNotParse: "exports.validateEnv = (c) => {",
  noExport: "exports.somethingElse = () => {};",
  exits: "exports.validateEnv = () => { process.exit(0); };",
  // Prints everything it can reach, on load and when called. None of it may
  // reach the parent's output, and the store must not be in its environment.
  dumpsEverything: [
    "console.log(JSON.stringify(process.env)); console.error(JSON.stringify(process.env));",
    "exports.validateEnv = (c) => {",
    "  console.log(JSON.stringify(c)); console.error(JSON.stringify(c));",
    "  const leaked = Object.keys(c).filter((k) => process.env[k] !== undefined);",
    "  if (leaked.length) throw new Error('the store reached the child environment: ' + leaked.join(', '));",
    "};",
  ].join("\n"),
  reportsKeys:
    "exports.validateEnv = (c) => { throw new Error('KEYS ' + Object.keys(c).sort().join(',')); };",
};

let scratch;
before(() => {
  scratch = mkdtempSync(join(tmpdir(), "check-deploy-config-"));
});
after(() => rmSync(scratch, { recursive: true, force: true }));

let trees = 0;
/** A deployed tree: environments.json, the boot check's source marker, its build (if given), and functions. */
function tree({ boot, source = true, functions = [] } = {}) {
  const root = join(scratch, `tree-${(trees += 1)}`);
  mkdirSync(join(root, ".github"), { recursive: true });
  copyFileSync(join(REPO, ".github", "environments.json"), join(root, ".github", "environments.json"));
  if (source) {
    mkdirSync(dirname(join(root, BOOT_CHECK_SOURCE)), { recursive: true });
    writeFileSync(join(root, BOOT_CHECK_SOURCE), "// stand-in\n");
  }
  if (boot !== undefined) {
    mkdirSync(dirname(join(root, BOOT_CHECK_BUILD)), { recursive: true });
    writeFileSync(join(root, BOOT_CHECK_BUILD), `${boot}\n`);
  }
  for (const name of functions) {
    mkdirSync(join(root, "supabase", "functions", name), { recursive: true });
    writeFileSync(join(root, "supabase", "functions", name, "index.ts"), "// stand-in\n");
  }
  return root;
}

const boot = (name, config = { ...STORE }) => runBootCheck({ root: tree({ boot: BOOT[name] }), config, childEnv: CHILD_ENV });

describe("check-deploy-config: the boot check, in a child", () => {
  it("passes a config the deployed commit's validateEnv accepts", () => {
    const result = boot("accepts");
    assert.equal(result.status, "ok");
    assert.match(result.message, /accepts the 8 names Infisical injected/);
  });

  it("fails on a refusal, naming the variable and the rule", () => {
    const { STRIPE_PRICE_ID: _omitted, ...rest } = STORE;
    const result = boot("refusesByName", rest);
    assert.equal(result.status, "failed");
    assert.match(result.message, /would refuse to boot.*Missing required environment variables: STRIPE_PRICE_ID/);
  });

  it("redacts every injected value from a refusal that quotes one", () => {
    const result = boot("echoesValue");
    assert.equal(result.status, "failed");
    assert.match(result.message, /SUPABASE_SERVICE_ROLE_KEY holds a client key: \*\*\*/);
    assert.doesNotMatch(result.message, new RegExp(CANARY));
  });

  it("withholds the text of anything but a plain Error, which can quote part of a value", () => {
    for (const [name, kind] of [["typeErrorWithFragment", "TypeError"], ["throwsValue", "string"]]) {
      const result = boot(name);
      assert.equal(result.status, "failed", name);
      assert.match(result.message, new RegExp(`threw a ${kind} rather than refusing a variable`), name);
      assert.doesNotMatch(result.message, /canary|0003/, name);
    }
  });

  it("fails closed when the build can't be loaded, or has no validateEnv", () => {
    const missing = runBootCheck({ root: tree(), config: { ...STORE }, childEnv: CHILD_ENV });
    assert.equal(missing.status, "failed");
    assert.match(missing.message, /Could not load the API's boot check from apps\/api\/dist\/config\/env\.validation\.js/);
    const unparsable = boot("doesNotParse");
    assert.equal(unparsable.status, "failed");
    assert.match(unparsable.message, /threw a SyntaxError/);
    const noExport = boot("noExport");
    assert.equal(noExport.status, "failed");
    assert.match(noExport.message, /exports no validateEnv function/);
  });

  it("fails when the child leaves no verdict, withholding its output", () => {
    const result = boot("exits");
    assert.equal(result.status, "failed");
    assert.match(result.message, /exited 0 without a verdict\. Its output is withheld/);
  });

  it("keeps the store out of the child's environment, and the child's output out of the log", () => {
    const result = boot("dumpsEverything");
    assert.equal(result.status, "ok", result.message);
  });

  it("skips, with a reason, a commit that has no boot check source (a rollback past it)", () => {
    const result = runBootCheck({ root: tree({ source: false }), config: { ...STORE }, childEnv: CHILD_ENV });
    assert.equal(result.status, "skipped");
    assert.match(result.message, /no apps\/api\/src\/config\/env\.validation\.ts/);
  });
});

describe("check-deploy-config: what counts as injected, and redaction", () => {
  it("hands validateEnv the names the injection added, less this step's own inputs", () => {
    const env = { PATH: "/usr/bin", HOME: "/home/runner", ...STORE, CHECK_API_BOOT: "true", TRUSTED_CI: "/t", TARGET_ENVIRONMENT: "staging" };
    const { injected, before } = splitByBaseline(env, new Set(["PATH", "HOME"]));
    assert.deepEqual(Object.keys(injected).sort(), Object.keys(STORE).sort());
    assert.deepEqual(before, { PATH: "/usr/bin", HOME: "/home/runner" });
    for (const name of OWN_INPUTS) assert.ok(!(name in injected), name);
  });

  it("passes exactly those names through the child", () => {
    const result = runBootCheck({
      root: tree({ boot: BOOT.reportsKeys }),
      config: { B_NAME: "value-b", A_NAME: "value-a" },
      childEnv: CHILD_ENV,
    });
    assert.match(result.message, /KEYS A_NAME,B_NAME$/);
  });

  it("redacts longest first, and leaves values too short to mean anything", () => {
    assert.equal(redact("key abcdef and abcdefgh", ["abcdef", "abcdefgh"]), "key *** and ***");
    assert.equal(redact("version 0.9.1", ["1", "0.9"]), "version 0.9.1");
    assert.equal(redact("no values", [undefined, 42]), "no values");
  });

  it("lets only a plain Error's message out of the child", () => {
    assert.deepEqual(thrownSummary(new Error("A must be set")), { message: "A must be set" });
    assert.deepEqual(thrownSummary(new TypeError("x")), { kind: "TypeError" });
    assert.deepEqual(thrownSummary(new (class ZodError extends Error {})("x")), { kind: "ZodError" });
    assert.deepEqual(thrownSummary("a string"), { kind: "string" });
  });
});

describe("check-deploy-config: the secrets later steps read", () => {
  const flags = (apiBoot, functions, verify) => ({
    TARGET_ENVIRONMENT: "staging",
    CHECK_API_BOOT: String(apiBoot),
    DEPLOYS_FUNCTIONS: String(functions),
    VERIFIES_API: String(verify),
  });
  const check = (env, { functions = ["attachment-copy"] } = {}) =>
    checkDeployConfig({
      env,
      root: tree({ source: false }),
      baselineNames: new Set(["PATH"]),
      functions,
      runBoot: () => assert.fail("no boot check"),
    });

  it("passes when every secret this run reads is set", () => {
    const { problems, passed } = check({ ...STORE, ...flags(false, true, true) });
    assert.deepEqual(problems, []);
    assert.equal(passed.length, 2);
  });

  it("refuses a missing SUPABASE_FUNCTIONS_DEPLOY_TOKEN by the Edge Functions deploy's own rule", () => {
    for (const token of [undefined, ""]) {
      const { problems } = check({ ...STORE, SUPABASE_FUNCTIONS_DEPLOY_TOKEN: token, ...flags(false, true, false) });
      assert.equal(problems.length, 1);
      // validateInputs' message, on one line, naming the project from environments.json.
      assert.match(problems[0], /^SUPABASE_FUNCTIONS_DEPLOY_TOKEN is not set in this Infisical environment\. It is a Supabase access token scoped to frapp-staging alone/);
      assert.match(problems[0], /This run deploys attachment-copy after the migrations\.$/);
      assert.doesNotMatch(problems[0], /\n/);
    }
  });

  it("refuses, before anything is written, a project ref the functions deploy would refuse", () => {
    const { problems } = check({ ...STORE, SUPABASE_PROJECT_REF: "unttyvyfezddlyafcydh", ...flags(false, true, false) });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /^SUPABASE_PROJECT_REF does not match the 'staging' environment\./);
    const unnamed = check({ ...STORE, ...flags(false, true, false), TARGET_ENVIRONMENT: undefined });
    assert.match(unnamed.problems[0], /^TARGET_ENVIRONMENT must be 'staging' or 'production'/);
  });

  it("doesn't ask for the token when this run deploys no function, or the tree has none", () => {
    const env = { ...STORE, SUPABASE_FUNCTIONS_DEPLOY_TOKEN: "" };
    assert.deepEqual(check({ ...env, ...flags(false, false, false) }).problems, []);
    assert.deepEqual(check({ ...env, ...flags(false, true, false) }, { functions: [] }).problems, []);
  });

  it("refuses a missing or blank API_HEALTHCHECK_URL only when this run checks the served commit", () => {
    for (const url of [undefined, "", "  "]) {
      const { problems } = check({ ...STORE, API_HEALTHCHECK_URL: url, ...flags(false, false, true) });
      assert.equal(problems.length, 1);
      assert.match(problems[0], /^API_HEALTHCHECK_URL is not set .*verify-served-commit\.mjs/);
    }
    assert.deepEqual(check({ ...STORE, API_HEALTHCHECK_URL: "", ...flags(false, false, false) }).problems, []);
  });

  it("fails closed on a flag that is neither true nor false, so a typo can't switch a check off", () => {
    const { problems } = check({ ...STORE, CHECK_API_BOOT: "ture", DEPLOYS_FUNCTIONS: "", VERIFIES_API: "true" });
    assert.equal(problems.length, 2);
    assert.match(problems[0], /^CHECK_API_BOOT must be true or false \(got "ture"\)/);
    assert.match(problems[1], /^DEPLOYS_FUNCTIONS must be true or false \(got ""\)/);
  });

  it("names every problem at once, never a value", () => {
    const env = { ...STORE, SUPABASE_FUNCTIONS_DEPLOY_TOKEN: "", API_HEALTHCHECK_URL: "", ...flags(true, true, true) };
    const { problems } = checkDeployConfig({
      env,
      root: tree({ boot: BOOT.echoesValue }),
      baselineNames: new Set(["PATH"]),
      functions: ["attachment-copy"],
    });
    assert.equal(problems.length, 3);
    assert.doesNotMatch(problems.join("\n"), new RegExp(CANARY));
  });

  it("summarises what passed, what it didn't check, and what failed", () => {
    const summary = formatSummary({ passed: ["A is set."], warnings: ["no boot check here."], problems: ["B is not set."] });
    assert.equal(summary, "### Config check, before anything is written\n\n- ✅ A is set.\n- ⚠️ Not checked: no boot check here.\n- ❌ B is not set.\n\n");
    assert.match(formatSummary({ passed: [], warnings: [], problems: [] }), /Nothing to check/);
  });
});

describe("check-deploy-config: as the job runs it", () => {
  /**
   * Run the script from `root` as `_deploy.yml` does. The baseline holds PATH
   * and GITHUB_STEP_SUMMARY, which every step of a real job has, so the rest
   * is "injected".
   */
  function run(root, env) {
    const baseline = join(root, "baseline.json");
    const summary = join(root, "summary.md");
    writeFileSync(baseline, `${JSON.stringify(["GITHUB_STEP_SUMMARY", "PATH"])}\n`);
    writeFileSync(summary, "");
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: root,
      env: { PATH: process.env.PATH, ENV_BASELINE: baseline, GITHUB_STEP_SUMMARY: summary, TARGET_ENVIRONMENT: "staging", ...env },
      encoding: "utf8",
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}`, summary: readFileSync(summary, "utf8") };
  }

  it("exits 1 with one annotation per problem, and no value anywhere in its output", () => {
    const root = tree({ boot: BOOT.dumpsEverything.replace("exports.validateEnv = (c) => {", "exports.validateEnv = (c) => { throw new Error('APP_URL is ' + c.SUPABASE_URL);") , functions: ["attachment-copy"] });
    const { status, output, summary } = run(root, {
      ...STORE,
      SUPABASE_FUNCTIONS_DEPLOY_TOKEN: "",
      API_HEALTHCHECK_URL: "",
      CHECK_API_BOOT: "true",
      DEPLOYS_FUNCTIONS: "true",
      VERIFIES_API: "true",
    });
    assert.equal(status, 1, output);
    assert.equal(output.match(/^::error::/gm)?.length, 3, output);
    assert.match(output, /::error::The API would refuse to boot.*APP_URL is \*\*\*/);
    assert.match(output, /Nothing has been applied or deployed/);
    assert.doesNotMatch(output, new RegExp(CANARY), output);
    assert.equal(summary.match(/^- ❌ /gm)?.length, 3, summary);
    assert.doesNotMatch(summary, new RegExp(CANARY), summary);
  });

  it("redacts every injected value from every line it prints, the project ref included", () => {
    const root = tree({ functions: ["attachment-copy"] });
    const { status, output } = run(root, {
      ...STORE,
      TARGET_ENVIRONMENT: "production",
      CHECK_API_BOOT: "false",
      DEPLOYS_FUNCTIONS: "true",
      VERIFIES_API: "false",
    });
    assert.equal(status, 1, output);
    assert.match(output, /SUPABASE_PROJECT_REF does not match the 'production' environment\..*Injected \(SUPABASE_PROJECT_REF\): \*\*\*/);
    assert.doesNotMatch(output, new RegExp(STAGING_REF), output);
  });

  it("exits 0 and says what it checked when everything holds", () => {
    const root = tree({ boot: BOOT.dumpsEverything, functions: ["attachment-copy"] });
    const { status, output } = run(root, { ...STORE, CHECK_API_BOOT: "true", DEPLOYS_FUNCTIONS: "true", VERIFIES_API: "true" });
    assert.equal(status, 0, output);
    assert.match(output, /✓ The API's boot check .* accepts the 8 names Infisical injected/);
    assert.match(output, /✓ SUPABASE_FUNCTIONS_DEPLOY_TOKEN is set, for attachment-copy\./);
    assert.match(output, /✓ API_HEALTHCHECK_URL is set\./);
    assert.doesNotMatch(output, new RegExp(CANARY), output);
  });

  it("warns and passes on a rollback to a commit with no boot check, and says so in the summary", () => {
    const { status, output, summary } = run(tree({ source: false }), { ...STORE, CHECK_API_BOOT: "true", DEPLOYS_FUNCTIONS: "false", VERIFIES_API: "true" });
    assert.equal(status, 0, output);
    assert.match(output, /^::warning::This commit has no apps\/api\/src\/config\/env\.validation\.ts/m);
    assert.match(summary, /^- ⚠️ Not checked: This commit has no apps\/api\/src\/config\/env\.validation\.ts/m);
    assert.doesNotMatch(summary, /boot check .* accepts/);
  });

  it("refuses to check anything without the env baseline", () => {
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: tree(),
      env: { PATH: process.env.PATH, ENV_BASELINE: join(scratch, "nope.json"), CHECK_API_BOOT: "false", DEPLOYS_FUNCTIONS: "false", VERIFIES_API: "false" },
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /::error::Could not read the env baseline/);
  });
});

describe("_deploy.yml: the config check's place and wiring (#3112)", () => {
  const steps = () => workflowSteps(DEPLOY).filter((s) => s.jobId === "deploy");
  const at = (name) => {
    const index = steps().findIndex((s) => s.name === name);
    assert.ok(index >= 0, `_deploy.yml has no step "${name}"`);
    return index;
  };
  const step = (name) => steps()[at(name)];
  const BUILD = "Build the API, for its boot check";
  const CHECKS = ["Check the config before anything is written (staging)", "Check the config before anything is written (production)"];

  it("builds the API on the deployed commit before any secret, skipping only a migrations-only run", () => {
    const build = step(BUILD);
    // Skipped where the check would skip: no source, nothing to build.
    assert.equal(build.if, `\${{ inputs.scope != 'migrations-only' && hashFiles('${BOOT_CHECK_SOURCE}') != '' }}`);
    assert.match(build.body, /run: npx --no-install turbo run build --filter=api$/m);
    assert.doesNotMatch(build.body, /secrets\./);
    assert.ok(at("Install dependencies") < at(BUILD), "it builds before the install");
    assert.ok(at(BUILD) < at("Move the workspace to the trusted ref"), "it builds in the trusted window");
    for (const s of steps().slice(0, at(BUILD))) assert.doesNotMatch(s.body, /infisical-secrets/, `${s.name} injects before the build`);
  });

  it("checks from the trusted copy, after the injection and the plan, before anything is written", () => {
    const copy = step("Keep a trusted copy of the served-commit check");
    const record = step("Record the job's environment names before Infisical adds to them");
    const firstWrite = Math.min(
      at("Start disposable Supabase stack"),
      at("Run migrations (dry-run)"),
      at("Run migrations (apply)"),
      at("Deploy the Edge Functions (staging)"),
      at("Deploy the commit to Render (staging)"),
    );
    for (const name of CHECKS) {
      const check = step(name);
      assert.match(check.body, /run: node "\$TRUSTED_CI\/check-deploy-config\.mjs"$/m, name);
      assert.equal(check.env.get("TRUSTED_CI"), copy.env.get("TRUSTED_CI"), `${name} reads another copy`);
      assert.equal(check.env.get("ENV_BASELINE"), record.env.get("VERCEL_BUILD_ENV_BASELINE"), `${name} reads another baseline`);
      assert.ok(at(name) > at("Inject production secrets from Infisical"), `${name} runs before the injection`);
      assert.ok(at(name) > at("Check out the commit being deployed"), `${name} checks the trusted tree`);
      assert.ok(at(name) > at("Plan the deploy"), `${name} runs before the plan it reads`);
      assert.ok(at(name) < firstWrite, `${name} runs after a step that writes`);
      assert.doesNotMatch(check.body, /continue-on-error/);
    }
  });

  it("names each environment as its Edge Functions step does, for the deploy's own token rule", () => {
    for (const [check, deploy] of [
      [CHECKS[0], "Deploy the Edge Functions (staging)"],
      [CHECKS[1], "Deploy the Edge Functions (production)"],
    ]) {
      assert.ok(step(deploy).env.get("TARGET_ENVIRONMENT"), deploy);
      assert.equal(step(check).env.get("TARGET_ENVIRONMENT"), step(deploy).env.get("TARGET_ENVIRONMENT"), check);
    }
  });

  it("leaves a dry run's summary to the check's own section rather than restating it", () => {
    const stop = step("Stop here (dry run only)");
    assert.match(stop.body, /The config check passed\. Its section of this summary lists what it checked/);
    assert.doesNotMatch(stop.body, /accepts its values/);
  });

  it("runs on every production run, dry runs included, and asks only for what the real run needs", () => {
    const production = step(CHECKS[1]);
    assert.equal(production.if, "inputs.environment == 'production'");
    assert.equal(production.env.get("CHECK_API_BOOT"), "${{ inputs.scope != 'migrations-only' }}");
    assert.equal(production.env.get("DEPLOYS_FUNCTIONS"), "${{ inputs.scope != 'migrations-only' }}");
    assert.equal(production.env.get("VERIFIES_API"), "true");
    // The steps those flags stand in for: the same scope gate, and a verify on every real run.
    assert.match(step("Deploy the commit to Render (production)").if, /inputs\.scope != 'migrations-only'/);
    assert.match(step("Deploy the Edge Functions (production)").if, /inputs\.scope != 'migrations-only'/);
    assert.equal(step("Verify production serves the commit").if, "${{ inputs.environment == 'production' && !inputs.dry_run }}");
  });

  it("follows staging's plan, restating the conditions of the steps it stands in for", () => {
    const staging = step(CHECKS[0]);
    assert.equal(staging.if, "inputs.environment == 'staging'");
    assert.equal(staging.env.get("CHECK_API_BOOT"), "${{ steps.plan.outputs.deploy }}");
    assert.equal(step("Deploy the commit to Render (staging)").if, "steps.plan.outputs.deploy == 'true'");
    assert.equal(staging.env.get("DEPLOYS_FUNCTIONS"), "${{ steps.plan.outputs.plan != 'stale' }}");
    assert.match(step("Deploy the Edge Functions (staging)").if, /steps\.plan\.outputs\.plan != 'stale'/);
    assert.equal(staging.env.get("VERIFIES_API"), "${{ steps.plan.outputs.verify_sha != '' }}");
    assert.equal(step("Verify staging serves the commit").if, "steps.plan.outputs.verify_sha != ''");
  });

  it("loads the boot check from where the API's build puts it today", () => {
    // A move of env.validation.ts would turn every deploy's check into the
    // rollback warning. This makes the move fail here instead.
    const source = readFileSync(join(REPO, BOOT_CHECK_SOURCE), "utf8");
    assert.match(source, /^export function validateEnv\(/m);
    const buildConfig = readFileSync(join(REPO, "apps", "api", "tsconfig.build.json"), "utf8");
    assert.match(buildConfig, /"rootDir": "\.\/src"/);
    assert.match(readFileSync(join(REPO, "apps", "api", "tsconfig.json"), "utf8"), /"outDir": "\.\/dist"/);
    assert.equal(BOOT_CHECK_BUILD, BOOT_CHECK_SOURCE.replace(/^apps\/api\/src\//, "apps/api/dist/").replace(/\.ts$/, ".js"));
  });
});
