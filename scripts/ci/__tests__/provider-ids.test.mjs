// Provider ids live in `.github/environments.json` and nowhere else (#2806).
//
// Workflows used to carry the API's service ids and the Vercel team and
// project ids as literals, in several files, with comments asking humans to keep
// the copies in step. A copy that drifts deploys to, or asserts against, some
// other service while every check reads green. So: the file holds them, the
// loader validates them, `provider-ids.mjs` hands them to a workflow as step
// outputs, and no workflow or action names one as a literal.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ENVIRONMENTS,
  VERCEL_PROJECT_ID_PATTERN,
  VERCEL_TEAM_ID_PATTERN,
  parseProviderIds,
  providerIdsFor,
} from "../lib/environments.mjs";
import { PROVIDER_ID_OUTPUTS, formatProviderOutputs } from "../provider-ids.mjs";
import { workflowFiles, workflowSteps } from "./helpers/workflow-yaml.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOW_DIR = join(REPO_ROOT, ".github", "workflows");
const ACTIONS_DIR = join(REPO_ROOT, ".github", "actions");
const SCRIPT = join(REPO_ROOT, "scripts", "ci", "provider-ids.mjs");

const cloudRun = (overrides = {}) => ({
  projectId: "nonprod-123",
  projectNumber: "211663803311",
  region: "us-east4",
  minInstances: 0,
  maxInstances: 1,
  ...overrides,
});

const config = (mutate = (c) => c) => {
  const base = {
    environments: {
      staging: { supabaseProjectRef: "aaaaaaaaaaaaaaa", cloudRun: cloudRun() },
      production: {
        supabaseProjectRef: "bbbbbbbbbbbbbbb",
        cloudRun: cloudRun({ projectId: "prod-456", projectNumber: "930610426605", region: "us-east5", minInstances: 1 }),
      },
    },
    vercel: { teamId: "team_abc", webProjectId: "prj_web", landingProjectId: "prj_landing" },
  };
  return JSON.stringify(mutate(base));
};

describe("the committed config", () => {
  it("names a distinct Google Cloud project per environment, and the Vercel team and projects", () => {
    const seen = new Set();
    for (const name of ENVIRONMENTS) {
      const ids = providerIdsFor(name);
      assert.ok(ids.gcpProjectId, name);
      assert.match(ids.vercelTeamId, VERCEL_TEAM_ID_PATTERN, name);
      assert.match(ids.vercelWebProjectId, VERCEL_PROJECT_ID_PATTERN, name);
      assert.match(ids.vercelLandingProjectId, VERCEL_PROJECT_ID_PATTERN, name);
      seen.add(ids.gcpProjectId);
    }
    assert.equal(seen.size, ENVIRONMENTS.length);
  });

  // Which id is which environment's, and which project is web's, can't be told
  // from the format. A swap would send every merge to production's API, or
  // web's bundle to the landing project, with CI green. So the committed
  // values are pinned here, as environments.test.mjs pins the Supabase refs,
  // and moving one is a reviewed change in two files. These are the literals
  // each workflow step used before #2806 moved them.
  it("pins which service and project each id is", () => {
    assert.equal(providerIdsFor("staging").gcpProjectId, "cs-project-6vw9f5xp", "nonprod");
    assert.equal(providerIdsFor("production").gcpProjectId, "cs-project-nyit2x59", "prod");
    const ids = providerIdsFor("production");
    assert.equal(ids.vercelWebProjectId, "prj_xkn32taKrJCgYRZoN6pZRfGfPT9T", "frapp-web");
    assert.equal(ids.vercelLandingProjectId, "prj_aAkER9EZJcxR51vUY0mwNDnCf8vy", "frapp-landing");
    assert.equal(ids.vercelTeamId, "team_j9XLIANou5EpvALrr4bM9Nee");
  });
});

describe("parseProviderIds", () => {
  it("returns the named environment's project and the shared Vercel ids", () => {
    assert.deepEqual(parseProviderIds(config(), "staging"), {
      environment: "staging",
      gcpProjectId: "nonprod-123",
      gcpRegion: "us-east4",
      cloudRunService: "frapp-api",
      cloudRunImage: "us-east4-docker.pkg.dev/nonprod-123/frapp/api",
      cloudRunDeployer: "frapp-deployer@nonprod-123.iam.gserviceaccount.com",
      cloudRunRuntime: "frapp-api-runtime@nonprod-123.iam.gserviceaccount.com",
      cloudRunProvider: "projects/211663803311/locations/global/workloadIdentityPools/github/providers/frapplive-frapp",
      cloudRunMinInstances: "0",
      cloudRunMaxInstances: "1",
      vercelTeamId: "team_abc",
      vercelWebProjectId: "prj_web",
      vercelLandingProjectId: "prj_landing",
    });
    assert.equal(parseProviderIds(config(), "production").gcpProjectId, "prod-456");
  });

  // No default anywhere: a wrong id deploys to some other service.
  it("refuses an unknown environment, a missing or malformed id, and shared ids", () => {
    const refusals = [
      ["an unknown environment", config(), "preview"],
      ["no vercel block", config((c) => (delete c.vercel, c)), "staging"],
      ["a malformed team id", config((c) => ((c.vercel.teamId = "j9XL"), c)), "staging"],
      ["a malformed project id", config((c) => ((c.vercel.landingProjectId = "landing"), c)), "production"],
      ["one project for web and landing", config((c) => ((c.vercel.landingProjectId = "prj_web"), c)), "staging"],
    ];
    for (const [label, text, name] of refusals) {
      assert.throws(() => parseProviderIds(text, name), Error, label);
    }
  });
});

