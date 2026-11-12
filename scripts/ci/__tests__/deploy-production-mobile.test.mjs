// The opt-in store build after a production ship (#3111):
// `deploy-production.yml`'s `mobile_build` input and `mobile` job, and the
// workflow it calls, `_mobile-build.yml`. The rules it exists for are in that
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
import { createHash } from "node:crypto";
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
    assert.equal(value("default"), "none");
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
    assert.deepEqual(jobs.map((j) => j.jobId), ["snapshot", "build", "record", "confirm"]);
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

// The run stays in flight for as long as EAS takes, and migration-snapshot.yml
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
    for (const id of ["build", "record", "confirm"]) {
      assert.deepEqual([...jobOf(CALLED, id).keys.get("permissions")], [["contents", "read"]], id);
    }
  });
});

const CONFIRM = "Confirm the tree is exactly the shipped commit";
const TAG_STEPS = {
  build: "Check the SHA is still the latest tag, before building",
  upload: "Check the SHA is still the latest tag, before uploading",
};
const START_STEPS = { ios: "Start the iOS build on EAS", android: "Start the Android build on EAS" };
const WAIT = "Wait for the EAS builds";
const CONFIRM_POLL = "Wait for each submission to finish on EAS";
const UPLOAD_STEPS = {
  ios: "Upload iOS to TestFlight (not submitted for review)",
  android: "Upload Android to the Play internal track (not promoted)",
};
const RUN_URL_EXPR = "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}";

