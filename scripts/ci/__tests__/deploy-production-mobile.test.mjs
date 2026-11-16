// The opt-in store build after a production ship (#3111):
// `deploy-production.yml`'s `mobile_build` input and `mobile` job, and the
// workflow it calls, `_mobile-build.yml`, which builds on GitHub's runners
// (#5162). The rules it exists for are in that
// file's header; each block below pins one of them.
//
// The job-level `if:` is evaluated, not grepped. The acceptance criteria are
// statements about every combination of inputs ("a dry run or a
// migrations-only run never builds, even with the box ticked"; "unticked, a
// run behaves exactly as before"), and a regex over the expression can't tell
// `!inputs.dry_run_only &&` from `!inputs.dry_run_only ||`. `evaluate` below
// reads the small subset of GitHub's expression language these conditions
// use, and throws on anything else, so a condition it can't read fails here
// instead of passing unread.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  USES_ANY_LOCAL_ACTION,
  WORKSPACE_REWRITE_RE,
  runsInstall,
  workflowJobs,
  workflowSteps,
} from "./helpers/workflow-yaml.mjs";
import { latestReleaseTag } from "../lib/release-tag.mjs";
import { parseEasCliPin } from "../../eas.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CALLER = join(REPO_ROOT, ".github", "workflows", "deploy-production.yml");
const CALLED = join(REPO_ROOT, ".github", "workflows", "_mobile-build.yml");
const VALIDATED_SHA = "${{ needs.validate.outputs.sha }}";
const SHA = "979c914f0123456789abcdef0123456789abcdef";

const jobOf = (path, id) => {
  const job = workflowJobs(path).find((j) => j.jobId === id);
  assert.ok(job, `${path.split("/").pop()} has no job "${id}"`);
  return job;
};
const stepsOf = (path, jobId) => workflowSteps(path).filter((s) => s.jobId === jobId);
const stepNamed = (path, jobId, name) => {
  const step = stepsOf(path, jobId).find((s) => s.name === name);
  assert.ok(step, `${jobId} has no step "${name}"`);
  return step;
};

/** A step's shell script: its `run: |` block dedented, or its one-line `run:`. */
function scriptOf(step) {
  const lines = step.body.split("\n");
  const at = lines.findIndex((l) => /^\s+run:/.test(l));
  assert.notEqual(at, -1, `step "${step.name}" has no run:`);
  const inline = lines[at].replace(/^\s+run:\s*/, "");
  if (inline !== "|") return inline;
  const indent = lines[at].match(/^\s*/)[0].length;
  const block = [];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() !== "" && line.match(/^\s*/)[0].length <= indent) break;
    block.push(line);
  }
  const depth = Math.min(...block.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length));
  return block.map((l) => l.slice(depth)).join("\n");
}

// ── A reader for the expressions these `if:`s use ─────────────────────────
// Literals ('x', true, false), context paths (`inputs.scope`,
// `needs.deploy.result`, hyphens allowed), `!`, `==`, `!=`, `&&`, `||` and
// parentheses. `==` on two strings ignores case, as GitHub's does. Anything
// else throws.
function evaluate(expression, context) {
  const source = expression.trim().replace(/^\$\{\{([\s\S]*)\}\}$/, "$1");
  const tokens = source.match(/'(?:[^']|'')*'|&&|\|\||==|!=|!|\(|\)|[A-Za-z_][\w.-]*|\S/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const take = (want) => {
    const token = tokens[i++];
    if (want !== undefined && token !== want) throw new Error(`expected ${want}, got ${token} in ${expression}`);
    return token;
  };
  const truthy = (v) => v !== false && v !== "" && v !== null && v !== undefined;
  const equal = (a, b) => {
    if (typeof a === "string" && typeof b === "string") return a.toLowerCase() === b.toLowerCase();
    if (typeof a !== typeof b) throw new Error(`comparing ${typeof a} with ${typeof b} in ${expression}`);
    return a === b;
  };
  function primary() {
    const token = take();
    if (token === "(") {
      const value = or();
      take(")");
      return value;
    }
    if (token === "!") return !truthy(primary());
    if (/^'/.test(token)) return token.slice(1, -1).replace(/''/g, "'");
    if (token === "true") return true;
    if (token === "false") return false;
    if (/^[A-Za-z_]/.test(token)) {
      if (peek() === "(") throw new Error(`function ${token}() is not supported in ${expression}`);
      return token.split(".").reduce((value, key) => {
        if (value === null || typeof value !== "object" || !(key in value)) {
          throw new Error(`unknown context path ${token} in ${expression}`);
        }
        return value[key];
      }, context);
    }
    throw new Error(`unexpected ${token} in ${expression}`);
  }
  function comparison() {
    let left = primary();
    while (peek() === "==" || peek() === "!=") {
      const op = take();
      const right = primary();
      left = op === "==" ? equal(left, right) : !equal(left, right);
    }
    return left;
  }
  function and() {
    let left = comparison();
    while (peek() === "&&") {
      take();
      const right = comparison();
      left = truthy(left) ? right : left;
    }
    return left;
  }
  function or() {
    let left = and();
    while (peek() === "||") {
      take();
      const right = and();
      left = truthy(left) ? left : right;
    }
    return left;
  }
  const value = or();
  if (i !== tokens.length) throw new Error(`trailing ${tokens.slice(i).join(" ")} in ${expression}`);
  return truthy(value);
}

describe("the expression reader", () => {
  it("reads what it claims to, and refuses the rest", () => {
    const ctx = { inputs: { a: "ios", b: false }, needs: { "x-y": { result: "success" } } };
    assert.equal(evaluate("${{ inputs.a == 'IOS' && !inputs.b }}", ctx), true);
    assert.equal(evaluate("${{ inputs.a != 'ios' || needs.x-y.result == 'failure' }}", ctx), false);
    assert.equal(evaluate("${{ !(inputs.a == 'ios') }}", ctx), false);
    assert.throws(() => evaluate("${{ always() }}", ctx), /not supported/);
    assert.throws(() => evaluate("${{ inputs.nope == 'x' }}", ctx), /unknown context path/);
    assert.throws(() => evaluate("${{ inputs.b == 'false' }}", ctx), /comparing boolean with string/);
  });
});

describe("the mobile_build input", () => {
  it("is a choice whose default does nothing for the app", () => {
    const lines = readFileSync(CALLER, "utf8").split("\n");
    const at = lines.findIndex((l) => /^ {6}mobile_build:\s*$/.test(l));
    assert.notEqual(at, -1, "deploy-production.yml has no mobile_build input");
    const block = [];
    for (const line of lines.slice(at + 1)) {
      if (/^ {0,6}\S/.test(line)) break;
      block.push(line);
    }
    const value = (key) => block.find((l) => new RegExp(`^ {8}${key}:`).test(l))?.replace(/^ {8}\w+:\s*/, "");
    assert.equal(value("type"), "choice");
    assert.equal(value("default"), "auto");
    assert.equal(value("required"), "false");
    assert.equal(value("options"), "[none, ios, android, all, auto]");
  });
});