describe("Cloud Run (#5228)", () => {
  it("derives the service, registry, accounts and sign-in provider from the project", () => {
    const ids = parseProviderIds(config(), "staging");
    assert.equal(ids.cloudRunService, "frapp-api");
    assert.equal(ids.cloudRunImage, "us-east4-docker.pkg.dev/nonprod-123/frapp/api");
    assert.equal(ids.cloudRunDeployer, "frapp-deployer@nonprod-123.iam.gserviceaccount.com");
    assert.equal(ids.cloudRunRuntime, "frapp-api-runtime@nonprod-123.iam.gserviceaccount.com");
    assert.equal(
      ids.cloudRunProvider,
      "projects/211663803311/locations/global/workloadIdentityPools/github/providers/frapplive-frapp",
    );
    assert.equal(ids.cloudRunMinInstances, "0");
  });

  it("refuses a missing or bad block and a shared project", () => {
    const refusals = [
      ["no block", config((c) => (delete c.environments.staging.cloudRun, c)), "staging"],
      ["a malformed project", config((c) => ((c.environments.staging.cloudRun.projectId = "Bad_Id"), c)), "staging"],
      ["a missing number", config((c) => (delete c.environments.staging.cloudRun.projectNumber, c)), "staging"],
      ["min above max", config((c) => ((c.environments.staging.cloudRun.minInstances = 2), c)), "staging"],
      ["no max", config((c) => (delete c.environments.staging.cloudRun.maxInstances, c)), "staging"],
      [
        "one project for both",
        config((c) => ((c.environments.production.cloudRun = cloudRun({ minInstances: 1 })), c)),
        "staging",
      ],
    ];
    for (const [label, text, name] of refusals) {
      assert.throws(() => parseProviderIds(text, name), Error, label);
    }
  });

  it("pins the committed projects: staging deploys to nonprod, production's block names prod", () => {
    const staging = providerIdsFor("staging");
    assert.equal(staging.gcpProjectId, "cs-project-6vw9f5xp");
    assert.equal(staging.gcpRegion, "us-east4");
    const production = providerIdsFor("production");
    assert.equal(production.gcpProjectId, "cs-project-nyit2x59");
    assert.equal(production.gcpRegion, "us-east5");
  });
});