/**
 * Runs a step's script under `bash -eo pipefail`, what the runner uses for
 * `shell: bash`. `flags: ["-e"]` gives the runner's default when a step names
 * no shell, as this file's upload steps don't, so a test of a step's own
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

describe("the build job's first step", () => {
  const step = () => stepNamed(CALLED, "build", "Check the inputs, and that EXPO_TOKEN reached this job");
  const run = (env) => runStep(step(), { cwd: tmpdir(), env: { DEPLOY_SHA: SHA, PLATFORM: "ios", HAS_EXPO_TOKEN: "true", ...env } });

  it("comes first, and reads only whether the token is set", () => {
    assert.equal(stepsOf(CALLED, "build")[0].name, step().name);
    assert.equal(step().env.get("HAS_EXPO_TOKEN"), "${{ secrets.EXPO_TOKEN != '' }}");
    assert.equal(step().env.get("PLATFORM"), "${{ inputs.platform }}");
    assert.equal(step().env.get("DEPLOY_SHA"), "${{ inputs.sha }}");
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

describe("the build job builds the validated SHA and nothing else", () => {
  const steps = () => stepsOf(CALLED, "build");

  it("checks out inputs.sha once, and nothing moves the tree after", () => {
    const checkouts = steps().filter((s) => /uses:\s*actions\/checkout@/.test(s.body));
    assert.equal(checkouts.length, 1);
    assert.match(checkouts[0].body, /^\s+ref: \$\{\{ inputs\.sha \}\}\s*$/m);
    assert.match(checkouts[0].body, /^\s+persist-credentials: false\s*$/m);
    for (const step of steps()) {
      assert.doesNotMatch(step.body, WORKSPACE_REWRITE_RE, `"${step.name}" moves the tree`);
      assert.ok(
        !step.body.split("\n").some((l) => USES_ANY_LOCAL_ACTION.test(l)),
        `"${step.name}" runs a local action, which would load from the deployed tree`,
      );
    }
  });

  // The order is the safety argument: installs, then the tree and the tag,
  // then the builds; the tag again, then the uploads.
  it("runs its steps in the order that refuses before it builds or uploads", () => {
    const ids = steps().map((s) => s.body.match(/^\s+id:\s*(\S+)/m)?.[1]).filter(Boolean);
    assert.deepEqual(ids, ["confirm", "tag-before-build", "start-ios", "start-android", "wait", "tag-before-upload", "upload-ios", "upload-android"]);
    const names = steps().map((s) => s.name);
    assert.ok(names.indexOf("Install EAS CLI") < names.indexOf(CONFIRM));
    for (const store of ["ios", "android"]) {
      assert.match(
        stepNamed(CALLED, "build", START_STEPS[store]).if,
        new RegExp(String.raw`^\$\{\{ !cancelled\(\) && steps\.tag-before-build\.outcome == 'success' && \(inputs\.platform == '${store}' \|\| inputs\.platform == 'all'\) \}\}$`),
      );
      assert.equal(
        stepNamed(CALLED, "build", UPLOAD_STEPS[store]).if,
        `\${{ !cancelled() && steps.tag-before-upload.outcome == 'success' && steps.wait.outputs.${store}_id != '' }}`,
      );
    }
    assert.equal(stepNamed(CALLED, "build", TAG_STEPS.build).if, null, "the first tag check runs whenever the steps before it passed");
    assert.equal(
      stepNamed(CALLED, "build", TAG_STEPS.upload).if,
      "${{ !cancelled() && (steps.wait.outputs.ios_id != '' || steps.wait.outputs.android_id != '') }}",
    );
  });

  describe("the confirm step, run", () => {
    const step = () => stepNamed(CALLED, "build", CONFIRM);
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

// Rule 1 at both ends of a build that can take hours: a ship made meanwhile
// (a rollback) tags another commit, and nothing from this SHA may upload.
function tagsDigest(tags) {
  return createHash("sha256").update(`${[...tags].sort().join("\n")}\n`).digest("hex");
}

describe("the latest-tag check, before the builds and again before the uploads", () => {
  const OLD = "1111111111111111111111111111111111111111";

  it("is one script, run twice, reading the API with the job's own token", () => {
    const [before, after] = [TAG_STEPS.build, TAG_STEPS.upload].map((n) => stepNamed(CALLED, "build", n));
    assert.equal(scriptOf(before), scriptOf(after));
    for (const step of [before, after]) {
      assert.deepEqual(Object.fromEntries(step.stepEnv), {
        GH_TOKEN: "${{ github.token }}",
        REPO: "${{ github.repository }}",
        DEPLOY_SHA: "${{ inputs.sha }}",
      });
    }
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
    writeFileSync(join(dir, "bin", "sleep"), '#!/usr/bin/env bash\necho "$1" >> "$(dirname "$0")/../sleeps"\n');
    chmodSync(join(dir, "bin", "sleep"), 0o755);
    const output = join(dir, "output");
    writeFileSync(output, "");
    const result = runStep(stepNamed(CALLED, "build", TAG_STEPS.build), {
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
      // What the wait's retry compares the tags it reads against (#3812).
      assert.equal(result.outputs.tags, tagsDigest(["v0.9.0", newest]));
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

describe("EXPO_TOKEN reaches only the steps that run eas", () => {
  it("is in the env of the two starts, the wait, the two uploads and the confirm poll, and nowhere else", () => {
    const holders = workflowSteps(CALLED)
      .filter((s) => [...s.env.values()].some((v) => /secrets\.EXPO_TOKEN\b/.test(v) && !/!=\s*''/.test(v)))
      .map((s) => `${s.jobId}: ${s.name}`);
    assert.deepEqual(holders, [
      `build: ${START_STEPS.ios}`,
      `build: ${START_STEPS.android}`,
      `build: ${WAIT}`,
      `build: ${UPLOAD_STEPS.ios}`,
      `build: ${UPLOAD_STEPS.android}`,
      `confirm: ${CONFIRM_POLL}`,
    ]);
    // The confirm poll reads EAS's API itself (eas-cli 24.8 can't show one
    // submission), from the trusted ref with nothing installed.
    const poll = stepNamed(CALLED, "confirm", CONFIRM_POLL);
    assert.equal(poll.stepEnv.get("EXPO_TOKEN"), "${{ secrets.EXPO_TOKEN }}");
    assert.equal(scriptOf(poll), "node scripts/ci/confirm-store-submissions.mjs");
    for (const step of stepsOf(CALLED, "build")) {
      if (step.env.has("EXPO_TOKEN")) {
        assert.equal(step.stepEnv.get("EXPO_TOKEN"), "${{ secrets.EXPO_TOKEN }}", step.name);
        assert.match(scriptOf(step), /(^|[\s(])eas (build|build:view|submit) /, step.name);
      }
    }
  });

  it("is never in an install step's environment, and no job- or workflow-level env carries it", () => {
    for (const step of workflowSteps(CALLED)) {
      if (!/^\s+run:/m.test(step.body)) continue;
      const installs = scriptOf(step).split("\n").some((l) => runsInstall(l) || /npm install --global/.test(l));
      if (installs) assert.equal(step.env.has("EXPO_TOKEN"), false, step.name);
      for (const [key, value] of step.env) {
        if (!step.stepEnv.has(key)) assert.doesNotMatch(value, /secrets\./, `${step.name} inherits ${key}`);
      }
    }
  });

  it("each job holds only its own credential", () => {
    const text = (jobId) => stepsOf(CALLED, jobId).map((s) => s.body).join("\n");
    assert.doesNotMatch(text("record"), /EXPO_TOKEN/);
    assert.doesNotMatch(text("confirm"), /PR_BASE_SYNC_APP_/);
    assert.doesNotMatch(text("build"), /PR_BASE_SYNC_APP_/);
    assert.doesNotMatch(text("snapshot"), /secrets\./);
  });
});

describe("the eas commands", () => {
  // The publish date of each eas-cli version this file has pinned. `--before`
  // must fall after it (or the version itself is excluded) and not in the
  // future (or it freezes nothing). Moving the pin means adding its date here.
  const PUBLISHED = { "24.8.0": "2026-09-24" };

  it("installs an exact eas-cli, running no install script, with its dependencies held to a past date", () => {
    const install = scriptOf(stepNamed(CALLED, "build", "Install EAS CLI"));
    // `--ignore-scripts`: the step's comment lists the install scripts in the tree. The parse is
    // the one `npm run eas` uses (scripts/eas.mjs), so a laptop installs exactly this.
    assert.match(install, /^npm install --global --ignore-scripts --before=\S+ eas-cli@\S+$/, install);
    const { before, version } = parseEasCliPin(`        run: ${install}\n`);
    assert.ok(PUBLISHED[version], `add eas-cli ${version}'s publish date to PUBLISHED`);
    assert.ok(before > PUBLISHED[version], `--before=${before} excludes eas-cli ${version} itself`);
    assert.ok(new Date(`${before}T00:00:00Z`) <= new Date(), `--before=${before} is in the future, so it freezes nothing`);
  });

  it("starts each platform with one script, on the production profile, without waiting", () => {
    const [ios, android] = [START_STEPS.ios, START_STEPS.android].map((n) => stepNamed(CALLED, "build", n));
    assert.equal(scriptOf(ios), scriptOf(android), "the two start steps must run the same script");
    for (const [step, platform] of [[ios, "ios"], [android, "android"]]) {
      assert.deepEqual(Object.fromEntries(step.stepEnv), {
        EXPO_TOKEN: "${{ secrets.EXPO_TOKEN }}",
        PLATFORM: platform,
        DEPLOY_SHA: "${{ inputs.sha }}",
        RUN_URL: RUN_URL_EXPR,
      });
      assert.match(step.body, /^\s+working-directory: apps\/mobile\s*$/m);
    }
    const command = scriptOf(ios)
      .replace(/\\\n\s*/g, " ")
      .split("\n")
      .find((l) => /\beas build\b/.test(l));
    for (const flag of ['--platform "$PLATFORM"', "--profile production", "--non-interactive", "--no-wait", "--json"]) {
      assert.ok(command.includes(flag), `eas build lacks ${flag}`);
    }
    assert.doesNotMatch(command, /--auto-submit|--local|\s--wait/);
    // The wait's retry starts a build too, and must start it the same way.
    const retry = scriptOf(stepNamed(CALLED, "build", WAIT))
      .replace(/\\\n\s*/g, " ")
      .split("\n")
      .find((l) => /\beas build --platform\b/.test(l));
    const normalize = (l) => l.trim().replace(/^timeout "\$START_TIMEOUT_SECONDS" /, "").replace(/"\$PL"/, '"$PLATFORM"').replace(/ \(retry of \$ID\)"/, '"').replace(/ \|\| [A-Z_]*STATUS=\$\?$/, "");
    assert.equal(normalize(retry), normalize(command));
  });

  it("submits each finished build by id without waiting, and submits nothing for review", () => {
    for (const store of ["ios", "android"]) {
      const step = stepNamed(CALLED, "build", UPLOAD_STEPS[store]);
      assert.deepEqual(Object.fromEntries(step.stepEnv), {
        EXPO_TOKEN: "${{ secrets.EXPO_TOKEN }}",
        BUILD_ID: `\${{ steps.wait.outputs.${store}_id }}`,
      });
      const command = scriptOf(step);
      const submit = command.split("\n").find((l) => /^eas submit /.test(l));
      assert.match(submit, new RegExp(`^eas submit --platform ${store} --profile production --id "\\$BUILD_ID" --non-interactive --no-wait`));
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

  // The job's ceiling has to hold every step's, and the wait has to stop
  // itself before its step is killed, or it loses the list it exists to hand on.
  it("fits every step's ceiling under the job's, and the wait's deadline under its own", () => {
    const job = Number(jobOf(CALLED, "build").keys.get("timeout-minutes"));
    assert.ok(job <= 360, "a hosted job runs at most 360 minutes");
    const ceilings = stepsOf(CALLED, "build").map((s) => Number(s.body.match(/^\s+timeout-minutes:\s*(\d+)/m)?.[1] ?? 0));
    assert.ok(ceilings.reduce((a, b) => a + b, 0) + 20 <= job, "the steps' ceilings, plus the installs, outrun the job's");
    const wait = stepNamed(CALLED, "build", WAIT);
    const stepCeiling = Number(wait.body.match(/^\s+timeout-minutes:\s*(\d+)/m)[1]);
    assert.ok(Number(wait.stepEnv.get("DEADLINE_MINUTES")) < stepCeiling);
  });

  describe("the start step, against a stand-in eas", () => {
    function run({ started, exit = 0, platform = "ios" }) {
      const { dir, output, path } = withStub("eas", `echo "$*" > "$RUNNER_TEMP/argv"\n${started === undefined ? "" : `echo '${JSON.stringify(started)}'`}\nexit ${exit}`);
      const result = runStep(stepNamed(CALLED, "build", START_STEPS[platform]), {
        cwd: dir,
        env: { PATH: path, RUNNER_TEMP: dir, GITHUB_OUTPUT: output, PLATFORM: platform, DEPLOY_SHA: SHA, RUN_URL: "https://x/runs/1" },
      });
      const outputs = readOutputs(output);
      const argv = readFileSync(join(dir, "argv"), "utf8");
      rmSync(dir, { recursive: true, force: true });
      return { status: result.status, stdout: result.stdout, outputs, argv };
    }

    it("hands the started build's id on at once", () => {
      const { status, outputs, argv } = run({ started: [{ id: "i1", platform: "IOS", status: "NEW" }] });
      assert.equal(status, 0);
      assert.equal(outputs.id, "i1");
      assert.match(argv, /^build --platform ios --profile production --non-interactive --no-wait --json --message /);
    });

    it("keeps eas's own exit status, and still names a build it started", () => {
      const { status, stdout, outputs } = run({ started: [{ id: "i1", platform: "IOS", status: "NEW" }], exit: 2 });
      assert.equal(status, 2);
      assert.match(stdout, /exited 2 after starting i1/);
      assert.equal(outputs.id, "i1");
    });

    it("fails when nothing started, or only another platform did", () => {
      const nothing = run({ started: undefined });
      assert.equal(nothing.status, 1);
      assert.equal(nothing.outputs.id, "");
      const other = run({ started: [{ id: "a1", platform: "ANDROID", status: "NEW" }] });
      assert.equal(other.status, 1);
      assert.match(other.stdout, /reported no started ios build/);
    });
  });

  it("waits for every started build, with its deadline under its step's", () => {
    const wait = stepNamed(CALLED, "build", WAIT);
    assert.equal(wait.if, "${{ !cancelled() && (steps.start-ios.outputs.id != '' || steps.start-android.outputs.id != '') }}");
    assert.deepEqual(Object.fromEntries(wait.stepEnv), {
      EXPO_TOKEN: "${{ secrets.EXPO_TOKEN }}",
      IDS: "${{ steps.start-ios.outputs.id }} ${{ steps.start-android.outputs.id }}",
      DEPLOY_SHA: "${{ inputs.sha }}",
      RUN_URL: RUN_URL_EXPR,
      GH_TOKEN: "${{ github.token }}",
      REPO: "${{ github.repository }}",
      TAGS_AT_BUILD: "${{ steps.tag-before-build.outputs.tags }}",
      DEADLINE_MINUTES: "230",
      POLL_SECONDS: "60",
      READ_TIMEOUT_SECONDS: "120",
      START_TIMEOUT_SECONDS: "540",
      RETRY_MIN_MINUTES: "60",
      LOG_TAIL_LINES: "100",
    });
    assert.match(scriptOf(wait), /timeout "\$READ_TIMEOUT_SECONDS" eas build:view "\$ID" --json/);
  });

  describe("the wait, against a stand-in eas", () => {
    const ios = (over = {}) => ({ id: "i1", platform: "IOS", status: "FINISHED", appVersion: "0.9.0", appBuildVersion: "12", gitCommitHash: SHA, extra: "dropped", ...over });
    const android = (over = {}) => ({ ...ios(), id: "a1", platform: "ANDROID", appBuildVersion: "7", ...over });

    /**
     * `views` maps a build id to what `eas build:view <id> --json` prints, or
     * to a list of what it prints on each read in turn (the last repeats); a
     * missing id fails, printing `error` on stderr, and `sleep` makes every
     * read stall that many seconds.
     */
    /*
     * `starts` maps a platform (`ios`, `android`) to what `eas build --platform
     * <p> … --json` prints, the retry's start; a missing one fails. `logs`
     * maps a log URL to its text, served by a stand-in curl. Each start's argv
     * lands in `starts-<p>`, returned as `startArgv`.
     */
    /*
     * `tags` is what the stand-in gh lists as the `v*` tags when the retry
     * reads them (null: the read fails); `tagsAtBuild` is what the check
     * before the builds saw, as its digest.
     */
    function run({ views, ids = "i1 a1", deadline = "0", sleep = 0, readTimeout = "120", error = "", starts = {}, logs = {}, retryMin = "0", tags = ["v0.17.0"], tagsAtBuild = ["v0.17.0"] }) {
      const { dir, output, path } = withStub(
        "eas",
        [
          'if [ "$1" = build ] && [ "$2" = --platform ]; then echo "$*" >> "$RUNNER_TEMP/starts-$3"; f="$RUNNER_TEMP/start-$3.json"; [ -f "$f" ] && cat "$f" && exit 0; exit 1; fi',
          sleep ? `sleep ${sleep}` : "",
          'n="$RUNNER_TEMP/reads-$2"; c=$(( $(cat "$n" 2>/dev/null || echo 0) + 1 )); echo "$c" > "$n"',
          'f="$RUNNER_TEMP/view-$2-$c.json"; [ -f "$f" ] || f="$(ls "$RUNNER_TEMP"/view-"$2"-*.json 2>/dev/null | sort -V | tail -n1)"',
          '[ -n "$f" ] && [ -f "$f" ] && cat "$f" || { [ -n "$EAS_ERROR" ] && echo "$EAS_ERROR" >&2; exit 1; }',
        ].join("\n"),
      );
      for (const [id, view] of Object.entries(views)) {
        (Array.isArray(view) ? view : [view]).forEach((v, i) => writeFileSync(join(dir, `view-${id}-${i + 1}.json`), JSON.stringify(v)));
      }
      for (const [platform, printed] of Object.entries(starts)) writeFileSync(join(dir, `start-${platform}.json`), JSON.stringify(printed));
      Object.entries(logs).forEach(([url, text], i) => writeFileSync(join(dir, `log-${i}`), text));
      // The stand-in curl serves `logs` by URL, its last argument.
      const curl = join(dir, "bin", "curl");
      writeFileSync(
        curl,
        `#!/usr/bin/env bash\nurl="\${@: -1}"\n${Object.keys(logs).map((url, i) => `[ "$url" = '${url}' ] && cat "$RUNNER_TEMP/log-${i}" && exit 0`).join("\n")}\nexit 22\n`,
      );
      chmodSync(curl, 0o755);
      const gh = join(dir, "bin", "gh");
      writeFileSync(
        gh,
        tags === null
          ? "#!/usr/bin/env bash\necho 'gh: Failed (HTTP 502)' >&2\nexit 1\n"
          : `#!/usr/bin/env bash\n[ "$2" = repos/o/r/git/matching-refs/tags/v ] || exit 2\nprintf '%s\\n' ${tags.map((t) => `'${t}'`).join(" ")}\n`,
      );
      chmodSync(gh, 0o755);
      const result = runStep(stepNamed(CALLED, "build", WAIT), {
        cwd: dir,
        env: {
          PATH: path,
          RUNNER_TEMP: dir,
          GITHUB_OUTPUT: output,
          IDS: ids,
          DEPLOY_SHA: SHA,
          DEADLINE_MINUTES: deadline,
          POLL_SECONDS: "0",
          READ_TIMEOUT_SECONDS: readTimeout,
          START_TIMEOUT_SECONDS: "30",
          RETRY_MIN_MINUTES: retryMin,
          LOG_TAIL_LINES: "100",
          RUN_URL: "https://github.com/o/r/actions/runs/1",
          REPO: "o/r",
          GH_TOKEN: "t",
          TAGS_AT_BUILD: tagsDigest(tagsAtBuild),
          EAS_ERROR: error,
        },
      });
      const outputs = readOutputs(output);
      const reads = Object.fromEntries(
        Object.keys(views).filter((id) => existsSync(join(dir, `reads-${id}`))).map((id) => [id, Number(readFileSync(join(dir, `reads-${id}`), "utf8"))]),
      );
      const startArgv = Object.fromEntries(
        ["ios", "android"].filter((p) => existsSync(join(dir, `starts-${p}`))).map((p) => [p, readFileSync(join(dir, `starts-${p}`), "utf8").trim().split("\n")]),
      );
      rmSync(dir, { recursive: true, force: true });
      return { status: result.status, stdout: result.stdout, outputs, startArgv, reads };
    }

    it("hands each finished build of the SHA to its upload, keeping only the fields the record job reads", () => {
      const { status, outputs } = run({ views: { i1: ios(), a1: android() } });
      assert.equal(status, 0);
      assert.equal(outputs.ios_id, "i1");
      assert.equal(outputs.android_id, "a1");
      assert.deepEqual(JSON.parse(outputs.builds)[0], {
        id: "i1", platform: "IOS", status: "FINISHED", appVersion: "0.9.0", appBuildVersion: "12", gitCommitHash: SHA,
      });
      assert.equal(run({ views: { i1: ios() }, ids: " i1" }).outputs.android_id, "", "a platform that never started");
    });

    it("never hands on a build EAS made from another commit", () => {
      const { status, stdout, outputs } = run({ views: { i1: ios({ gitCommitHash: "f".repeat(40) }), a1: android() } });
      assert.equal(status, 1);
      assert.match(stdout, /will not be uploaded: IOS i1 from f{40}/);
      assert.equal(outputs.ios_id, "");
      assert.equal(outputs.android_id, "a1");
    });

    it("fails on an errored or canceled build, and still hands on the one that finished", () => {
      const { status, stdout, outputs } = run({ views: { i1: ios({ status: "ERRORED" }), a1: android() } });
      assert.equal(status, 1);
      assert.match(stdout, /did not finish: IOS i1 ERRORED/);
      assert.equal(outputs.ios_id, "");
      assert.equal(outputs.android_id, "a1");
    });

    // #3812: a failed platform is named the round it is seen, not after the
    // other platform finishes.
    it("reports an errored build the round it sees it, while the other still builds", () => {
      const { status, stdout } = run({
        views: {
          i1: ios({ status: "ERRORED", error: { errorCode: "EAS_BUILD_UNKNOWN_FASTLANE_ERROR", message: "Fastlane\nfailed\n" } }),
          a1: [android({ status: "IN_PROGRESS" }), android({ status: "IN_PROGRESS" }), android()],
        },
        deadline: "5",
      });
      assert.equal(status, 1);
      const early = stdout.indexOf("::error::The IOS build i1 ERRORED (EAS_BUILD_UNKNOWN_FASTLANE_ERROR: Fastlane failed)");
      assert.ok(early >= 0, stdout);
      assert.equal((stdout.match(/::error::The IOS build i1 ERRORED/g) ?? []).length, 1, "reported once, not every round");
      const androidDone = stdout.indexOf("ANDROID a1: FINISHED");
      assert.ok(stdout.indexOf("ANDROID a1: IN_PROGRESS") >= 0 && androidDone > 0, stdout);
      assert.ok(early < androidDone, "named while Android was still building, not once it finished");
    });

    const POD_504 = "[!] Invalid `RNSentry.podspec` file: Failed to download https://github.com/getsentry/sentry-cocoa/releases/download/9.32.0/Sentry.xcframework.zip: OpenURI::HTTPError: 504 Gateway Time-out.";

    it("starts an iOS build again once when its logs end on a transient download failure, and hands on the retry", () => {
      const { status, stdout, outputs, startArgv } = run({
        views: {
          i1: ios({ status: "ERRORED", error: { errorCode: "UNKNOWN_ERROR", message: "Unknown error. See logs of the Install pods build phase." }, logFiles: ["https://logs/i1-a", "https://logs/i1-b"] }),
          i2: [ios({ id: "i2", status: "IN_QUEUE", appBuildVersion: "13" }), ios({ id: "i2", appBuildVersion: "13" })],
          a1: android(),
        },
        logs: { "https://logs/i1-a": '{"msg":"Installing pods"}\n', "https://logs/i1-b": `${JSON.stringify({ msg: POD_504 })}\n{"msg":"Build failed"}\n` },
        starts: { ios: [{ id: "i2", platform: "IOS" }] },
        deadline: "5",
      });
      assert.equal(status, 0, stdout);
      assert.match(stdout, /::warning::The IOS build i1 errored on a transient network failure/);
      assert.equal(startArgv.ios.length, 1);
      assert.match(startArgv.ios[0], /^build --platform ios --profile production --non-interactive --no-wait --json --message Deploy production [0-9a-f]{40} https:\/\/github\.com\/o\/r\/actions\/runs\/1 \(retry of i1\)$/);
      assert.equal(outputs.ios_retry, "i2");
      assert.equal(outputs.ios_id, "i2");
      assert.equal(outputs.android_id, "a1");
      assert.deepEqual(JSON.parse(outputs.builds).map((b) => `${b.id} ${b.status}`), ["i2 FINISHED", "a1 FINISHED"], "the retry replaces the errored build");
      assert.doesNotMatch(stdout, /https:\/\/logs\//, "signed log URLs are never printed");
    });

    it("retries on a 5xx named in EAS's own error message, without reading the logs", () => {
      const { status, outputs } = run({
        views: { a1: android({ status: "ERRORED", error: { message: "Request failed: HTTP error 503 while downloading gradle" } }), a2: android({ id: "a2" }) },
        ids: " a1",
        starts: { android: [{ id: "a2", platform: "ANDROID" }] },
        deadline: "5",
      });
      assert.equal(status, 0);
      assert.equal(outputs.android_retry, "a2");
      assert.equal(outputs.android_id, "a2");
    });

    it("retries a platform at most once", () => {
      const failed = (id) => ios({ id, status: "ERRORED", error: { message: `OpenURI::HTTPError: 504 Gateway Time-out` } });
      const { status, stdout, outputs, startArgv } = run({
        views: { i1: failed("i1"), i2: failed("i2") },
        ids: "i1",
        starts: { ios: [{ id: "i2", platform: "IOS" }] },
        deadline: "5",
      });
      assert.equal(status, 1);
      assert.equal(startArgv.ios.length, 1);
      assert.match(stdout, /::error::The IOS build i2 ERRORED/);
      assert.match(stdout, /did not finish: IOS i2 ERRORED/);
      assert.equal(outputs.ios_id, "");
    });

    it("never retries a failure that isn't a transient network error, nor a cancelled build", () => {
      for (const view of [
        ios({ status: "ERRORED", error: { errorCode: "EAS_BUILD_CREDENTIALS", message: "Distribution certificate expired" }, logFiles: ["https://logs/x"] }),
        ios({ status: "CANCELED", error: { message: "504 Gateway Time-out" } }),
      ]) {
        const { status, startArgv, outputs } = run({
          views: { i1: view },
          ids: "i1",
          logs: { "https://logs/x": '{"msg":"No valid code signing certificates"}\n' },
          starts: { ios: [{ id: "i2", platform: "IOS" }] },
        });
        assert.equal(status, 1);
        assert.deepEqual(startArgv, {}, `${view.status} started a retry`);
        assert.equal(outputs.ios_retry, undefined);
      }
    });

    it("doesn't retry when too little of the deadline is left for a build to finish", () => {
      const { status, startArgv } = run({
        views: { i1: ios({ status: "ERRORED", error: { message: "HTTPError: 502 Bad Gateway" } }) },
        ids: "i1",
        starts: { ios: [{ id: "i2", platform: "IOS" }] },
        deadline: "30",
        retryMin: "60",
      });
      assert.equal(status, 1);
      assert.deepEqual(startArgv, {});
    });

    it("reports the errored build when the retry fails to start", () => {
      const { status, stdout, outputs, startArgv } = run({
        views: { i1: ios({ status: "ERRORED", error: { message: "ECONNRESET" } }) },
        ids: "i1",
        deadline: "5",
      });
      assert.equal(status, 1);
      assert.equal(startArgv.ios.length, 1);
      assert.match(stdout, /::error::Starting the ios retry failed \(exit 1\), so i1 stands as the IOS build/);
      assert.match(stdout, /did not finish: IOS i1 ERRORED/);
      assert.equal(outputs.ios_retry, undefined);
    });

    const transient504 = (over = {}) => ios({ status: "ERRORED", error: { message: "OpenURI::HTTPError: 504 Gateway Time-out" }, ...over });

    // Rule 1 holds for a retry: it is a build start like any other.
    it("doesn't retry when the v* tags changed since the builds started, or can't be read", () => {
      for (const [tags, why] of [[["v0.17.0", "v0.17.1"], "a later ship"], [null, "an unreadable tag list"]]) {
        const { status, stdout, startArgv } = run({ views: { i1: transient504() }, ids: "i1", tags, starts: { ios: [{ id: "i2", platform: "IOS" }] }, deadline: "5" });
        assert.equal(status, 1, why);
        assert.deepEqual(startArgv, {}, `${why} started a retry`);
        assert.match(stdout, /v\* tags changed since the builds started, or couldn't be read, so it is not started again/, why);
      }
    });

    it("matches a transient failure early in a large log tail, where a pipe into grep -q would SIGPIPE", () => {
      const filler = `${JSON.stringify({ msg: "x".repeat(2000) })}\n`;
      const { outputs, stdout } = run({
        views: { i1: ios({ status: "ERRORED", logFiles: ["https://logs/big"] }), i2: ios({ id: "i2" }) },
        ids: "i1",
        logs: { "https://logs/big": `${JSON.stringify({ msg: "Could not GET 'https://repo1.maven.org/x.pom'. Received status code 502 from server: Bad Gateway" })}\n${filler.repeat(99)}` },
        starts: { ios: [{ id: "i2", platform: "IOS" }] },
        deadline: "5",
      });
      assert.equal(outputs.ios_retry, "i2", stdout);
    });

    it("ignores a network error further back than the last LOG_TAIL_LINES lines", () => {
      const { startArgv } = run({
        views: { i1: ios({ status: "ERRORED", logFiles: ["https://logs/old"] }) },
        ids: "i1",
        logs: { "https://logs/old": `{"msg":"npm WARN ETIMEDOUT, retrying"}\n${'{"msg":"compiling"}\n'.repeat(100)}{"msg":"error: no such module"}\n` },
        starts: { ios: [{ id: "i2", platform: "IOS" }] },
        deadline: "5",
      });
      assert.deepEqual(startArgv, {});
    });

    it("never reads a build again once it has ended", () => {
      const { status, reads, outputs } = run({
        views: { i1: [ios({ status: "IN_QUEUE" }), ios({ status: "IN_PROGRESS" }), ios({ status: "IN_PROGRESS" }), ios()], a1: android() },
        deadline: "5",
      });
      assert.equal(status, 0);
      assert.equal(reads.a1, 1, "a finished build was read again, and a failed re-read would make it UNREAD");
      assert.equal(reads.i1, 4);
      assert.equal(outputs.android_id, "a1");
    });

    // The loop's own exit: every build ended, well before the deadline.
    it("keeps reading until every build has ended", () => {
      const { status, outputs } = run({
        views: { i1: [ios({ status: "IN_QUEUE" }), ios({ status: "IN_PROGRESS" }), ios()], a1: [android({ status: "IN_PROGRESS" }), android()] },
        deadline: "5",
      });
      assert.equal(status, 0);
      assert.equal(outputs.ios_id, "i1");
      assert.equal(outputs.android_id, "a1");
    });

    it("treats a stalled read as unread instead of hanging past its step", () => {
      const started = Date.now();
      const { status, stdout } = run({ views: { i1: ios() }, ids: "i1", sleep: 5, readTimeout: "1" });
      assert.ok(Date.now() - started < 4000, "the read was not cut off");
      assert.equal(status, 1);
      assert.match(stdout, /i1 UNREAD/);
      assert.match(stdout, /The last read of i1 failed: no answer within 1s/);
    });

    it("logs why a read failed, every round and again at the deadline", () => {
      const { status, stdout, outputs } = run({
        views: { i1: ios({ status: "IN_QUEUE" }) },
        error: "GraphQL request failed: Unauthorized",
      });
      assert.equal(status, 1);
      assert.match(stdout, /Couldn't read a1 this round \(exit 1: GraphQL request failed: Unauthorized/);
      assert.match(stdout, /::error::The last read of a1 failed: exit 1: GraphQL request failed: Unauthorized/);
      assert.doesNotMatch(stdout, /The last read of i1/, "i1 was read; only the unread build is explained");
      // The cause stays in the log: an output carrying a masked value is dropped.
      assert.doesNotMatch(outputs.builds, /Unauthorized/);
    });

    it("refuses to wait for nothing", () => {
      const { status, stdout } = run({ views: {}, ids: " " });
      assert.equal(status, 1);
      assert.match(stdout, /No build id reached the wait/);
    });

    it("stops at its deadline with the list, naming what is still building or unread", () => {
      const { status, stdout, outputs } = run({ views: { i1: ios({ status: "IN_QUEUE" }) } });
      assert.equal(status, 1);
      assert.match(stdout, /Still not finished after 0 minutes: i1 IN_QUEUE, a1 UNREAD/);
      assert.deepEqual(JSON.parse(outputs.builds).map((b) => `${b.id} ${b.status}`), ["i1 IN_QUEUE", "a1 UNREAD"]);
      assert.equal(outputs.ios_id, "");
    });
  });
});

describe("the upload steps, against a stand-in eas", () => {
  const SUBMISSION = "3f1c2b4a-1111-4a2b-9c3d-0123456789ab";
  function run({ printed, exit = 0, store = "ios" }) {
    const { dir, output, path } = withStub("eas", `echo "$*" > "$RUNNER_TEMP/argv"\n${printed === undefined ? "" : `printf '%s\\n' '${printed}'`}\nexit ${exit}`);
    // The runner's default `bash -e`: the steps name no shell, so only their
    // own `set -o pipefail` lets a failed `eas submit | tee` fail the step.
    const result = runStep(stepNamed(CALLED, "build", UPLOAD_STEPS[store]), {
      cwd: dir,
      env: { PATH: path, RUNNER_TEMP: dir, GITHUB_OUTPUT: output, BUILD_ID: "b1" },
      flags: ["-e"],
    });
    const outputs = readOutputs(output);
    const argv = readFileSync(join(dir, "argv"), "utf8");
    rmSync(dir, { recursive: true, force: true });
    return { status: result.status, stdout: result.stdout, outputs, argv };
  }

  it("hands on the submission id from the details link, colored or not", () => {
    for (const store of ["ios", "android"]) {
      const plain = run({ store, printed: `Submission details: https://expo.dev/accounts/pdcarlson/projects/frapp/submissions/${SUBMISSION}` });
      assert.equal(plain.status, 0, plain.stdout);
      assert.equal(plain.outputs.submission, SUBMISSION);
      assert.match(plain.argv, new RegExp(`^submit --platform ${store} --profile production --id b1 --non-interactive --no-wait`));
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
    for (const store of ["ios", "android"]) {
      const refused = run({ store, printed: "Error: build not found", exit: 1 });
      assert.equal(refused.status, 1);
      assert.equal(refused.outputs.submission, undefined);
    }
  });
});

describe("the confirm job", () => {
  it("runs beside record once an upload succeeded, from the trusted ref, with nothing installed", () => {
    const job = jobOf(CALLED, "confirm");
    assert.equal(job.keys.get("needs"), "build");
    assert.equal(
      job.if,
      "${{ !cancelled() && (needs.build.outputs.ios-upload == 'success' || needs.build.outputs.android-upload == 'success') }}",
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

  it("feeds the script each upload's outcome, submission and build, and stops polling before its step and job are killed", () => {
    const poll = stepNamed(CALLED, "confirm", CONFIRM_POLL);
    for (const store of ["ios", "android"]) {
      const KEY = store.toUpperCase();
      assert.equal(poll.stepEnv.get(`${KEY}_UPLOAD`), `\${{ needs.build.outputs.${store}-upload }}`);
      assert.equal(poll.stepEnv.get(`${KEY}_SUBMISSION`), `\${{ needs.build.outputs.${store}-submission }}`);
      assert.equal(poll.stepEnv.get(`${KEY}_BUILD`), `\${{ needs.build.outputs.${store}-started }}`);
    }
    const step = Number(poll.body.match(/^\s+timeout-minutes:\s*(\d+)/m)[1]);
    const job = Number(jobOf(CALLED, "confirm").keys.get("timeout-minutes"));
    assert.ok(Number(poll.stepEnv.get("DEADLINE_MINUTES")) < step, "the poll's deadline must end before its step's ceiling");
    assert.ok(step + 5 <= job, "the step's ceiling, plus checkout and setup, must fit the job's");
    assert.ok(job <= 360, "a hosted job runs at most 360 minutes");
  });
});

describe("the record job", () => {
  it("runs after a failed build too, from the trusted ref, and only mints a token when something uploaded", () => {
    const job = jobOf(CALLED, "record");
    assert.equal(job.if, "${{ !cancelled() && needs.build.result != 'skipped' }}");
    assert.equal(job.keys.get("needs"), "build");
    const steps = stepsOf(CALLED, "record");
    const checkout = steps.find((s) => /uses:\s*actions\/checkout@/.test(s.body));
    assert.doesNotMatch(checkout.body, /^\s+ref:/m, "the record job must run the trusted ref, not the built commit");
    const mint = stepNamed(CALLED, "record", "Mint the base-sync App token");
    assert.equal(
      mint.if,
      "${{ needs.build.outputs.ios-upload == 'success' || needs.build.outputs.android-upload == 'success' }}",
    );
  });

  it("feeds the script every value it reads, from the build job's outputs", () => {
    const step = stepNamed(CALLED, "record", "Record the uploaded builds and summarise the run");
    assert.equal(step.if, "${{ !cancelled() }}");
    assert.equal(scriptOf(step), "node scripts/ci/record-shipped-builds.mjs");
    const expected = {
      EAS_BUILDS: "${{ needs.build.outputs.builds }}",
      EAS_STARTED_IOS: "${{ needs.build.outputs.ios-started }}",
      EAS_STARTED_ANDROID: "${{ needs.build.outputs.android-started }}",
      BUILD_RESULT: "${{ needs.build.result }}",
      PLATFORM: "${{ inputs.platform }}",
      IOS_UPLOAD: "${{ needs.build.outputs.ios-upload }}",
      ANDROID_UPLOAD: "${{ needs.build.outputs.android-upload }}",
      TAG_MOVED: "${{ needs.build.outputs.tag-moved }}",
      TAG_BEFORE_BUILD: "${{ needs.build.outputs.tag-before-build }}",
      TAG_BEFORE_UPLOAD: "${{ needs.build.outputs.tag-before-upload }}",
      DEPLOY_SHA: "${{ inputs.sha }}",
      GH_TOKEN: "${{ steps.app-token.outputs.token }}",
      // The record PR merges itself (Paul, 2026-11-12).
      AUTO_MERGE: "true",
      RUN_URL: RUN_URL_EXPR,
      RUN_ID: "${{ github.run_id }}",
      // Each attempt's own branch: a re-run must not collide with the PR an
      // earlier attempt opened.
      RUN_ATTEMPT: "${{ github.run_attempt }}",
    };
    assert.deepEqual(Object.fromEntries(step.stepEnv), expected);
    assert.deepEqual(Object.fromEntries(jobOf(CALLED, "build").keys.get("outputs")), {
      builds: "${{ steps.wait.outputs.builds }}",
      "ios-started": "${{ steps.wait.outputs.ios_retry || steps.start-ios.outputs.id }}",
      "android-started": "${{ steps.wait.outputs.android_retry || steps.start-android.outputs.id }}",
      "ios-upload": "${{ steps.upload-ios.outcome }}",
      "android-upload": "${{ steps.upload-android.outcome }}",
      "ios-submission": "${{ steps.upload-ios.outputs.submission }}",
      "android-submission": "${{ steps.upload-android.outputs.submission }}",
      "tag-moved": "${{ steps.tag-before-build.outputs.moved || steps.tag-before-upload.outputs.moved }}",
      "tag-before-build": "${{ steps.tag-before-build.outcome }}",
      "tag-before-upload": "${{ steps.tag-before-upload.outcome }}",
    });
  });
});