// Three jobs read the input: `mobile-plan` decides once, from the trusted
// ref, and `mobile` (store build) and `ota` (update) act on its two outputs.
describe("the app jobs run only after a live, tagged full ship, for a value named in full", () => {
  const MODES = ["none", "ios", "android", "all", "auto", "", "bogus"];
  const RESULTS = ["success", "failure", "skipped", "cancelled"];
  const PLAN_VALUES = ["none", "ios", "android", "all", "", "bogus"];
  const live = (dry_run_only, scope, deploy, release) =>
    !dry_run_only && scope !== "migrations-only" && deploy === "success" && release === "success";

  it("plans exactly when every condition holds, across every combination", () => {
    const condition = jobOf(CALLER, "mobile-plan").if;
    assert.ok(condition, "the mobile-plan job has no if:");
    let planned = 0;
    for (const mobile_build of MODES)
      for (const dry_run_only of [true, false])
        for (const scope of ["full", "migrations-only", ""])
          for (const deploy of RESULTS)
            for (const release of RESULTS) {
              const runs = evaluate(condition, {
                inputs: { mobile_build, dry_run_only, scope },
                needs: { deploy: { result: deploy }, release: { result: release } },
              });
              const expected = ["ios", "android", "all", "auto"].includes(mobile_build) && live(dry_run_only, scope, deploy, release);
              assert.equal(runs, expected, JSON.stringify({ mobile_build, dry_run_only, scope, deploy, release }));
              if (runs) planned += 1;
            }
    // Four modes, two scopes that ship (`full`, and an empty scope that ships
    // like `full`): the table above was not vacuous.
    assert.equal(planned, 8);
  });

  it("builds and publishes only what a successful plan names, after a live ship", () => {
    const build = jobOf(CALLER, "mobile").if;
    const ota = jobOf(CALLER, "ota").if;
    let builds = 0;
    let publishes = 0;
    for (const mobile_build of MODES)
      for (const dry_run_only of [true, false])
        for (const scope of ["full", "migrations-only"])
          for (const deploy of ["success", "failure"])
            for (const plan of RESULTS)
              for (const out of PLAN_VALUES) {
                const ctx = {
                  inputs: { mobile_build, dry_run_only, scope },
                  needs: {
                    deploy: { result: deploy },
                    release: { result: "success" },
                    "mobile-plan": { result: plan, outputs: { build: out, update: out } },
                  },
                };
                const ok = live(dry_run_only, scope, deploy, "success") && plan === "success" && ["ios", "android", "all"].includes(out);
                const key = JSON.stringify({ mobile_build, dry_run_only, scope, deploy, plan, out });
                assert.equal(evaluate(build, ctx), ok, `mobile ${key}`);
                // An update only ever comes from `auto`, whatever the plan says.
                assert.equal(evaluate(ota, ctx), ok && mobile_build === "auto", `ota ${key}`);
                if (ok) builds += 1;
                if (ok && mobile_build === "auto") publishes += 1;
              }
    assert.ok(builds > 0 && publishes > 0, "the tables above were vacuous");
  });

  it("waits for the deploy, the tag and the plan, and acts on the validated SHA", () => {
    assert.equal(jobOf(CALLER, "mobile-plan").keys.get("needs"), "[validate, deploy, release]");
    for (const [id, uses, output] of [
      ["mobile", "./.github/workflows/_mobile-build.yml", "build"],
      ["ota", "./.github/workflows/_mobile-update.yml", "update"],
    ]) {
      const job = jobOf(CALLER, id);
      assert.equal(job.keys.get("needs"), "[validate, deploy, release, mobile-plan]", id);
      assert.equal(job.keys.get("uses"), uses, id);
      const call = job.keys.get("with");
      assert.equal(call.get("sha"), VALIDATED_SHA, id);
      assert.equal(call.get("platform"), `\${{ needs.mobile-plan.outputs.${output} }}`, id);
      // The called jobs read `automation` secrets, which a called job gets
      // only through `inherit` (#2804).
      assert.equal(job.keys.get("secrets"), "inherit", id);
    }
  });

  it("the plan holds no secret, runs the trusted ref's script, and installs the shipped tree inert", () => {
    const steps = stepsOf(CALLER, "mobile-plan");
    assert.doesNotMatch(steps.map((s) => s.body).join("\n"), /secrets\./);
    const plan = stepNamed(CALLER, "mobile-plan", "Plan the store build and the update");
    assert.equal(scriptOf(plan), "node trusted/scripts/ci/plan-mobile-release.mjs");
    const install = stepNamed(CALLER, "mobile-plan", "Install the shipped commit's dependencies (no install scripts)");
    assert.equal(scriptOf(install), "npm ci --ignore-scripts --no-audit --no-fund");
    const names = steps.map((s) => s.name);
    assert.ok(names.indexOf("Check out the shipped commit (read, never run)") < names.indexOf("Check out the trusted ref beside it"), "the root checkout comes first");
  });
});

describe("unticked, a run is what it was", () => {
  it("nothing else in the dispatch reads the input", () => {
    for (const j of workflowJobs(CALLER).filter((x) => !["mobile-plan", "mobile", "ota"].includes(x.jobId))) {
      assert.doesNotMatch(String(j.if ?? ""), /mobile/, `${j.jobId}'s if: reads the mobile input`);
    }
    const text = readFileSync(CALLER, "utf8")
      .split("\n")
      .filter((l) => !/^\s*#/.test(l));
    const reads = text.filter((l) => /inputs\.mobile_build|needs\.mobile\b(?!-)/.test(l)).map((l) => l.trim());
    // The plan's own reads, the update's `auto` clause, and the summary's,
    // for one message on a failed tag, run below.
    assert.deepEqual(reads, [
      `if: ${jobOf(CALLER, "mobile-plan").if}`,
      "if: ${{ inputs.mobile_build == 'auto' }}",
      "if: ${{ inputs.mobile_build == 'auto' }}",
      "MOBILE_BUILD: ${{ inputs.mobile_build }}",
      `if: ${jobOf(CALLER, "ota").if}`,
      "MOBILE_BUILD: ${{ inputs.mobile_build }}",
    ]);
  });

  it("the summary job's inputs are unchanged, so its report and alert are too", () => {
    assert.equal(jobOf(CALLER, "deploy-outcome").keys.get("needs"), "[validate, deploy, release]");
  });

  // A failed tag skips the store build (`mobile` needs `release`), and the
  // Release workflow, the retry the summary names, never builds. So a run
  // that asked for one says so, and names the retry that keeps it.
  describe("the summary, when the tag failed", () => {
    const step = () => stepNamed(CALLER, "deploy-outcome", "Summarise what actually happened");
    function run(mobileBuild, releaseResult = "failure") {
      const dir = mkdtempSync(join(tmpdir(), "mobile-summary-"));
      const summaryFile = join(dir, "summary.md");
      writeFileSync(summaryFile, "");
      const result = runStep(step(), {
        cwd: dir,
        env: {
          GITHUB_STEP_SUMMARY: summaryFile,
          SHA,
          SCOPE: "full",
          DRY_RUN: "false",
          DEPLOY_RESULT: "success",
          RELEASE_RESULT: releaseResult,
          RESOLVED: "false",
          ALERT_OUTCOME: "",
          MOBILE_BUILD: mobileBuild,
        },
      });
      rmSync(dir, { recursive: true, force: true });
      return result;
    }

    it("reads the input only through its env", () => {
      assert.equal(step().env.get("MOBILE_BUILD"), "${{ inputs.mobile_build }}");
    });

    it("names the skipped store build, and the retry that keeps it, only when one was asked for", () => {
      const none = run("none");
      assert.equal(none.status, 1);
      assert.match(none.stdout, /Re-run the 'Release' workflow manually with sha=/);
      assert.doesNotMatch(none.stdout, /store build/, "unticked, the message is what it was");
      for (const platform of ["ios", "android", "all", "auto"]) {
        const asked = run(platform);
        assert.equal(asked.status, 1, platform);
        assert.match(asked.stdout, new RegExp(`asked for a store build or update \\(${platform}\\).*Re-run failed jobs on this run`), platform);
      }
      assert.equal(run("ios", "success").status, 0, "a tagged ship says nothing about the store build here");
    });
  });

  // The approval count. Every job that names `production` costs an Approve
  // click (deploy-production.yml's header). The dispatch names none itself,
  // `_deploy.yml`'s one job is the click, and the mobile jobs name
  // `automation`, which has no reviewers (agent-infra.md § GitHub
  // environments and bootstrap secrets).
  it("adds no Approve click: the mobile jobs name automation, never production", () => {
    for (const j of workflowJobs(CALLER)) {
      assert.equal(j.keys.has("environment"), false, `deploy-production.yml job "${j.jobId}" names an environment`);
    }
    const jobs = workflowJobs(CALLED);
    assert.deepEqual(jobs.map((j) => j.jobId), ["snapshot", "ios", "android", "record", "confirm", "merge-record"]);
    for (const j of jobs) {
      const env = j.keys.get("environment");
      assert.ok(env instanceof Map, `${j.jobId} must name its environment in block form`);
      assert.equal(env.get("name"), "automation", j.jobId);
      assert.equal(env.get("deployment"), "false", `${j.jobId} must not create deployment records`);
    }
    assert.doesNotMatch(readFileSync(CALLED, "utf8"), /^\s*(environment|name):\s*production\s*$/m);
  });

  it("is callable only, so nothing but the dispatch can start a build", () => {
    const on = readFileSync(CALLED, "utf8").match(/^on:\n((?: {2}.*\n|\n)*)/m)?.[1] ?? "";
    const triggers = on.split("\n").filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim());
    assert.deepEqual(triggers, ["workflow_call:"]);
  });
});

