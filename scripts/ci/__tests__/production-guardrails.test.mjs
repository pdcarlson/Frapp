import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  assertRenderService,
  assertVercelProductionBranch,
  buildSummary,
  collectFindings,
} from "../production-guardrails.mjs";

function okJson(body) {
  return { ok: true, status: 200, json: async () => body };
}

describe("assertRenderService", () => {
  it("passes the intended configuration", () =>
    assert.deepEqual(assertRenderService({ autoDeploy: "no", branch: "main" }), []));

  // The live configuration before the cutover, and the reason this file exists:
  // autoDeploy "yes" + branch "main" means every merge deploys production with
  // no CI gate, no migration gate, and no approval.
  it("flags autoDeploy left on", () => {
    const findings = assertRenderService({ autoDeploy: "yes", branch: "main" });
    assert.equal(findings.length, 1);
    assert.match(findings[0], /without CI/);
  });

  it("flags a service still tracking the deleted production branch", () => {
    const findings = assertRenderService({ autoDeploy: "no", branch: "production" });
    assert.equal(findings.length, 1);
    assert.match(findings[0], /expected 'main'/);
  });

  it("flags both at once", () =>
    assert.equal(assertRenderService({ autoDeploy: "yes", branch: "production" }).length, 2));

  it("treats an unreadable service as two violations, not a pass", () =>
    assert.equal(assertRenderService({}).length, 2));
});

describe("assertVercelProductionBranch", () => {
  // Not-main rather than equals-X, deliberately: after the branch is deleted,
  // `production` points at nothing, so no push can match it and nothing
  // auto-promotes. That is the SAFE state.
  it("passes when Production Branch is the now-deleted production branch", () =>
    assert.deepEqual(assertVercelProductionBranch({ link: { productionBranch: "production" } }, "frapp-web"), []));

  it("fails when Production Branch is main", () => {
    const findings = assertVercelProductionBranch({ link: { productionBranch: "main" } }, "frapp-web");
    assert.equal(findings.length, 1);
    assert.match(findings[0], /bypassing deploy-production\.yml/);
  });

  // Vercel falls back to the repository default branch when the field is unset,
  // and the default branch is main. Absent is therefore the dangerous case, not
  // a neutral one.
  it("fails when Production Branch is absent", () => {
    const findings = assertVercelProductionBranch({ link: {} }, "frapp-web");
    assert.equal(findings.length, 1);
    assert.match(findings[0], /falls back to the repository/);
  });

  it("fails when there is no link object at all", () =>
    assert.equal(assertVercelProductionBranch({}, "frapp-landing").length, 1));

  it("fails on an empty string", () =>
    assert.equal(assertVercelProductionBranch({ link: { productionBranch: "" } }, "frapp-web").length, 1));
});

describe("collectFindings", () => {
  const goodRender = { autoDeploy: "no", branch: "main" };
  const goodVercel = { link: { productionBranch: "production" } };

  it("is clean when every provider is configured correctly", async () => {
    const findings = await collectFindings({
      renderApiKey: "r",
      vercelApiKey: "v",
      fetchImpl: async (url) => okJson(url.includes("render.com") ? goodRender : goodVercel),
    });
    assert.deepEqual(findings, []);
  });

  // staging-conformance.mjs has a `skipped` outcome. This one deliberately does
  // not: "I could not check whether production auto-deploys" is not a state in
  // which to deploy to production.
  it("treats an unreadable Render API as a violation, never a skip", async () => {
    const findings = await collectFindings({
      renderApiKey: "r",
      vercelApiKey: "v",
      fetchImpl: async (url) =>
        url.includes("render.com") ? { ok: false, status: 401 } : okJson(goodVercel),
    });
    assert.equal(findings.length, 1);
    assert.match(findings[0], /Unreadable is not a pass/);
  });

  it("treats an unreadable Vercel project as a violation", async () => {
    const findings = await collectFindings({
      renderApiKey: "r",
      vercelApiKey: "v",
      fetchImpl: async (url) =>
        url.includes("render.com") ? okJson(goodRender) : { ok: false, status: 403 },
    });
    // Both projects fail to read.
    assert.equal(findings.length, 2);
  });

  it("reports each Vercel project independently", async () => {
    const findings = await collectFindings({
      renderApiKey: "r",
      vercelApiKey: "v",
      fetchImpl: async (url) => {
        if (url.includes("render.com")) return okJson(goodRender);
        return okJson(url.includes("prj_aAkER") ? { link: { productionBranch: "main" } } : goodVercel);
      },
    });
    assert.equal(findings.length, 1);
    assert.match(findings[0], /frapp-landing/);
  });
});

describe("buildSummary", () => {
  it("says so plainly when everything holds", () =>
    assert.match(buildSummary([]), /All production deploy guardrails hold/));
  it("counts and lists violations", () => {
    const summary = buildSummary(["a", "b"]);
    assert.match(summary, /2 production guardrail violation/);
    assert.match(summary, /- a/);
  });
});
