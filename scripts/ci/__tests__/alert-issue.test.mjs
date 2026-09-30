import { mock, test } from "node:test";
import assert from "node:assert/strict";

import {
  ALERT_ASSIGNEE,
  ALERT_LOOKUP_LABEL,
  defineAlert,
  findAlertIssues,
  findAlertIssuesDetailed,
  isDefinedAlert,
  raiseAlert,
  resolveAlert,
  selectAlertConfig,
  withAgentNote,
} from "../lib/alert-issue.mjs";

import { makeFetchMock } from "./helpers.mjs";

// Direct coverage for the shared alert mechanism. Before this file existed, the
// lib was exercised only through deploy-alert.mjs's wrappers — so the second
// consumer (staging-conformance.mjs), which is the whole reason for the
// extraction, relied on behaviour nothing tested at this level.

const TITLE = "Test alert";
const ALERT = defineAlert({ title: TITLE, labels: ["area:ci", "P1"] });
const args = (fetchImpl) => ({ token: "t", repo: "o/r", fetchImpl, alert: ALERT });

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

test("a created alert carries the label its own lookup filters on, and its title", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [] },
    { method: "POST", path: "/issues", body: { number: 7 } },
  ]);
  // The caller never names the lookup label: defineAlert puts it first.
  // Without it the issue is invisible to findAlertIssues: a fresh duplicate
  // every run, and never closed on recovery.
  const out = await raiseAlert({ ...args(fetchImpl), ...builders });
  assert.equal(out.action, "created");
  const created = JSON.parse(calls.find((c) => c.method === "POST").body);
  assert.equal(created.title, TITLE);
  assert.deepEqual(created.labels, [ALERT_LOOKUP_LABEL, "area:ci", "P1"]);
});

// ── defineAlert and the identity it makes ───────────────────────────────────

test("defineAlert forces the lookup label in first, once, and freezes the result", () => {
  assert.deepEqual(defineAlert({ title: "T" }).labels, [ALERT_LOOKUP_LABEL]);
  // A caller that names it anyway gets it once, still first.
  const alert = defineAlert({ title: "T", labels: ["P1", ALERT_LOOKUP_LABEL] });
  assert.deepEqual(alert.labels, [ALERT_LOOKUP_LABEL, "P1"]);
  assert.ok(Object.isFrozen(alert) && Object.isFrozen(alert.labels));
  assert.ok(isDefinedAlert(alert));
});

test("defineAlert refuses a title the exact-match lookup could never find again", () => {
  // GitHub trims the titles it stores, so a padded one would file an issue
  // whose stored title never equals the lookup key.
  for (const title of [undefined, "", " padded", "padded ", 42]) {
    assert.throws(() => defineAlert({ title }), TypeError, JSON.stringify(title));
  }
  for (const labels of ["P1", [""], [7]]) {
    assert.throws(() => defineAlert({ title: "T", labels }), TypeError, JSON.stringify(labels));
  }
});

test("the lib refuses an identity defineAlert did not make", async () => {
  // A hand-built copy, even one with the right title and labels, is exactly
  // the second shape #1731 was filed to prevent. So is the old loose-title call.
  const handBuilt = { title: TITLE, labels: [ALERT_LOOKUP_LABEL, "area:ci", "P1"] };
  const { fetchImpl, calls } = makeFetchMock([{ method: "GET", path: "/issues?state=all", body: [] }]);
  const base = { token: "t", repo: "o/r", fetchImpl };
  for (const identity of [{ alert: handBuilt }, { title: TITLE }, { alert: Object.freeze({ ...ALERT }) }]) {
    await assert.rejects(findAlertIssues({ ...base, ...identity }), TypeError);
    await assert.rejects(raiseAlert({ ...base, ...identity, ...builders }), TypeError);
    await assert.rejects(
      resolveAlert({ ...base, ...identity, buildRecoveryBody: () => "recovered" }),
      TypeError,
    );
  }
  assert.equal(calls.length, 0, "a refused identity must not reach GitHub");
});

test("selectAlertConfig returns the named config and is loud about anything else", () => {
  const table = { one: { name: "one", alert: ALERT } };
  assert.equal(selectAlertConfig(table, "one", "WHICH"), table.one);
  // Missing, unknown and inherited names all throw, naming the variable and
  // the known configurations. There is no default.
  for (const name of [undefined, null, "", "two", "toString", "constructor"]) {
    assert.throws(() => selectAlertConfig(table, name, "WHICH"), /WHICH .*Known configurations: one\./, String(name));
  }
  // An entry whose identity is hand-built is refused too.
  const loose = { bad: { name: "bad", alert: { title: TITLE, labels: [ALERT_LOOKUP_LABEL] } } };
  assert.throws(() => selectAlertConfig(loose, "bad", "WHICH"), TypeError);
});

test("raiseAlert comments instead of filing a second issue when one is open", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [{ number: 7, title: TITLE, state: "open" }] },
    { method: "POST", path: "/comments", body: {} },
  ]);
  const out = await raiseAlert({ ...args(fetchImpl), ...builders });
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
  await raiseAlert({ ...args(fetchImpl), ...builders });
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
    out = await raiseAlert({ ...args(routed), ...builders });
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
      await raiseAlert({ ...args(fetchImpl), ...builders });
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
  const out = await raiseAlert({ ...args(fetchImpl), ...builders });
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
  const out = await raiseAlert({ ...args(fetchImpl), ...builders });
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
    out = await raiseAlert({ ...args(routed), ...builders });
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
  const out = await raiseAlert({ ...args(fetchImpl), ...builders });
  assert.equal(out.action, "failed");
  assert.equal(out.issueNumber, 7);
});

