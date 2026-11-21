import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  assertVercelNoGitLink,
  buildSummary,
  collectFindings,
  looksLikeVercelProject,
  syncGuardrailsAlert,
  ALERT,
} from "../production-guardrails.mjs";
import { quiet } from "./helpers.mjs";

const VERCEL_PROJECTS = [
  { projectId: "prj_web", label: "frapp-web" },
  { projectId: "prj_landing", label: "frapp-landing" },
];

function okJson(body) {
  return { ok: true, status: 200, json: async () => body };
}

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
  const goodVercel = { id: "prj_test", name: "frapp-test", link: null };

  it("is clean when every project is configured correctly", async () => {
    const findings = await collectFindings({
      vercelApiKey: "v",
      vercelProjects: VERCEL_PROJECTS,
      fetchImpl: async () => okJson(goodVercel),
    });
    assert.deepEqual(findings, []);
  });

  // staging-conformance.mjs has a `skipped` outcome. This one deliberately does
  // not: "I could not check whether production auto-deploys" is not a state in
  // which to deploy to production.
  it("treats an unreadable Vercel project as a violation, never a skip", async () => {
    const findings = await collectFindings({
      vercelApiKey: "v",
      vercelProjects: VERCEL_PROJECTS,
      fetchImpl: async () => ({ ok: false, status: 403 }),
    });
    // Both projects fail to read.
    assert.equal(findings.length, 2);
    assert.match(findings[0], /Unreadable is not a pass/);
  });

  it("reports each Vercel project independently", async () => {
    const findings = await collectFindings({
      vercelApiKey: "v",
      vercelProjects: VERCEL_PROJECTS,
      fetchImpl: async (url) =>
        okJson(
          url.includes("prj_landing")
            ? { id: "prj_landing", name: "frapp-landing", link: { type: "github", org: "pdcarlson", repo: "Frapp" } }
            : goodVercel,
        ),
    });
    assert.equal(findings.length, 1);
    assert.match(findings[0], /frapp-landing/);
  });

  // The end-to-end shape of the #1579 regression, pinned so it cannot come
  // back: the live provider state (both projects unlinked) must be a PASS.
  it("is clean against the real post-ADR-21 provider state", async () => {
    const findings = await collectFindings({
      vercelApiKey: "v",
      vercelProjects: VERCEL_PROJECTS,
      fetchImpl: async (url) =>
        okJson(
          url.includes("prj_landing")
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
  // The failure this guards: a project is recreated and gets a new id.
  // Whoever updates `_deploy.yml` (which is what actually deploys) has no
  // reason to touch this script — so a default baked in here would keep the
  // daily watchdog asserting against the OLD project, reporting green forever
  // about an object nothing deploys to. Every sibling script requires its ids
  // from env for the same reason.
  it("queries exactly the projects it was handed", async () => {
    const urls = [];
    await collectFindings({
      vercelApiKey: "v",
      vercelProjects: [{ projectId: "prj_only", label: "solo" }],
      fetchImpl: async (url) => {
        urls.push(url);
        return okJson({ id: "prj_only", name: "solo", link: null });
      },
    });

    assert.equal(urls.length, 1);
    assert.ok(urls[0].includes("prj_only"));
    // No hardcoded production id leaked into the calls.
    assert.ok(!urls.some((u) => u.includes("prj_xkn32taKrJCgYRZoN6pZRfGfPT9T")));
  });
});

describe("buildSummary — a pass must not assert what it did not read", () => {
  it("names both projects when both were checked", () => {
    const text = buildSummary([]);
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
    const text = buildSummary([], { checked: ["vercel-web"] });
    assert.match(text, /frapp-web is not linked to Git/);
    assert.doesNotMatch(text, /neither Vercel project is linked to Git/);
    assert.match(text, /frapp-landing's Git link was NOT read/);
    // And it must not claim completeness.
    assert.doesNotMatch(text, /All production deploy guardrails hold/);
  });

  it("still reports violations verbatim regardless of scope", () => {
    const text = buildSummary(["frapp-web is linked to Git"], { checked: ["vercel-web"] });
    assert.match(text, /1 production guardrail violation/);
    assert.match(text, /frapp-web is linked to Git/);
  });
});

describe("syncGuardrailsAlert — a clean run whose alert can't be read or closed is red (#2627)", () => {
  function issuesFetch({ lookup, closeStatus = 200 }) {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      const method = init.method ?? "GET";
      calls.push({ method, url: String(url), body: init.body ?? "" });
      if (method === "GET") {
        return typeof lookup === "number"
          ? { ok: false, status: lookup, text: async () => "{}" }
          : { ok: true, status: 200, text: async () => JSON.stringify(lookup) };
      }
      const status = method === "PATCH" ? closeStatus : 201;
      return { ok: status < 300, status, text: async () => JSON.stringify({ number: 42 }) };
    };
    return { fetchImpl, calls };
  }
  const base = { summary: "all hold", token: "t", repo: "o/r" };
  const openAlert = [{ number: 42, state: "open", title: ALERT.title }];

  it("exits 0 and closes the alert on a clean run", async () => {
    const { fetchImpl } = issuesFetch({ lookup: openAlert });
    const out = await syncGuardrailsAlert({ ...base, findings: [], fetchImpl, logger: quiet });
    assert.deepEqual(out, { alert: { action: "closed", closed: [42] }, exitCode: 0 });
  });

  it("exits 0 when the lookup worked and nothing was open", async () => {
    const { fetchImpl, calls } = issuesFetch({ lookup: [] });
    const out = await syncGuardrailsAlert({ ...base, findings: [], fetchImpl, logger: quiet });
    assert.equal(out.exitCode, 0);
    assert.equal(calls.length, 1, "one lookup, no pre-check");
  });

  it("exits 1 with an ::error:: when the lookup fails, and writes nothing", async () => {
    const lines = [];
    const { fetchImpl, calls } = issuesFetch({ lookup: 502 });
    const out = await syncGuardrailsAlert({
      ...base,
      findings: [],
      fetchImpl,
      logger: { log: (line) => lines.push(line) },
    });
    assert.deepEqual(out, { alert: { action: "unread", closed: [] }, exitCode: 1 });
    assert.equal(calls.filter((c) => c.method !== "GET").length, 0);
    assert.ok(lines.some((l) => /^::error::.*could not be read/.test(l)));
    assert.ok(!lines.some((l) => /still open/.test(l)));
  });

  it("exits 1 with an ::error:: when the close fails", async () => {
    const lines = [];
    const { fetchImpl } = issuesFetch({ lookup: openAlert, closeStatus: 502 });
    const out = await syncGuardrailsAlert({
      ...base,
      findings: [],
      fetchImpl,
      logger: { log: (line) => lines.push(line) },
    });
    assert.deepEqual(out, { alert: { action: "failed", closed: [] }, exitCode: 1 });
    assert.ok(lines.some((l) => /^::error::.*could not be closed/.test(l)));
  });

  it("main() exits with syncGuardrailsAlert's exit code", () => {
    // The only line that turns an unreadable or unclosable alert into a red
    // scheduled run; `process.exit(findings.length ? 1 : 0)` left the rest green.
    const source = readFileSync(new URL("../production-guardrails.mjs", import.meta.url), "utf8");
    const main = source.slice(source.indexOf("async function main()"));
    assert.match(main, /const \{ exitCode \} = await syncGuardrailsAlert\(/);
    assert.match(main, /process\.exit\(exitCode\);\n\}/);
  });

  it("exits 1 on a violation, whatever the alert write did", async () => {
    const { fetchImpl } = issuesFetch({ lookup: [] });
    const out = await syncGuardrailsAlert({
      ...base,
      findings: ["frapp-web is linked to Git"],
      fetchImpl,
      logger: quiet,
    });
    assert.equal(out.exitCode, 1);
    assert.equal(out.alert.action, "created");
  });
});
