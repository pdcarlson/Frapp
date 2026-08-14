import { test } from "node:test";
import assert from "node:assert/strict";

// check-npm-audit.mjs is a general-purpose script under scripts/ (a peer of
// check-*.mjs); its test lives here so the existing `test:ci-scripts` glob
// (scripts/ci/__tests__/*.test.mjs) runs it — hence the ../../ reach.
import {
  collectAdvisories,
  evaluateAudit,
  validateAllowlist,
  GATE_SEVERITIES,
} from "../../check-npm-audit.mjs";

const TODAY = "2026-08-14";

function advisory(ghsa, severity, pkg = "some-pkg") {
  return {
    ghsa,
    severity,
    package: pkg,
    title: `${pkg} advisory`,
    url: `https://github.com/advisories/${ghsa}`,
  };
}

function entry(ghsa, overrides = {}) {
  return {
    ghsa,
    reason: "accepted: build-time only, fix needs tracked major upgrade",
    trackedBy: "#289",
    expires: "2099-01-01",
    ...overrides,
  };
}

// ── collectAdvisories: npm audit v2 parsing ─────────────────────────────────

test("collects advisory objects and ignores chain-pointer strings", () => {
  const audit = {
    vulnerabilities: {
      expo: { via: ["@expo/cli"], severity: "high" },
      "image-size": {
        via: [
          {
            source: 1,
            name: "image-size",
            title: "ICNS DoS",
            url: "https://github.com/advisories/GHSA-w3rx-r6r6-pgpr",
            severity: "high",
          },
        ],
      },
    },
  };
  const advisories = collectAdvisories(audit);
  assert.equal(advisories.length, 1);
  assert.equal(advisories[0].ghsa, "GHSA-w3rx-r6r6-pgpr");
  assert.equal(advisories[0].severity, "high");
});

test("dedupes an advisory surfacing under several packages", () => {
  const via = {
    source: 1,
    name: "tar",
    title: "tar DoS",
    url: "https://github.com/advisories/GHSA-23hp-3jrh-7fpw",
    severity: "critical",
  };
  const audit = {
    vulnerabilities: {
      tar: { via: [via] },
      "@infisical/cli": { via: [via] },
    },
  };
  assert.equal(collectAdvisories(audit).length, 1);
});

test("throws on output with no vulnerabilities object (fail closed)", () => {
  assert.throws(() => collectAdvisories({}));
  assert.throws(() => collectAdvisories(null));
});

// ── validateAllowlist: a malformed list can never pass as empty ─────────────

test("accepts a well-formed allowlist", () => {
  assert.deepEqual(validateAllowlist([entry("GHSA-w3rx-r6r6-pgpr")]), []);
});

test("rejects entries missing ghsa, reason, trackedBy, or expires", () => {
  assert.ok(validateAllowlist([entry("not-a-ghsa")]).length > 0);
  assert.ok(validateAllowlist([entry("GHSA-w3rx-r6r6-pgpr", { reason: "" })]).length > 0);
  assert.ok(validateAllowlist([entry("GHSA-w3rx-r6r6-pgpr", { trackedBy: "someday" })]).length > 0);
  assert.ok(validateAllowlist([entry("GHSA-w3rx-r6r6-pgpr", { expires: "soon" })]).length > 0);
});

test("rejects duplicate ghsa entries and non-array shapes", () => {
  const dup = entry("GHSA-w3rx-r6r6-pgpr");
  assert.ok(validateAllowlist([dup, { ...dup }]).length > 0);
  assert.ok(validateAllowlist("nope").length > 0);
});

// ── evaluateAudit: the gate decision ────────────────────────────────────────

test("gates exactly high and critical", () => {
  assert.deepEqual([...GATE_SEVERITIES].sort(), ["critical", "high"]);
});

test("empty allowlist fails on every high/critical (cannot swallow new criticals)", () => {
  const outcome = evaluateAudit({
    advisories: [advisory("GHSA-aaaa-bbbb-cccc", "critical"), advisory("GHSA-dddd-eeee-ffff", "high")],
    entries: [],
    today: TODAY,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.failures.length, 2);
});

test("moderate and low advisories never fail the gate", () => {
  const outcome = evaluateAudit({
    advisories: [advisory("GHSA-aaaa-bbbb-cccc", "moderate"), advisory("GHSA-dddd-eeee-ffff", "low")],
    entries: [],
    today: TODAY,
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.failures.length, 0);
});

test("a live allowlist entry admits its advisory and only its advisory", () => {
  const outcome = evaluateAudit({
    advisories: [advisory("GHSA-aaaa-bbbb-cccc", "high"), advisory("GHSA-dddd-eeee-ffff", "high")],
    entries: [entry("GHSA-aaaa-bbbb-cccc")],
    today: TODAY,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.allowlisted.length, 1);
  assert.equal(outcome.failures.length, 1);
  assert.equal(outcome.failures[0].ghsa, "GHSA-dddd-eeee-ffff");
});

test("an expired entry with a live advisory fails the gate", () => {
  const outcome = evaluateAudit({
    advisories: [advisory("GHSA-aaaa-bbbb-cccc", "high")],
    entries: [entry("GHSA-aaaa-bbbb-cccc", { expires: "2026-08-13" })],
    today: TODAY,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.expiredInUse.length, 1);
  assert.equal(outcome.failures.length, 0);
});

test("an entry expiring today is still live (expiry is exclusive)", () => {
  const outcome = evaluateAudit({
    advisories: [advisory("GHSA-aaaa-bbbb-cccc", "high")],
    entries: [entry("GHSA-aaaa-bbbb-cccc", { expires: TODAY })],
    today: TODAY,
  });
  assert.equal(outcome.ok, true);
});

test("entries with no matching gated advisory are stale but do not fail", () => {
  const outcome = evaluateAudit({
    advisories: [advisory("GHSA-aaaa-bbbb-cccc", "moderate")],
    entries: [entry("GHSA-aaaa-bbbb-cccc")],
    today: TODAY,
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.staleEntries.length, 1);
});