describe("provider-ids.mjs", () => {
  it("writes one output per id, named as the workflows read them", () => {
    const ids = parseProviderIds(config(), "production");
    assert.equal(
      formatProviderOutputs(ids),
      "gcp_project_id=prod-456\ngcp_region=us-east5\ncloud_run_service=frapp-api\n" +
        "cloud_run_image=us-east5-docker.pkg.dev/prod-456/frapp/api\n" +
        "cloud_run_deployer=frapp-deployer@prod-456.iam.gserviceaccount.com\n" +
        "cloud_run_runtime=frapp-api-runtime@prod-456.iam.gserviceaccount.com\n" +
        "cloud_run_provider=projects/930610426605/locations/global/workloadIdentityPools/github/providers/frapplive-frapp\n" +
        "cloud_run_min_instances=1\ncloud_run_max_instances=1\n" +
        "vercel_team_id=team_abc\n" +
        "vercel_web_project_id=prj_web\nvercel_landing_project_id=prj_landing\n",
    );
  });

  it("appends the committed ids to GITHUB_OUTPUT, and fails on an unknown environment", () => {
    const dir = mkdtempSync(join(tmpdir(), "provider-ids-"));
    try {
      const out = join(dir, "out");
      writeFileSync(out, "earlier=1\n");
      const run = (environment) =>
        spawnSync(process.execPath, [SCRIPT], {
          env: { PATH: process.env.PATH, TARGET_ENVIRONMENT: environment, GITHUB_OUTPUT: out },
          encoding: "utf8",
        });
      const ok = run("staging");
      assert.equal(ok.status, 0, ok.stderr);
      assert.equal(readFileSync(out, "utf8"), `earlier=1\n${formatProviderOutputs(providerIdsFor("staging"))}`);
      const bad = run("preview");
      assert.equal(bad.status, 1);
      assert.match(bad.stderr, /::error::Unknown environment "preview"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The acceptance criterion of #2806, as a grep: the ids' own prefixes.
describe("no workflow or action names a provider id", () => {
  const LITERAL = /\b(?:cs-project-[a-z0-9]{6,}|prj_[A-Za-z0-9]{6,}|team_[A-Za-z0-9]{6,})\b/;
  // Every file, not only YAML: an action's shell helper or README could carry
  // a literal just as well.
  const files = (dir) =>
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => join(e.parentPath ?? e.path, e.name));

  it("finds the files it scans", () => {
    assert.ok(files(WORKFLOW_DIR).length > 20);
    assert.ok(files(ACTIONS_DIR).length > 3);
  });

  it("holds every id in .github/environments.json alone", () => {
    for (const file of [...files(WORKFLOW_DIR), ...files(ACTIONS_DIR)]) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          assert.doesNotMatch(line, LITERAL, `${file.slice(REPO_ROOT.length + 1)}:${i + 1} names a provider id`);
        });
    }
    // The pattern is live: it matches what the config holds.
    const { gcpProjectId, vercelTeamId, vercelWebProjectId, vercelLandingProjectId } = providerIdsFor("production");
    for (const id of [gcpProjectId, vercelTeamId, vercelWebProjectId, vercelLandingProjectId]) assert.match(id, LITERAL);
  });
});

// Every step that hands an id to a script takes it from the ids step of its own
// job, which reads the environment that job deploys to or watches.
describe("every consumer reads the ids step of its own job", () => {
  const OUTPUTS = PROVIDER_ID_OUTPUTS.map(([, output]) => output);
  const NAMES = new Map([
    ["GCP_PROJECT_ID", "gcp_project_id"],
    ["GCP_REGION", "gcp_region"],
    ["CLOUD_RUN_SERVICE", "cloud_run_service"],
    ["CLOUD_RUN_IMAGE", "cloud_run_image"],
    ["CLOUD_RUN_DEPLOYER", "cloud_run_deployer"],
    ["CLOUD_RUN_RUNTIME", "cloud_run_runtime"],
    ["CLOUD_RUN_PROVIDER", "cloud_run_provider"],
    ["CLOUD_RUN_MIN_INSTANCES", "cloud_run_min_instances"],
    ["CLOUD_RUN_MAX_INSTANCES", "cloud_run_max_instances"],
    ["VERCEL_TEAM_ID", "vercel_team_id"],
    ["VERCEL_WEB_PROJECT_ID", "vercel_web_project_id"],
    ["VERCEL_LANDING_PROJECT_ID", "vercel_landing_project_id"],
  ]);
  // Which environment each job's ids step reads.
  const EXPECTED = new Map([
    ["_deploy.yml/deploy", "${{ inputs.environment }}"],
    ["deploy-staging.yml/prune-vercel-staging", "staging"],
    ["production-guardrails.yml/guardrails", "production"],
    ["production-release-pin.yml/pin", "production"],
  ]);

  it("covers every output the script writes", () => {
    assert.deepEqual([...NAMES.values()].sort(), [...OUTPUTS].sort());
  });

  it("has an ids step, earlier in the job, for the environment the job is about", () => {
    const seen = new Set();
    for (const file of workflowFiles()) {
      const steps = workflowSteps(join(WORKFLOW_DIR, file));
      steps.forEach((step, i) => {
        for (const [name, output] of NAMES) {
          if (!step.env.has(name)) continue;
          const job = `${file}/${step.jobId}`;
          seen.add(job);
          assert.equal(step.env.get(name), `\${{ steps.ids.outputs.${output} }}`, `${job} "${step.name}" ${name}`);
          const ids = steps.slice(0, i).find((s) => s.jobId === step.jobId && /^\s+id: ids$/m.test(s.body));
          assert.ok(ids, `${job} "${step.name}" reads steps.ids before any ids step`);
          assert.match(ids.body, /run: node scripts\/ci\/provider-ids\.mjs/);
          assert.equal(ids.env.get("TARGET_ENVIRONMENT"), EXPECTED.get(job), `${job} reads another environment's ids`);
        }
      });
    }
    assert.deepEqual([...seen].sort(), [...EXPECTED.keys()].sort());
  });

  // The ids come from the trusted ref, like the local actions: a rollback to an
  // older commit still deploys to the services the config names today.
  it("reads them in _deploy.yml's trusted window", () => {
    const names = workflowSteps(join(WORKFLOW_DIR, "_deploy.yml")).map((s) => s.name);
    const at = (n) => names.indexOf(n);
    assert.ok(at("Move the workspace to the trusted ref") < at("Read the provider ids"));
    assert.ok(at("Read the provider ids") < at("Provider guardrail preflight"));
    assert.ok(at("Read the provider ids") < at("Check out the commit being deployed"));
  });
});
