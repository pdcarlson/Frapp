import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  assertRenderService,
  assertVercelProductionBranch,
  buildSummary,
  collectFindings,
} from "../production-guardrails.mjs";

const RENDER_SERVICE_ID = "srv-test";
const VERCEL_PROJECTS = [
  { projectId: "prj_web", label: "frapp-web" },
  { projectId: "prj_landing", label: "frapp-landing" },
];

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
      renderServiceId: RENDER_SERVICE_ID,
      vercelProjects: VERCEL_PROJECTS,
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
      renderServiceId: RENDER_SERVICE_ID,
      vercelProjects: VERCEL_PROJECTS,
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
      renderServiceId: RENDER_SERVICE_ID,
      vercelProjects: VERCEL_PROJECTS,
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
      renderServiceId: RENDER_SERVICE_ID,
      vercelProjects: VERCEL_PROJECTS,
      fetchImpl: async (url) => {
        if (url.includes("render.com")) return okJson(goodRender);
        return okJson(url.includes("prj_landing") ? { link: { productionBranch: "main" } } : goodVercel);
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

describe("provider identifiers are inputs, never defaults", () => {
  // The failure this guards: `frapp-api-prod` is recreated and gets a new
  // service id. Whoever updates deploy-production.yml (which is what actually
  // deploys) has no reason to touch this script — so a default baked in here
  // would keep the daily watchdog asserting auto-deploy against the OLD
  // service, reporting green forever about an object nothing deploys to. Every
  // sibling script requires its ids from env for the same reason.
  it("queries exactly the service and projects it was handed", async () => {
    const urls = [];
    await collectFindings({
      renderApiKey: "r",
      vercelApiKey: "v",
      renderServiceId: "srv-somewhere-else",
      vercelProjects: [{ projectId: "prj_only", label: "solo" }],
      fetchImpl: async (url) => {
        urls.push(url);
        return okJson(url.includes("render.com") ? { autoDeploy: "no", branch: "main" } : { link: { productionBranch: "production" } });
      },
    });

    assert.equal(urls.length, 2);
    assert.ok(urls[0].endsWith("/services/srv-somewhere-else"));
    assert.ok(urls[1].includes("prj_only"));
    // No hardcoded production id leaked into the calls.
    assert.ok(!urls.some((u) => u.includes("srv-d6lqu41aae7s73f62df0")));
    assert.ok(!urls.some((u) => u.includes("prj_xkn32taKrJCgYRZoN6pZRfGfPT9T")));
  });
});

describe("buildSummary — a pass must not assert what it did not read", () => {
  it("names both settings when both were checked", () => {
    const text = buildSummary([]);
    assert.match(text, /Render auto-deploy is off/);
    assert.match(text, /neither Vercel project promotes from main/);
  });

  it("does NOT claim the Vercel setting under --render-only", () => {
    // The failure this guards: `migrations-only` runs the preflight with
    // --render-only, which never fetches either Vercel project. A success line
    // still naming the Vercel Production Branch is a written assurance about a
    // setting nothing looked at — on the only path to production, in the step
    // whose entire job is asserting the two settings that fail open.
    const text = buildSummary([], { checked: ["render"] });
    assert.match(text, /Render auto-deploy is off/);
    assert.doesNotMatch(text, /neither Vercel project promotes from main/);
    assert.match(text, /NOT read by this run/);
    // And it must not claim completeness either.
    assert.doesNotMatch(text, /All production deploy guardrails hold/);
  });

  it("still reports violations verbatim regardless of scope", () => {
    const text = buildSummary(["Render auto-deploy is ON"], { checked: ["render"] });
    assert.match(text, /1 production guardrail violation/);
    assert.match(text, /Render auto-deploy is ON/);
  });
});
