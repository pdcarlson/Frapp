import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { assignStagingAlias, ensureVercelStagingAlias } from "../ensure-vercel-staging-alias.mjs";

const API_KEY = "key";
const PROJECT_ID = "prj_x";
const SHA = "deadbeef";
const STAGING = "app.staging.frapp.live";

function okJson(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

describe("ensureVercelStagingAlias", () => {
  it("skips when no deployment matches the SHA", async () => {
    const fetchImpl = async (url) => {
      assert.match(url, /\/v6\/deployments/);
      return okJson({
        deployments: [
          {
            uid: "dpl_other",
            state: "READY",
            createdAt: "2026-04-16T00:00:00Z",
            meta: { githubCommitSha: "other" },
          },
        ],
      });
    };

    const result = await ensureVercelStagingAlias({
      apiKey: API_KEY,
      projectId: PROJECT_ID,
      sha: SHA,
      stagingAlias: STAGING,
      fetchImpl,
    });

    assert.equal(result.status, "skipped");
  });

  it("returns success when staging alias already exists", async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, method: options?.method ?? "GET" });
      if (url.includes("/v6/deployments")) {
        return okJson({
          deployments: [
            {
              uid: "dpl_1",
              state: "READY",
              createdAt: "2026-04-16T01:00:00Z",
              meta: { githubCommitSha: SHA },
            },
          ],
        });
      }
      if (url.endsWith("/aliases") && (options?.method ?? "GET") === "GET") {
        return okJson({
          aliases: [{ alias: STAGING, uid: "a1" }],
        });
      }
      assert.fail("unexpected fetch");
    };

    const result = await ensureVercelStagingAlias({
      apiKey: API_KEY,
      projectId: PROJECT_ID,
      sha: SHA,
      stagingAlias: STAGING,
      fetchImpl,
    });

    assert.equal(result.status, "success");
    assert.equal(calls.filter((c) => c.method === "POST").length, 0);
  });

  it("POSTs alias when READY deployment lacks staging hostname", async () => {
    const fetchImpl = async (url, options) => {
      if (url.includes("/v6/deployments")) {
        return okJson({
          deployments: [
            {
              uid: "dpl_fix",
              state: "READY",
              createdAt: "2026-04-16T01:00:00Z",
              meta: { githubCommitSha: SHA },
            },
          ],
        });
      }
      if (url.includes("/v2/deployments/dpl_fix/aliases") && options?.method !== "POST") {
        return okJson({ aliases: [{ alias: "frapp-web-git-main-foo.vercel.app" }] });
      }
      if (url.includes("/v2/deployments/dpl_fix/aliases") && options?.method === "POST") {
        assert.deepEqual(JSON.parse(options.body), { alias: STAGING });
        return okJson({ alias: STAGING, uid: "new", created: "2026-04-16T02:00:00Z" });
      }
      assert.fail(`unexpected url ${url}`);
    };

    const result = await ensureVercelStagingAlias({
      apiKey: API_KEY,
      projectId: PROJECT_ID,
      sha: SHA,
      stagingAlias: STAGING,
      fetchImpl,
    });

    assert.equal(result.status, "success");
    assert.match(result.message, /Assigned/);
  });

  it("fails when deployment is not READY", async () => {
    const fetchImpl = async (url) => {
      if (url.includes("/v6/deployments")) {
        return okJson({
          deployments: [
            {
              uid: "dpl_build",
              state: "BUILDING",
              createdAt: "2026-04-16T01:00:00Z",
              meta: { githubCommitSha: SHA },
            },
          ],
        });
      }
      assert.fail("should not list aliases");
    };

    const result = await ensureVercelStagingAlias({
      apiKey: API_KEY,
      projectId: PROJECT_ID,
      sha: SHA,
      stagingAlias: STAGING,
      fetchImpl,
    });

    assert.equal(result.status, "failure");
    assert.match(result.message, /BUILDING/);
  });

  // #1377: a deployment that has fallen off the first page must still be
  // found, not read as "no deployment exists".
  it("finds a deployment on a later page via the cursor", async () => {
    let deploymentsCallCount = 0;
    const fetchImpl = async (url, options) => {
      if (url.includes("/v6/deployments")) {
        deploymentsCallCount += 1;
        if (!url.includes("until=")) {
          return okJson({
            deployments: [
              { uid: "dpl_other", state: "READY", created: 200, meta: { githubCommitSha: "other" } },
            ],
            pagination: { next: 100 },
          });
        }
        assert.match(url, /until=100/);
        return okJson({
          deployments: [
            { uid: "dpl_target", state: "READY", created: 50, meta: { githubCommitSha: SHA } },
          ],
        });
      }
      if (url.includes("/v2/deployments/dpl_target/aliases") && options?.method !== "POST") {
        return okJson({ aliases: [{ alias: STAGING }] });
      }
      assert.fail(`unexpected url ${url}`);
    };

    const result = await ensureVercelStagingAlias({
      apiKey: API_KEY,
      projectId: PROJECT_ID,
      sha: SHA,
      stagingAlias: STAGING,
      fetchImpl,
    });

    assert.equal(result.status, "success");
    assert.equal(deploymentsCallCount, 2);
  });

  it("names how many pages it searched when nothing matches", async () => {
    const fetchImpl = async (url) => {
      assert.match(url, /\/v6\/deployments/);
      return okJson({
        deployments: [
          { uid: "dpl_other", state: "READY", createdAt: "2026-04-16T00:00:00Z", meta: { githubCommitSha: "other" } },
        ],
      });
    };

    const result = await ensureVercelStagingAlias({
      apiKey: API_KEY,
      projectId: PROJECT_ID,
      sha: SHA,
      stagingAlias: STAGING,
      fetchImpl,
    });

    assert.equal(result.status, "skipped");
    assert.match(result.message, /searched all 1 page/);
  });

  it("skips when latest deployment for SHA is CANCELED", async () => {
    const fetchImpl = async (url) => {
      if (url.includes("/v6/deployments")) {
        return okJson({
          deployments: [
            {
              uid: "dpl_canceled",
              state: "CANCELED",
              createdAt: "2026-04-16T01:00:00Z",
              meta: { githubCommitSha: SHA },
            },
          ],
        });
      }
      assert.fail("should not list aliases");
    };

    const result = await ensureVercelStagingAlias({
      apiKey: API_KEY,
      projectId: PROJECT_ID,
      sha: SHA,
      stagingAlias: STAGING,
      fetchImpl,
    });

    assert.equal(result.status, "skipped");
    assert.match(result.message, /CANCELED/);
  });
});

