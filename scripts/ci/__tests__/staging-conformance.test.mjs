import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALERT_ISSUE_TITLE,
  FAIL,
  PASS,
  SKIPPED,
  buildAlertIssueBody,
  buildRunSummary,
  checkAuthHook,
  checkAuthSignIn,
  checkInfisicalSyncs,
  checkProjectStatus,
  checkSchemaDrift,
  classifyConformance,
  decodeJwtPayload,
  readWorkspaceId,
  runStagingConformance,
} from "../staging-conformance.mjs";

import { makeFetchMock, quiet } from "./helpers.mjs";

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const httpError = (status) => ({ ok: false, status, json: async () => ({}) });

// ── Project status ──────────────────────────────────────────────────────────

test("project status passes only on ACTIVE_HEALTHY", async () => {
  const healthy = await checkProjectStatus({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () => ok({ status: "ACTIVE_HEALTHY" }),
  });
  assert.equal(healthy.status, PASS);

  const paused = await checkProjectStatus({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () => ok({ status: "INACTIVE" }),
  });
  assert.equal(paused.status, FAIL);
  assert.match(paused.detail, /INACTIVE/);
});

test("project status skips rather than fails when the credential is absent", async () => {
  const result = await checkProjectStatus({ accessToken: "", projectRef: "" });
  assert.equal(result.status, SKIPPED);
});

test("a non-200 from the Management API is a failure, not a skip", async () => {
  const result = await checkProjectStatus({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () => httpError(401),
  });
  assert.equal(result.status, FAIL);
});

// ── Auth hook — the #805 regression this workflow exists to catch ───────────

