import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DeleteRateLimited,
  KEEP_PREVIEWS,
  MAX_DELETIONS_PER_PROJECT,
  deleteDeployment,
  listDeployments,
  pruneStagingDeployments,
  selectPrunable,
} from "../prune-vercel-staging.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** `n` preview deployments, `dpl_0` newest, one minute apart. */
function previews(n, { state = "READY", from = 0 } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    uid: `dpl_${from + i}`,
    created: 1_790_000_000_000 - (from + i) * 60_000,
    state,
    target: null,
  }));
}

const ids = (rows) => rows.map((row) => row.uid);

describe("selectPrunable", () => {
  it("keeps the newest previews and deletes the rest, oldest first", () => {
    const rows = previews(14);
    const { previews: seen, prunable } = selectPrunable([...rows].reverse(), { keep: 10 });
    assert.equal(seen, 14);
    assert.deepEqual(ids(prunable), ["dpl_13", "dpl_12", "dpl_11", "dpl_10"]);
  });

  it("never deletes a production deployment, and doesn't count it toward the kept previews", () => {
    const rows = [
      ...previews(3),
      { uid: "dpl_prod", created: 1, state: "READY", target: "production" },
    ];
    const { previews: seen, prunable } = selectPrunable(rows, { keep: 1 });
    assert.equal(seen, 3);
    assert.deepEqual(ids(prunable), ["dpl_2", "dpl_1"]);
  });

  it("never deletes what a staging hostname serves, however old", () => {
    const { prunable } = selectPrunable(previews(5), { keep: 1, protectedIds: new Set(["dpl_4", "dpl_2"]) });
    assert.deepEqual(ids(prunable), ["dpl_3", "dpl_1"]);
  });

  it("never deletes a deployment that is still building", () => {
    const rows = [...previews(2), ...previews(2, { state: "BUILDING", from: 2 }), ...previews(1, { state: "ERROR", from: 4 })];
    const { prunable } = selectPrunable(rows, { keep: 1 });
    assert.deepEqual(ids(prunable), ["dpl_4", "dpl_1"]);
  });

  it("reads the id and state from either field Vercel uses", () => {
    const rows = [
      { id: "dpl_new", created: 3, readyState: "READY", target: null },
      { id: "dpl_old", created: 1, readyState: "CANCELED", target: null },
    ];
    assert.deepEqual(selectPrunable(rows, { keep: 1 }).prunable.map((row) => row.id), ["dpl_old"]);
  });

  // Vercel allows 200 deletions per ten minutes per team; a backlog drains
  // over several runs instead of failing one on a 429.
  it("deletes at most maxDeletions a run, oldest first", () => {
    const { prunable } = selectPrunable(previews(10 + MAX_DELETIONS_PER_PROJECT + 5));
    assert.equal(prunable.length, MAX_DELETIONS_PER_PROJECT);
    assert.equal(prunable[0].uid, `dpl_${10 + MAX_DELETIONS_PER_PROJECT + 4}`);
    assert.ok(2 * MAX_DELETIONS_PER_PROJECT < 200);
    assert.equal(KEEP_PREVIEWS, 10);
  });
});

/** A fake Vercel API: pages of deployments per project, hostnames, deletes. */
function fakeVercel({ pages = {}, hosts = {}, deleteStatus = () => 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method ?? "GET", path: u.pathname, search: u.searchParams, auth: init.headers?.Authorization });
    if (u.pathname === "/v6/deployments") {
      const projectPages = pages[u.searchParams.get("projectId")] ?? [[]];
      const until = u.searchParams.get("until");
      const index = until ? Number(until) : 0;
      const next = index + 1 < projectPages.length ? String(index + 1) : null;
      return Response.json({ deployments: projectPages[index], pagination: { next } });
    }
    const match = u.pathname.match(/^\/v13\/deployments\/(.+)$/);
    if (match && (init.method ?? "GET") === "GET") {
      const id = hosts[decodeURIComponent(match[1])];
      return id ? Response.json({ id, target: null, meta: {} }) : new Response("not found", { status: 404 });
    }
    if (match && init.method === "DELETE") {
      const status = deleteStatus(decodeURIComponent(match[1]));
      return new Response(status === 200 ? "{}" : "nope", { status });
    }
    return new Response("unexpected", { status: 500 });
  };
  return { fetchImpl, calls };
}

