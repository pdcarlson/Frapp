import { mock, test } from "node:test";
import assert from "node:assert/strict";

import {
  ALERT_ASSIGNEE,
  ALERT_LOOKUP_LABEL,
  findAlertIssues,
  raiseAlert,
  resolveAlert,
  withAgentNote,
} from "../lib/alert-issue.mjs";

import { makeFetchMock } from "./helpers.mjs";

// Direct coverage for the shared alert mechanism. Before this file existed, the
// lib was exercised only through deploy-alert.mjs's wrappers — so the second
// consumer (staging-conformance.mjs), which is the whole reason for the
// extraction, relied on behaviour nothing tested at this level.

const TITLE = "Test alert";
const LABELS = [ALERT_LOOKUP_LABEL, "area:ci", "P1"];
const args = (fetchImpl) => ({ token: "t", repo: "o/r", fetchImpl, title: TITLE });

const builders = {
  buildIssueBody: () => "issue body",
  buildCommentBody: ({ reopened }) => (reopened ? "reopened body" : "comment body"),
};

// ── findAlertIssues ─────────────────────────────────────────────────────────

test("findAlertIssues pins sort order and filters to the exact title", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    {
      method: "GET",
      path: "/issues?state=all",
      body: [
        { number: 1, title: TITLE, state: "open" },
        { number: 2, title: "something else", state: "open" },
        { number: 3, title: TITLE, state: "open", pull_request: {} },
      ],
    },
  ]);
  const found = await findAlertIssues(args(fetchImpl));
  assert.deepEqual(
    found.map((i) => i.number),
    [1],
    "a foreign title and a pull request must both be excluded",
  );
  assert.match(calls[0].url, /sort=created&direction=desc/);
});

test("findAlertIssues returns [] on a failed lookup so the caller falls through to create", async () => {
  const { fetchImpl } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", status: 500, body: {} },
  ]);
  assert.deepEqual(await findAlertIssues(args(fetchImpl)), []);
});

// ── raiseAlert ──────────────────────────────────────────────────────────────

test("a created alert always carries the label its own lookup filters on", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [] },
    { method: "POST", path: "/issues", body: { number: 7 } },
  ]);
  // Caller omits the lookup label — the lib must add it back. Otherwise the
  // issue is invisible to findAlertIssues: a fresh duplicate every run, and
  // never closed on recovery.
  const out = await raiseAlert({
    ...args(fetchImpl),
    labels: ["area:ci"],
    ...builders,
  });
  assert.equal(out.action, "created");
  const created = JSON.parse(calls.find((c) => c.method === "POST").body);
  assert.ok(created.labels.includes(ALERT_LOOKUP_LABEL));
});

test("raiseAlert comments instead of filing a second issue when one is open", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [{ number: 7, title: TITLE, state: "open" }] },
    { method: "POST", path: "/comments", body: {} },
  ]);
  const out = await raiseAlert({ ...args(fetchImpl), labels: LABELS, ...builders });
  assert.equal(out.action, "commented");
  assert.equal(calls.filter((c) => c.url.endsWith("/issues")).length, 0);
  // An open alert keeps whatever assignees it has: the owner may have dropped
  // the assignment mid-incident, and a run must not override that.
  assert.equal(calls.filter((c) => c.method === "PATCH").length, 0);
});

// ── Assignment (ADR-24 decision 2) ──────────────────────────────────────────

test("a created alert is assigned to the owner", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [] },
    { method: "POST", path: "/issues", body: { number: 7 } },
  ]);
  await raiseAlert({ ...args(fetchImpl), labels: LABELS, ...builders });
  const created = JSON.parse(calls.find((c) => c.method === "POST").body);
  assert.deepEqual(created.assignees, [ALERT_ASSIGNEE]);
});

test("an assignee GitHub rejects (422) still files the alert, unassigned", async () => {
  // Losing the alert is the failure this module exists to prevent; a missing
  // assignee is the lesser one.
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [] },
    { method: "POST", path: "/issues", body: { number: 7 } },
  ]);
  // makeFetchMock takes one status per route, so reject by request body here.
  const routed = async (url, init = {}) => {
    const response = await fetchImpl(url, init);
    const sent = init.body ? JSON.parse(init.body) : {};
    if (init.method === "POST" && url.endsWith("/issues") && sent.assignees) {
      return { ...response, ok: false, status: 422 };
    }
    return response;
  };
  const log = mock.method(console, "log", () => {});
  let out;
  try {
    out = await raiseAlert({ ...args(routed), labels: LABELS, ...builders });
  } finally {
    log.mock.restore();
  }
  assert.deepEqual(out, { action: "created", issueNumber: 7 });
  const creates = calls.filter((c) => c.method === "POST" && c.url.endsWith("/issues"));
  assert.equal(creates.length, 2);
  const retry = JSON.parse(creates[1].body);
  assert.equal("assignees" in retry, false);
  assert.equal(retry.title, TITLE);
  assert.ok(retry.labels.includes(ALERT_LOOKUP_LABEL));
  // The return reads as a normal create, so the run annotation is the only
  // place the missing assignee shows.
  const lines = log.mock.calls.map((call) => call.arguments.join(" "));
  assert.equal(lines.filter((line) => line.startsWith("::warning::#7 is not assigned")).length, 1);
});

