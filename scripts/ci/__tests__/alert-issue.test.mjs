import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_LOOKUP_LABEL,
  findAlertIssues,
  raiseAlert,
  resolveAlert,
} from "../lib/alert-issue.mjs";

import { makeFetchMock } from "./helpers.mjs";

// Direct coverage for the shared alert mechanism. Before this file existed, the
// lib was exercised only through deploy-alert.mjs's wrappers — so the second
// consumer (staging-conformance.mjs), which is the whole reason for the
// extraction, relied on behaviour nothing tested at this level.

const TITLE = "Test alert";
const LABELS = [DEFAULT_LOOKUP_LABEL, "area:ci", "P1"];
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
  assert.ok(created.labels.includes(DEFAULT_LOOKUP_LABEL));
});

test("raiseAlert comments instead of filing a second issue when one is open", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [{ number: 7, title: TITLE, state: "open" }] },
    { method: "POST", path: "/comments", body: {} },
  ]);
  const out = await raiseAlert({ ...args(fetchImpl), labels: LABELS, ...builders });
  assert.equal(out.action, "commented");
  assert.equal(calls.filter((c) => c.url.endsWith("/issues")).length, 0);
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
  assert.deepEqual(JSON.parse(patch.body), { body: "issue body" });
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

test("resolveAlert is a no-op when nothing is open", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [{ number: 7, title: TITLE, state: "closed" }] },
  ]);
  const out = await resolveAlert({ ...args(fetchImpl), buildRecoveryBody: () => "recovered" });
  assert.equal(out.action, "none");
  assert.equal(calls.filter((c) => c.method === "PATCH").length, 0);
});