describe("listDeployments", () => {
  it("pages back until Vercel has no next page, scoped to the team", async () => {
    const { fetchImpl, calls } = fakeVercel({ pages: { prj_web: [previews(2), previews(2, { from: 2 })] } });
    const rows = await listDeployments({ apiKey: "k", teamId: "team_1", projectId: "prj_web", fetchImpl });
    assert.deepEqual(ids(rows), ["dpl_0", "dpl_1", "dpl_2", "dpl_3"]);
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.search.get("teamId"), "team_1");
      assert.equal(call.auth, "Bearer k");
    }
  });

  it("throws on a failed or malformed page rather than pruning a partial list", async () => {
    await assert.rejects(
      listDeployments({ apiKey: "k", teamId: "t", projectId: "p", fetchImpl: async () => new Response("", { status: 403 }) }),
      /HTTP 403/,
    );
    await assert.rejects(
      listDeployments({ apiKey: "k", teamId: "t", projectId: "p", fetchImpl: async () => Response.json({ error: {} }) }),
      /unexpected/,
    );
  });
});

describe("deleteDeployment", () => {
  it("treats a deployment that is already gone as deleted", async () => {
    await deleteDeployment({ apiKey: "k", teamId: "t", id: "dpl_1", fetchImpl: async () => new Response("", { status: 404 }) });
  });

  it("reports a rate limit apart from a failure", async () => {
    await assert.rejects(
      deleteDeployment({ apiKey: "k", teamId: "t", id: "dpl_1", fetchImpl: async () => new Response("slow down", { status: 429 }) }),
      (error) => error instanceof DeleteRateLimited,
    );
  });

  it("throws on any other failure", async () => {
    await assert.rejects(
      deleteDeployment({ apiKey: "k", teamId: "t", id: "dpl_1", fetchImpl: async () => new Response("forbidden", { status: 403 }) }),
      /HTTP 403/,
    );
  });
});

describe("pruneStagingDeployments", () => {
  const projects = [
    { label: "frapp-web", projectId: "prj_web" },
    { label: "frapp-landing", projectId: "prj_landing" },
  ];

  it("deletes each project's old previews and spares what the hostnames serve", async () => {
    const { fetchImpl, calls } = fakeVercel({
      pages: { prj_web: [previews(4)], prj_landing: [previews(3, { from: 10 })] },
      hosts: { "app.staging.frapp.live": "dpl_3", "staging.frapp.live": "dpl_10" },
    });
    const results = await pruneStagingDeployments({
      apiKey: "k",
      teamId: "team_1",
      projects,
      hosts: ["app.staging.frapp.live", "staging.frapp.live"],
      keep: 1,
      fetchImpl,
    });
    assert.deepEqual(results, [
      { label: "frapp-web", previews: 4, deleted: ["dpl_2", "dpl_1"], failed: [], deferred: 0 },
      { label: "frapp-landing", previews: 3, deleted: ["dpl_12", "dpl_11"], failed: [], deferred: 0 },
    ]);
    const deletes = calls.filter((call) => call.method === "DELETE");
    assert.equal(deletes.length, 4);
    for (const call of deletes) assert.equal(call.search.get("teamId"), "team_1");
  });

  // Not knowing what staging serves is no reason to guess: nothing is deleted.
  it("deletes nothing when a hostname can't be resolved", async () => {
    const { fetchImpl, calls } = fakeVercel({
      pages: { prj_web: [previews(20)], prj_landing: [previews(20)] },
      hosts: { "app.staging.frapp.live": "dpl_0" },
    });
    await assert.rejects(
      pruneStagingDeployments({ apiKey: "k", teamId: "t", projects, hosts: ["app.staging.frapp.live", "staging.frapp.live"], keep: 1, fetchImpl }),
      /staging\.frapp\.live/,
    );
    assert.equal(calls.filter((call) => call.method === "DELETE").length, 0);
  });

  it("reports a failed delete and carries on with the rest", async () => {
    const { fetchImpl } = fakeVercel({
      pages: { prj_web: [previews(4)], prj_landing: [[]] },
      hosts: { h: "dpl_0" },
      deleteStatus: (id) => (id === "dpl_2" ? 500 : 200),
    });
    const [web] = await pruneStagingDeployments({ apiKey: "k", teamId: "t", projects, hosts: ["h"], keep: 1, fetchImpl });
    assert.deepEqual(web.deleted, ["dpl_3", "dpl_1"]);
    assert.equal(web.failed.length, 1);
    assert.equal(web.failed[0].id, "dpl_2");
    assert.match(web.failed[0].error, /HTTP 500/);
  });
});

