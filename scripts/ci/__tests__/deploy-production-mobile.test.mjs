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
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
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
  it("is a choice whose default builds nothing", () => {
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
    assert.equal(value("options"), "[none, ios, android, all]");
  });
});

describe("the mobile job runs only after a live, tagged full ship, for a named platform", () => {
  const job = () => jobOf(CALLER, "mobile");
  const PLATFORMS = ["none", "ios", "android", "all", "", "bogus"];
  const RESULTS = ["success", "failure", "skipped", "cancelled"];

  it("builds exactly when every condition holds, across every combination", () => {
    const condition = job().if;
    assert.ok(condition, "the mobile job has no if:");
    let built = 0;
    for (const mobile_build of PLATFORMS)
      for (const dry_run_only of [true, false])
        for (const scope of ["full", "migrations-only", ""])
          for (const deploy of RESULTS)
            for (const release of RESULTS) {
              const runs = evaluate(condition, {
                inputs: { mobile_build, dry_run_only, scope },
                needs: { deploy: { result: deploy }, release: { result: release } },
              });
              const expected =
                ["ios", "android", "all"].includes(mobile_build) &&
                !dry_run_only &&
                scope !== "migrations-only" &&
                deploy === "success" &&
                release === "success";
              assert.equal(runs, expected, JSON.stringify({ mobile_build, dry_run_only, scope, deploy, release }));
              if (runs) built += 1;
            }
    // Three platforms, two scopes that ship (`full`, and an empty scope that
    // ships like `full`): the table above was not vacuous.
    assert.equal(built, 6);
  });

  it("waits for the deploy and the tag, and builds the validated SHA", () => {
    assert.equal(job().keys.get("needs"), "[validate, deploy, release]");
    assert.equal(job().keys.get("uses"), "./.github/workflows/_mobile-build.yml");
    const call = job().keys.get("with");
    assert.equal(call.get("sha"), VALIDATED_SHA);
    assert.equal(call.get("platform"), "${{ inputs.mobile_build }}");
    // The called jobs read `automation` secrets, which a called job gets only
    // through `inherit` (#2804).
    assert.equal(job().keys.get("secrets"), "inherit");
  });
});

