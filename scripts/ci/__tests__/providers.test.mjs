import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  assignVercelDeploymentAlias,
  resolveVercelTeamId,
} from "../lib/providers.mjs";

describe("resolveVercelTeamId", () => {
  it("returns VERCEL_TEAM_ID when set", async () => {
    const previous = process.env.VERCEL_TEAM_ID;
    process.env.VERCEL_TEAM_ID = "team_from_env";
    try {
      const teamId = await resolveVercelTeamId({
        apiKey: "k",
        projectId: "prj_x",
        fetchImpl: async () => {
          throw new Error("fetch should not run when env is set");
        },
      });
      assert.equal(teamId, "team_from_env");
    } finally {
      if (previous === undefined) {
        delete process.env.VERCEL_TEAM_ID;
      } else {
        process.env.VERCEL_TEAM_ID = previous;
      }
    }
  });

  it("fetches accountId from the project when VERCEL_TEAM_ID is unset", async () => {
    delete process.env.VERCEL_TEAM_ID;
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ accountId: "team_api" }),
    });
    const teamId = await resolveVercelTeamId({ apiKey: "k", projectId: "prj_x", fetchImpl });
    assert.equal(teamId, "team_api");
  });

  it("throws when project response has no accountId", async () => {
    delete process.env.VERCEL_TEAM_ID;
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    await assert.rejects(
      () => resolveVercelTeamId({ apiKey: "k", projectId: "prj_x", fetchImpl }),
      /missing accountId/,
    );
  });
});

describe("assignVercelDeploymentAlias", () => {
  it("returns ok on HTTP 200", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ uid: "alias_1" }),
    });
    const out = await assignVercelDeploymentAlias({
      apiKey: "k",
      teamId: "team_t",
      deploymentUid: "dpl_1",
      alias: "app.example.com",
      fetchImpl,
    });
    assert.equal(out.ok, true);
  });

  it("treats not_modified (409) as success", async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 409,
      json: async () => ({
        error: { code: "not_modified", message: "already associated" },
      }),
    });
    const out = await assignVercelDeploymentAlias({
      apiKey: "k",
      teamId: "team_t",
      deploymentUid: "dpl_1",
      alias: "app.example.com",
      fetchImpl,
    });
    assert.equal(out.ok, true);
  });

  it("returns ok false on other errors", async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: { code: "deployment_not_ready", message: "not ready" },
      }),
    });
    const out = await assignVercelDeploymentAlias({
      apiKey: "k",
      teamId: "team_t",
      deploymentUid: "dpl_1",
      alias: "app.example.com",
      fetchImpl,
    });
    assert.equal(out.ok, false);
    assert.match(out.message, /not ready/);
  });
});
