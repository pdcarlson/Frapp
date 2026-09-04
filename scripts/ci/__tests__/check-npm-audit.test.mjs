import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// check-npm-audit.mjs is a general-purpose script under scripts/ (a peer of
// check-*.mjs); its test lives here so the existing `test:ci-scripts` glob
// (scripts/ci/__tests__/*.test.mjs) runs it — hence the ../../ reach.
import {
  AUDIT_ARGS,
  AUDIT_ATTEMPTS,
  AUDIT_BACKOFF_MS,
  AUDIT_TIMEOUT_MS,
  exitCodeFor,
  noVerdictHint,
  throwIfSpawnFailed,
  AuditUnavailableError,
  collectAdvisories,
  describeNpmFailure,
  NPM_FETCH_TIMEOUT_MS,
  redactUrlCredentials,
  SOFT_FETCH_TIMEOUT_MS,
  evaluateAudit,
  normalizeGhsa,
  parseAllowlistSource,
  parseAuditOutput,
  runAuditWithRetry,
  validateAllowlist,
} from "../../check-npm-audit.mjs";

const TODAY = "2026-08-14";

function advisory(ghsa, severity, pkg = "some-pkg") {
  return {
    ghsa: normalizeGhsa(ghsa),
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

test("throws on a gated-severity advisory with no parseable GHSA url (fail closed)", () => {
  // A critical advisory the gate cannot key by GHSA id must fail the run,
  // never silently skip — a skip would let it ship ungated.
  for (const badUrl of [undefined, null, "", "https://example.com/advisory/123", "https://github.com/advisories/GHSA-w3rx-r6r6-pgpr/"]) {
    assert.throws(
      () => collectAdvisories({ vulnerabilities: { evil: { via: [{ source: 9, name: "evil", severity: "critical", url: badUrl }] } } }),
      /refusing to pass what cannot be gated/,
      `url ${JSON.stringify(badUrl)} should fail closed`,
    );
  }
});

test("non-gated advisories without a GHSA url are skipped, not fatal", () => {
  const audit = {
    vulnerabilities: {
      meh: { via: [{ source: 9, name: "meh", severity: "moderate", url: null }] },
    },
  };
  assert.deepEqual(collectAdvisories(audit), []);
});

test("throws on output with no vulnerabilities object (fail closed)", () => {
  assert.throws(() => collectAdvisories({}));
  assert.throws(() => collectAdvisories(null));
});

// ── normalizeGhsa: one id form on both sides ────────────────────────────────

test("normalizeGhsa canonicalizes case (upper prefix, lower groups)", () => {
  assert.equal(normalizeGhsa("GHSA-W3RX-R6R6-PGPR"), "GHSA-w3rx-r6r6-pgpr");
  assert.equal(normalizeGhsa("ghsa-w3rx-r6r6-pgpr"), "GHSA-w3rx-r6r6-pgpr");
  assert.equal(normalizeGhsa("GHSA-w3rx-r6r6-pgpr"), "GHSA-w3rx-r6r6-pgpr");
});

// ── validateAllowlist: a malformed list can never pass as empty ─────────────

test("accepts a well-formed allowlist (optional fields included)", () => {
  assert.deepEqual(
    validateAllowlist([entry("GHSA-w3rx-r6r6-pgpr", { package: "image-size", severity: "high" })]),
    [],
  );
});

test("rejects entries missing ghsa, reason, trackedBy, or expires", () => {
  assert.ok(validateAllowlist([entry("not-a-ghsa")]).length > 0);
  assert.ok(validateAllowlist([entry("GHSA-w3rx-r6r6-pgpr", { reason: "" })]).length > 0);
  assert.ok(validateAllowlist([entry("GHSA-w3rx-r6r6-pgpr", { trackedBy: "someday" })]).length > 0);
  assert.ok(validateAllowlist([entry("GHSA-w3rx-r6r6-pgpr", { expires: "soon" })]).length > 0);
});

test("rejects rollover dates like 2026-02-30 that Date.parse would accept", () => {
  assert.ok(validateAllowlist([entry("GHSA-w3rx-r6r6-pgpr", { expires: "2026-02-30" })]).length > 0);
  assert.ok(validateAllowlist([entry("GHSA-w3rx-r6r6-pgpr", { expires: "2026-13-01" })]).length > 0);
  assert.deepEqual(validateAllowlist([entry("GHSA-w3rx-r6r6-pgpr", { expires: "2028-02-29" })]), []);
});

test("rejects malformed optional package/severity fields", () => {
  assert.ok(validateAllowlist([entry("GHSA-w3rx-r6r6-pgpr", { package: " " })]).length > 0);
  assert.ok(validateAllowlist([entry("GHSA-w3rx-r6r6-pgpr", { severity: "severe" })]).length > 0);
});

test("rejects duplicate ghsa entries (case-insensitively) and non-array shapes", () => {
  const dup = entry("GHSA-w3rx-r6r6-pgpr");
  assert.ok(validateAllowlist([dup, { ...dup }]).length > 0);
  assert.ok(validateAllowlist([dup, entry("GHSA-W3RX-R6R6-PGPR")]).length > 0);
  assert.ok(validateAllowlist("nope").length > 0);
  assert.ok(validateAllowlist(undefined).length > 0);
});

// ── evaluateAudit: the gate decision ────────────────────────────────────────

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

test("a case-variant allowlist entry still matches its advisory", () => {
  const outcome = evaluateAudit({
    advisories: [advisory("GHSA-aaaa-bbbb-cccc", "high")],
    entries: [entry("GHSA-AAAA-BBBB-CCCC")],
    today: TODAY,
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.allowlisted.length, 1);
  assert.equal(outcome.staleEntries.length, 0);
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

// ── parseAuditOutput / parseAllowlistSource: the fail-closed IO layer ───────

test("parseAuditOutput throws on non-JSON stdout (fail closed)", () => {
  assert.throws(
    () => parseAuditOutput({ stdout: "npm ERR! network", status: 1, stderr: "ECONNREFUSED" }),
    /did not produce JSON/,
  );
});

test("parseAuditOutput throws on an npm error payload", () => {
  assert.throws(
    () => parseAuditOutput({ stdout: JSON.stringify({ error: { summary: "registry unreachable" } }), status: 1, stderr: "" }),
    /registry unreachable/,
  );
});

test("parseAuditOutput returns the parsed report on success", () => {
  const report = { vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } };
  assert.deepEqual(parseAuditOutput({ stdout: JSON.stringify(report), status: 0, stderr: "" }), report);
});

test("the npm exit status is never consulted, in either direction", () => {
  // npm exits 1 for BOTH "vulnerabilities found" and "registry unreachable",
  // so any status fast-path classifies every dead-registry payload as a
  // finding — reinstating the #1638 conflation. Pin that status is ignored.
  const report = { vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } };
  for (const status of [0, 1, null]) {
    assert.deepEqual(parseAuditOutput({ stdout: JSON.stringify(report), status, stderr: "" }), report);
    assert.throws(
      () => parseAuditOutput({ stdout: JSON.stringify(NPM_ECONNREFUSED), status, stderr: "" }),
      AuditUnavailableError,
    );
  }
});

test("a permanent npm error is not retried, however transport-shaped", () => {
  // A missing lockfile or a 401 against a private registry is deterministic:
  // retrying spends the whole schedule to reprint it, and "re-run it" is the
  // wrong instruction to give.
  const noLock = caught(() =>
    parseAuditOutput({
      stdout: JSON.stringify({ error: { code: "ENOLOCK", summary: "This command requires an existing lockfile." } }),
      status: 1,
      stderr: "",
    }),
  );
  assert.ok(noLock instanceof AuditUnavailableError);
  assert.equal(noLock.retriable, false);
  assert.match(noLock.message, /existing lockfile/);
});

test("credentials in a registry URL never reach the log", () => {
  // npm echoes the registry URL verbatim. The old code printed only
  // `error.summary`, which has no URL — reading `message` opened a new egress
  // path, live for any dev whose .npmrc holds basic auth in the URL.
  const leaked = {
    message: "request to http://ciuser:s3cr3t-token@artifactory.corp/-/npm/v1/security/audits/quick failed",
    error: { summary: "", detail: "" },
  };
  const described = describeNpmFailure(leaked);
  assert.doesNotMatch(described, /s3cr3t-token/);
  assert.doesNotMatch(described, /ciuser/);
  assert.match(described, /<redacted>@artifactory\.corp/);
  // The host and the failure itself must survive — redaction that erases the
  // diagnostic recreates the blank message this whole change is about.
  assert.match(described, /artifactory\.corp/);
  assert.equal(redactUrlCredentials("no url here"), "no url here");
  assert.equal(redactUrlCredentials("https://registry.npmjs.org/x"), "https://registry.npmjs.org/x");
});

test("parseAllowlistSource throws on invalid JSON and surfaces missing entries to validation", () => {
  assert.throws(() => parseAllowlistSource("{not json"), /not valid JSON/);
  // A file without `entries` parses to undefined, which validateAllowlist
  // must reject — a typo'd top-level key can never act as an empty list.
  const entries = parseAllowlistSource(JSON.stringify({ entires: [] }));
  assert.equal(entries, undefined);
  assert.ok(validateAllowlist(entries).length > 0);
});

// ── Transport failures vs verdicts (issue #1638) ────────────────────────────
//
// npm reports an unreachable registry in its stdout payload and exits **1** —
// the same code it uses for a successful audit that found vulnerabilities, so
// `status` cannot separate the two and is deliberately never consulted. This
// payload was captured verbatim by pointing npm at a dead port; it is the
// shape that blocked two merges with a blank message.
/** node:assert's `throws` returns undefined, so grab the error to inspect it. */
function caught(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new assert.AssertionError({ message: "expected the call to throw, and it did not" });
}

const NPM_ECONNREFUSED = {
  message: "request to http://127.0.0.1:9/-/npm/v1/security/audits/quick failed, reason: connect ECONNREFUSED 127.0.0.1:9",
  error: { summary: "", detail: "" },
};

test("describeNpmFailure surfaces npm's reason when `summary` is the empty string", () => {
  // The regression: `summary ?? fallback` kept "" (falsy, not nullish) and
  // printed nothing. And `JSON.stringify(error)` — the fallback `||` would
  // have reached — is `{"summary":"","detail":""}`, no better. Only the
  // top-level `message` ever carries the cause.
  const described = describeNpmFailure(NPM_ECONNREFUSED);
  assert.match(described, /ECONNREFUSED/);
  assert.doesNotMatch(described, /^\s*$/);
});

test("describeNpmFailure prefers summary, then the top-level message, then detail", () => {
  assert.equal(describeNpmFailure({ message: "outer", error: { summary: "real summary" } }), "real summary");
  // message BEFORE detail, and this is the case that pins the order: npm's
  // real payloads carry the cause in `message` while `detail` is boilerplate,
  // so a tidy-up to [summary, detail, message] prints the less useful field.
  assert.equal(
    describeNpmFailure({ message: "connect ECONNREFUSED", error: { summary: "", detail: "See above." } }),
    "connect ECONNREFUSED",
  );
  assert.equal(describeNpmFailure({ error: { summary: "   ", detail: "the detail" } }), "the detail");
  assert.equal(describeNpmFailure({ error: { summary: "", detail: "" } }), '{"summary":"","detail":""}');
});

test("parseAuditOutput reports a transport failure as retriable, and never blank", () => {
  const error = caught(() => parseAuditOutput({ stdout: JSON.stringify(NPM_ECONNREFUSED), status: 1, stderr: "" }));
  assert.ok(error instanceof AuditUnavailableError);
  assert.equal(error.retriable, true);
  assert.match(error.message, /ECONNREFUSED/);
});

test("parseAuditOutput treats non-JSON stdout as a retriable transport failure", () => {
  const error = caught(() => parseAuditOutput({ stdout: "npm ERR! network", status: 1, stderr: "ECONNREFUSED" }));
  assert.ok(error instanceof AuditUnavailableError);
  assert.equal(error.retriable, true);
});

test("an unreadable SHAPE is a no-verdict, and is not retried", () => {
  // npm answered; asking again returns the same answer.
  const shape = caught(() => collectAdvisories({}));
  assert.ok(shape instanceof AuditUnavailableError);
  assert.equal(shape.retriable, false);
});

test("an advisory npm DID report stays a finding, even when its id is unreadable", () => {
  // This must NOT be AuditUnavailableError. Exit 2 prints "this is NOT a
  // report of a vulnerability" over what is, in fact, a live critical — and a
  // maintainer who re-runs, sees identical output and calls it flake can
  // admin-merge past a required gate. It is a plain Error, so it exits 1.
  const unkeyable = caught(() =>
    collectAdvisories({ vulnerabilities: { p: { via: [{ severity: "critical", name: "p", url: "https://example.test/nope" }] } } }),
  );
  assert.ok(unkeyable instanceof Error);
  assert.ok(!(unkeyable instanceof AuditUnavailableError), "an advisory npm reported is not a no-verdict");
  assert.equal(exitCodeFor(unkeyable), 1);
  assert.match(unkeyable.message, /cannot be gated/);
});

test("a non-object payload is a no-verdict, not a crash scored as a finding", () => {
  // JSON.parse returns null for the literal "null"; dereferencing it threw a
  // raw TypeError, which the entry guard scored exit 1 — a crash reported as
  // an advisory finding.
  for (const stdout of ["null", '"a string"', "42"]) {
    const error = caught(() => parseAuditOutput({ stdout, status: 0, stderr: "" }));
    assert.ok(error instanceof AuditUnavailableError, `${stdout} must be a no-verdict`);
    assert.equal(exitCodeFor(error), 2);
  }
});

test("runAuditWithRetry never rejects with undefined", () => {
  // attempts < 1 left lastError unset. The entry guard then dereferenced
  // `.message` inside its own catch: unhandled rejection, no message at all.
  return assert.rejects(
    runAuditWithRetry({ runOnce: () => ({ vulnerabilities: {} }), attempts: 0 }),
    (error) => error instanceof AuditUnavailableError && /no audit attempt/.test(error.message),
  );
});

// ── runAuditWithRetry ───────────────────────────────────────────────────────

function transport(message = "registry down") {
  return new AuditUnavailableError(message, { retriable: true });
}

test("the spawn cap sits above the timeout npm is ACTUALLY given", () => {
  // Comparing AUDIT_TIMEOUT_MS to NPM_FETCH_TIMEOUT_MS is a tautology — the
  // former is defined as the latter plus a margin. The load-bearing question
  // is whether the cap exceeds the budget handed to npm on the command line,
  // which crosses from the constant to the real invocation.
  const flag = AUDIT_ARGS.find((arg) => arg.startsWith("--fetch-timeout="));
  assert.ok(flag, `AUDIT_ARGS must pin npm's fetch budget, got: ${AUDIT_ARGS.join(" ")}`);
  const given = Number(flag.split("=")[1]);
  assert.equal(given, NPM_FETCH_TIMEOUT_MS);
  assert.ok(
    AUDIT_TIMEOUT_MS > given,
    `spawn cap ${AUDIT_TIMEOUT_MS}ms must exceed the ${given}ms budget npm is given, or it kills healthy audits`,
  );
});

test("npm's own retry is disabled, so one attempt is one request", () => {
  // Without this the schedule below is a lie: npm silently turns each attempt
  // into up to three 300s requests, which the spawn cap then kills mid-flight
  // — converting slow-but-healthy runs into red required checks.
  assert.ok(
    AUDIT_ARGS.includes("--fetch-retries=0"),
    `AUDIT_ARGS must delegate retry to this script, got: ${AUDIT_ARGS.join(" ")}`,
  );
});

test("retry is actually enabled — more than one attempt", () => {
  // Every other retry test derives its expectation from AUDIT_ATTEMPTS, so
  // setting it to 1 disables the feature this fix exists for while the suite
  // stays green. Both #1638 failures passed on ONE more ask; pin that.
  assert.ok(AUDIT_ATTEMPTS >= 2, "a single attempt is no retry at all");
});

test("the exit-2 banner only says 're-run it' when re-running could help", () => {
  assert.match(noVerdictHint({ retriable: true }), /re-run it/);
  assert.match(noVerdictHint({ retriable: false }), /reprint this/);
  assert.doesNotMatch(noVerdictHint({ retriable: false }), /re-run it/);
});

test("exitCodeFor splits a no-verdict from a verdict", () => {
  // SECURITY_FIXES.md § Prevention tells operators to read the exit code
  // first: 2 means nothing was established, only 1 is a finding. Flipping
  // this ternary silently falsifies that instruction — which is #1638.
  assert.equal(exitCodeFor(new AuditUnavailableError("registry down", { retriable: true })), 2);
  assert.equal(exitCodeFor(new AuditUnavailableError("bad shape", { retriable: false })), 2);
  assert.equal(exitCodeFor(new Error("2 unallowlisted high advisories")), 1);
});

test("throwIfSpawnFailed names a timeout as a timeout, and never retries a missing npm", () => {
  const killed = caught(() => throwIfSpawnFailed({ signal: "SIGTERM" }, 330_000));
  assert.ok(killed instanceof AuditUnavailableError);
  assert.equal(killed.retriable, true);
  // Falling through to parseAuditOutput instead would report "did not produce
  // JSON (exit null)" — the uninformative message class #1638 was filed about.
  assert.match(killed.message, /did not finish within 330s/);

  const missing = caught(() =>
    throwIfSpawnFailed({ error: Object.assign(new Error("spawn npm ENOENT"), { code: "ENOENT" }) }),
  );
  assert.equal(missing.retriable, false);

  const transient = caught(() =>
    throwIfSpawnFailed({ error: Object.assign(new Error("EAGAIN"), { code: "EAGAIN" }) }),
  );
  assert.equal(transient.retriable, true);

  // A clean result must pass straight through.
  assert.equal(throwIfSpawnFailed({ status: 1, stdout: "{}", stderr: "" }), undefined);
});

test("retries a transport failure and returns the report once npm answers", async () => {
  const slept = [];
  let calls = 0;
  const report = await runAuditWithRetry({
    runOnce: () => {
      calls += 1;
      if (calls < AUDIT_ATTEMPTS) throw transport();
      return { vulnerabilities: {} };
    },
    sleep: (ms) => { slept.push(ms); return Promise.resolve(); },
  });
  assert.deepEqual(report, { vulnerabilities: {} });
  assert.equal(calls, AUDIT_ATTEMPTS);
  // One sleep per gap, and the documented schedule — not a hardcoded copy of it.
  assert.deepEqual(slept, AUDIT_BACKOFF_MS.slice(0, AUDIT_ATTEMPTS - 1));
});

test("fails closed after exhausting attempts, rethrowing the last cause", async () => {
  let calls = 0;
  await assert.rejects(
    runAuditWithRetry({
      runOnce: () => { calls += 1; throw transport(`attempt ${calls} down`); },
      sleep: () => Promise.resolve(),
    }),
    (error) =>
      error instanceof AuditUnavailableError && error.message === `attempt ${AUDIT_ATTEMPTS} down`,
  );
  assert.equal(calls, AUDIT_ATTEMPTS);
});

test("the backoff schedule covers every gap between attempts", () => {
  // A schedule shorter than the gaps silently falls back to a default, which
  // is how a documented cadence drifts from the real one.
  assert.ok(AUDIT_BACKOFF_MS.length >= AUDIT_ATTEMPTS - 1);
});

test("the backoff still covers the window npm's own retries used to", () => {
  // --fetch-retries=0 switches off npm's 2 internal retries, whose
  // fetch-retry-mintimeout is 10s and maxtimeout 60s. If this schedule is
  // shorter than that, the change makes a routine 10-70s registry incident
  // MORE likely to redden an untouched PR — the #1638 symptom, reintroduced
  // by the fix for it.
  const covered = AUDIT_BACKOFF_MS.reduce((total, ms) => total + ms, 0);
  assert.ok(covered >= 70_000, `backoff covers only ${covered}ms of npm's displaced ~70s window`);
});

test("does not retry a non-retriable no-verdict, or any other error", async () => {
  let shapeCalls = 0;
  await assert.rejects(
    runAuditWithRetry({
      runOnce: () => { shapeCalls += 1; throw new AuditUnavailableError("bad shape", { retriable: false }); },
      sleep: () => Promise.resolve(),
    }),
    /bad shape/,
  );
  assert.equal(shapeCalls, 1);

  let bugCalls = 0;
  await assert.rejects(
    runAuditWithRetry({
      runOnce: () => { bugCalls += 1; throw new TypeError("a bug, not a blip"); },
      sleep: () => Promise.resolve(),
    }),
    TypeError,
  );
  assert.equal(bugCalls, 1);
});

test("--soft-network's single attempt neither retries nor sleeps", async () => {
  // The local gate passes attempts: 1 so an offline dev hears the warning at
  // once instead of waiting out a schedule that can only end in that warning.
  let calls = 0;
  let sleeps = 0;
  await assert.rejects(
    runAuditWithRetry({
      runOnce: () => { calls += 1; throw transport(); },
      attempts: 1,
      sleep: () => { sleeps += 1; return Promise.resolve(); },
    }),
    AuditUnavailableError,
  );
  assert.equal(calls, 1);
  assert.equal(sleeps, 0);
});

// ── The gate as a process (issue #1638's actual surface) ────────────────────
//
// Everything above imports the module, which never reaches the entry guard —
// so the exit-code split, the softening wiring and the argv parsing had no
// coverage at all. These drive the real CLI with a stub `npm` on PATH, so
// they are deterministic and need no network.
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const GATE = join(REPO_ROOT, "scripts", "check-npm-audit.mjs");

/**
 * Run the gate with a stub npm that prints `payload` and exits 1 — the code
 * real npm uses for BOTH a successful audit with findings and an unreachable
 * registry, which is why the script must never consult it.
 */
function runGate(payload, args = []) {
  const dir = mkdtempSync(join(tmpdir(), "npm-audit-stub-"));
  const payloadPath = join(dir, "payload.json");
  const argvPath = join(dir, "argv.txt");
  writeFileSync(payloadPath, JSON.stringify(payload));
  // The stub records the argv it was handed, so the flags the gate actually
  // passes npm can be asserted rather than assumed.
  writeFileSync(
    join(dir, "npm"),
    `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(argvPath)}\ncat ${JSON.stringify(payloadPath)}\nexit 1\n`,
  );
  chmodSync(join(dir, "npm"), 0o755);
  const result = spawnSync(process.execPath, [GATE, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
  });
  result.npmArgv = readFileSync(argvPath, "utf8").split("\n").filter(Boolean);
  return result;
}

const CLEAN_REPORT = { vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } };
const UNALLOWLISTED_CRITICAL = {
  vulnerabilities: {
    evil: {
      via: [
        {
          severity: "critical",
          name: "evil",
          title: "evil does evil things",
          url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
        },
      ],
    },
  },
  metadata: { vulnerabilities: { total: 1, critical: 1, high: 0, moderate: 0, low: 0 } },
};

// The stub is a POSIX shell script; the win32 branch shells out to npm.cmd.
const cliTest = process.platform === "win32" ? test.skip : test;

cliTest("a clean report exits 0", () => {
  const result = runGate(CLEAN_REPORT);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /npm audit gate passed/);
});

cliTest("an unallowlisted critical exits 1 — the gate still fails closed", () => {
  const result = runGate(UNALLOWLISTED_CRITICAL);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Unallowlisted HIGH\/CRITICAL/);
  // The remediation block is the tail of the output, and the first thing a
  // process.exit() would truncate on a piped stderr.
  assert.match(result.stderr, /npm audit fix/);
});

