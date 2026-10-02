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
    // The third read is the summary's, for one message on a failed tag, run below.
    assert.deepEqual(reads, [
      `if: ${jobOf(CALLER, "mobile").if}`,
      "platform: ${{ inputs.mobile_build }}",
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
      for (const platform of ["ios", "android", "all"]) {
        const asked = run(platform);
        assert.equal(asked.status, 1, platform);
        assert.match(asked.stdout, new RegExp(`asked for a store build \\(${platform}\\).*Re-run failed jobs on this run`), platform);
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

const CONFIRM = "Confirm the tree is exactly the shipped commit";
const TAG_STEPS = {
  build: "Check the SHA is still the latest tag, before building",
  upload: "Check the SHA is still the latest tag, before uploading",
};
const START_STEPS = { ios: "Start the iOS build on EAS", android: "Start the Android build on EAS" };
const WAIT = "Wait for the EAS builds";
const UPLOAD_STEPS = {
  ios: "Upload iOS to TestFlight (not submitted for review)",
  android: "Upload Android to the Play internal track (not promoted)",
};
const RUN_URL_EXPR = "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}";

/** Runs a step's script under the runner's own `bash -eo pipefail`. */
function runStep(step, { cwd, env }) {
  return spawnSync("bash", ["-eo", "pipefail", "-c", scriptOf(step)], {
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
  it("is in the env of the two starts, the wait and the two uploads, and nowhere else", () => {
    const holders = workflowSteps(CALLED)
      .filter((s) => [...s.env.values()].some((v) => /secrets\.EXPO_TOKEN\b/.test(v) && !/!=\s*''/.test(v)))
      .map((s) => `${s.jobId}: ${s.name}`);
    assert.deepEqual(holders, [
      `build: ${START_STEPS.ios}`,
      `build: ${START_STEPS.android}`,
      `build: ${WAIT}`,
      `build: ${UPLOAD_STEPS.ios}`,
      `build: ${UPLOAD_STEPS.android}`,
    ]);
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
  });

  it("uploads each finished build by id, and submits nothing for review", () => {
    for (const store of ["ios", "android"]) {
      const step = stepNamed(CALLED, "build", UPLOAD_STEPS[store]);
      assert.deepEqual(Object.fromEntries(step.stepEnv), {
        EXPO_TOKEN: "${{ secrets.EXPO_TOKEN }}",
        BUILD_ID: `\${{ steps.wait.outputs.${store}_id }}`,
      });
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
      DEADLINE_MINUTES: "230",
      POLL_SECONDS: "60",
      READ_TIMEOUT_SECONDS: "120",
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
    function run({ views, ids = "i1 a1", deadline = "0", sleep = 0, readTimeout = "120", error = "" }) {
      const { dir, output, path } = withStub(
        "eas",
        [
          sleep ? `sleep ${sleep}` : "",
          'n="$RUNNER_TEMP/reads-$2"; c=$(( $(cat "$n" 2>/dev/null || echo 0) + 1 )); echo "$c" > "$n"',
          'f="$RUNNER_TEMP/view-$2-$c.json"; [ -f "$f" ] || f="$(ls "$RUNNER_TEMP"/view-"$2"-*.json 2>/dev/null | sort -V | tail -n1)"',
          '[ -n "$f" ] && [ -f "$f" ] && cat "$f" || { [ -n "$EAS_ERROR" ] && echo "$EAS_ERROR" >&2; exit 1; }',
        ].join("\n"),
      );
      for (const [id, view] of Object.entries(views)) {
        (Array.isArray(view) ? view : [view]).forEach((v, i) => writeFileSync(join(dir, `view-${id}-${i + 1}.json`), JSON.stringify(v)));
      }
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
          EAS_ERROR: error,
        },
      });
      const outputs = readOutputs(output);
      rmSync(dir, { recursive: true, force: true });
      return { status: result.status, stdout: result.stdout, outputs };
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
      RUN_URL: RUN_URL_EXPR,
      RUN_ID: "${{ github.run_id }}",
      // Each attempt's own branch: a re-run must not collide with the PR an
      // earlier attempt opened.
      RUN_ATTEMPT: "${{ github.run_attempt }}",
    };
    assert.deepEqual(Object.fromEntries(step.stepEnv), expected);
    assert.deepEqual(Object.fromEntries(jobOf(CALLED, "build").keys.get("outputs")), {
      builds: "${{ steps.wait.outputs.builds }}",
      "ios-started": "${{ steps.start-ios.outputs.id }}",
      "android-started": "${{ steps.start-android.outputs.id }}",
      "ios-upload": "${{ steps.upload-ios.outcome }}",
      "android-upload": "${{ steps.upload-android.outcome }}",
      "tag-moved": "${{ steps.tag-before-build.outputs.moved || steps.tag-before-upload.outputs.moved }}",
      "tag-before-build": "${{ steps.tag-before-build.outcome }}",
      "tag-before-upload": "${{ steps.tag-before-upload.outcome }}",
    });
  });
});