describe("pruneStagingDeployments under Vercel's rate limit", () => {
  // Runs close together can pass 200 deletes in ten minutes. Stopping there is
  // the plan, not a failure: the next run carries on.
  it("stops deleting at the first 429, in every project, and leaves the rest for the next run", async () => {
    const asked = [];
    const { fetchImpl } = fakeVercel({
      pages: { prj_web: [previews(5)], prj_landing: [previews(4, { from: 10 })] },
      hosts: { h: "dpl_0" },
      deleteStatus: (id) => {
        asked.push(id);
        return id === "dpl_3" ? 429 : 200;
      },
    });
    const results = await pruneStagingDeployments({
      apiKey: "k",
      teamId: "t",
      projects: [
        { label: "frapp-web", projectId: "prj_web" },
        { label: "frapp-landing", projectId: "prj_landing" },
      ],
      hosts: ["h"],
      keep: 1,
      fetchImpl,
    });
    assert.deepEqual(asked, ["dpl_4", "dpl_3"], "nothing is asked after the 429");
    assert.deepEqual(results[0], { label: "frapp-web", previews: 5, deleted: ["dpl_4"], failed: [], deferred: 3 });
    assert.deepEqual(results[1], { label: "frapp-landing", previews: 4, deleted: [], failed: [], deferred: 3 });
  });
});

describe("CLI", () => {
  /** Run the CLI with `api.vercel.com` answered by a preloaded stub. */
  function runWithStub(deleteStatus) {
    const root = mkdtempSync(join(tmpdir(), "prune-cli-"));
    try {
      const preload = join(root, "stub.mjs");
      writeFileSync(
        preload,
        [
          "globalThis.fetch = async (url, init = {}) => {",
          "  const u = new URL(String(url));",
          '  if (u.pathname === "/v6/deployments") {',
          "    const deployments = Array.from({ length: 12 }, (_, i) => ({ uid: `dpl_${i}`, created: 100 - i, state: \"READY\", target: null }));",
          "    return Response.json({ deployments, pagination: { next: null } });",
          "  }",
          `  if (init.method === "DELETE") return new Response("x", { status: ${deleteStatus} });`,
          '  return Response.json({ id: "dpl_0", target: null, meta: {} });',
          "};",
        ].join("\n"),
      );
      const env = {
        ...process.env,
        VERCEL_API_KEY: "k",
        VERCEL_TEAM_ID: "t",
        VERCEL_WEB_PROJECT_ID: "w",
        VERCEL_LANDING_PROJECT_ID: "l",
        VERCEL_STAGING_HOSTS: "h",
        NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
      };
      delete env.GITHUB_STEP_SUMMARY;
      return spawnSync(process.execPath, [join(REPO_ROOT, "scripts", "ci", "prune-vercel-staging.mjs")], { env, encoding: "utf8" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // Its job in deploy-staging.yml is apart from the deploy job: this exit code
  // is what turns a ceiling that stopped working into a red job on the run.
  it("exits 1 when a delete fails, and 0 when it deletes or is rate-limited", () => {
    const failed = runWithStub(500);
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    assert.match(failed.stderr, /could not delete dpl_/);
    const ok = runWithStub(200);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /\[frapp-web\] 12 preview deployment\(s\).*deleted 2\./);
    const limited = runWithStub(429);
    assert.equal(limited.status, 0, limited.stdout + limited.stderr);
    assert.match(limited.stdout, /left for the next run/);
  });

  it("exits 1 naming each missing input", () => {
    for (const key of ["VERCEL_API_KEY", "VERCEL_TEAM_ID", "VERCEL_WEB_PROJECT_ID", "VERCEL_LANDING_PROJECT_ID", "VERCEL_STAGING_HOSTS"]) {
      const env = {
        ...process.env,
        VERCEL_API_KEY: "k",
        VERCEL_TEAM_ID: "t",
        VERCEL_WEB_PROJECT_ID: "w",
        VERCEL_LANDING_PROJECT_ID: "l",
        VERCEL_STAGING_HOSTS: "h",
      };
      delete env[key];
      const run = spawnSync(process.execPath, [join(REPO_ROOT, "scripts", "ci", "prune-vercel-staging.mjs")], { env, encoding: "utf8" });
      assert.equal(run.status, 1, `${key}: ${run.stdout}${run.stderr}`);
      assert.match(run.stderr + run.stdout, new RegExp(key), key);
    }
  });
});
