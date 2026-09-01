import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ensureVercelStagingAlias } from "../ensure-vercel-staging-alias.mjs";

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