test("auth hook disabled fails and names the trust-model consequence", async () => {
  const result = await checkAuthHook({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () => ok({ hook_custom_access_token_enabled: false }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /x-chapter-id/);
});

test("auth hook enabled but pointed at another function is not a pass", async () => {
  const result = await checkAuthHook({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () =>
      ok({
        hook_custom_access_token_enabled: true,
        hook_custom_access_token_uri: "pg-functions://postgres/public/some_other_hook",
      }),
  });
  assert.equal(result.status, FAIL);
});

test("auth hook enabled and correctly pointed passes", async () => {
  const result = await checkAuthHook({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () =>
      ok({
        hook_custom_access_token_enabled: true,
        hook_custom_access_token_uri: "pg-functions://postgres/public/custom_access_token_hook",
      }),
  });
  assert.equal(result.status, PASS);
});

// ── Infisical syncs ─────────────────────────────────────────────────────────

const infisicalFetch = (syncPayload, { loginStatus = 200 } = {}) => async (url) => {
  if (url.includes("universal-auth/login")) {
    return loginStatus === 200
      ? ok({ accessToken: "at" })
      : httpError(loginStatus);
  }
  return ok(syncPayload);
};

test("all-succeeded syncs pass", async () => {
  const result = await checkInfisicalSyncs({
    clientId: "c",
    clientSecret: "s",
    projectId: "p",
    fetchImpl: infisicalFetch({
      secretSyncs: [
        { name: "render-api-staging", syncStatus: "succeeded" },
        { name: "vercel-web-staging", syncStatus: "succeeded" },
      ],
    }),
  });
  assert.equal(result.status, PASS);
});

test("a failing sync names the sync — the #834 signature", async () => {
  const result = await checkInfisicalSyncs({
    clientId: "c",
    clientSecret: "s",
    projectId: "p",
    fetchImpl: infisicalFetch({
      secretSyncs: [
        { name: "render-api-staging", syncStatus: "succeeded" },
        { name: "vercel-landing-staging", syncStatus: "failed" },
      ],
    }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /vercel-landing-staging/);
});

test("a rejected login explains that the credential is present but refused", async () => {
  const result = await checkInfisicalSyncs({
    clientId: "c",
    clientSecret: "s",
    projectId: "p",
    fetchImpl: infisicalFetch({}, { loginStatus: 401 }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /Client ID/);
});

test("an unrecognised response shape fails closed rather than reading as healthy", async () => {
  const result = await checkInfisicalSyncs({
    clientId: "c",
    clientSecret: "s",
    projectId: "p",
    fetchImpl: infisicalFetch({ unexpected: true }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /could not interpret/);
});

test("zero syncs is a failure — the store is supposed to have six", async () => {
  const result = await checkInfisicalSyncs({
    clientId: "c",
    clientSecret: "s",
    projectId: "p",
    fetchImpl: infisicalFetch({ secretSyncs: [] }),
  });
  assert.equal(result.status, FAIL);
});

// ── End-to-end sign-in ──────────────────────────────────────────────────────

test("sign-in skips loudly when the smoke credential is not provisioned", async () => {
  const result = await checkAuthSignIn({ supabaseUrl: "u", anonKey: "k" });
  assert.equal(result.status, SKIPPED);
  assert.match(result.detail, /exactly ONE chapter membership/);
});

test("a token carrying active_chapter_id passes", async () => {
  const result = await checkAuthSignIn({
    supabaseUrl: "https://staging.example",
    anonKey: "k",
    email: "smoke@example.com",
    password: "pw",
    fetchImpl: async () => ok({ access_token: "header.payload.sig" }),
    decode: () => ({ active_chapter_id: "chapter-uuid" }),
  });
  assert.equal(result.status, PASS);
});

test("a claimless token fails and names the no-membership trap, not just the hook", async () => {
  const result = await checkAuthSignIn({
    supabaseUrl: "https://staging.example",
    anonKey: "k",
    email: "smoke@example.com",
    password: "pw",
    fetchImpl: async () => ok({ access_token: "header.payload.sig" }),
    decode: () => ({ sub: "user-uuid" }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /no membership|resolves to no chapter/);
});

test("decodeJwtPayload reads a real base64url payload and survives garbage", () => {
  const payload = Buffer.from(JSON.stringify({ active_chapter_id: "abc" })).toString("base64url");
  assert.deepEqual(decodeJwtPayload(`h.${payload}.s`), { active_chapter_id: "abc" });
  assert.equal(decodeJwtPayload("not-a-jwt"), null);
  assert.equal(decodeJwtPayload(""), null);
});

// ── Schema drift delegation (#833) ──────────────────────────────────────────

test("schema drift reports NOT-WIRED while #833 is unmerged, and never a pass", async () => {
  const result = await checkSchemaDrift({ exists: () => false });
  assert.equal(result.status, SKIPPED);
  assert.match(result.detail, /#833/);
});

test("schema drift delegates to the script once it exists", async () => {
  const passed = await checkSchemaDrift({ exists: () => true, run: () => "no drift" });
  assert.equal(passed.status, PASS);

  const failed = await checkSchemaDrift({
    exists: () => true,
    run: () => {
      const error = new Error("exited 1");
      error.stdout = "3 migrations applied remotely are missing locally";
      throw error;
    },
  });
  assert.equal(failed.status, FAIL);
  assert.match(failed.detail, /missing locally/);
});

// ── Classification and reporting ────────────────────────────────────────────

test("skipped assertions never turn the run red", () => {
  const { outcome, skipped, passed } = classifyConformance([
    { status: PASS },
    { status: SKIPPED },
    { status: SKIPPED },
  ]);
  assert.equal(outcome, "healthy");
  assert.equal(skipped.length, 2);
  assert.equal(passed.length, 1);
});

test("all-skipped is inconclusive, never healthy", () => {
  const { outcome } = classifyConformance([{ status: SKIPPED }, { status: SKIPPED }]);
  assert.equal(outcome, "inconclusive");
});

test("one failure reds the run regardless of how many passed", () => {
  const { outcome, failed } = classifyConformance([
    { status: PASS },
    { status: PASS },
    { status: FAIL },
  ]);
  assert.equal(outcome, "failed");
  assert.equal(failed.length, 1);
});

test("the summary never folds a skipped assertion into the pass count", () => {
  const summary = buildRunSummary({
    outcome: "healthy",
    results: [
      { status: PASS, label: "a", detail: "" },
      { status: SKIPPED, label: "b", detail: "no credential" },
    ],
    runUrl: "",
  });
  assert.match(summary, /1 of 2 assertions passed/);
  assert.match(summary, /SKIPPED/);
  assert.match(summary, /A skipped check is not a passing check/);
});

test("the alert body lists only the failing assertions and warns off claiming it", () => {
  const body = buildAlertIssueBody({
    results: [
      { status: PASS, label: "healthy thing", detail: "" },
      { status: FAIL, label: "auth hook", detail: "disabled" },
    ],
    runUrl: "https://example/run",
  });
  assert.match(body, /auth hook/);
  assert.doesNotMatch(body, /healthy thing/);
  assert.match(body, /routine-state/);
});

// ── Orchestration ───────────────────────────────────────────────────────────

test("a failing run writes the summary, annotates as an error, and raises the alert", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [] },
    { method: "POST", path: "/issues", body: { number: 900 } },
  ]);
  let summary = "";
  const { outcome, alert } = await runStagingConformance({
    token: "t",
    repo: "o/r",
    fetchImpl,
    checks: [async () => ({ id: "x", label: "auth hook", status: FAIL, detail: "disabled" })],
    writeSummary: (s) => { summary = s; },
    logger: quiet,
  });

  assert.equal(outcome, "failed");
  assert.equal(alert.action, "created");
  assert.match(summary, /has drifted/);
  const created = calls.find((c) => c.method === "POST" && c.url.includes("/issues"));
  assert.match(created.body, new RegExp(ALERT_ISSUE_TITLE.slice(0, 20)));
});

test("a clean run closes an open alert", async () => {
  const { fetchImpl } = makeFetchMock([
    {
      method: "GET",
      path: "/issues?state=all",
      body: [{ number: 900, state: "open", title: ALERT_ISSUE_TITLE }],
    },
    { method: "POST", path: "/comments", body: {} },
    { method: "PATCH", path: "/issues/900", body: {} },
  ]);
  const { outcome, alert } = await runStagingConformance({
    token: "t",
    repo: "o/r",
    fetchImpl,
    checks: [async () => ({ id: "x", label: "ok", status: PASS, detail: "" })],
    writeSummary: () => {},
    logger: quiet,
  });
  assert.equal(outcome, "healthy");
  assert.deepEqual(alert.closed, [900]);
});

test("an all-skipped run does NOT close an open alert by counting as healthy", async () => {
  // Guards the subtle version of the bug this workflow exists to prevent: if
  // every credential vanished, the run must not read as a recovery.
  const { fetchImpl } = makeFetchMock([
    {
      method: "GET",
      path: "/issues?state=all",
      body: [{ number: 900, state: "open", title: ALERT_ISSUE_TITLE }],
    },
    { method: "POST", path: "/comments", body: {} },
    { method: "PATCH", path: "/issues/900", body: {} },
  ]);
  let summary = "";
  const { outcome, alert } = await runStagingConformance({
    token: "t",
    repo: "o/r",
    fetchImpl,
    checks: [async () => ({ id: "x", label: "ok", status: SKIPPED, detail: "no credential" })],
    writeSummary: (s) => { summary = s; },
    logger: quiet,
  });
  assert.equal(outcome, "inconclusive");
  assert.deepEqual(alert.closed, []);
  assert.match(summary, /Inconclusive — nothing was asserted/);
  assert.match(summary, /left open deliberately/);
});

test("an inconclusive run issues no PATCH — the open alert is untouched", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    {
      method: "GET",
      path: "/issues?state=all",
      body: [{ number: 900, state: "open", title: ALERT_ISSUE_TITLE }],
    },
    { method: "PATCH", path: "/issues/900", body: {} },
  ]);
  await runStagingConformance({
    token: "t",
    repo: "o/r",
    fetchImpl,
    checks: [async () => ({ id: "x", label: "ok", status: SKIPPED, detail: "no credential" })],
    writeSummary: () => {},
    logger: quiet,
  });
  assert.equal(calls.filter((c) => c.method === "PATCH").length, 0);
});

test("a partially-skipped run with at least one real pass still resolves", async () => {
  // The live shape until the smoke credential is provisioned: some checks
  // assert, one skips. That must still count as evidence of health.
  const { fetchImpl } = makeFetchMock([
    {
      method: "GET",
      path: "/issues?state=all",
      body: [{ number: 900, state: "open", title: ALERT_ISSUE_TITLE }],
    },
    { method: "POST", path: "/comments", body: {} },
    { method: "PATCH", path: "/issues/900", body: {} },
  ]);
  const { outcome, alert } = await runStagingConformance({
    token: "t",
    repo: "o/r",
    fetchImpl,
    checks: [
      async () => ({ id: "a", label: "asserted", status: PASS, detail: "" }),
      async () => ({ id: "b", label: "skipped", status: SKIPPED, detail: "no credential" }),
    ],
    writeSummary: () => {},
    logger: quiet,
  });
  assert.equal(outcome, "healthy");
  assert.deepEqual(alert.closed, [900]);
});

test("one assertion throwing is a failure, and the others still report", async () => {
  const { fetchImpl } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [] },
    { method: "POST", path: "/issues", body: { number: 901 } },
  ]);
  const { outcome, results } = await runStagingConformance({
    token: "t",
    repo: "o/r",
    fetchImpl,
    checks: [
      async () => { throw new Error("DNS blew up"); },
      async () => ({ id: "y", label: "still ran", status: PASS, detail: "" }),
    ],
    writeSummary: () => {},
    logger: quiet,
  });
  assert.equal(outcome, "failed");
  assert.equal(results.length, 2);
  assert.equal(results[1].status, PASS);
  assert.match(results[0].detail, /DNS blew up/);
});

test("readWorkspaceId reads .infisical.json and returns null on anything malformed", () => {
  assert.equal(
    readWorkspaceId({ path: "x", read: () => JSON.stringify({ workspaceId: "ws-1" }) }),
    "ws-1",
  );
  assert.equal(readWorkspaceId({ path: "x", read: () => "{not json" }), null);
  assert.equal(
    readWorkspaceId({ path: "x", read: () => { throw new Error("ENOENT"); } }),
    null,
  );
});

test("the repo's real .infisical.json exposes a workspaceId", () => {
  // Not a mock: the Infisical assertion depends on this file's shape, so a
  // rename would otherwise only surface as a silent SKIPPED in production.
  assert.ok(readWorkspaceId());
});