test("a 2xx that comes back without the owner assigned is annotated", async () => {
  const warned = async (assignees) => {
    const { fetchImpl } = makeFetchMock([
      { method: "GET", path: "/issues?state=all", body: [] },
      { method: "POST", path: "/issues", body: { number: 7, assignees } },
    ]);
    const log = mock.method(console, "log", () => {});
    try {
      await raiseAlert({ ...args(fetchImpl), labels: LABELS, ...builders });
    } finally {
      log.mock.restore();
    }
    return log.mock.calls.some((call) => String(call.arguments[0]).startsWith("::warning::"));
  };
  assert.equal(await warned([]), true, "assignee silently dropped");
  assert.equal(await warned([{ login: ALERT_ASSIGNEE }]), false, "owner assigned");
});

test("a 5xx create is not retried as an assignee problem", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [] },
    { method: "POST", path: "/issues", status: 502, body: {} },
  ]);
  const out = await raiseAlert({ ...args(fetchImpl), labels: LABELS, ...builders });
  assert.deepEqual(out, { action: "failed", issueNumber: null });
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
});

test("a reopen assigns the owner and keeps anyone already assigned", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    {
      method: "GET",
      path: "/issues?state=all",
      body: [{ number: 7, title: TITLE, state: "closed", assignees: [{ login: "someone" }] }],
    },
    { method: "PATCH", path: "/issues/7", body: {} },
    { method: "POST", path: "/comments", body: {} },
  ]);
  const out = await raiseAlert({ ...args(fetchImpl), labels: LABELS, ...builders });
  assert.equal(out.action, "reopened");
  const patch = JSON.parse(calls.find((c) => c.method === "PATCH").body);
  // PATCH replaces the assignee set, so the existing one must be carried.
  assert.deepEqual(patch, { state: "open", assignees: ["someone", ALERT_ASSIGNEE] });
});

test("a reopen whose assignee GitHub rejects (422) still reopens", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [{ number: 7, title: TITLE, state: "closed" }] },
    { method: "PATCH", path: "/issues/7", body: {} },
    { method: "POST", path: "/comments", body: {} },
  ]);
  const routed = async (url, init = {}) => {
    const response = await fetchImpl(url, init);
    const sent = init.body ? JSON.parse(init.body) : {};
    if (init.method === "PATCH" && sent.assignees) return { ...response, ok: false, status: 422 };
    return response;
  };
  const log = mock.method(console, "log", () => {});
  let out;
  try {
    out = await raiseAlert({ ...args(routed), labels: LABELS, ...builders });
  } finally {
    log.mock.restore();
  }
  assert.equal(out.action, "reopened");
  assert.equal(log.mock.callCount(), 1);
  const patches = calls.filter((c) => c.method === "PATCH").map((c) => JSON.parse(c.body));
  assert.deepEqual(patches, [{ state: "open", assignees: [ALERT_ASSIGNEE] }, { state: "open" }]);
});

test("a FAILED reopen is reported as failed, not as reopened", async () => {
  // The dangerous direction: reporting success leaves a live outage with the
  // alert still closed and the run logging "reopened".
  const { fetchImpl } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [{ number: 7, title: TITLE, state: "closed" }] },
    { method: "PATCH", path: "/issues/7", status: 502, body: {} },
    { method: "POST", path: "/comments", body: {} },
  ]);
  const out = await raiseAlert({ ...args(fetchImpl), labels: LABELS, ...builders });
  assert.equal(out.action, "failed");
  assert.equal(out.issueNumber, 7);
});

test("a successful reopen reports reopened and uses the reopened comment body", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [{ number: 7, title: TITLE, state: "closed" }] },
    { method: "PATCH", path: "/issues/7", body: {} },
    { method: "POST", path: "/comments", body: {} },
  ]);
  const out = await raiseAlert({ ...args(fetchImpl), labels: LABELS, ...builders });
  assert.equal(out.action, "reopened");
  assert.match(calls.find((c) => c.url.includes("/comments")).body, /reopened body/);
});

