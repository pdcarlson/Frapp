import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  API_IMAGE_PATHS,
  formatPlanOutputs,
  gitChangedPaths,
  gitResolve,
  gitIsAncestor,
  planStagingDeploy,
  readServedCommit,
} from "../plan-staging-deploy.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HEAD = "1111111111111111111111111111111111111111";
const SERVED = "2222222222222222222222222222222222222222";

/** A history where `older` commits are ancestors of `newer` ones: order is the array index. */
function linearHistory(...commits) {
  return (a, b) => {
    const ia = commits.indexOf(a);
    const ib = commits.indexOf(b);
    if (ia === -1 || ib === -1) throw Object.assign(new Error("unknown commit"), { status: 128 });
    return ia <= ib;
  };
}

/** A stub that records calls, so a test can assert a path was never taken (a throw would be caught). */
function never() {
  const calls = [];
  const fn = (...args) => {
    calls.push(args);
    return [];
  };
  fn.calls = calls;
  return fn;
}

describe("planStagingDeploy", () => {
  it("deploys the tip when staging's served commit can't be read", () => {
    for (const served of [null, undefined, "", "not-a-sha"]) {
      const isAncestor = never();
      const plan = planStagingDeploy({ head: HEAD, served, tip: HEAD, isAncestor, changedPaths: never() });
      assert.equal(plan.plan, "deploy", `served=${served}`);
      assert.equal(plan.deploy, true);
      assert.equal(plan.verifySha, HEAD);
      assert.equal(isAncestor.calls.length, 0);
    }
  });

  // Only the tip's run deploys or speaks for staging. An old run's commit,
  // deployed while /health is down (a cold start, or the outage someone re-ran
  // it for), would be a rollback; even a forward deploy of it would close an
  // alert the tip's own failing run raised.
  it("calls any run that isn't for main's tip stale, whatever staging serves", () => {
    const TIP = "3333333333333333333333333333333333333333";
    const cases = [
      { served: null, isAncestor: never(), changedPaths: never() },
      { served: SERVED, isAncestor: linearHistory(SERVED, HEAD, TIP), changedPaths: () => ["apps/api/src/main.ts"] },
      { served: SERVED, isAncestor: () => false, changedPaths: never() },
      { served: SERVED, isAncestor: () => { throw new Error("bad object"); }, changedPaths: never() },
    ];
    for (const [i, input] of cases.entries()) {
      const plan = planStagingDeploy({ head: HEAD, tip: TIP, ...input });
      assert.equal(plan.plan, "stale", `case ${i}: ${plan.reason}`);
      assert.equal(plan.deploy, false, `case ${i}`);
      assert.equal(plan.verifySha, "", `case ${i}`);
    }
  });

  it("treats the run as the tip when main's tip can't be read", () => {
    const plan = planStagingDeploy({ head: HEAD, served: null, tip: null, isAncestor: never(), changedPaths: never() });
    assert.equal(plan.plan, "deploy");
  });

  it("does not redeploy the commit staging already serves, and verifies it", () => {
    const plan = planStagingDeploy({ head: HEAD, served: HEAD.toUpperCase(), tip: HEAD, isAncestor: never(), changedPaths: never() });
    assert.equal(plan.plan, "current");
    assert.equal(plan.deploy, false);
    assert.match(plan.reason, /already serves/);
  });

  // A re-run of an old run keeps its original head_sha. Deploying it would roll
  // staging back past commits it already serves, and its verdict is about an
  // old commit, so it must not close or raise the alert either.
  // Even for the tip as this checkout saw it: staging can serve a newer commit
  // when main moved on after the checkout (and that commit's run deployed), or
  // when Render auto-deploy is still on (#2679).
  it("never deploys a commit staging has already moved past, and calls it stale", () => {
    const changedPaths = never();
    const plan = planStagingDeploy({
      head: HEAD,
      served: SERVED,
      tip: HEAD,
      isAncestor: linearHistory(HEAD, SERVED),
      changedPaths,
    });
    assert.equal(plan.plan, "stale");
    assert.equal(plan.deploy, false);
    assert.equal(plan.verifySha, "");
    assert.match(plan.reason, /roll staging back/);
    assert.equal(changedPaths.calls.length, 0);
  });

  // The per-push filter this replaces diffed HEAD~1, so an API commit whose own
  // run never deployed (CI failed or replaced) was skipped by the next docs-only
  // push. Diffing from the served commit carries it forward.
  it("deploys a docs-only push when an earlier API change never reached staging", () => {
    const seen = [];
    const plan = planStagingDeploy({
      head: HEAD,
      served: SERVED,
      tip: HEAD,
      isAncestor: linearHistory(SERVED, HEAD),
      changedPaths: (base, head) => {
        seen.push([base, head]);
        return ["apps/api/src/main.ts", "docs/a.md"];
      },
    });
    assert.deepEqual(seen, [[SERVED, HEAD]], "diffs from the served commit, not HEAD~1");
    assert.equal(plan.plan, "deploy");
    assert.equal(plan.verifySha, HEAD);
    assert.match(plan.reason, /apps\/api\/src\/main\.ts/);
  });

  it("calls the tip current when nothing the image is built from changed, and verifies the served commit", () => {
    const plan = planStagingDeploy({
      head: HEAD,
      served: SERVED,
      tip: HEAD,
      isAncestor: linearHistory(SERVED, HEAD),
      changedPaths: () => ["docs/a.md", "apps/web/app/page.tsx", "packages/ui/package.json"],
    });
    assert.equal(plan.plan, "current");
    assert.equal(plan.deploy, false);
    assert.equal(plan.verifySha, SERVED);
  });

  it("deploys the tip when git can't relate the two commits", () => {
    const plan = planStagingDeploy({
      head: HEAD,
      served: SERVED,
      tip: HEAD,
      isAncestor: () => { throw Object.assign(new Error("bad object"), { status: 128 }); },
      changedPaths: never(),
    });
    assert.equal(plan.plan, "deploy");
  });

  it("deploys, without diffing, when staging serves a commit off this history", () => {
    const changedPaths = never();
    const plan = planStagingDeploy({ head: HEAD, served: SERVED, tip: HEAD, isAncestor: () => false, changedPaths });
    assert.equal(plan.plan, "deploy");
    assert.match(plan.reason, /not on this commit's history/);
    assert.equal(changedPaths.calls.length, 0, "an off-history served commit is never diffed");
  });

  it("deploys when the diff can't be read", () => {
    const plan = planStagingDeploy({
      head: HEAD,
      served: SERVED,
      tip: HEAD,
      isAncestor: linearHistory(SERVED, HEAD),
      changedPaths: () => { throw new Error("fatal: bad revision"); },
    });
    assert.equal(plan.plan, "deploy");
  });
});

/**
 * The build-context sources of every `COPY` in apps/api/Dockerfile (not
 * `COPY --from=<stage>`, which copies between stages).
 */
function dockerfileCopySources() {
  const dockerfile = readFileSync(join(REPO_ROOT, "apps", "api", "Dockerfile"), "utf8");
  const sources = new Set();
  for (const line of dockerfile.split("\n")) {
    const match = line.match(/^\s*COPY\s+(?!--from=)(.+)$/);
    if (!match) continue;
    const args = match[1].split(/\s+/).filter((arg) => !arg.startsWith("--"));
    for (const source of args.slice(0, -1)) sources.add(source.replace(/^\.\//, ""));
  }
  return [...sources];
}

describe("API_IMAGE_PATHS", () => {
  // The filter this replaced listed three of the seven packages the image
  // builds, so a change to `packages/color` reached staging only with the next
  // unrelated API commit (#2505). The list is read from the Dockerfile, so a
  // package added there and not here fails.
  it("matches every path the API Dockerfile copies", () => {
    const sources = dockerfileCopySources();
    assert.ok(sources.length >= 10, `expected the Dockerfile's COPY sources, found ${sources.length}`);
    for (const source of [...sources, ".dockerignore"]) {
      const path = source.endsWith("/") ? `${source}src/index.ts` : source;
      assert.match(path, API_IMAGE_PATHS, `${path} (COPY ${source}) must count as an API change`);
    }
  });

  it("does not treat a sibling workspace's manifest as the root manifest", () => {
    for (const path of ["packages/ui/package.json", "apps/web/package.json", "docs/api/x.md"]) {
      assert.doesNotMatch(path, API_IMAGE_PATHS, path);
    }
  });
});

describe("git helpers", () => {
  it("gitIsAncestor reads merge-base's exit codes: 0 yes, 1 no, anything else throws", () => {
    const exitWith = (status) => () => {
      if (status === 0) return "";
      throw Object.assign(new Error(`exit ${status}`), { status });
    };
    assert.equal(gitIsAncestor("a", "b", { exec: exitWith(0) }), true);
    assert.equal(gitIsAncestor("a", "b", { exec: exitWith(1) }), false);
    assert.throws(() => gitIsAncestor("a", "b", { exec: exitWith(128) }));
  });

  // Renames off so a file moved out of apps/api is listed under its old path;
  // NUL-separated and unquoted so a non-ASCII path still matches.
  it("gitChangedPaths lists both sides of a rename and unquoted paths", () => {
    const calls = [];
    const exec = (cmd, args) => {
      calls.push([cmd, ...args]);
      return "apps/api/\u00e9.ts\0docs/b.md\0";
    };
    assert.deepEqual(gitChangedPaths("base", "head", { exec }), ["apps/api/\u00e9.ts", "docs/b.md"]);
    assert.deepEqual(calls, [
      ["git", "-c", "core.quotePath=false", "diff", "--no-renames", "--name-only", "-z", "base", "head"],
    ]);
  });

  it("gitChangedPaths sees the old side of a real rename out of apps/api", () => {
    const root = mkdtempSync(join(tmpdir(), "plan-rename-"));
    const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
    try {
      git("init", "-q");
      git("config", "user.email", "t@example.com");
      git("config", "user.name", "t");
      mkdirSync(join(root, "apps", "api"), { recursive: true });
      writeFileSync(join(root, "apps", "api", "moved.ts"), "export const x = 1;\n".repeat(20));
      git("add", "-A");
      git("commit", "-qm", "base");
      const base = git("rev-parse", "HEAD").trim();
      mkdirSync(join(root, "tools"), { recursive: true });
      git("mv", "apps/api/moved.ts", "tools/moved.ts");
      git("commit", "-qm", "move");
      const head = git("rev-parse", "HEAD").trim();
      const paths = gitChangedPaths(base, head, { exec: (cmd, args, opts) => execFileSync(cmd, ["-C", root, ...args], opts) });
      assert.ok(paths.includes("apps/api/moved.ts"), JSON.stringify(paths));
      assert.ok(paths.some((path) => API_IMAGE_PATHS.test(path)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("readServedCommit", () => {
  const response = (status, body) => ({ ok: status < 300, status, json: async () => body });

  it("reads /health's commit", async () => {
    assert.equal(await readServedCommit("u", { fetchImpl: async () => response(200, { commit: SERVED }) }), SERVED);
  });

  it("is null, never a throw, for a failed, empty or thrown read", async () => {
    assert.equal(await readServedCommit("u", { fetchImpl: async () => response(503, {}) }), null);
    assert.equal(await readServedCommit("u", { fetchImpl: async () => response(200, { status: "ok" }) }), null);
    assert.equal(await readServedCommit("u", { fetchImpl: async () => { throw new Error("ECONNRESET"); } }), null);
  });
});

describe("gitResolve", () => {
  it("resolves a ref to its commit, and is null for one that doesn't exist", () => {
    const head = execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const exec = (cmd, args, opts) => execFileSync(cmd, ["-C", REPO_ROOT, ...args], opts);
    assert.equal(gitResolve("HEAD", { exec }), head);
    assert.equal(gitResolve("refs/heads/no-such-branch-for-this-test", { exec }), null);
  });
});

describe("formatPlanOutputs", () => {
  // The keys deploy-api.yml reads (`steps.plan.outputs.plan|deploy|verify_sha`,
  // pinned from that side by deploy-api-workflow.test.mjs).
  it("writes the keys the workflow reads", () => {
    const out = formatPlanOutputs({ plan: "deploy", deploy: true, verifySha: HEAD, reason: "r" });
    assert.match(out, /^plan=deploy$/m);
    assert.match(out, /^deploy=true$/m);
    assert.match(out, new RegExp(`^verify_sha=${HEAD}$`, "m"));
  });

  // With `-z` a changed path comes back verbatim, newline and all; written raw
  // into `reason`, it would start a new output line.
  it("can't be made to write a second output line through the reason", () => {
    const out = formatPlanOutputs({ plan: "deploy", deploy: true, verifySha: HEAD, reason: "first: apps/api/a\nplan=stale\r" });
    assert.equal(out.split("\n").filter((line) => line.startsWith("plan=")).length, 1, out);
    assert.match(out, /^reason=first: apps\/api\/a plan=stale $/m);
  });
});

// The "a missing API_HEALTHCHECK_URL fails" criterion lives in main(), so the
// CLI itself is run: a revert to warn-and-exit-0 must go red here.
describe("CLI", () => {
  it("exits 1 when API_HEALTHCHECK_URL is missing", () => {
    const env = { ...process.env, DEPLOY_SHA: HEAD };
    delete env.API_HEALTHCHECK_URL;
    delete env.GITHUB_OUTPUT;
    const run = spawnSync(process.execPath, [join(REPO_ROOT, "scripts", "ci", "plan-staging-deploy.mjs")], { env, encoding: "utf8" });
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stderr + run.stdout, /API_HEALTHCHECK_URL/);
  });

  // End to end through main(): read /health, resolve the tip, write GITHUB_OUTPUT.
  async function runCli({ served, tipRef }) {
    const server = createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: "ok", commit: served }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const dir = mkdtempSync(join(tmpdir(), "plan-cli-"));
    const output = join(dir, "output");
    writeFileSync(output, "");
    try {
      const head = execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      const env = {
        ...process.env,
        DEPLOY_SHA: head,
        API_HEALTHCHECK_URL: `http://127.0.0.1:${server.address().port}/health`,
        GITHUB_OUTPUT: output,
        TIP_REF: tipRef,
      };
      delete env.GITHUB_STEP_SUMMARY;
      const run = await new Promise((resolve) => {
        const child = spawn(process.execPath, [join(REPO_ROOT, "scripts", "ci", "plan-staging-deploy.mjs")], { env, cwd: REPO_ROOT });
        let log = "";
        child.stdout.on("data", (d) => { log += d; });
        child.stderr.on("data", (d) => { log += d; });
        child.on("close", (status) => resolve({ status, log }));
      });
      return { ...run, written: readFileSync(output, "utf8") };
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // The tip comes from TIP_REF (default origin/main). A tip lookup that broke
  // would make every run "the tip" and silently disable the stale verdict.
  it("calls the run stale when TIP_REF resolves to another commit", async () => {
    const head = execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const parent = execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD~1"], { encoding: "utf8" }).trim();
    const { status, log, written } = await runCli({ served: head, tipRef: parent });
    assert.equal(status, 0, log);
    assert.match(written, /^plan=stale$/m, written);
    assert.match(written, /^verify_sha=$/m, written);
  });

  it("writes plan, deploy and verify_sha to GITHUB_OUTPUT", async () => {
    const head = execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const server = createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: "ok", commit: head }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const dir = mkdtempSync(join(tmpdir(), "plan-cli-"));
    const output = join(dir, "output");
    writeFileSync(output, "");
    try {
      const env = {
        ...process.env,
        DEPLOY_SHA: head,
        API_HEALTHCHECK_URL: `http://127.0.0.1:${server.address().port}/health`,
        GITHUB_OUTPUT: output,
        TIP_REF: "HEAD",
      };
      delete env.GITHUB_STEP_SUMMARY;
      const run = await new Promise((resolve) => {
        const child = spawn(process.execPath, [join(REPO_ROOT, "scripts", "ci", "plan-staging-deploy.mjs")], { env, cwd: REPO_ROOT });
        let log = "";
        child.stdout.on("data", (d) => { log += d; });
        child.stderr.on("data", (d) => { log += d; });
        child.on("close", (status) => resolve({ status, log }));
      });
      assert.equal(run.status, 0, run.log);
      const written = readFileSync(output, "utf8");
      assert.match(written, /^plan=current$/m, written);
      assert.match(written, /^deploy=false$/m, written);
      assert.match(written, new RegExp(`^verify_sha=${head}$`, "m"), written);
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