describe("unticked, a run is what it was", () => {
  it("nothing else in the dispatch reads the input", () => {
    for (const j of workflowJobs(CALLER).filter((x) => x.jobId !== "mobile")) {
      assert.doesNotMatch(String(j.if ?? ""), /mobile/, `${j.jobId}'s if: reads the mobile input`);
    }
    const text = readFileSync(CALLER, "utf8")
      .split("\n")
      .filter((l) => !/^\s*#/.test(l));
    const reads = text.filter((l) => /inputs\.mobile_build|needs\.mobile\b/.test(l)).map((l) => l.trim());
    assert.deepEqual(reads, [
      `if: ${jobOf(CALLER, "mobile").if}`,
      "platform: ${{ inputs.mobile_build }}",
    ]);
  });

  it("the summary job's inputs are unchanged, so its report and alert are too", () => {
    assert.equal(jobOf(CALLER, "deploy-outcome").keys.get("needs"), "[validate, deploy, release]");
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
    assert.deepEqual(jobs.map((j) => j.jobId), ["build", "record"]);
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

  it("confirms the tree after the installs and before the build", () => {
    const names = steps().map((s) => s.name);
    const at = (name) => {
      const i = names.indexOf(name);
      assert.notEqual(i, -1, `no step "${name}"`);
      return i;
    };
    const confirm = at("Confirm the tree is exactly the shipped commit");
    assert.ok(at("Install dependencies") < confirm);
    assert.ok(at("Install EAS CLI") < confirm);
    assert.ok(confirm < at("Build on EAS"));
    assert.equal(steps()[confirm].env.get("DEPLOY_SHA"), "${{ inputs.sha }}");
  });

  describe("the confirm step, run", () => {
    const step = () => stepNamed(CALLED, "build", "Confirm the tree is exactly the shipped commit");
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
    const run = (dir, sha) =>
      spawnSync("bash", ["-eo", "pipefail", "-c", scriptOf(step())], {
        cwd: dir,
        env: { ...process.env, DEPLOY_SHA: sha },
        encoding: "utf8",
      });

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

describe("EXPO_TOKEN reaches only the steps that run eas", () => {
  it("is in the env of the build and the two uploads, and nowhere else", () => {
    const holders = workflowSteps(CALLED)
      .filter((s) => [...s.env.values()].some((v) => /secrets\.EXPO_TOKEN\b/.test(v) && !/!=\s*''/.test(v)))
      .map((s) => `${s.jobId}: ${s.name}`);
    assert.deepEqual(holders, [
      "build: Build on EAS",
      "build: Upload iOS to TestFlight (not submitted for review)",
      "build: Upload Android to the Play internal track (not promoted)",
    ]);
    for (const step of stepsOf(CALLED, "build")) {
      if (step.env.has("EXPO_TOKEN")) assert.match(scriptOf(step), /(^|\s)eas (build|submit) /, step.name);
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
    assert.doesNotMatch(text("build"), /PR_BASE_SYNC_APP_/);
  });
});

describe("the eas commands", () => {
  const build = () => stepNamed(CALLED, "build", "Build on EAS");

  it("pins eas-cli to an exact version", () => {
    const install = scriptOf(stepNamed(CALLED, "build", "Install EAS CLI"));
    assert.match(install, /^npm install --global eas-cli@\d+\.\d+\.\d+$/);
  });

  it("builds the production profile, non-interactively, and waits for the JSON", () => {
    const script = scriptOf(build()).replace(/\\\n\s*/g, " ");
    const command = script.split("\n").find((l) => /\beas build\b/.test(l));
    for (const flag of ['--platform "$PLATFORM"', "--profile production", "--non-interactive", "--wait", "--json"]) {
      assert.ok(command.includes(flag), `eas build lacks ${flag}`);
    }
    assert.doesNotMatch(command, /--auto-submit|--local|--no-wait/);
    assert.equal(build().env.get("PLATFORM"), "${{ inputs.platform }}");
    assert.match(build().body, /^\s+working-directory: apps\/mobile\s*$/m);
  });

  it("uploads each finished build by id, after a failed sibling too, and submits nothing for review", () => {
    for (const [store, name] of [
      ["ios", "Upload iOS to TestFlight (not submitted for review)"],
      ["android", "Upload Android to the Play internal track (not promoted)"],
    ]) {
      const step = stepNamed(CALLED, "build", name);
      assert.equal(step.if, `\${{ !cancelled() && steps.build.outputs.${store}_id != '' }}`);
      assert.equal(step.env.get("BUILD_ID"), `\${{ steps.build.outputs.${store}_id }}`);
      const command = scriptOf(step);
      assert.match(command, new RegExp(`^eas submit --platform ${store} --profile production --id "\\$BUILD_ID" --non-interactive --wait`));
      if (store === "ios") assert.match(command, /--no-auto-testflight-setup/);
    }
  });

  describe("the build step's own checks, against a stand-in eas", () => {
    function run({ builds, exit = 0, platform = "all" }) {
      const dir = mkdtempSync(join(tmpdir(), "mobile-eas-"));
      const bin = join(dir, "bin");
      mkdirSync(bin);
      writeFileSync(join(dir, "builds.json"), builds === undefined ? "" : JSON.stringify(builds));
      writeFileSync(join(bin, "eas"), `#!/usr/bin/env bash\necho "$*" > "${dir}/argv"\ncat "${dir}/builds.json"\nexit ${exit}\n`);
      chmodSync(join(bin, "eas"), 0o755);
      const output = join(dir, "output");
      writeFileSync(output, "");
      const result = spawnSync("bash", ["-eo", "pipefail", "-c", scriptOf(build())], {
        cwd: dir,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          RUNNER_TEMP: dir,
          GITHUB_OUTPUT: output,
          PLATFORM: platform,
          DEPLOY_SHA: SHA,
          RUN_URL: "https://github.com/x/y/actions/runs/1",
        },
        encoding: "utf8",
      });
      const outputs = Object.fromEntries(
        readFileSync(output, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
      );
      const argv = readFileSync(join(dir, "argv"), "utf8");
      rmSync(dir, { recursive: true, force: true });
      return { status: result.status, stdout: result.stdout, outputs, argv };
    }
    const ios = (over = {}) => ({ id: "i1", platform: "IOS", status: "FINISHED", appVersion: "0.9.0", appBuildVersion: "12", gitCommitHash: SHA, extra: "dropped", ...over });
    const android = (over = {}) => ({ ...ios(), id: "a1", platform: "ANDROID", appBuildVersion: "7", ...over });

    it("hands both ids on, keeping only the fields the record job reads", () => {
      const { status, outputs, argv } = run({ builds: [ios(), android()] });
      assert.equal(status, 0);
      assert.equal(outputs.ios_id, "i1");
      assert.equal(outputs.android_id, "a1");
      assert.deepEqual(JSON.parse(outputs.builds)[0], {
        id: "i1",
        platform: "IOS",
        status: "FINISHED",
        appVersion: "0.9.0",
        appBuildVersion: "12",
        gitCommitHash: SHA,
      });
      assert.match(argv, /^build --platform all --profile production --non-interactive --wait --json --message /);
    });

    it("fails on a CANCELED build that eas exits 0 for, and still hands on the one that finished", () => {
      const { status, stdout, outputs } = run({ builds: [ios({ status: "CANCELED" }), android()] });
      assert.equal(status, 1);
      assert.match(stdout, /Not every EAS build finished: IOS i1 CANCELED/);
      assert.equal(outputs.ios_id, "");
      assert.equal(outputs.android_id, "a1");
    });

    it("fails with eas's own status when a build errored, after recording what finished", () => {
      const { status, outputs } = run({ builds: [ios(), android({ status: "ERRORED" })], exit: 1 });
      assert.equal(status, 1);
      assert.equal(outputs.ios_id, "i1");
      assert.equal(outputs.android_id, "");
    });

    it("fails when eas printed nothing, and hands on no ids", () => {
      const { status, outputs } = run({ builds: undefined });
      assert.equal(status, 1);
      assert.equal(outputs.builds, "");
      assert.equal(outputs.ios_id, "");
      assert.equal(outputs.android_id, "");
    });
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
      BUILD_RESULT: "${{ needs.build.result }}",
      PLATFORM: "${{ inputs.platform }}",
      IOS_UPLOAD: "${{ needs.build.outputs.ios-upload }}",
      ANDROID_UPLOAD: "${{ needs.build.outputs.android-upload }}",
      DEPLOY_SHA: "${{ inputs.sha }}",
      GH_TOKEN: "${{ steps.app-token.outputs.token }}",
    };
    for (const [key, value] of Object.entries(expected)) assert.equal(step.env.get(key), value, key);
    const outputs = jobOf(CALLED, "build").keys.get("outputs");
    assert.equal(outputs.get("builds"), "${{ steps.build.outputs.builds }}");
    assert.equal(outputs.get("ios-upload"), "${{ steps.upload-ios.outcome }}");
    assert.equal(outputs.get("android-upload"), "${{ steps.upload-android.outcome }}");
    const ids = stepsOf(CALLED, "build").map((s) => s.body.match(/^\s+id:\s*(\S+)/m)?.[1]).filter(Boolean);
    assert.deepEqual(ids, ["build", "upload-ios", "upload-android"]);
  });
});
