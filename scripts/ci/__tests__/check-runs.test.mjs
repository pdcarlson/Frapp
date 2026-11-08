// lib/check-runs.mjs: the read both the deploy gate (validate-deploy-sha.mjs) and
// the base-sync update slot (pr-base-sync.mjs, #3599) depend on.

import { test } from "node:test";
import assert from "node:assert/strict";

import { fetchCheckRuns, latestRunsByName } from "../lib/check-runs.mjs";
import { makeFetchMock } from "./helpers.mjs";

const page = (n, count) =>
  Array.from({ length: count }, (_, i) => ({ name: `job-${n}-${i}`, status: "completed" }));

test("follows pagination past a full page of 100, and stops at a short one", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "&page=1", body: { check_runs: page(1, 100) } },
    { method: "GET", path: "&page=2", body: { check_runs: page(2, 7) } },
  ]);
  const runs = await fetchCheckRuns({ repo: "o/r", sha: "abc", token: "t", fetchImpl });
  assert.equal(runs.length, 107, "a required check on page 2 must not read as missing");
  assert.equal(calls.length, 2);
});

test("the newest run of a name wins, by started_at", () => {
  const latest = latestRunsByName([
    { name: "api-tests", conclusion: "success", started_at: "2026-11-06T19:00:00Z" },
    { name: "api-tests", conclusion: "failure", started_at: "2026-11-06T19:10:00Z" },
  ]);
  assert.equal(latest.get("api-tests").conclusion, "failure");
});