// ── The id path (#1578) ────────────────────────────────────────────────────
//
// The search path above answers "no deployment for this SHA" by exiting 0. That
// was safe only while `verify-vercel-deploy.mjs` ran first in
// `verify-deployments.yml` and failed that case — those jobs were removed in
// #1579. A caller that CREATED the deployment passes its id instead, and none
// of the search runs.
describe("ensureVercelStagingAlias with a known deployment id", () => {
  it("assigns the alias without ever listing deployments", async () => {
    const seen = [];
    const fetchImpl = async (url, options) => {
      seen.push(url);
      if (url.includes("/v6/deployments") || url.includes("projectId=")) {
        assert.fail(`must not search by SHA when an id is known: ${url}`);
      }
      if (!options?.method) return okJson({ aliases: [] });
      return okJson({});
    };

    const result = await ensureVercelStagingAlias({
      apiKey: API_KEY,
      stagingAlias: STAGING,
      deploymentId: "dpl_known",
      fetchImpl,
    });

    assert.equal(result.status, "success");
    assert.match(result.message, /dpl_known/);
    assert.ok(seen.every((url) => url.includes("dpl_known")));
  });

  it("is a no-op when the alias already points at that deployment", async () => {
    const fetchImpl = async () => okJson({ aliases: [{ alias: STAGING }] });
    const result = await ensureVercelStagingAlias({
      apiKey: API_KEY,
      stagingAlias: STAGING,
      deploymentId: "dpl_known",
      fetchImpl,
    });
    assert.equal(result.status, "success");
    assert.match(result.message, /already points/);
  });

  // The whole point of the id path: there is no "nothing to alias, skipping"
  // outcome, because the caller knows the deployment exists.
  it("reports a failed assignment as a failure, never a skip", async () => {
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      if (call === 1) return okJson({ aliases: [] });
      return { ok: false, status: 500, json: async () => ({}), text: async () => "" };
    };
    const result = await ensureVercelStagingAlias({
      apiKey: API_KEY,
      stagingAlias: STAGING,
      deploymentId: "dpl_known",
      fetchImpl,
    });
    assert.equal(result.status, "failure");
  });
});

describe("assignStagingAlias", () => {
  it("treats a 409 as success — the alias is already where we want it", async () => {
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      if (call === 1) return okJson({ aliases: [] });
      return { ok: false, status: 409, json: async () => ({}), text: async () => "" };
    };
    const result = await assignStagingAlias({
      apiKey: API_KEY,
      deploymentId: "dpl_known",
      stagingAlias: STAGING,
      fetchImpl,
    });
    assert.equal(result.status, "success");
  });
});