// NOTE: no CLI test drives a RETRIABLE transport failure to exhaustion. That
// path sleeps the real AUDIT_BACKOFF_MS — 70s inside a required job — and its
// pieces are covered without it: runAuditWithRetry's schedule above,
// exitCodeFor and noVerdictHint below, and the --soft-network case here, which
// puts the same payload through the same wiring in a single attempt.
cliTest("a permanent npm error exits 2 but does NOT tell the operator to re-run", () => {
  const result = runGate({ error: { code: "ENOLOCK", summary: "This command requires an existing lockfile." } });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /existing lockfile/);
  assert.match(result.stderr, /Re-running will reprint this/);
});

cliTest("--soft-network warns and exits 0 on a transport failure", () => {
  const result = runGate(NPM_ECONNREFUSED, ["--soft-network"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /--soft-network is set/);
  // The blank message from #1638 must never come back.
  assert.match(result.stderr, /ECONNREFUSED/);
});

cliTest("--soft-network still fails closed on a real advisory", () => {
  // The offline path softens a missing REPORT, never a report's verdict.
  const result = runGate(UNALLOWLISTED_CRITICAL, ["--soft-network"]);
  assert.equal(result.status, 1, result.stderr);
});

cliTest("the offline path gives npm a budget measured in seconds, not minutes", () => {
  // --soft-network drops to ONE attempt, but that alone does not make the
  // header's "a dev should hear it in seconds" true: a black-holed network
  // (captive portal, half-dead VPN) never errors, so npm sits on its full
  // budget. Only a shorter --fetch-timeout delivers the promise.
  const soft = runGate(NPM_ECONNREFUSED, ["--soft-network"]);
  assert.ok(
    soft.npmArgv.includes(`--fetch-timeout=${SOFT_FETCH_TIMEOUT_MS}`),
    `offline path must shorten npm's budget, got: ${soft.npmArgv.join(" ")}`,
  );
  assert.ok(SOFT_FETCH_TIMEOUT_MS <= 30_000, "'in seconds' has to mean seconds");

  // CI keeps the full budget: a slow-but-healthy registry must not be cut off.
  const hard = runGate(CLEAN_REPORT);
  assert.ok(
    hard.npmArgv.includes(`--fetch-timeout=${NPM_FETCH_TIMEOUT_MS}`),
    `CI path must keep npm's full budget, got: ${hard.npmArgv.join(" ")}`,
  );
  assert.ok(hard.npmArgv.includes("--fetch-retries=0"));
});