// The run stays in flight while the builds and Expo's queue take their time, and migration-snapshot.yml
// publishes only when a Deploy production run completes. Without this job the
// required PR migration gates would judge production against the pre-ship
// snapshot for hours (download-migration-snapshot's header).
describe("the migration snapshot is published as the store build starts", () => {
  it("dispatches the publisher on main, beside the build, holding only actions: write", () => {
    const job = jobOf(CALLED, "snapshot");
    assert.equal(job.keys.has("needs"), false, "it must not wait for the store build");
    assert.equal(job.if, null);
    assert.deepEqual([...job.keys.get("permissions")], [["actions", "write"]]);
    const [step] = stepsOf(CALLED, "snapshot");
    assert.equal(scriptOf(step), 'gh workflow run migration-snapshot.yml --repo "$REPO" --ref main');
    assert.equal(step.env.get("GH_TOKEN"), "${{ github.token }}");
    assert.match(readFileSync(join(REPO_ROOT, ".github", "workflows", "migration-snapshot.yml"), "utf8"), /^ {2}workflow_dispatch:/m);
  });

  it("gets actions: write from the call, and the jobs that run eas or open the PR don't", () => {
    assert.deepEqual([...jobOf(CALLER, "mobile").keys.get("permissions")], [
      ["contents", "read"],
      ["actions", "write"],
    ]);
    for (const id of ["ios", "android", "record", "confirm"]) {
      assert.deepEqual([...jobOf(CALLED, id).keys.get("permissions")], [["contents", "read"]], id);
    }
  });
});

// Each platform builds in its own job on a GitHub runner (#5162).
const BUILD_JOBS = ["ios", "android"];
const STAGING = join(REPO_ROOT, ".github", "workflows", "staging-app.yml");
const INPUTS = "Check the inputs, and that EXPO_TOKEN reached this job";
const CONFIRM = "Confirm the tree is exactly the shipped commit";
const INSTALL_EAS = "Install EAS CLI";
const FIREBASE = "Fetch the Firebase config from EAS";
const SENTRY = "Turn the Sentry upload off when no token reached this job";
const BUILD = "Build (Release, signed with EAS's credentials)";
const PLIST = "Check the binary carries the version it is recorded as";
const XCODE = "Pick the newest stable Xcode 26 on the runner";
const JAVA = "Use Java 17 and give Gradle the memory the runner has";
const TAG_STEPS = {
  build: "Check the SHA is still the latest tag, before building",
  upload: "Check the SHA is still the latest tag, before uploading",
};
const CONFIRM_POLL = "Wait for each submission to finish on EAS";
const UPLOAD_STEPS = {
  ios: "Upload iOS to TestFlight (not submitted for review)",
  android: "Upload Android to the Play internal track (not promoted)",
};
const ARCHIVES = { ios: "${{ runner.temp }}/frapp.ipa", android: "${{ runner.temp }}/frapp.aab" };
const RUN_URL_EXPR = "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}";

/**
 * Runs a step's script under `bash -eo pipefail`, what the runner uses for
 * `shell: bash`. `flags: ["-e"]` gives the runner's default when a step names
 * no shell, as this file's steps don't, so a test of a step's own
 * `set -o pipefail` can see it go missing.
 */