test("refreshBodyOnRaise rewrites an open alert's body; default leaves it alone", async () => {
  const routes = [
    { method: "GET", path: "/issues?state=all", body: [{ number: 7, title: TITLE, state: "open" }] },
    { method: "PATCH", path: "/issues/7", body: {} },
    { method: "POST", path: "/comments", body: {} },
  ];

  const off = makeFetchMock(routes);
  await raiseAlert({ ...args(off.fetchImpl), labels: LABELS, ...builders });
  assert.equal(off.calls.filter((c) => c.method === "PATCH").length, 0);

  const on = makeFetchMock(routes);
  await raiseAlert({
    ...args(on.fetchImpl),
    labels: LABELS,
    ...builders,
    refreshBodyOnRaise: true,
  });
  const patch = on.calls.find((c) => c.method === "PATCH");
  assert.ok(patch, "body refresh must issue a PATCH");
  assert.deepEqual(JSON.parse(patch.body), { body: withAgentNote("issue body", "o/r") });
});

test("every alert body ends with one pointer to what agents may do with it", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [] },
    { method: "POST", path: "/issues", body: { number: 7 } },
  ]);
  await raiseAlert({ ...args(fetchImpl), labels: LABELS, ...builders });
  const { body } = JSON.parse(calls.find((c) => c.method === "POST").body);
  assert.ok(body.startsWith("issue body\n\n---\n"), "the watchdog's own body comes first");
  const link = "https://github.com/o/r/blob/main/docs/internal/ops/ALERT_ROUTING.md#escalation";
  assert.equal(body.split(link).length - 1, 1, "exactly one pointer");
});

// ── resolveAlert ────────────────────────────────────────────────────────────

test("resolveAlert closes every open duplicate so an API-blip duplicate self-heals", async () => {
  const { fetchImpl } = makeFetchMock([
    {
      method: "GET",
      path: "/issues?state=all",
      body: [
        { number: 7, title: TITLE, state: "open" },
        { number: 8, title: TITLE, state: "open" },
        { number: 9, title: TITLE, state: "closed" },
      ],
    },
    { method: "POST", path: "/comments", body: {} },
    { method: "PATCH", path: "/issues/", body: {} },
  ]);
  const out = await resolveAlert({
    ...args(fetchImpl),
    buildRecoveryBody: () => "recovered",
  });
  assert.deepEqual(out.closed, [7, 8]);
});

test("resolveAlert closes as completed", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [{ number: 7, title: TITLE, state: "open" }] },
    { method: "POST", path: "/comments", body: {} },
    { method: "PATCH", path: "/issues/7", body: {} },
  ]);
  await resolveAlert({ ...args(fetchImpl), buildRecoveryBody: () => "recovered" });
  assert.deepEqual(JSON.parse(calls.find((c) => c.method === "PATCH").body), {
    state: "closed",
    state_reason: "completed",
  });
});

test("a close that fails is reported as failed, never as closed-with-nothing", async () => {
  // Returning {action:"closed", closed:[]} let the caller log a successful
  // closure while a P1 stayed open on a healthy environment forever.
  const { fetchImpl } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [{ number: 7, title: TITLE, state: "open" }] },
    { method: "POST", path: "/comments", body: {} },
    { method: "PATCH", path: "/issues/7", status: 502, body: {} },
  ]);
  const out = await resolveAlert({ ...args(fetchImpl), buildRecoveryBody: () => "recovered" });
  assert.equal(out.action, "failed");
  assert.deepEqual(out.closed, []);
});

test("a failed lookup on the close path is failed, never none", async () => {
  // "none" would tell the caller nothing was open; the alert may well be open.
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", status: 502, body: {} },
  ]);
  const out = await resolveAlert({ ...args(fetchImpl), buildRecoveryBody: () => "recovered" });
  assert.deepEqual(out, { action: "failed", closed: [] });
  assert.equal(calls.filter((c) => c.method !== "GET").length, 0);
});

test("a close that leaves one duplicate open is failed, listing what did close", async () => {
  const { fetchImpl } = makeFetchMock([
    {
      method: "GET",
      path: "/issues?state=all",
      body: [
        { number: 7, title: TITLE, state: "open" },
        { number: 8, title: TITLE, state: "open" },
      ],
    },
    { method: "POST", path: "/comments", body: {} },
    { method: "PATCH", path: "/issues/8", status: 502, body: {} },
    { method: "PATCH", path: "/issues/7", body: {} },
  ]);
  const out = await resolveAlert({ ...args(fetchImpl), buildRecoveryBody: () => "recovered" });
  assert.deepEqual(out, { action: "failed", closed: [7] });
});

test("resolveAlert is a no-op when nothing is open", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [{ number: 7, title: TITLE, state: "closed" }] },
  ]);
  const out = await resolveAlert({ ...args(fetchImpl), buildRecoveryBody: () => "recovered" });
  assert.equal(out.action, "none");
  assert.equal(calls.filter((c) => c.method === "PATCH").length, 0);
});
