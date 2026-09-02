import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  assertRenderService,
  assertVercelNoGitLink,
  buildSummary,
  collectFindings,
  looksLikeVercelProject,
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

describe("looksLikeVercelProject", () => {
  // This predicate is what keeps the inverted assertion from failing open. It
  // is tested separately from the assertion because "absent link" and "response
  // we did not understand" must never collapse into the same answer.
  it("accepts a real project object", () =>
    assert.equal(looksLikeVercelProject({ id: "prj_web", name: "frapp-web", link: null }), true));

  it("rejects an empty object", () => assert.equal(looksLikeVercelProject({}), false));
  it("rejects an error envelope", () =>
    assert.equal(looksLikeVercelProject({ error: { code: "forbidden", message: "no" } }), false));
  it("rejects null and undefined", () => {
    assert.equal(looksLikeVercelProject(null), false);
    assert.equal(looksLikeVercelProject(undefined), false);
  });
  it("rejects a project whose id is present but empty", () =>
    assert.equal(looksLikeVercelProject({ id: "" }), false));
});

describe("assertVercelNoGitLink", () => {
  const UNLINKED = { id: "prj_web", name: "frapp-web", link: null };

  // The live, intended state post-ADR-21: both projects unlinked, so there is
  // no Production Branch and no push path to production.
  it("passes when the project is unlinked (link: null)", () =>
    assert.deepEqual(assertVercelNoGitLink(UNLINKED, "frapp-web"), []));

  it("passes when link is absent entirely", () =>
    assert.deepEqual(assertVercelNoGitLink({ id: "prj_landing", name: "frapp-landing" }, "frapp-landing"), []));

  // The violation this assertion exists to catch. Re-linking restores both
  // fail-open dashboard settings the unlink removed.
  it("fails when the project has regained a Git link", () => {
    const findings = assertVercelNoGitLink(
      { id: "prj_web", name: "frapp-web", link: { type: "github", org: "pdcarlson", repo: "Frapp" } },
      "frapp-web",
    );
    assert.equal(findings.length, 1);
    assert.match(findings[0], /is linked to Git/);
    assert.match(findings[0], /github pdcarlson\/Frapp/);
    assert.match(findings[0], /ADR-21/);
  });

  it("fails on a link object with nothing identifying in it — a link is a link", () => {
    const findings = assertVercelNoGitLink({ id: "prj_web", link: {} }, "frapp-web");
    assert.equal(findings.length, 1);
    assert.match(findings[0], /is linked to Git/);
  });

  // The regression the inversion could otherwise introduce. Under the OLD
  // assertion absent meant violation, so a malformed body failed closed for
  // free. Now absent means pass, so an unrecognised shape must be caught
  // explicitly or the guardrail goes green having read nothing.
  it("fails on an unrecognised response shape rather than reading it as unlinked", () => {
    for (const body of [{}, { error: { code: "forbidden" } }, null, undefined, "nope"]) {
      const findings = assertVercelNoGitLink(body, "frapp-web");
      assert.equal(findings.length, 1, `expected a violation for ${JSON.stringify(body)}`);
      assert.match(findings[0], /Unreadable is not a pass/);
    }
  });
});

describe("collectFindings", () => {
  const goodRender = { autoDeploy: "no", branch: "main" };
  const goodVercel = { id: "prj_test", name: "frapp-test", link: null };

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
        return okJson(
          url.includes("prj_landing")
            ? { id: "prj_landing", name: "frapp-landing", link: { type: "github", org: "pdcarlson", repo: "Frapp" } }
            : goodVercel,
        );
      },
    });
    assert.equal(findings.length, 1);
    assert.match(findings[0], /frapp-landing/);
  });

  // The end-to-end shape of the #1579 regression, pinned so it cannot come
  // back: the live provider state (both projects unlinked) must be a PASS.
  it("is clean against the real post-ADR-21 provider state", async () => {
    const findings = await collectFindings({
      renderApiKey: "r",
      vercelApiKey: "v",
      renderServiceId: RENDER_SERVICE_ID,
      vercelProjects: VERCEL_PROJECTS,
      fetchImpl: async (url) =>
        okJson(
          url.includes("render.com")
            ? { autoDeploy: "no", branch: "main" }
            : url.includes("prj_landing")
              ? { id: "prj_aAkER9EZJcxR51vUY0mwNDnCf8vy", name: "frapp-landing", link: null }
              : { id: "prj_xkn32taKrJCgYRZoN6pZRfGfPT9T", name: "frapp-web", link: null },
        ),
    });
    assert.deepEqual(findings, []);
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
        return okJson(
          url.includes("render.com")
            ? { autoDeploy: "no", branch: "main" }
            : { id: "prj_only", name: "solo", link: null },
        );
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
    assert.match(text, /neither Vercel project is linked to Git/);
  });

  it("claims only frapp-web, never 'neither project', under --migrations-only", () => {
    // Two failures guarded at once.
    //
    // The first: a success line naming a setting nothing read. `migrations-only`
    // skips frapp-landing, so claiming "neither Vercel project is linked to
    // Git" would be a written assurance about a project this run never
    // fetched — on the only path to production, in the step whose entire job is
    // asserting the settings that fail open.
    //
    // The second, and the reason frapp-web is still in the list: `apps/web` is
    // a direct Supabase client (PostgREST reads plus `postgres_changes` on
    // `public.chat_messages` and `public.chat_message_actions`), so a dashboard
    // promoted from `main` is wired straight to the schema a migrations-only
    // run is changing. An earlier cut of this flag dropped both projects on the
    // stated grounds that a Production Branch "bears on nothing a migration
    // does". That was false for frapp-web, and stays false after #1579 inverted
    // the assertion to a Git-link check — only the mechanism changed.
    const text = buildSummary([], { checked: ["render", "vercel-web"] });
    assert.match(text, /Render auto-deploy is off/);
    assert.match(text, /frapp-web is not linked to Git/);
    assert.doesNotMatch(text, /neither Vercel project is linked to Git/);
    assert.match(text, /frapp-landing's Git link was NOT read/);
    // And it must not claim completeness.
    assert.doesNotMatch(text, /All production deploy guardrails hold/);
  });

  it("still reports violations verbatim regardless of scope", () => {
    const text = buildSummary(["Render auto-deploy is ON"], { checked: ["render", "vercel-web"] });
    assert.match(text, /1 production guardrail violation/);
    assert.match(text, /Render auto-deploy is ON/);
  });
});