function runStep(step, { cwd, env, flags = ["-eo", "pipefail"] }) {
  return spawnSync("bash", [...flags, "-c", scriptOf(step)], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

/** `key=value` lines from a GITHUB_OUTPUT file. */
function readOutputs(file) {
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
}

/** A temp dir with `bin/<name>` holding `script`, first on PATH. */
function withStub(name, script) {
  const dir = mkdtempSync(join(tmpdir(), `mobile-${name}-`));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${script}\n`);
  chmodSync(join(bin, name), 0o755);
  const output = join(dir, "output");
  writeFileSync(output, "");
  return { dir, output, path: `${bin}:${process.env.PATH}` };
}

/** Adds `bin/<name>` holding `script` to a `withStub` dir. */
function addStub(dir, name, script) {
  writeFileSync(join(dir, "bin", name), `#!/usr/bin/env bash\n${script}\n`);
  chmodSync(join(dir, "bin", name), 0o755);
}

/** A git repo with `apps/mobile/app.json` at `version`, committed; returns its HEAD. */
function mobileRepo(dir, version = "0.13.0") {
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" }).toString().trim();
  mkdirSync(join(dir, "apps", "mobile"), { recursive: true });
  writeFileSync(join(dir, "apps", "mobile", "app.json"), `${JSON.stringify({ expo: { version } })}\n`);
  writeFileSync(join(dir, ".gitignore"), "bin/\noutput\n*.log\nfrapp.*\nenv\nsummary\n");
  git("init", "-q");
  git("-c", "user.email=t@example.com", "-c", "user.name=t", "add", "-A");
  git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "seed");
  return git("rev-parse", "HEAD");
}

describe("the build jobs, one per platform", () => {
  it("each runs only for its platform, on the runner that builds it", () => {
    const ran = (id, platform) => evaluate(jobOf(CALLED, id).if, { inputs: { platform } });
    for (const platform of ["ios", "android", "all", "none", ""]) {
      assert.equal(ran("ios", platform), platform === "ios" || platform === "all", `ios on ${platform}`);
      assert.equal(ran("android", platform), platform === "android" || platform === "all", `android on ${platform}`);
    }
    assert.equal(jobOf(CALLED, "ios").keys.get("runs-on"), "macos-latest");
    assert.equal(jobOf(CALLED, "android").keys.get("runs-on"), "ubuntu-latest");
  });

  // Every step after the first failure is skipped, so nothing builds after
  // a refusal and nothing uploads after a failed build or check.
  it("runs every step only while the ones before it passed", () => {
    for (const id of BUILD_JOBS) {
      for (const step of stepsOf(CALLED, id)) assert.equal(step.if, null, `${id}: "${step.name}" has its own if:`);
    }
  });

  it("hands on what it built, the upload, and both tag checks", () => {
    for (const id of BUILD_JOBS) {
      assert.deepEqual(Object.fromEntries(jobOf(CALLED, id).keys.get("outputs")), {
        build: "${{ steps.build.outputs.build }}",
        upload: "${{ steps.upload.outcome }}",
        submission: "${{ steps.upload.outputs.submission }}",
        "tag-moved": "${{ steps.tag-before-build.outputs.moved || steps.tag-before-upload.outputs.moved }}",
        "tag-before-build": "${{ steps.tag-before-build.outcome }}",
        "tag-before-upload": "${{ steps.tag-before-upload.outcome }}",
      });
    }
  });

  // The steps that do the same thing in both jobs must not drift apart.
  it("runs the same script in both jobs wherever they do the same thing", () => {
    for (const name of [INPUTS, INSTALL_EAS, CONFIRM, TAG_STEPS.build, SENTRY, BUILD, TAG_STEPS.upload]) {
      assert.equal(scriptOf(stepNamed(CALLED, "ios", name)), scriptOf(stepNamed(CALLED, "android", name)), name);
    }
    for (const [id, platform, eas] of [["ios", "ios", "IOS"], ["android", "android", "ANDROID"]]) {
      assert.deepEqual(Object.fromEntries(stepNamed(CALLED, id, BUILD).stepEnv), {
        EXPO_TOKEN: "${{ secrets.EXPO_TOKEN }}",
        SENTRY_AUTH_TOKEN: "${{ secrets.SENTRY_AUTH_TOKEN }}",
        PLATFORM: platform,
        EAS_PLATFORM: eas,
        ARCHIVE: ARCHIVES[id],
        DEPLOY_SHA: "${{ inputs.sha }}",
      });
    }
  });

  // A local build needs the same runner setup Frapp Staging's does, and that
  // workflow is where it was proven (#4877).
  it("sets up its runner exactly as staging-app.yml's build of the same platform", () => {
    assert.equal(scriptOf(stepNamed(CALLED, "ios", XCODE)), scriptOf(stepNamed(STAGING, "ios", XCODE)));
    assert.equal(scriptOf(stepNamed(CALLED, "android", JAVA)), scriptOf(stepNamed(STAGING, "android", JAVA)));
    assert.equal(jobOf(STAGING, "ios").keys.get("runs-on"), jobOf(CALLED, "ios").keys.get("runs-on"));
    assert.equal(jobOf(STAGING, "android").keys.get("runs-on"), jobOf(CALLED, "android").keys.get("runs-on"));
    for (const id of BUILD_JOBS) {
      const setup = (path) => stepNamed(path, id, "Setup Node").body.replace(/^\s*#.*\n/gm, "");
      assert.equal(setup(CALLED), setup(STAGING), id);
    }
  });
});

describe("the build jobs' first step", () => {
  const step = (id) => stepNamed(CALLED, id, INPUTS);
  const run = (env) => runStep(step("ios"), { cwd: tmpdir(), env: { DEPLOY_SHA: SHA, PLATFORM: "ios", HAS_EXPO_TOKEN: "true", ...env } });

  it("comes first, and reads only whether the token is set", () => {
    for (const id of BUILD_JOBS) {
      assert.equal(stepsOf(CALLED, id)[0].name, INPUTS, id);
      assert.equal(step(id).env.get("HAS_EXPO_TOKEN"), "${{ secrets.EXPO_TOKEN != '' }}");
      assert.equal(step(id).env.get("PLATFORM"), "${{ inputs.platform }}");
      assert.equal(step(id).env.get("DEPLOY_SHA"), "${{ inputs.sha }}");
    }
  });

  it("passes for each platform with a token and a full SHA", () => {
    for (const PLATFORM of ["ios", "android", "all"]) assert.equal(run({ PLATFORM }).status, 0, PLATFORM);
  });

  it("stops on a missing token, an unknown platform or a short SHA", () => {
    const missing = run({ HAS_EXPO_TOKEN: "false" });
    assert.equal(missing.status, 1);
    assert.match(missing.stdout, /EXPO_TOKEN did not reach this job/);
    for (const PLATFORM of ["none", "", "IOS"]) assert.equal(run({ PLATFORM }).status, 1, PLATFORM);
    for (const DEPLOY_SHA of [SHA.slice(0, 8), SHA.toUpperCase(), ""]) assert.equal(run({ DEPLOY_SHA }).status, 1, DEPLOY_SHA);
  });
});

describe("each build job builds the validated SHA and nothing else", () => {
  it("checks out inputs.sha once, and nothing moves the tree after", () => {
    for (const id of BUILD_JOBS) {
      const steps = stepsOf(CALLED, id);
      const checkouts = steps.filter((s) => /uses:\s*actions\/checkout@/.test(s.body));
      assert.equal(checkouts.length, 1, id);
      assert.match(checkouts[0].body, /^\s+ref: \$\{\{ inputs\.sha \}\}\s*$/m);
      assert.match(checkouts[0].body, /^\s+persist-credentials: false\s*$/m);
      for (const step of steps) {
        assert.doesNotMatch(step.body, WORKSPACE_REWRITE_RE, `"${step.name}" moves the tree`);
        assert.ok(
          !step.body.split("\n").some((l) => USES_ANY_LOCAL_ACTION.test(l)),
          `"${step.name}" runs a local action, which would load from the deployed tree`,
        );
      }
    }
  });

  // The order is the safety argument: installs, then the tree and the tag,
  // then the build and its checks; the tag again, then the upload.
  it("runs its steps in the order that refuses before it builds or uploads", () => {
    const ids = (id) => stepsOf(CALLED, id).map((s) => s.body.match(/^\s+id:\s*(\S+)/m)?.[1]).filter(Boolean);
    for (const id of BUILD_JOBS) {
      assert.deepEqual(ids(id), ["confirm", "tag-before-build", "build", "tag-before-upload", "upload"], id);
    }
    const names = (id) => stepsOf(CALLED, id).map((s) => s.name);
    assert.deepEqual(names("ios"), [
      INPUTS,
      "Check out the shipped commit",
      XCODE,
      "Setup Node",
      "Install dependencies",
      INSTALL_EAS,
      CONFIRM,
      TAG_STEPS.build,
      SENTRY,
      BUILD,
      PLIST,
      TAG_STEPS.upload,
      UPLOAD_STEPS.ios,
    ]);
    // The Firebase file is fetched before the tree is checked, so the check
    // sees that the fetch left nothing behind.
    assert.deepEqual(names("android"), [
      INPUTS,
      "Check out the shipped commit",
      JAVA,
      "Setup Node",
      "Install dependencies",
      INSTALL_EAS,
      FIREBASE,
      CONFIRM,
      TAG_STEPS.build,
      SENTRY,
      BUILD,
      TAG_STEPS.upload,
      UPLOAD_STEPS.android,
    ]);
  });

  describe("the confirm step, run", () => {
    const step = () => stepNamed(CALLED, "ios", CONFIRM);
    function repo() {
      const dir = mkdtempSync(join(tmpdir(), "mobile-confirm-"));
      const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" }).toString().trim();
      git("init", "-q");
      git("config", "user.email", "t@example.com");
      git("config", "user.name", "t");
      writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
      writeFileSync(join(dir, "app.json"), "{}\n");
      git("add", "-A");
      git("commit", "-qm", "seed");
      return { dir, head: git("rev-parse", "HEAD") };
    }
    const run = (dir, sha) => runStep(step(), { cwd: dir, env: { DEPLOY_SHA: sha } });

    it("passes on the commit, with ignored install output beside it", () => {
      const { dir, head } = repo();
      mkdirSync(join(dir, "node_modules"));
      writeFileSync(join(dir, "node_modules", "x.js"), "");
      assert.equal(run(dir, head).status, 0);
      rmSync(dir, { recursive: true, force: true });
    });

    it("fails on another commit, a changed file or a new one", () => {
      const { dir, head } = repo();
      assert.equal(run(dir, SHA).status, 1);
      writeFileSync(join(dir, "app.json"), '{"changed":true}\n');
      assert.equal(run(dir, head).status, 1);
      execFileSync("git", ["checkout", "-q", "--", "app.json"], { cwd: dir });
      writeFileSync(join(dir, "new.txt"), "x");
      const added = run(dir, head);
      assert.equal(added.status, 1);
      assert.match(added.stdout, /new\.txt/);
      rmSync(dir, { recursive: true, force: true });
    });
  });
});

// Rule 1 at both ends of a build: a ship made meanwhile (a rollback) tags
// another commit, and nothing from this SHA may upload.
describe("the latest-tag check, before the build and again before the upload", () => {
  const OLD = "1111111111111111111111111111111111111111";

  it("is one script, run twice in each job, reading the API with the job's own token", () => {
    const all = BUILD_JOBS.flatMap((id) => [TAG_STEPS.build, TAG_STEPS.upload].map((n) => stepNamed(CALLED, id, n)));
    for (const step of all) {
      assert.equal(scriptOf(step), scriptOf(all[0]), `${step.jobId}: ${step.name}`);
      assert.deepEqual(Object.fromEntries(step.stepEnv), {
        GH_TOKEN: "${{ github.token }}",
        REPO: "${{ github.repository }}",
        DEPLOY_SHA: "${{ inputs.sha }}",
      });
    }
    // macOS runners have no sha256sum, and nothing reads a digest any more.
    assert.doesNotMatch(scriptOf(all[0]), /sha256sum/);
  });

  /**
   * Runs the check against a stand-in `gh`: `tags` maps each tag to the
   * commit it names; an annotated tag is served as a tag object, the way
   * release.yml mints them. `fail` makes the first `times` calls fail with
   * HTTP `status`, as gh reports it on stderr. `sleep` is a stand-in that
   * records each back-off, so a retry costs the suite nothing.
   */
  function run({ tags, sha = SHA, fail = null }) {
    const objects = Object.entries(tags).map(([name, commit]) => `${name} ${commit}`).join("\n");
    const { dir, path } = withStub(
      "gh",
      [
        'state="$(dirname "$0")/.."',
        'n="$(cat "$state/calls" 2>/dev/null || echo 0)"',
        'echo "$((n + 1))" > "$state/calls"',
        fail ? `if [ "$n" -lt ${fail.times} ]; then echo 'gh: Failed (HTTP ${fail.status})' >&2; exit 1; fi` : "",
        'path="$2"',
        'case "$path" in',
        // In ref order, as the API returns them: lexical, so v0.10.0 comes
        // before v0.9.0, and only a version sort finds the newest.
        `  */git/matching-refs/tags/v) printf '%s\\n' ${Object.keys(tags).map((t) => `'${t}'`).join(" ") || "''"} | sed '/^$/d' | LC_ALL=C sort ;;`,
        `  */git/ref/tags/*) t="\${path##*/}"; printf 'tag obj-%s\\n' "$t" ;;`,
        `  */git/tags/obj-*) t="\${path##*/obj-}"; printf '%s\\n' "${objects}" | awk -v t="$t" '$1 == t { print $2 }' ;;`,
        "  *) echo \"unexpected gh api $path\" >&2; exit 2 ;;",
        "esac",
      ].join("\n"),
    );
    addStub(dir, "sleep", 'echo "$1" >> "$(dirname "$0")/../sleeps"');
    const output = join(dir, "output");
    writeFileSync(output, "");
    const result = runStep(stepNamed(CALLED, "ios", TAG_STEPS.build), {
      cwd: dir,
      env: { PATH: path, GH_TOKEN: "t", REPO: "o/r", DEPLOY_SHA: sha, GITHUB_OUTPUT: output, RUNNER_TEMP: dir },
    });
    result.outputs = readOutputs(output);
    const read = (name) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean) : []);
    result.calls = Number(read("calls")[0] ?? 0);
    result.sleeps = read("sleeps");
    rmSync(dir, { recursive: true, force: true });
    return result;
  }

  it("passes when the newest version tag names the SHA, by version and not by text", () => {
    // Lexically, v0.10.0 < v0.9.0 and v0.9.0 < v1.0.0: a text sort either way
    // picks v0.9.0 in one of these, which names the older commit.
    for (const newest of ["v0.10.0", "v1.0.0"]) {
      const result = run({ tags: { "v0.9.0": OLD, [newest]: SHA } });
      assert.equal(result.status, 0, `${newest}: ${result.stdout}${result.stderr}`);
      assert.match(result.stdout, new RegExp(`is the latest tag \\(${newest.replace(/\./g, "\\.")}\\)`));
      assert.deepEqual(result.outputs, {});
    }
  });

  it("refuses once a later ship tagged another commit, and says so in its output", () => {
    const result = run({ tags: { "v0.9.0": SHA, "v0.10.0": OLD } });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /The latest tag, v0\.10\.0, is on 1{40}, not /);
    assert.equal(result.outputs.moved, "true", "the record job forbids a hand upload only on this output");
    assert.equal(run({ tags: { "v0.9.0": SHA } }).outputs.moved, undefined);
  });

  it("refuses with no v* tag, or a top one that isn't a release, and neither is a moved production", () => {
    const none = run({ tags: {} });
    assert.equal(none.status, 1);
    assert.match(none.stdout, /No v\* tag exists/);
    // A hand-pushed tag above the release: release.yml would bump from it,
    // so stepping past it would disagree with the next release.
    const rc = run({ tags: { "v0.9.0": SHA, "v0.10.0-rc1": OLD } });
    assert.equal(rc.status, 1);
    assert.match(rc.stdout, /The latest v\* tag, v0\.10\.0-rc1, is not a vX\.Y\.Z release/);
    for (const result of [none, rc]) assert.equal(result.outputs.moved, undefined);
  });

  it("names the same tag as release-tag.mjs, and refuses where it does", () => {
    const cases = [
      [],
      ["v0.9.0"],
      ["v0.9.0", "v0.10.0"],
      ["v1.0.0", "v0.10.0", "v0.9.0"],
      ["v1.0.9", "v1.0.10"],
      ["v1.9.0", "v1.10.0-rc1"],
      ["v1.10.0", "v1.10.0-rc1"],
      ["v0.9.0", "v2-rc"],
      ["v1.2.3", "v1.2.3.4"],
      ["v0.9.0", "very-old"],
      // Where GNU `sort -V` and git's version sort disagree: a shell sort
      // would take the hand-pushed tag, or the zero-padded one.
      ["v1.2.3", "v-next"],
      ["v0.10.0", "v.1"],
      ["v0.10.0", "v-backup"],
      ["v1.2.3", "v-1.2.4"],
      ["v1.1.0", "v1.02.0"],
      ["v1.0.0", "v1.00.0"],
    ];
    const dir = mkdtempSync(join(tmpdir(), "mobile-tags-"));
    const git = (args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
    try {
      git(["init", "-q"]);
      git(["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "seed"]);
      for (const tags of cases) {
        for (const t of git(["tag", "--list"]).split("\n").filter(Boolean)) git(["tag", "-d", t]);
        for (const t of tags) git(["tag", t]);
        const lib = latestReleaseTag({ git });
        // Only the lib's tag names the SHA, so a check that picked any other
        // tag reads production as moved and fails.
        const shell = run({ tags: Object.fromEntries(tags.map((t) => [t, t === lib.tag ? SHA : OLD])) });
        const label = `[${tags.join(", ")}]: ${shell.stdout}${shell.stderr}`;
        if (lib.ok) {
          assert.equal(shell.status, 0, label);
          assert.ok(shell.stdout.includes(`is the latest tag (${lib.tag})`), label);
        } else if (lib.tag === null) {
          assert.equal(shell.status, 1, label);
          assert.match(shell.stdout, /No v\* tag exists/, label);
        } else {
          assert.equal(shell.status, 1, label);
          assert.ok(shell.stdout.includes(`The latest v* tag, ${lib.tag}, is not a vX.Y.Z release`), label);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("retries a failed read, 1s then 5s apart, and passes once one answers", () => {
    const result = run({ tags: { "v0.9.0": SHA }, fail: { status: 502, times: 2 } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(result.sleeps, ["1", "5"]);
  });

  it("fails on an API error rather than calling it untagged or moved, and doesn't retry a 4xx", () => {
    const down = run({ tags: { "v0.9.0": SHA }, fail: { status: 502, times: 3 } });
    assert.notEqual(down.status, 0);
    assert.equal(down.calls, 3);
    assert.doesNotMatch(down.stdout, /No v\* tag exists|is not a vX\.Y\.Z release/);
    assert.equal(down.outputs.moved, undefined, "a failed read is not a moved production");
    const refused = run({ tags: { "v0.9.0": SHA }, fail: { status: 404, times: 1 } });
    assert.notEqual(refused.status, 0);
    assert.equal(refused.calls, 1);
    assert.deepEqual(refused.sleeps, []);
    const limited = run({ tags: { "v0.9.0": SHA }, fail: { status: 429, times: 1 } });
    assert.equal(limited.status, 0, limited.stdout + limited.stderr);
  });
});

describe("the tokens reach only the steps that run eas", () => {
  it("EXPO_TOKEN is in the env of the Firebase fetch, the builds, the uploads and the confirm poll, and nowhere else", () => {
    const holders = workflowSteps(CALLED)
      .filter((s) => [...s.env.values()].some((v) => /secrets\.EXPO_TOKEN\b/.test(v) && !/!=\s*''/.test(v)))
      .map((s) => `${s.jobId}: ${s.name}`);
    assert.deepEqual(holders, [
      `ios: ${BUILD}`,
      `ios: ${UPLOAD_STEPS.ios}`,
      `android: ${FIREBASE}`,
      `android: ${BUILD}`,
      `android: ${UPLOAD_STEPS.android}`,
      `confirm: ${CONFIRM_POLL}`,
    ]);
    // The confirm poll reads EAS's API itself (eas-cli 24.8 can't show one
    // submission), from the trusted ref with nothing installed.
    const poll = stepNamed(CALLED, "confirm", CONFIRM_POLL);
    assert.equal(poll.stepEnv.get("EXPO_TOKEN"), "${{ secrets.EXPO_TOKEN }}");
    assert.equal(scriptOf(poll), "node scripts/ci/confirm-store-submissions.mjs");
    for (const id of BUILD_JOBS) {
      for (const step of stepsOf(CALLED, id)) {
        if (step.env.has("EXPO_TOKEN")) {
          assert.equal(step.stepEnv.get("EXPO_TOKEN"), "${{ secrets.EXPO_TOKEN }}", step.name);
          assert.match(scriptOf(step), /(^|[\s(])eas (build|submit|env:pull) /, step.name);
        }
      }
    }
  });

  it("SENTRY_AUTH_TOKEN is in the env of the builds alone", () => {
    const holders = workflowSteps(CALLED)
      .filter((s) => [...s.env.values()].some((v) => /secrets\.SENTRY_AUTH_TOKEN\b/.test(v) && !/!=\s*''/.test(v)))
      .map((s) => `${s.jobId}: ${s.name}`);
    assert.deepEqual(holders, [`ios: ${BUILD}`, `android: ${BUILD}`]);
  });

  it("is never in an install step's environment, and no job- or workflow-level env carries it", () => {
    for (const step of workflowSteps(CALLED)) {
      if (!/^\s+run:/m.test(step.body)) continue;
      const installs = scriptOf(step).split("\n").some((l) => runsInstall(l) || /npm install --global/.test(l));
      if (installs) {
        assert.equal(step.env.has("EXPO_TOKEN"), false, step.name);
        assert.equal(step.env.has("SENTRY_AUTH_TOKEN"), false, step.name);
      }
      for (const [key, value] of step.env) {
        if (!step.stepEnv.has(key)) assert.doesNotMatch(value, /secrets\./, `${step.name} inherits ${key}`);
      }
    }
  });

  it("each job holds only its own credential", () => {
    const text = (jobId) => stepsOf(CALLED, jobId).map((s) => s.body).join("\n");
    assert.doesNotMatch(text("record"), /EXPO_TOKEN|SENTRY_AUTH_TOKEN/);
    assert.doesNotMatch(text("confirm"), /PR_BASE_SYNC_APP_|SENTRY_AUTH_TOKEN/);
    for (const id of BUILD_JOBS) assert.doesNotMatch(text(id), /PR_BASE_SYNC_APP_/);
    assert.doesNotMatch(text("snapshot"), /secrets\./);
    assert.doesNotMatch(text("merge-record"), /EXPO_TOKEN|SENTRY_AUTH_TOKEN/);
  });
});

describe("the eas commands", () => {
  // The publish date of each eas-cli version this file has pinned. `--before`
  // must fall after it (or the version itself is excluded) and not in the
  // future (or it freezes nothing). Moving the pin means adding its date here.
  const PUBLISHED = { "24.8.0": "2026-09-24" };

  it("installs an exact eas-cli, the same in both jobs, running no install script, with its dependencies held to a past date", () => {
    const [ios, android] = BUILD_JOBS.map((id) => scriptOf(stepNamed(CALLED, id, INSTALL_EAS)));
    assert.equal(ios, android);
    // `--ignore-scripts`: the step's comment lists the install scripts in the tree. The parse is
    // the one `npm run eas` uses (scripts/eas.mjs), so a laptop installs exactly this.
    assert.match(ios, /^npm install --global --ignore-scripts --before=\S+ eas-cli@\S+$/, ios);
    const { before, version } = parseEasCliPin(readFileSync(CALLED, "utf8"));
    assert.equal(ios, `npm install --global --ignore-scripts --before=${before} eas-cli@${version}`);
    assert.ok(PUBLISHED[version], `add eas-cli ${version}'s publish date to PUBLISHED`);
    assert.ok(before > PUBLISHED[version], `--before=${before} excludes eas-cli ${version} itself`);
    assert.ok(new Date(`${before}T00:00:00Z`) <= new Date(), `--before=${before} is in the future, so it freezes nothing`);
  });

  it("builds on the runner, on the production profile, into the archive the upload sends", () => {
    const command = scriptOf(stepNamed(CALLED, "ios", BUILD))
      .replace(/\\\n\s*/g, " ")
      .split("\n")
      .find((l) => /\beas build\b/.test(l));
    for (const flag of ["--local", '--platform "$PLATFORM"', "--profile production", "--non-interactive", '--output "$ARCHIVE"']) {
      assert.ok(command.includes(flag), `eas build lacks ${flag}`);
    }
    // Never EAS's metered cloud (#5162), and never a submit of its own.
    assert.doesNotMatch(command, /--auto-submit|--no-wait|--json/);
    assert.doesNotMatch(readFileSync(CALLED, "utf8").replace(/^\s*#.*$/gm, ""), /eas build:view|eas build --platform/);
    for (const id of BUILD_JOBS) {
      assert.equal(stepNamed(CALLED, id, UPLOAD_STEPS[id]).stepEnv.get("ARCHIVE"), ARCHIVES[id], id);
    }
  });

  it("submits each built archive by path without waiting, and submits nothing for review", () => {
    for (const store of BUILD_JOBS) {
      const step = stepNamed(CALLED, store, UPLOAD_STEPS[store]);
      assert.deepEqual(Object.fromEntries(step.stepEnv), {
        EXPO_TOKEN: "${{ secrets.EXPO_TOKEN }}",
        ARCHIVE: ARCHIVES[store],
      });
      assert.match(step.body, /^\s+working-directory: apps\/mobile\s*$/m);
      const command = scriptOf(step);
      const submit = command.split("\n").find((l) => /^eas submit /.test(l));
      assert.match(submit, new RegExp(`^eas submit --platform ${store} --profile production --path "\\$ARCHIVE" --non-interactive --no-wait`));
      assert.doesNotMatch(submit, /\s--wait\b/);
      if (store === "ios") assert.match(command, /--no-auto-testflight-setup/);
    }
  });

  // A non-interactive iOS submit stops without it (mobile.md § 6.6's table),
  // after the build has been paid for. eas-production-profile.test.mjs
  // deliberately doesn't require it; this is the job that does. It must be
  // the Apple ID the store README records for the app.
  it("names the App Store Connect app the upload goes to", () => {
    const eas = JSON.parse(readFileSync(join(REPO_ROOT, "apps", "mobile", "eas.json"), "utf8"));
    const recorded = readFileSync(join(REPO_ROOT, "apps", "mobile", "store", "README.md"), "utf8").match(
      /^\| Apple ID \| `(\d+)` \|$/m,
    )?.[1];
    assert.ok(recorded, "apps/mobile/store/README.md § As submitted no longer records the Apple ID");
    assert.equal(eas.submit?.production?.ios?.ascAppId, recorded);
  });

  it("fits every step's ceiling under its job's", () => {
    for (const id of BUILD_JOBS) {
      const job = Number(jobOf(CALLED, id).keys.get("timeout-minutes"));
      assert.ok(job <= 360, "a hosted job runs at most 360 minutes");
      const ceilings = stepsOf(CALLED, id).map((s) => Number(s.body.match(/^\s+timeout-minutes:\s*(\d+)/m)?.[1] ?? 0));
      assert.ok(ceilings.reduce((a, b) => a + b, 0) + 20 <= job, `${id}: the steps' ceilings, plus the installs, outrun the job's`);
    }
  });
});

describe("the build step, against a stand-in eas", () => {
  /**
   * Runs the shared build step in a repo whose app.json says `version`, with
   * an `eas` that prints `printed`, writes the archive unless `archive` is
   * false, and exits `exit`.
   */
  function run({ printed = "", exit = 0, archive = true, platform = "ios", moveHead = false } = {}) {
    const { dir, output, path } = withStub(
      "eas",
      [
        'echo "$PWD $*" > "$RUNNER_TEMP/argv"',
        `printf '%b\\n' '${printed.replace(/'/g, "'\\''")}'`,
        archive ? 'out=""; prev=""; for a in "$@"; do [ "$prev" = "--output" ] && out="$a"; prev="$a"; done; echo binary > "$out"' : "",
        `exit ${exit}`,
      ].join("\n"),
    );
    const head = mobileRepo(dir);
    const archivePath = join(dir, platform === "ios" ? "frapp.ipa" : "frapp.aab");
    const result = runStep(stepNamed(CALLED, platform, BUILD), {
      cwd: dir,
      env: {
        PATH: path,
        RUNNER_TEMP: dir,
        GITHUB_OUTPUT: output,
        PLATFORM: platform,
        EAS_PLATFORM: platform.toUpperCase(),
        ARCHIVE: archivePath,
        DEPLOY_SHA: moveHead ? SHA : head,
      },
    });
    const outputs = readOutputs(output);
    const argv = existsSync(join(dir, "argv")) ? readFileSync(join(dir, "argv"), "utf8") : "";
    rmSync(dir, { recursive: true, force: true });
    return { status: result.status, stdout: result.stdout, outputs, argv, head };
  }
  const ios = "✔ Incremented buildNumber from \\033[1m24\\033[22m to \\033[1m25\\033[22m.";
  const android = "✔ Incremented versionCode from 24 to 25.";

  it("builds locally from apps/mobile and hands on the version, the build number and the commit", () => {
    for (const [platform, printed] of [["ios", ios], ["android", android]]) {
      const { status, stdout, outputs, argv, head } = run({ platform, printed });
      assert.equal(status, 0, stdout);
      assert.match(argv, new RegExp(`/apps/mobile build --local --platform ${platform} --profile production --non-interactive --output `));
      assert.deepEqual(JSON.parse(outputs.build), {
        platform: platform.toUpperCase(),
        status: "FINISHED",
        appVersion: "0.13.0",
        appBuildVersion: "25",
        gitCommitHash: head,
      });
    }
  });

  it("reads a first build number, which eas-cli reports as initialized", () => {
    const { status, outputs } = run({ printed: "✔ Initialized buildNumber with 1." });
    assert.equal(status, 0);
    assert.equal(JSON.parse(outputs.build).appBuildVersion, "1");
  });

  it("keeps eas's own exit status, and hands nothing on", () => {
    const failed = run({ printed: ios, exit: 3 });
    assert.equal(failed.status, 3);
    assert.match(failed.stdout, /eas build --local --platform ios exited 3/);
    assert.equal(failed.outputs.build, undefined);
  });

  it("refuses a build that wrote no archive, or whose build number it can't read once", () => {
    const empty = run({ printed: ios, archive: false });
    assert.equal(empty.status, 1);
    assert.match(empty.stdout, /wrote no/);
    for (const printed of ["Build successful", `${android}\n✔ Incremented versionCode from 25 to 26.`]) {
      const unread = run({ platform: "android", printed });
      assert.equal(unread.status, 1, printed);
      assert.match(unread.stdout, /Couldn't read the one build number/, printed);
      assert.equal(unread.outputs.build, undefined, printed);
    }
  });

  it("refuses a tree that isn't the shipped commit", () => {
    const moved = run({ printed: ios, moveHead: true });
    assert.equal(moved.status, 1);
    assert.match(moved.stdout, /off the shipped/);
    assert.equal(moved.outputs.build, undefined);
  });
});

describe("the iOS binary's version check, against stand-ins", () => {
  function run({ short, number, build }) {
    const { dir, path } = withStub("unzip", 'echo plist');
    addStub(dir, "plutil", `case "$2" in CFBundleShortVersionString) echo '${short}' ;; CFBundleVersion) echo '${number}' ;; *) exit 2 ;; esac`);
    const step = stepNamed(CALLED, "ios", PLIST);
    const result = runStep(step, { cwd: dir, env: { PATH: path, RUNNER_TEMP: dir, ARCHIVE: join(dir, "frapp.ipa"), BUILD: JSON.stringify(build) } });
    rmSync(dir, { recursive: true, force: true });
    return result;
  }
  const build = { platform: "IOS", status: "FINISHED", appVersion: "0.13.0", appBuildVersion: "25", gitCommitHash: SHA };

  it("reads the build step's output, and passes when the binary agrees", () => {
    const step = stepNamed(CALLED, "ios", PLIST);
    assert.equal(step.stepEnv.get("BUILD"), "${{ steps.build.outputs.build }}");
    assert.equal(step.stepEnv.get("ARCHIVE"), ARCHIVES.ios);
    assert.match(scriptOf(step), /unzip -W -p "\$ARCHIVE" 'Payload\/\*\.app\/Info\.plist'/);
    assert.equal(run({ short: "0.13.0", number: "25", build }).status, 0);
  });

  it("refuses a binary whose version or build number differs from the record's", () => {
    for (const [short, number] of [["0.13.1", "25"], ["0.13.0", "24"]]) {
      const result = run({ short, number, build });
      assert.equal(result.status, 1, `${short} (${number})`);
      assert.match(result.stdout, /Not uploading a build the record would misname/);
    }
  });
});

describe("the Firebase fetch, against a stand-in eas", () => {
  function run({ file = '{"project_info":{}}', exit = 0 } = {}) {
    const { dir, path } = withStub(
      "eas",
      [
        'echo "$*" > "$RUNNER_TEMP/argv"',
        'out=""; prev=""; for a in "$@"; do [ "$prev" = "--path" ] && out="$a"; prev="$a"; done',
        'echo "EXPO_PUBLIC_X=1" > "$out"',
        file === null ? "" : `mkdir -p .eas/.env && printf '%s' '${file}' > .eas/.env/GOOGLE_SERVICES_JSON`,
        `exit ${exit}`,
      ].join("\n"),
    );
    const mobile = join(dir, "apps", "mobile");
    // A tracked file under .eas/ (apps/mobile/.eas/workflows/), which the cleanup must keep.
    mkdirSync(join(mobile, ".eas", "workflows"), { recursive: true });
    writeFileSync(join(mobile, ".eas", "workflows", "device-smoke.yml"), "jobs: {}\n");
    const envFile = join(dir, "env");
    writeFileSync(envFile, "");
    const result = runStep(stepNamed(CALLED, "android", FIREBASE), { cwd: mobile, env: { PATH: path, RUNNER_TEMP: dir, GITHUB_ENV: envFile } });
    result.argv = readFileSync(join(dir, "argv"), "utf8");
    result.env = readFileSync(envFile, "utf8");
    result.leftInTree = existsSync(join(mobile, ".eas", ".env"));
    result.trackedKept = existsSync(join(mobile, ".eas", "workflows", "device-smoke.yml"));
    result.pulledLeft = existsSync(join(dir, "eas-production.env"));
    result.file = existsSync(join(dir, "google-services.json")) ? readFileSync(join(dir, "google-services.json"), "utf8") : null;
    rmSync(dir, { recursive: true, force: true });
    return result;
  }

  it("pulls production's File variable out of the tree and points GOOGLE_SERVICES_JSON at it", () => {
    const step = stepNamed(CALLED, "android", FIREBASE);
    assert.match(step.body, /^\s+working-directory: apps\/mobile\s*$/m);
    const result = run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.argv, /^env:pull --environment production --non-interactive --path /);
    assert.equal(result.file, '{"project_info":{}}');
    assert.match(result.env, /^GOOGLE_SERVICES_JSON=.*\/google-services\.json$/m);
    assert.equal(result.leftInTree, false, "the pulled files leave the tree before the build packs it");
    assert.equal(result.trackedKept, true, "the tree check that follows would refuse a deleted tracked file");
    assert.equal(result.pulledLeft, false, "the pulled values are deleted unread");
  });

  it("fails with what to change when the variable isn't readable here, and leaves nothing behind", () => {
    const missing = run({ file: null });
    assert.equal(missing.status, 1);
    assert.match(missing.stdout, /no readable GOOGLE_SERVICES_JSON file\. It must be a File variable with Plain text or Sensitive visibility/);
    assert.equal(missing.env, "");
    const failed = run({ exit: 4 });
    assert.equal(failed.status, 4);
    assert.match(failed.stdout, /eas env:pull exited 4/);
    for (const result of [missing, failed]) {
      assert.equal(result.leftInTree, false);
      assert.equal(result.trackedKept, true);
      assert.equal(result.pulledLeft, false);
    }
  });
});

describe("the Sentry switch", () => {
  function run(has) {
    const dir = mkdtempSync(join(tmpdir(), "mobile-sentry-"));
    const [envFile, summaryFile] = [join(dir, "env"), join(dir, "summary")];
    writeFileSync(envFile, "");
    writeFileSync(summaryFile, "");
    const result = runStep(stepNamed(CALLED, "ios", SENTRY), { cwd: dir, env: { HAS_SENTRY_AUTH_TOKEN: has, GITHUB_ENV: envFile, GITHUB_STEP_SUMMARY: summaryFile } });
    result.env = readFileSync(envFile, "utf8");
    result.summary = readFileSync(summaryFile, "utf8");
    rmSync(dir, { recursive: true, force: true });
    return result;
  }

  it("reads only whether the token is set", () => {
    for (const id of BUILD_JOBS) {
      assert.deepEqual(Object.fromEntries(stepNamed(CALLED, id, SENTRY).stepEnv), { HAS_SENTRY_AUTH_TOKEN: "${{ secrets.SENTRY_AUTH_TOKEN != '' }}" });
    }
  });

  it("leaves the upload on with a token, and turns it off without one, saying so", () => {
    const on = run("true");
    assert.equal(on.status, 0);
    assert.equal(on.env, "");
    const off = run("false");
    assert.equal(off.status, 0);
    assert.equal(off.env, "SENTRY_DISABLE_AUTO_UPLOAD=true\n");
    assert.match(off.stdout, /::warning::The automation environment has no SENTRY_AUTH_TOKEN/);
    assert.match(off.summary, /stay unsymbolicated/);
  });
});

describe("the upload steps, against a stand-in eas", () => {
  const SUBMISSION = "3f1c2b4a-1111-4a2b-9c3d-0123456789ab";
  function run({ printed, exit = 0, store = "ios" }) {
    const { dir, output, path } = withStub("eas", `echo "$*" > "$RUNNER_TEMP/argv"\n${printed === undefined ? "" : `printf '%s\\n' '${printed}'`}\nexit ${exit}`);
    // The runner's default `bash -e`: the steps name no shell, so only their
    // own `set -o pipefail` lets a failed `eas submit | tee` fail the step.
    const result = runStep(stepNamed(CALLED, store, UPLOAD_STEPS[store]), {
      cwd: dir,
      env: { PATH: path, RUNNER_TEMP: dir, GITHUB_OUTPUT: output, ARCHIVE: "/tmp/frapp.bin" },
      flags: ["-e"],
    });
    const outputs = readOutputs(output);
    const argv = readFileSync(join(dir, "argv"), "utf8");
    rmSync(dir, { recursive: true, force: true });
    return { status: result.status, stdout: result.stdout, outputs, argv };
  }

  it("hands on the submission id from the details link, colored or not", () => {
    for (const store of BUILD_JOBS) {
      const plain = run({ store, printed: `Submission details: https://expo.dev/accounts/pdcarlson/projects/frapp/submissions/${SUBMISSION}` });
      assert.equal(plain.status, 0, plain.stdout);
      assert.equal(plain.outputs.submission, SUBMISSION);
      assert.match(plain.argv, new RegExp(`^submit --platform ${store} --profile production --path /tmp/frapp\\.bin --non-interactive --no-wait`));
      const colored = run({ store, printed: `\x1b[2mSubmission details: \x1b[4mhttps://expo.dev/accounts/pdcarlson/projects/frapp/submissions/${SUBMISSION}\x1b[24m\x1b[22m` });
      assert.equal(colored.outputs.submission, SUBMISSION);
    }
  });

  it("passes when eas printed no link, with an empty id and a warning", () => {
    const quiet = run({ printed: "Scheduled." });
    assert.equal(quiet.status, 0);
    assert.equal(quiet.outputs.submission, "");
    assert.match(quiet.stdout, /::warning::eas submit printed no submission link/);
  });

  it("fails when eas refuses the submission, so record never lists it", () => {
    for (const store of BUILD_JOBS) {
      const refused = run({ store, printed: "Error: archive not found", exit: 1 });
      assert.equal(refused.status, 1);
      assert.equal(refused.outputs.submission, undefined);
    }
  });
});

describe("the confirm job", () => {
  it("runs beside record once an upload succeeded, from the trusted ref, with nothing installed", () => {
    const job = jobOf(CALLED, "confirm");
    assert.equal(job.keys.get("needs"), "[ios, android]");
    assert.equal(
      job.if,
      "${{ !cancelled() && (needs.ios.outputs.upload == 'success' || needs.android.outputs.upload == 'success') }}",
    );
    const steps = stepsOf(CALLED, "confirm");
    const checkout = steps.find((s) => /uses:\s*actions\/checkout@/.test(s.body));
    assert.doesNotMatch(checkout.body, /^\s+ref:/m, "the confirm job must run the trusted ref, not the built commit");
    const setup = steps.find((s) => /uses:\s*\.\/\.github\/actions\/node-setup/.test(s.body));
    assert.match(setup.body, /^\s+install: none\s*$/m);
    for (const step of steps) {
      if (/^\s+run:/m.test(step.body)) assert.ok(!scriptOf(step).split("\n").some((l) => runsInstall(l)), step.name);
    }
  });

  it("feeds the script each upload's outcome and submission, and stops polling before its step and job are killed", () => {
    const poll = stepNamed(CALLED, "confirm", CONFIRM_POLL);
    for (const store of BUILD_JOBS) {
      const KEY = store.toUpperCase();
      assert.equal(poll.stepEnv.get(`${KEY}_UPLOAD`), `\${{ needs.${store}.outputs.upload }}`);
      assert.equal(poll.stepEnv.get(`${KEY}_SUBMISSION`), `\${{ needs.${store}.outputs.submission }}`);
      // A runner's build has no EAS build id; a failed upload is retried by
      // its submission id instead.
      assert.equal(poll.stepEnv.has(`${KEY}_BUILD`), false);
    }
    const step = Number(poll.body.match(/^\s+timeout-minutes:\s*(\d+)/m)[1]);
    const job = Number(jobOf(CALLED, "confirm").keys.get("timeout-minutes"));
    assert.ok(Number(poll.stepEnv.get("DEADLINE_MINUTES")) < step, "the poll's deadline must end before its step's ceiling");
    assert.ok(step + 5 <= job, "the step's ceiling, plus checkout and setup, must fit the job's");
    assert.ok(job <= 360, "a hosted job runs at most 360 minutes");
  });
});

// Paul, 2026-11-12: the record PR merges itself, but only once `confirm` saw
// every upload finish, so a failed upload never lands on `main`.
describe("the merge-record job", () => {
  it("runs after record and confirm, only for an opened PR, and acts on confirm's result", () => {
    const job = jobOf(CALLED, "merge-record");
    assert.equal(job.keys.get("needs"), "[record, confirm]");
    assert.equal(job.if, "${{ !cancelled() && needs.record.outputs.pr != '' && needs.confirm.result != 'skipped' }}");
    assert.equal(jobOf(CALLED, "record").keys.get("outputs").get("pr"), "${{ steps.record.outputs.pr }}");
    const step = stepNamed(CALLED, "merge-record", "Turn on auto-merge, or say why not");
    assert.equal(step.stepEnv.get("PR"), "${{ needs.record.outputs.pr }}");
    assert.equal(step.stepEnv.get("CONFIRMED"), "${{ needs.confirm.result }}");
    assert.equal(step.stepEnv.get("GH_TOKEN"), "${{ steps.app-token.outputs.token }}");
    const script = scriptOf(step);
    assert.match(script, /if \[ "\$AUTO_MERGE" != "true" \]; then/);
    assert.match(script, /if \[ "\$CONFIRMED" = "success" \]; then/);
    assert.match(script, /gh pr merge "\$PR" --repo "\$GITHUB_REPOSITORY" --auto --squash/);
    // A failed or unfinished upload: auto-merge stays off, and the PR says so.
    const [onSuccess, otherwise] = script.split(/\n\s*else\n/);
    assert.match(onSuccess, /gh pr merge/);
    assert.doesNotMatch(otherwise, /gh pr merge/);
    assert.match(otherwise, /gh pr comment "\$PR"/);
  });
});

describe("the record job", () => {
  it("runs after a failed build too, from the trusted ref, and only mints a token when something uploaded", () => {
    const job = jobOf(CALLED, "record");
    assert.equal(job.if, "${{ !cancelled() }}");
    assert.equal(job.keys.get("needs"), "[ios, android]");
    const steps = stepsOf(CALLED, "record");
    const checkout = steps.find((s) => /uses:\s*actions\/checkout@/.test(s.body));
    assert.doesNotMatch(checkout.body, /^\s+ref:/m, "the record job must run the trusted ref, not the built commit");
    const mint = stepNamed(CALLED, "record", "Mint the base-sync App token");
    assert.equal(mint.if, "${{ needs.ios.outputs.upload == 'success' || needs.android.outputs.upload == 'success' }}");
  });

  it("feeds the script every value it reads, from each build job's result and outputs", () => {
    const step = stepNamed(CALLED, "record", "Record the uploaded builds and summarise the run");
    assert.equal(step.if, "${{ !cancelled() }}");
    assert.equal(scriptOf(step), "node scripts/ci/record-shipped-builds.mjs");
    const perJob = Object.fromEntries(
      BUILD_JOBS.flatMap((id) => {
        const KEY = id.toUpperCase();
        return [
          [`${KEY}_RESULT`, `\${{ needs.${id}.result }}`],
          [`${KEY}_BUILD`, `\${{ needs.${id}.outputs.build }}`],
          [`${KEY}_UPLOAD`, `\${{ needs.${id}.outputs.upload }}`],
          [`${KEY}_TAG_MOVED`, `\${{ needs.${id}.outputs.tag-moved }}`],
          [`${KEY}_TAG_BEFORE_BUILD`, `\${{ needs.${id}.outputs.tag-before-build }}`],
          [`${KEY}_TAG_BEFORE_UPLOAD`, `\${{ needs.${id}.outputs.tag-before-upload }}`],
        ];
      }),
    );
    assert.deepEqual(Object.fromEntries(step.stepEnv), {
      PLATFORM: "${{ inputs.platform }}",
      ...perJob,
      DEPLOY_SHA: "${{ inputs.sha }}",
      GH_TOKEN: "${{ steps.app-token.outputs.token }}",
      RUN_URL: RUN_URL_EXPR,
      RUN_ID: "${{ github.run_id }}",
      // Each attempt's own branch: a re-run must not collide with the PR an
      // earlier attempt opened.
      RUN_ATTEMPT: "${{ github.run_attempt }}",
    });
  });
});

// "Retry a store upload" (mobile-retry-upload.yml, Paul 2026-11-12): the
// hand-run retry of one failed submission. It shares `confirm`'s script and
// trust: the trusted ref, nothing installed, EXPO_TOKEN and nothing else.
describe("the Retry a store upload workflow", () => {
  const RETRY = join(REPO_ROOT, ".github", "workflows", "mobile-retry-upload.yml");
  const STEP = "Retry the submission and wait for it on EAS";

  it("runs the confirm script from the trusted ref with nothing installed", () => {
    const steps = stepsOf(RETRY, "retry");
    const checkout = steps.find((s) => /uses:\s*actions\/checkout@/.test(s.body));
    assert.doesNotMatch(checkout.body, /^\s+ref:/m);
    assert.match(checkout.body, /persist-credentials: false/);
    const setup = steps.find((s) => /uses:\s*\.\/\.github\/actions\/node-setup/.test(s.body));
    assert.match(setup.body, /^\s+install: none\s*$/m);
    for (const step of steps) {
      if (/^\s+run:/m.test(step.body)) assert.ok(!scriptOf(step).split("\n").some((l) => runsInstall(l)), step.name);
    }
    assert.match(scriptOf(stepNamed(RETRY, "retry", STEP)), /node scripts\/ci\/confirm-store-submissions\.mjs/);
  });

  it("retries any error, holds only EXPO_TOKEN, and stops polling before its step and job are killed", () => {
    const poll = stepNamed(RETRY, "retry", STEP);
    assert.equal(poll.stepEnv.get("RETRY_ANY_ERROR"), "true");
    assert.equal(poll.stepEnv.get("EXPO_TOKEN"), "${{ secrets.EXPO_TOKEN }}");
    assert.doesNotMatch(readFileSync(RETRY, "utf8"), /secrets\.(?!EXPO_TOKEN\b)/);
    const step = Number(poll.body.match(/^\s+timeout-minutes:\s*(\d+)/m)[1]);
    const job = Number(jobOf(RETRY, "retry").keys.get("timeout-minutes"));
    assert.ok(Number(poll.stepEnv.get("DEADLINE_MINUTES")) < step);
    assert.ok(step + 5 <= job && job <= 360);
  });
});