test("a successful reopen reports reopened and uses the reopened comment body", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [{ number: 7, title: TITLE, state: "closed" }] },
    { method: "PATCH", path: "/issues/7", body: {} },
    { method: "POST", path: "/comments", body: {} },
  ]);
  const out = await raiseAlert({ ...args(fetchImpl), ...builders });
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
  await raiseAlert({ ...args(off.fetchImpl), ...builders });
  assert.equal(off.calls.filter((c) => c.method === "PATCH").length, 0);

  const on = makeFetchMock(routes);
  await raiseAlert({
    ...args(on.fetchImpl),
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
  await raiseAlert({ ...args(fetchImpl), ...builders });
  const { body } = JSON.parse(calls.find((c) => c.method === "POST").body);
  assert.ok(body.startsWith("issue body\n\n---\n"), "the watchdog's own body comes first");
  const link = "https://github.com/o/r/blob/main/docs/ops/alert-routing.md#escalation";
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

test("resolveAlert reports a failed lookup as unread, apart from a failed close (#2627)", async () => {
  // "I could not look" is neither "nothing is open" (none) nor "a close left
  // one open" (failed); each caller keeps its own policy for it.
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ method: init.method ?? "GET", url });
    return { ok: false, status: 502, text: async () => "{}" };
  };
  const out = await resolveAlert({ ...args(fetchImpl), buildRecoveryBody: () => "recovered" });
  assert.deepEqual(out, { action: "unread", closed: [] });
  assert.equal(calls.length, 1, "one lookup, and nothing written");
});

// ── A caller's own lookup (#2333) ───────────────────────────────────────────
// A watchdog that reads its alert to decide what to do hands that read on,
// rather than letting raiseAlert/resolveAlert read the same pages again.

const lookupGets = (calls) => calls.filter((c) => c.method === "GET").length;

test("raiseAlert reuses the caller's successful lookup instead of reading again", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [{ number: 7, title: TITLE, state: "closed" }] },
    { method: "PATCH", path: "/issues/7", body: { number: 7, assignees: [{ login: ALERT_ASSIGNEE }] } },
    { method: "POST", path: "/comments", body: {} },
  ]);
  const lookup = await findAlertIssuesDetailed(args(fetchImpl));
  const out = await raiseAlert({ ...args(fetchImpl), ...builders, lookup });
  assert.equal(out.action, "reopened");
  assert.equal(lookupGets(calls), 1, "one lookup for the whole run");
});

test("resolveAlert reuses the caller's successful lookup instead of reading again", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [{ number: 7, title: TITLE, state: "open" }] },
    { method: "POST", path: "/comments", body: {} },
    { method: "PATCH", path: "/issues/7", body: {} },
  ]);
  const lookup = await findAlertIssuesDetailed(args(fetchImpl));
  const out = await resolveAlert({ ...args(fetchImpl), buildRecoveryBody: () => "recovered", lookup });
  assert.deepEqual(out, { action: "closed", closed: [7] });
  assert.equal(lookupGets(calls), 1, "one lookup for the whole run");
});

test("a caller's failed lookup is read again, as a retry, before raising or resolving", async () => {
  for (const act of ["raise", "resolve"]) {
    const { fetchImpl: serve, calls } = makeFetchMock([
      { method: "GET", path: "/issues?state=all", body: [{ number: 7, title: TITLE, state: "open" }] },
      { method: "POST", path: "/comments", body: {} },
      { method: "PATCH", path: "/issues/7", body: {} },
    ]);
    // The caller's own read fails; every later request is served normally.
    let failNextGet = true;
    const fetchImpl = async (url, init = {}) => {
      if (failNextGet && (init.method ?? "GET") === "GET") {
        failNextGet = false;
        calls.push({ method: "GET", url, body: null });
        return { ok: false, status: 502, text: async () => "{}" };
      }
      return serve(url, init);
    };
    const lookup = await findAlertIssuesDetailed(args(fetchImpl));
    assert.equal(lookup.lookupOk, false);
    const out =
      act === "raise"
        ? await raiseAlert({ ...args(fetchImpl), ...builders, lookup })
        : await resolveAlert({ ...args(fetchImpl), buildRecoveryBody: () => "recovered", lookup });
    assert.equal(out.action, act === "raise" ? "commented" : "closed", act);
    assert.equal(lookupGets(calls), 2, `${act}: the failed read, then one fresh read`);
  }
});

test("a lookup read for another alert, or built by hand, is refused", async () => {
  const OTHER = defineAlert({ title: "Other alert" });
  const { fetchImpl } = makeFetchMock([{ method: "GET", path: "/issues?state=all", body: [] }]);
  const foreign = await findAlertIssuesDetailed({ ...args(fetchImpl), alert: OTHER });
  const handBuilt = { issues: [], lookupOk: true };
  for (const lookup of [foreign, handBuilt]) {
    await assert.rejects(raiseAlert({ ...args(fetchImpl), ...builders, lookup }), TypeError);
    await assert.rejects(
      resolveAlert({ ...args(fetchImpl), buildRecoveryBody: () => "recovered", lookup }),
      TypeError,
    );
  }
});
