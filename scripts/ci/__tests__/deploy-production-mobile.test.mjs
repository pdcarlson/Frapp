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
    assert.deepEqual(jobs.map((j) => j.jobId), ["snapshot", "build", "record"]);
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
    for (const id of ["build", "record"]) {
      assert.deepEqual([...jobOf(CALLED, id).keys.get("permissions")], [["contents", "read"]], id);
    }
  });
});

const CONFIRM = "Confirm the tree is exactly the shipped commit, and still the latest tag";
const BUILD_STEPS = { ios: "Build iOS on EAS", android: "Build Android on EAS" };
const UPLOAD_STEPS = {
  ios: "Upload iOS to TestFlight (not submitted for review)",
  android: "Upload Android to the Play internal track (not promoted)",
};

/** Runs a step's script under the runner's own `bash -eo pipefail`. */
function runStep(step, { cwd, env }) {
  return spawnSync("bash", ["-eo", "pipefail", "-c", scriptOf(step)], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
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

  it("checks out inputs.sha once, with its tags, and nothing moves the tree after", () => {
    const checkouts = steps().filter((s) => /uses:\s*actions\/checkout@/.test(s.body));
    assert.equal(checkouts.length, 1);
    assert.match(checkouts[0].body, /^\s+ref: \$\{\{ inputs\.sha \}\}\s*$/m);
    assert.match(checkouts[0].body, /^\s+fetch-depth: 0\s*$/m);
    assert.match(checkouts[0].body, /^\s+persist-credentials: false\s*$/m);
    for (const step of steps()) {
      assert.doesNotMatch(step.body, WORKSPACE_REWRITE_RE, `"${step.name}" moves the tree`);
      assert.ok(
        !step.body.split("\n").some((l) => USES_ANY_LOCAL_ACTION.test(l)),
        `"${step.name}" runs a local action, which would load from the deployed tree`,
      );
    }
  });

  it("confirms the tree after the installs, and every build waits for it", () => {
    const names = steps().map((s) => s.name);
    const at = (name) => {
      const i = names.indexOf(name);
      assert.notEqual(i, -1, `no step "${name}"`);
      return i;
    };
    const confirm = at(CONFIRM);
    assert.ok(at("Install dependencies") < confirm);
    assert.ok(at("Install EAS CLI") < confirm);
    assert.equal(steps()[confirm].env.get("DEPLOY_SHA"), "${{ inputs.sha }}");
    assert.match(steps()[confirm].body, /^\s+id: confirm\s*$/m);
    for (const name of Object.values(BUILD_STEPS)) {
      assert.ok(confirm < at(name), name);
      assert.match(stepNamed(CALLED, "build", name).if, /^\$\{\{ !cancelled\(\) && steps\.confirm\.outcome == 'success' && /, name);
    }
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
      // Annotated, as release.yml mints them; v0.9.0 sorts above v0.10.0
      // only when the sort is lexical, which would pick the wrong tag.
      git("tag", "-a", "v0.9.0", "-m", "Release v0.9.0", "HEAD");
      return { dir, git, head: git("rev-parse", "HEAD") };
    }
    const run = (dir, sha) => runStep(step(), { cwd: dir, env: { DEPLOY_SHA: sha } });

    it("passes on the latest tag's commit, with ignored install output beside it", () => {
      const { dir, git, head } = repo();
      git("tag", "-a", "v0.10.0", "-m", "Release v0.10.0", "HEAD");
      mkdirSync(join(dir, "node_modules"));
      writeFileSync(join(dir, "node_modules", "x.js"), "");
      const result = run(dir, head);
      assert.equal(result.status, 0, result.stdout);
      assert.match(result.stdout, /the latest tag \(v0\.10\.0\)/);
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

    // A re-run of the store build after a later ship: production has moved,
    // and the old SHA must not be built.
    it("fails once a later ship has tagged another commit, or when nothing is tagged", () => {
      const { dir, git, head } = repo();
      writeFileSync(join(dir, "app.json"), '{"next":true}\n');
      git("commit", "-qam", "next");
      git("tag", "-a", "v0.10.0", "-m", "Release v0.10.0", "HEAD");
      git("checkout", "-q", "--detach", head);
      const moved = run(dir, head);
      assert.equal(moved.status, 1);
      assert.match(moved.stdout, /The latest tag, v0\.10\.0, is on /);
      git("tag", "-d", "v0.9.0", "v0.10.0");
      const untagged = run(dir, head);
      assert.equal(untagged.status, 1);
      assert.match(untagged.stdout, /No v\* tag exists/);
      rmSync(dir, { recursive: true, force: true });
    });
  });
});

describe("EXPO_TOKEN reaches only the steps that run eas", () => {
  it("is in the env of the two builds and the two uploads, and nowhere else", () => {
    const holders = workflowSteps(CALLED)
      .filter((s) => [...s.env.values()].some((v) => /secrets\.EXPO_TOKEN\b/.test(v) && !/!=\s*''/.test(v)))
      .map((s) => `${s.jobId}: ${s.name}`);
    assert.deepEqual(holders, [
      `build: ${BUILD_STEPS.ios}`,
      `build: ${UPLOAD_STEPS.ios}`,
      `build: ${BUILD_STEPS.android}`,
      `build: ${UPLOAD_STEPS.android}`,
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
    assert.doesNotMatch(text("snapshot"), /secrets\./);
  });
});

describe("the eas commands", () => {
  it("installs an exact eas-cli, with its dependencies resolved as of a fixed date", () => {
    const install = scriptOf(stepNamed(CALLED, "build", "Install EAS CLI"));
    assert.match(install, /^npm install --global --before=\d{4}-\d{2}-\d{2} eas-cli@\d+\.\d+\.\d+$/);
  });

  it("builds one platform per step, from one script, on the production profile", () => {
    const [ios, android] = [BUILD_STEPS.ios, BUILD_STEPS.android].map((n) => stepNamed(CALLED, "build", n));
    assert.equal(scriptOf(ios), scriptOf(android), "the two build steps must run the same script");
    assert.equal(ios.env.get("PLATFORM"), "ios");
    assert.equal(android.env.get("PLATFORM"), "android");
    assert.match(ios.if, /\(inputs\.platform == 'ios' \|\| inputs\.platform == 'all'\) \}\}$/);
    assert.match(android.if, /\(inputs\.platform == 'android' \|\| inputs\.platform == 'all'\) \}\}$/);
    const command = scriptOf(ios)
      .replace(/\\\n\s*/g, " ")
      .split("\n")
      .find((l) => /\beas build\b/.test(l));
    for (const flag of ['--platform "$PLATFORM"', "--profile production", "--non-interactive", "--wait", "--json"]) {
      assert.ok(command.includes(flag), `eas build lacks ${flag}`);
    }
    assert.doesNotMatch(command, /--auto-submit|--local|--no-wait/);
    for (const step of [ios, android]) assert.match(step.body, /^\s+working-directory: apps\/mobile\s*$/m);
  });

  it("uploads each finished build by id, after a failed sibling too, and submits nothing for review", () => {
    for (const store of ["ios", "android"]) {
      const step = stepNamed(CALLED, "build", UPLOAD_STEPS[store]);
      assert.equal(step.if, `\${{ !cancelled() && steps.build-${store}.outputs.id != '' }}`);
      assert.equal(step.env.get("BUILD_ID"), `\${{ steps.build-${store}.outputs.id }}`);
      const command = scriptOf(step);
      assert.match(command, new RegExp(`^eas submit --platform ${store} --profile production --id "\\$BUILD_ID" --non-interactive --wait`));
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

  describe("the build step's own checks, against a stand-in eas", () => {
    function run({ builds, exit = 0, platform = "ios" }) {
      const dir = mkdtempSync(join(tmpdir(), "mobile-eas-"));
      const bin = join(dir, "bin");
      mkdirSync(bin);
      writeFileSync(join(dir, "builds.json"), builds === undefined ? "" : JSON.stringify(builds));
      writeFileSync(join(bin, "eas"), `#!/usr/bin/env bash\necho "$*" > "${dir}/argv"\ncat "${dir}/builds.json"\nexit ${exit}\n`);
      chmodSync(join(bin, "eas"), 0o755);
      const output = join(dir, "output");
      writeFileSync(output, "");
      const result = runStep(stepNamed(CALLED, "build", BUILD_STEPS[platform]), {
        cwd: dir,
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          RUNNER_TEMP: dir,
          GITHUB_OUTPUT: output,
          PLATFORM: platform,
          DEPLOY_SHA: SHA,
          RUN_URL: "https://github.com/x/y/actions/runs/1",
        },
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

    it("hands the id on, keeping only the fields the record job reads", () => {
      const { status, outputs, argv } = run({ builds: [ios()] });
      assert.equal(status, 0);
      assert.equal(outputs.id, "i1");
      assert.deepEqual(JSON.parse(outputs.builds), [
        { id: "i1", platform: "IOS", status: "FINISHED", appVersion: "0.9.0", appBuildVersion: "12", gitCommitHash: SHA },
      ]);
      assert.match(argv, /^build --platform ios --profile production --non-interactive --wait --json --message /);
      const other = run({ builds: [android()], platform: "android" });
      assert.equal(other.status, 0);
      assert.equal(other.outputs.id, "a1");
      assert.match(other.argv, /^build --platform android /);
    });

    it("fails on a CANCELED build that eas exits 0 for, and hands on no id", () => {
      const { status, stdout, outputs } = run({ builds: [ios({ status: "CANCELED" })] });
      assert.equal(status, 1);
      assert.match(stdout, /Not every EAS build finished: IOS i1 CANCELED/);
      assert.equal(outputs.id, "");
    });

    it("fails with eas's own exit status, even when every listed build finished", () => {
      const { status, stdout, outputs } = run({ builds: [ios()], exit: 2 });
      assert.equal(status, 2);
      assert.match(stdout, /eas build --platform ios exited 2/);
      assert.equal(outputs.id, "i1", "a finished build is still handed on to its upload");
    });

    it("fails when eas printed nothing, or listed no build of its platform", () => {
      const empty = run({ builds: undefined });
      assert.equal(empty.status, 1);
      assert.equal(empty.outputs.builds, "");
      assert.equal(empty.outputs.id, "");
      const wrong = run({ builds: [android()] });
      assert.equal(wrong.status, 1);
      assert.match(wrong.stdout, /listed no finished ios build/);
      assert.equal(wrong.outputs.id, "");
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
      EAS_BUILDS_IOS: "${{ needs.build.outputs.ios-builds }}",
      EAS_BUILDS_ANDROID: "${{ needs.build.outputs.android-builds }}",
      BUILD_RESULT: "${{ needs.build.result }}",
      PLATFORM: "${{ inputs.platform }}",
      IOS_UPLOAD: "${{ needs.build.outputs.ios-upload }}",
      ANDROID_UPLOAD: "${{ needs.build.outputs.android-upload }}",
      DEPLOY_SHA: "${{ inputs.sha }}",
      GH_TOKEN: "${{ steps.app-token.outputs.token }}",
      RUN_URL: "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}",
      RUN_ID: "${{ github.run_id }}",
      // Each attempt's own branch: a re-run must not collide with the PR an
      // earlier attempt opened.
      RUN_ATTEMPT: "${{ github.run_attempt }}",
    };
    assert.deepEqual([...step.stepEnv.keys()].sort(), Object.keys(expected).sort());
    for (const [key, value] of Object.entries(expected)) assert.equal(step.env.get(key), value, key);
    const outputs = jobOf(CALLED, "build").keys.get("outputs");
    assert.deepEqual(Object.fromEntries(outputs), {
      "ios-builds": "${{ steps.build-ios.outputs.builds }}",
      "android-builds": "${{ steps.build-android.outputs.builds }}",
      "ios-upload": "${{ steps.upload-ios.outcome }}",
      "android-upload": "${{ steps.upload-android.outcome }}",
    });
    const ids = stepsOf(CALLED, "build").map((s) => s.body.match(/^\s+id:\s*(\S+)/m)?.[1]).filter(Boolean);
    assert.deepEqual(ids, ["confirm", "build-ios", "upload-ios", "build-android", "upload-android"]);
  });
});
