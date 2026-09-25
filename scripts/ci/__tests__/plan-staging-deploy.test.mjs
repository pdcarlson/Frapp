import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  API_IMAGE_PATHS,
  gitChangedPaths,
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

describe("planStagingDeploy", () => {
  it("deploys when staging's served commit can't be read", () => {
    for (const served of [null, undefined, "", "not-a-sha"]) {
      const plan = planStagingDeploy({ head: HEAD, served, isAncestor: () => assert.fail(), changedPaths: () => assert.fail() });
      assert.equal(plan.deploy, true, `served=${served}`);
      assert.equal(plan.verifySha, HEAD);
    }
  });

  it("does not redeploy the commit staging already serves, and verifies it", () => {
    const plan = planStagingDeploy({ head: HEAD, served: HEAD.toUpperCase(), isAncestor: () => assert.fail(), changedPaths: () => assert.fail() });
    assert.equal(plan.deploy, false);
    assert.match(plan.reason, /already serves/);
  });

  // A re-run of an old run keeps its original head_sha. Deploying it would roll
  // staging back past commits it already serves.
  it("never deploys a commit staging has already moved past", () => {
    const plan = planStagingDeploy({
      head: HEAD,
      served: SERVED,
      isAncestor: linearHistory(HEAD, SERVED),
      changedPaths: () => assert.fail("no diff needed"),
    });
    assert.equal(plan.deploy, false);
    assert.equal(plan.verifySha, SERVED, "verifies what staging serves, not the older commit");
    assert.match(plan.reason, /roll staging back/);
  });

  // The per-push filter this replaces diffed HEAD~1, so an API commit whose own
  // run never deployed (CI failed or replaced) was skipped by the next docs-only
  // push. Diffing from the served commit carries it forward.
  it("deploys a docs-only push when an earlier API change never reached staging", () => {
    const seen = [];
    const plan = planStagingDeploy({
      head: HEAD,
      served: SERVED,
      isAncestor: linearHistory(SERVED, HEAD),
      changedPaths: (base, head) => {
        seen.push([base, head]);
        return ["apps/api/src/main.ts", "docs/a.md"];
      },
    });
    assert.deepEqual(seen, [[SERVED, HEAD]], "diffs from the served commit, not HEAD~1");
    assert.equal(plan.deploy, true);
    assert.equal(plan.verifySha, HEAD);
    assert.match(plan.reason, /apps\/api\/src\/main\.ts/);
  });

  it("doesn't deploy when nothing the image is built from changed, and verifies the served commit", () => {
    const plan = planStagingDeploy({
      head: HEAD,
      served: SERVED,
      isAncestor: linearHistory(SERVED, HEAD),
      changedPaths: () => ["docs/a.md", "apps/web/app/page.tsx", "packages/ui/package.json"],
    });
    assert.equal(plan.deploy, false);
    assert.equal(plan.verifySha, SERVED);
  });

  it("deploys when git can't relate the two commits", () => {
    const plan = planStagingDeploy({
      head: HEAD,
      served: SERVED,
      isAncestor: () => { throw Object.assign(new Error("bad object"), { status: 128 }); },
      changedPaths: () => assert.fail(),
    });
    assert.equal(plan.deploy, true);
  });

  it("deploys when staging serves a commit off this history", () => {
    const plan = planStagingDeploy({ head: HEAD, served: SERVED, isAncestor: () => false, changedPaths: () => assert.fail() });
    assert.equal(plan.deploy, true);
  });

  it("deploys when the diff can't be read", () => {
    const plan = planStagingDeploy({
      head: HEAD,
      served: SERVED,
      isAncestor: linearHistory(SERVED, HEAD),
      changedPaths: () => { throw new Error("fatal: bad revision"); },
    });
    assert.equal(plan.deploy, true);
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

  it("gitChangedPaths splits git diff --name-only output", () => {
    const calls = [];
    const exec = (cmd, args) => {
      calls.push([cmd, ...args]);
      return "apps/api/a.ts\ndocs/b.md\n";
    };
    assert.deepEqual(gitChangedPaths("base", "head", { exec }), ["apps/api/a.ts", "docs/b.md"]);
    assert.deepEqual(calls, [["git", "diff", "--name-only", "base", "head"]]);
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
});
