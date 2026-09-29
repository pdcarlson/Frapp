import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  API_IMAGE_PATHS,
  FRONTEND_BUILD_PATHS,
  formatPlanOutputs,
  gitChangedPaths,
  gitResolve,
  gitIsAncestor,
  planFrontendUpload,
  planStagingDeploy,
  readServedCommit,
  readStagingFrontends,
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

  // `main` usually moves on while a run waits for CI and the run ahead, and
  // the tip's own run may never deploy (its CI can fail). A run that isn't the
  // tip but is newer than what staging serves still ships its change.
  it("moves a non-tip run forward when it is newer than the served commit and the image changed", () => {
    const TIP = "3333333333333333333333333333333333333333";
    const plan = planStagingDeploy({
      head: HEAD,
      served: SERVED,
      tip: TIP,
      isAncestor: linearHistory(SERVED, HEAD, TIP),
      changedPaths: () => ["apps/api/src/main.ts"],
    });
    assert.equal(plan.plan, "forward");
    assert.equal(plan.deploy, true);
    assert.equal(plan.verifySha, HEAD);
    assert.match(plan.reason, /its run decides the alert/);
  });

  // Anything else a non-tip run could do is a rollback, a verdict about an old
  // commit, or a guess: it changes nothing, and the tip's run decides.
  it("calls a non-tip run stale when there is nothing to move forward to, or it can't tell", () => {
    const TIP = "3333333333333333333333333333333333333333";
    const cases = [
      ["served unreadable", { served: null, isAncestor: never(), changedPaths: never() }],
      ["served is newer", { served: SERVED, isAncestor: linearHistory(HEAD, SERVED, TIP), changedPaths: never() }],
      ["nothing changed", { served: SERVED, isAncestor: linearHistory(SERVED, HEAD, TIP), changedPaths: () => ["docs/a.md"] }],
      ["served off history", { served: SERVED, isAncestor: () => false, changedPaths: never() }],
      ["git can't relate", { served: SERVED, isAncestor: () => { throw new Error("bad object"); }, changedPaths: never() }],
      ["diff unreadable", { served: SERVED, isAncestor: linearHistory(SERVED, HEAD, TIP), changedPaths: () => { throw new Error("bad revision"); } }],
    ];
    for (const [label, input] of cases) {
      const plan = planStagingDeploy({ head: HEAD, tip: TIP, ...input });
      assert.equal(plan.plan, "stale", `${label}: ${plan.reason}`);
      assert.equal(plan.deploy, false, label);
      assert.equal(plan.verifySha, "", label);
      // Only "nothing changed" leaves an API that carries this commit's API.
      assert.equal(plan.readyApi, label === "nothing changed" ? SERVED : null, label);
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
    assert.equal(plan.readyApi, null, "an API already past this commit is no API to upload behind");
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
    assert.equal(plan.readyApi, HEAD);
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
    assert.equal(plan.readyApi, SERVED);
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

describe("planFrontendUpload", () => {
  const TIP = "3333333333333333333333333333333333333333";
  const OLD = "4444444444444444444444444444444444444444";
  const WEB = "app.staging.frapp.live";
  const LANDING = "staging.frapp.live";
  const api = (overrides = {}) => ({ plan: "stale", deploy: false, verifySha: "", readyApi: SERVED, reason: "r", ...overrides });
  const hosts = (web, landing = web) => [
    { host: WEB, sha: web },
    { host: LANDING, sha: landing },
  ];

  const webChange = () => ["docs/x.md", "apps/web/app/page.tsx"];
  const docsOnly = () => ["docs/x.md", "apps/api/src/main.ts", "apps/mobile/app/index.tsx"];

  // The tip ships its frontends when something they are built from changed
  // since what the hosts serve, like its API (#2865).
  it("uploads the tip when something web or landing is built from changed since what the hosts serve", () => {
    for (const plan of ["deploy", "current"]) {
      const result = planFrontendUpload({
        head: HEAD,
        tip: HEAD,
        api: api({ plan, verifySha: SERVED, readyApi: SERVED }),
        live: hosts(OLD),
        isAncestor: linearHistory(OLD, HEAD),
        changedPaths: webChange,
      });
      assert.equal(result.upload, true, plan);
      assert.equal(result.verifySha, SERVED, plan);
      assert.match(result.uploadReason, /apps\/web\/app\/page\.tsx/, plan);
    }
  });

  // The waste #2865 is about: a docs, API or mobile merge made two new Vercel
  // deployments of apps it didn't touch.
  it("does not upload the tip when nothing web or landing is built from changed", () => {
    const changedPaths = never();
    const result = planFrontendUpload({
      head: HEAD,
      tip: HEAD,
      api: api({ plan: "deploy", verifySha: HEAD, readyApi: HEAD }),
      live: hosts(OLD, SERVED),
      isAncestor: linearHistory(OLD, SERVED, HEAD),
      changedPaths: (base, head) => { changedPaths(base, head); return docsOnly(); },
    });
    assert.equal(result.upload, false, result.uploadReason);
    assert.equal(result.verifySha, HEAD, "the API plan's own verify still runs");
    assert.match(result.uploadReason, /nothing web and landing are built from changed/);
    assert.doesNotMatch(result.uploadReason, /moved on/);
    assert.deepEqual(changedPaths.calls, [[OLD, HEAD], [SERVED, HEAD]], "one diff per distinct host commit");
  });

  it("diffs once when both hosts serve the same commit, and skips a host that already serves the tip", () => {
    const changedPaths = never();
    const count = (base, head) => { changedPaths(base, head); return docsOnly(); };
    planFrontendUpload({ head: HEAD, tip: HEAD, api: api(), live: hosts(OLD), isAncestor: linearHistory(OLD, HEAD), changedPaths: count });
    assert.equal(changedPaths.calls.length, 1);
    const result = planFrontendUpload({ head: HEAD, tip: HEAD, api: api(), live: hosts(HEAD), isAncestor: linearHistory(HEAD), changedPaths: never() });
    assert.equal(result.upload, false);
    assert.match(result.uploadReason, /already serves/);
  });

  // `_deploy.yml`'s upload step: a re-run of the tip's run is how a rotated
  // build-time value reaches staging, since NEXT_PUBLIC_* are inlined at build.
  it("uploads a re-run of the tip even when nothing changed", () => {
    const result = planFrontendUpload({
      head: HEAD,
      tip: HEAD,
      api: api(),
      live: hosts(HEAD),
      isAncestor: linearHistory(HEAD),
      changedPaths: docsOnly,
      rerun: true,
    });
    assert.equal(result.upload, true);
    assert.match(result.uploadReason, /re-run/);
  });

  it("uploads the tip when it can't tell what changed", () => {
    const cases = [
      ["hosts not read", null, linearHistory(OLD, HEAD), webChange],
      ["no hosts", [], linearHistory(OLD, HEAD), webChange],
      ["web unread", hosts(null, OLD), linearHistory(OLD, HEAD), docsOnly],
      ["not a SHA", hosts("main", OLD), linearHistory(OLD, HEAD), docsOnly],
      ["off history", hosts(OLD), () => false, docsOnly],
      ["git can't relate", hosts(OLD), () => { throw new Error("bad object"); }, docsOnly],
      ["diff fails", hosts(OLD), linearHistory(OLD, HEAD), () => { throw new Error("bad revision"); }],
    ];
    for (const [label, live, isAncestor, changedPaths] of cases) {
      const result = planFrontendUpload({ head: HEAD, tip: HEAD, api: api(), live, isAncestor, changedPaths });
      assert.equal(result.upload, true, `${label}: ${result.uploadReason}`);
    }
  });

  // Nothing checked this before #2865, because the tip always uploaded: a host
  // a later run already moved past would have been rolled back.
  it("never uploads the tip over a host that serves a newer commit, even on a re-run", () => {
    for (const rerun of [false, true]) {
      const result = planFrontendUpload({
        head: HEAD,
        tip: HEAD,
        api: api(),
        live: hosts(OLD, TIP),
        isAncestor: linearHistory(OLD, HEAD, TIP),
        changedPaths: webChange,
        rerun,
      });
      assert.equal(result.upload, false, String(rerun));
      assert.match(result.uploadReason, /already serves 333333333333, which contains/);
    }
  });

  it("treats the run as the tip when main's tip can't be read", () => {
    const result = planFrontendUpload({
      head: HEAD,
      tip: null,
      api: api({ plan: "deploy", verifySha: HEAD, readyApi: HEAD }),
      live: hosts(OLD),
      isAncestor: linearHistory(OLD, HEAD),
      changedPaths: webChange,
    });
    assert.equal(result.upload, true);
    assert.equal(result.verifySha, HEAD);
  });

  // Staging can serve a commit newer than the tip this checkout fetched (Render
  // auto-deploy still on, #2679): the API plan is `stale` with nothing to
  // verify, and uploading anyway would ship frontends behind an API nobody saw
  // ready (#2803 review).
  it("does not upload even the tip behind an API it can't verify", () => {
    const plan = planStagingDeploy({ head: HEAD, served: SERVED, tip: HEAD, isAncestor: linearHistory(HEAD, SERVED), changedPaths: never() });
    assert.equal(plan.plan, "stale");
    const result = planFrontendUpload({ head: HEAD, tip: HEAD, api: plan, live: null, isAncestor: never() });
    assert.equal(result.upload, false);
    assert.equal(result.verifySha, "");
    assert.doesNotMatch(result.uploadReason, /moved on/, "the tip's reason must not claim main moved on");
  });

  // The review finding this rule exists for: a web-only commit that isn't the
  // tip plans `stale` for the API, yet nothing newer is live. If the tip's CI
  // fails, its run never comes, so skipping here would strand a green change.
  it("moves a non-tip commit's frontends forward when both hosts serve older commits", () => {
    const result = planFrontendUpload({
      head: HEAD,
      tip: TIP,
      api: api(),
      live: hosts(OLD, SERVED),
      isAncestor: linearHistory(OLD, SERVED, HEAD, TIP),
      changedPaths: webChange,
    });
    assert.equal(result.upload, true, result.uploadReason);
    assert.equal(result.verifySha, SERVED, "a stale API plan verifies the served commit before anything ships");
    assert.match(result.uploadReason, /moving them forward/);
  });

  it("verifies the forward-deployed commit when the API moves forward too", () => {
    const result = planFrontendUpload({
      head: HEAD,
      tip: TIP,
      api: api({ plan: "forward", deploy: true, verifySha: HEAD, readyApi: HEAD }),
      live: hosts(OLD),
      isAncestor: linearHistory(OLD, HEAD, TIP),
      changedPaths: webChange,
    });
    assert.equal(result.upload, true);
    assert.equal(result.verifySha, HEAD);
  });

  it("does not move a non-tip commit's frontends forward when nothing they are built from changed", () => {
    const result = planFrontendUpload({
      head: HEAD,
      tip: TIP,
      api: api(),
      live: hosts(OLD, SERVED),
      isAncestor: linearHistory(OLD, SERVED, HEAD, TIP),
      changedPaths: docsOnly,
    });
    assert.equal(result.upload, false, result.uploadReason);
    assert.match(result.uploadReason, /nothing web and landing are built from changed/);
  });

  // CI can finish out of order: the tip's run may already have uploaded. An
  // upload of this older commit would roll the hosts back.
  it("never uploads over a host that already serves this commit or a newer one", () => {
    for (const [label, live, isAncestor] of [
      ["web newer", hosts(TIP, OLD), linearHistory(OLD, HEAD, TIP)],
      ["landing newer", hosts(OLD, TIP), linearHistory(OLD, HEAD, TIP)],
      ["already this commit", hosts(HEAD), linearHistory(HEAD, TIP)],
    ]) {
      const result = planFrontendUpload({ head: HEAD, tip: TIP, api: api(), live, isAncestor, changedPaths: webChange });
      assert.equal(result.upload, false, label);
      assert.equal(result.verifySha, "", label);
      assert.match(result.uploadReason, /already serves/, label);
    }
  });

  it("does not upload when a host can't be read or sits on another history", () => {
    const cases = [
      ["not read", null, linearHistory(OLD, HEAD, TIP)],
      ["no hosts", [], linearHistory(OLD, HEAD, TIP)],
      ["web unread", hosts(null, OLD), linearHistory(OLD, HEAD, TIP)],
      ["off history", hosts(OLD), () => false],
      ["git can't relate", hosts(OLD), () => { throw new Error("bad object"); }],
    ];
    for (const [label, live, isAncestor] of cases) {
      const result = planFrontendUpload({ head: HEAD, tip: TIP, api: api(), live, isAncestor, changedPaths: webChange });
      assert.equal(result.upload, false, `${label}: ${result.uploadReason}`);
      assert.match(result.uploadReason, /its run uploads/, label);
    }
  });

  // A `meta.githubCommitSha` that isn't a SHA never reaches git, where a
  // ref-shaped string would resolve to some other commit.
  it("refuses a host commit that isn't a SHA without asking git", () => {
    for (const bogus of ["not-a-sha", "main", "HEAD~1"]) {
      const isAncestor = never();
      const result = planFrontendUpload({ head: HEAD, tip: TIP, api: api(), live: hosts(bogus), isAncestor, changedPaths: webChange });
      assert.equal(result.upload, false, bogus);
      assert.match(result.uploadReason, /could not be read/, bogus);
      assert.equal(isAncestor.calls.length, 0, bogus);
    }
  });

  it("names why a host could not be read", () => {
    const live = [{ host: WEB, sha: null, error: "Vercel could not resolve the deployment (HTTP 403)" }, { host: LANDING, sha: OLD }];
    const result = planFrontendUpload({ head: HEAD, tip: TIP, api: api(), live, isAncestor: linearHistory(OLD, HEAD, TIP), changedPaths: webChange });
    assert.equal(result.upload, false);
    assert.match(result.uploadReason, /HTTP 403/);
  });

  // A stale API plan that isn't "nothing changed" (staging's API is past this
  // commit, or can't be read) leaves no API known to carry this commit's.
  it("does not upload behind an API that doesn't carry this commit's API", () => {
    const isAncestor = never();
    const result = planFrontendUpload({ head: HEAD, tip: TIP, api: api({ readyApi: null }), live: hosts(OLD), isAncestor, changedPaths: never() });
    assert.equal(result.upload, false);
    assert.equal(isAncestor.calls.length, 0);
  });

  // End to end through both functions: the scenario the review traced.
  it("ships a non-tip web-only commit's frontends, which the API plan alone would skip", () => {
    const isAncestor = linearHistory(SERVED, HEAD, TIP);
    const changedPaths = () => ["apps/web/app/page.tsx"];
    const plan = planStagingDeploy({ head: HEAD, served: SERVED, tip: TIP, isAncestor, changedPaths });
    assert.equal(plan.plan, "stale");
    const result = planFrontendUpload({ head: HEAD, tip: TIP, api: plan, live: hosts(SERVED), isAncestor, changedPaths });
    assert.equal(result.upload, true, result.uploadReason);
    assert.equal(result.verifySha, SERVED);
  });
});

describe("readStagingFrontends", () => {
  it("reads each host's commit from its deployment's meta, and never throws", async () => {
    const asked = [];
    const fetchImpl = async (url) => {
      asked.push(url);
      if (url.includes("broken.example")) return new Response("nope", { status: 403 });
      return Response.json({ id: "dpl_1", target: null, url: "x.vercel.app", meta: { githubCommitSha: SERVED } });
    };
    const live = await readStagingFrontends(["app.staging.frapp.live", "broken.example"], { apiKey: "k", teamId: "team_1", fetchImpl });
    assert.deepEqual(live[0], { host: "app.staging.frapp.live", sha: SERVED });
    assert.equal(live[1].host, "broken.example");
    assert.equal(live[1].sha, null);
    // The cause survives into the plan's reason: a revoked key reads differently
    // from an unaliased host.
    assert.match(live[1].error, /HTTP 403/);
    assert.ok(asked[0].startsWith("https://api.vercel.com/v13/deployments/app.staging.frapp.live?teamId=team_1"), asked[0]);
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

/** Repo-relative files reached from `entry` through relative static imports. */
function relativeImportClosure(entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const source = readFileSync(join(REPO_ROOT, entry), "utf8");
  for (const [, spec] of source.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["'](\.{1,2}\/[^"']+)["']/gms)) {
    const target = join(dirname(entry), spec).split("\\").join("/");
    relativeImportClosure(target, seen);
  }
  return seen;
}

describe("FRONTEND_BUILD_PATHS", () => {
  // The apps' `build` and `prebuild` run root scripts (`node ../../scripts/…`);
  // a script they reach that isn't matched would change the bundle without
  // ever uploading it.
  it("matches every root script web and landing build with, and what those import", () => {
    const entries = new Set();
    for (const app of ["web", "landing"]) {
      const { scripts } = JSON.parse(readFileSync(join(REPO_ROOT, "apps", app, "package.json"), "utf8"));
      for (const name of ["prebuild", "build"]) {
        for (const [, rel] of String(scripts?.[name] ?? "").matchAll(/\.\.\/\.\.\/(scripts\/\S+\.mjs)/g)) entries.add(rel);
      }
    }
    assert.ok(entries.size >= 2, `expected the apps' build scripts, found ${[...entries]}`);
    const reached = new Set();
    for (const entry of entries) relativeImportClosure(entry, reached);
    for (const path of reached) assert.match(path, FRONTEND_BUILD_PATHS, `${path} is part of the web/landing build`);
  });

  it("matches the deploy script and the helpers that decide what reaches vercel build", () => {
    for (const path of [
      "apps/web/app/page.tsx",
      "apps/landing/next.config.js",
      "packages/theme/fonts/Figtree-Bold.ttf",
      "package.json",
      "package-lock.json",
      "turbo.json",
      "scripts/ci/deploy-vercel.mjs",
      "scripts/ci/lib/vercel-cli.mjs",
      "scripts/ci/lib/vercel-build-env.mjs",
    ]) {
      assert.match(path, FRONTEND_BUILD_PATHS, path);
    }
  });

  it("does not count what neither app is built from", () => {
    for (const path of [
      "docs/internal/ops/deployment/ci-cd.md",
      "spec/ui/web-greenfield/tokens.md",
      "apps/api/src/main.ts",
      "apps/mobile/app/index.tsx",
      "apps/web-old/x.ts",
      "supabase/migrations/1_x.sql",
      ".github/workflows/_deploy.yml",
      "scripts/ci/plan-staging-deploy.mjs",
      "apps/api/package.json",
    ]) {
      assert.doesNotMatch(path, FRONTEND_BUILD_PATHS, path);
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
  const frontends = { upload: true, uploadReason: "u", verifySha: SERVED };

  // The keys _deploy.yml reads (`steps.plan.outputs.plan|deploy|upload|verify_sha`,
  // pinned from that side by deploy-staging-workflow.test.mjs).
  it("writes the keys the workflow reads", () => {
    const out = formatPlanOutputs({ plan: "stale", deploy: false, verifySha: "", reason: "r" }, frontends);
    assert.match(out, /^plan=stale$/m);
    assert.match(out, /^deploy=false$/m);
    assert.match(out, /^upload=true$/m);
    // The verify step checks what the upload runs behind, not the API plan's own sha.
    assert.match(out, new RegExp(`^verify_sha=${SERVED}$`, "m"));
  });

  // With `-z` a changed path comes back verbatim, newline and all; written raw
  // into `reason`, it would start a new output line.
  it("can't be made to write a second output line through either reason", () => {
    const out = formatPlanOutputs(
      { plan: "deploy", deploy: true, verifySha: HEAD, reason: "first: apps/api/a\nplan=stale\r" },
      { ...frontends, uploadReason: "x\nupload=false" },
    );
    assert.equal(out.split("\n").filter((line) => line.startsWith("plan=")).length, 1, out);
    assert.equal(out.split("\n").filter((line) => line.startsWith("upload=")).length, 1, out);
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

  /**
   * Run the CLI in a throwaway repo whose `origin/main` is one commit ahead of
   * the checked-out commit, with /health serving the checked-out one. A
   * throwaway repo because CI's checkout is shallow: the real repo has no
   * `HEAD~1` there.
   */
  /**
   * `hostsServe` ("base" or "tip") makes the staging hostnames answer with that
   * commit: a preloaded module swaps `fetch` for `api.vercel.com` only, and
   * records each URL asked for, so the CLI's own host read runs for real.
   */
  async function runInTwoCommitRepo(env, { serveTip = false, hostsServe = null, headFile = "apps/web/a.md" } = {}) {
    const root = mkdtempSync(join(tmpdir(), "plan-tip-"));
    const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
    let server;
    try {
      git("init", "-q");
      git("config", "user.email", "t@example.com");
      git("config", "user.name", "t");
      git("config", "commit.gpgsign", "false");
      writeFileSync(join(root, "base.md"), "base\n");
      git("add", "-A");
      git("commit", "-qm", "base");
      const base = git("rev-parse", "HEAD");
      mkdirSync(dirname(join(root, headFile)), { recursive: true });
      writeFileSync(join(root, headFile), "a\n");
      git("add", "-A");
      git("commit", "-qm", "head");
      const head = git("rev-parse", "HEAD");
      writeFileSync(join(root, "b.md"), "b\n");
      git("add", "-A");
      git("commit", "-qm", "tip");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      const tip = git("rev-parse", "HEAD");
      git("checkout", "-q", "--detach", head);
      server = createServer((req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ status: "ok", commit: serveTip ? tip : head }));
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const output = join(root, ".output");
      writeFileSync(output, "");
      const asked = join(root, ".vercel-asked");
      const preload = join(root, "stub-vercel.mjs");
      if (hostsServe) {
        const sha = { tip, head, base }[hostsServe];
        writeFileSync(
          preload,
          [
            'import { appendFileSync } from "node:fs";',
            "const realFetch = globalThis.fetch;",
            "globalThis.fetch = async (url, init) => {",
            '  if (!String(url).startsWith("https://api.vercel.com/")) return realFetch(url, init);',
            `  appendFileSync(${JSON.stringify(asked)}, String(url) + "\\n");`,
            `  return Response.json({ id: "dpl_stub", target: null, url: "stub.vercel.app", meta: { githubCommitSha: ${JSON.stringify(sha)} } });`,
            "};",
          ].join("\n"),
        );
      }
      const childEnv = {
        ...process.env,
        DEPLOY_SHA: head,
        API_HEALTHCHECK_URL: `http://127.0.0.1:${server.address().port}/health`,
        // Required, but unread: a run whose API is ready reads the hosts, and
        // those runs pass `hostsServe`, so nothing leaves the box.
        VERCEL_API_KEY: "unused",
        VERCEL_TEAM_ID: "team_unused",
        VERCEL_STAGING_HOSTS: "app.staging.frapp.live staging.frapp.live",
        GITHUB_OUTPUT: output,
        // CI's own re-run must not read as the deploy's.
        GITHUB_RUN_ATTEMPT: undefined,
        ...(hostsServe ? { NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` } : {}),
        ...env,
      };
      delete childEnv.GITHUB_STEP_SUMMARY;
      for (const [key, value] of Object.entries(childEnv)) if (value === undefined) delete childEnv[key];
      const run = await new Promise((resolve) => {
        const child = spawn(process.execPath, [join(REPO_ROOT, "scripts", "ci", "plan-staging-deploy.mjs")], { env: childEnv, cwd: root });
        let log = "";
        child.stdout.on("data", (d) => { log += d; });
        child.stderr.on("data", (d) => { log += d; });
        child.on("close", (status) => resolve({ status, log }));
      });
      let hostsAsked = [];
      try {
        hostsAsked = readFileSync(asked, "utf8").split("\n").filter(Boolean);
      } catch {
        // Never asked.
      }
      return { ...run, head, written: readFileSync(output, "utf8"), hostsAsked };
    } finally {
      server?.close();
      rmSync(root, { recursive: true, force: true });
    }
  }

  // No TIP_REF, as in the workflow: the tip comes from `origin/main`. A tip
  // lookup that broke would make every run "the tip" and silently disable the
  // stale verdict.
  it("reads the tip from origin/main by default", async () => {
    const { status, log, written } = await runInTwoCommitRepo({ TIP_REF: undefined }, { serveTip: true });
    assert.equal(status, 0, log);
    assert.match(written, /^plan=stale$/m, log);
    assert.match(written, /^upload=false$/m, written);
    assert.match(written, /^verify_sha=$/m, written);
  });

  it("exits 1 when the Vercel inputs the host read needs are missing", () => {
    for (const key of ["VERCEL_API_KEY", "VERCEL_TEAM_ID", "VERCEL_STAGING_HOSTS"]) {
      const env = {
        ...process.env,
        DEPLOY_SHA: HEAD,
        API_HEALTHCHECK_URL: "http://127.0.0.1:9/health",
        VERCEL_API_KEY: "k",
        VERCEL_TEAM_ID: "t",
        VERCEL_STAGING_HOSTS: "h",
      };
      delete env[key];
      delete env.GITHUB_OUTPUT;
      const run = spawnSync(process.execPath, [join(REPO_ROOT, "scripts", "ci", "plan-staging-deploy.mjs")], { env, encoding: "utf8" });
      assert.equal(run.status, 1, `${key}: ${run.stdout}${run.stderr}`);
      assert.match(run.stderr + run.stdout, new RegExp(key), key);
    }
  });

  // The rule #2803's review exists for, through the CLI: a non-tip commit that
  // changed nothing in the API, with both hosts on an older commit, uploads and
  // verifies the served commit. Pins the host read's wiring in main(): the
  // space-separated host list, and the key and team it passes.
  it("uploads a non-tip commit when both staging hosts serve older commits", async () => {
    const { status, log, written, head, hostsAsked } = await runInTwoCommitRepo({ TIP_REF: undefined }, { hostsServe: "base" });
    assert.equal(status, 0, log);
    assert.match(written, /^plan=stale$/m, log);
    assert.match(written, /^upload=true$/m, log);
    assert.match(written, new RegExp(`^verify_sha=${head}$`, "m"), written);
    assert.deepEqual(
      hostsAsked.map((url) => new URL(url).pathname).sort(),
      ["/v13/deployments/app.staging.frapp.live", "/v13/deployments/staging.frapp.live"],
    );
    for (const url of hostsAsked) assert.equal(new URL(url).searchParams.get("teamId"), "team_unused");
  });

  it("does not upload a non-tip commit over hosts that already serve a newer one", async () => {
    const { status, log, written } = await runInTwoCommitRepo({ TIP_REF: undefined }, { hostsServe: "tip" });
    assert.equal(status, 0, log);
    assert.match(written, /^upload=false$/m, log);
    assert.match(written, /^upload_reason=.*already serves/m, written);
    assert.match(written, /^verify_sha=$/m, written);
  });

  it("takes the tip from TIP_REF when it is set", async () => {
    const { status, log, written, head, hostsAsked } = await runInTwoCommitRepo({ TIP_REF: "HEAD" }, { hostsServe: "base" });
    assert.equal(status, 0, log);
    assert.match(written, /^plan=current$/m, log);
    assert.match(written, /^deploy=false$/m, written);
    assert.match(written, /^upload=true$/m, written);
    assert.match(written, /^upload_reason=.*apps\/web\/a\.md/m, written);
    assert.match(written, new RegExp(`^verify_sha=${head}$`, "m"), written);
    assert.equal(hostsAsked.length, 2, "the tip reads the hosts now, to diff against them");
  });

  // #2865 through the CLI: a docs-only tip makes no Vercel deployment.
  it("does not upload the tip when nothing web or landing is built from changed", async () => {
    const { status, log, written } = await runInTwoCommitRepo({ TIP_REF: "HEAD" }, { hostsServe: "base", headFile: "docs/a.md" });
    assert.equal(status, 0, log);
    assert.match(written, /^upload=false$/m, written);
    assert.match(written, /^upload_reason=nothing web and landing are built from changed/m, written);
  });

  it("uploads a re-run of the tip whose hosts already serve it", async () => {
    const once = await runInTwoCommitRepo({ TIP_REF: "HEAD" }, { hostsServe: "head" });
    assert.equal(once.status, 0, once.log);
    assert.match(once.written, /^upload=false$/m, once.written);
    const again = await runInTwoCommitRepo({ TIP_REF: "HEAD", GITHUB_RUN_ATTEMPT: "2" }, { hostsServe: "head" });
    assert.equal(again.status, 0, again.log);
    assert.match(again.written, /^upload=true$/m, again.written);
    assert.match(again.written, /^upload_reason=.*re-run/m, again.written);
  });
});
