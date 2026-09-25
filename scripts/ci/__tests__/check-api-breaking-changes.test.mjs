import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  baselinesFor,
  checkShipped,
  parseRegistry,
} from "../../check-api-breaking-changes.mjs";
import { workflowJobs, workflowSteps } from "./helpers/workflow-yaml.mjs";

// The shipped-contract check is the one thing between a PR and every install
// of a store binary (#2619). Each way it could pass having compared nothing is
// a test here, because that failure is a green check.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function build(overrides = {}) {
  return {
    platform: "ios",
    version: "1.0.0",
    build: "12",
    sha: SHA_A,
    recorded: "2026-10-01",
    ...overrides,
  };
}

function registry(builds) {
  return JSON.stringify({ builds });
}

/** checkShipped with every dependency stubbed and its output captured. */
function run(builds, overrides = {}) {
  const out = [];
  const calls = [];
  const dir = mkdtempSync(path.join(tmpdir(), "api-breaking-test-"));
  const code = checkShipped({
    registryText: typeof builds === "string" ? builds : registry(builds),
    registryLabel: "shipped-builds.json",
    headPath: "/head/openapi.json",
    oasdiffBin: "/bin/oasdiff",
    ignorePath: "/ignore.txt",
    exists: () => true,
    specAt: () => "{}",
    oasdiff: (args) => {
      calls.push(args);
      return { status: "clean", output: "" };
    },
    workDir: () => dir,
    log: (line) => out.push(line),
    error: (line) => out.push(line),
    ...overrides,
  });
  return { code, out: out.join("\n"), calls, dir };
}

// ── The registry ────────────────────────────────────────────────────────────

test("the committed registry parses", () => {
  const text = readFileSync(path.join(ROOT, "apps/mobile/store/shipped-builds.json"), "utf8");
  assert.doesNotThrow(() => parseRegistry(text));
});

test("an empty registry is valid", () => {
  assert.deepEqual(parseRegistry('{ "builds": [] }'), { builds: [] });
});

test("a registry that isn't the expected shape is refused, not read as empty", () => {
  assert.throws(() => parseRegistry("not json"), /not valid JSON/);
  assert.throws(() => parseRegistry("[]"), /top level/);
  assert.throws(() => parseRegistry("{}"), /`builds` must be an array/);
  assert.throws(() => parseRegistry('{ "build": [] }'), /`builds` must be an array/);
});

test("an entry with a typo'd key is refused", () => {
  const { sha, ...rest } = build();
  assert.throws(() => parseRegistry(registry([{ ...rest, commit: sha }])), /unknown key `commit`[\s\S]*\.sha/);
});

test("each field is validated", () => {
  assert.throws(() => parseRegistry(registry([build({ platform: "web" })])), /platform/);
  assert.throws(() => parseRegistry(registry([build({ version: "v1.0.0" })])), /version/);
  assert.throws(() => parseRegistry(registry([build({ build: 12 })])), /build must be/);
  assert.throws(() => parseRegistry(registry([build({ sha: "abc1234" })])), /40-character/);
  assert.throws(() => parseRegistry(registry([build({ sha: SHA_A.toUpperCase() })])), /40-character/);
  assert.throws(() => parseRegistry(registry([build({ recorded: "Oct 1" })])), /recorded/);
  assert.throws(() => parseRegistry(registry([build({ note: 3 })])), /note/);
  assert.doesNotThrow(() => parseRegistry(registry([build({ note: "TestFlight" })])));
});

test("the same build listed twice is refused", () => {
  assert.throws(() => parseRegistry(registry([build(), build({ sha: SHA_B })])), /repeats ios\/1\.0\.0\+12/);
});

test("builds made from one SHA share one comparison", () => {
  const baselines = baselinesFor([
    build(),
    build({ platform: "android" }),
    build({ build: "13", sha: SHA_B }),
  ]);
  assert.deepEqual(baselines, [
    { sha: SHA_A, labels: ["ios/1.0.0+12", "android/1.0.0+12"] },
    { sha: SHA_B, labels: ["ios/1.0.0+13"] },
  ]);
});

// ── The check ───────────────────────────────────────────────────────────────

test("with nothing shipped it passes, says so, and needs no oasdiff", () => {
  const { code, out, calls } = run([], { exists: () => false });
  assert.equal(code, 0);
  assert.match(out, /compared against nothing/);
  assert.equal(calls.length, 0);
});

test("an invalid registry fails the check", () => {
  const { code, out } = run('{ "builds": {} }');
  assert.equal(code, 2);
  assert.match(out, /::error::shipped-builds\.json is invalid/);
});

test("a missing oasdiff fails once a build is listed", () => {
  const { code, out, calls } = run([build()], { exists: (p) => p !== "/bin/oasdiff" });
  assert.equal(code, 2);
  assert.match(out, /::error::oasdiff is not installed/);
  assert.equal(calls.length, 0);
});

test("a SHA whose contract can't be read fails instead of being skipped", () => {
  const { code, out, calls, dir } = run([build(), build({ build: "13", sha: SHA_B })], {
    specAt: (sha) => (sha === SHA_A ? null : "{}"),
  });
  assert.equal(code, 2);
  assert.match(out, new RegExp(`::error::Cannot read apps/api/openapi\\.json at ${SHA_A}`));
  // The readable one is still compared.
  assert.deepEqual(
    calls.map((c) => c.basePath),
    [path.join(dir, `${SHA_B}.json`)],
  );
});

test("a breaking change against a shipped build blocks and names the build", () => {
  const { code, out } = run([build(), build({ platform: "android" })], {
    oasdiff: () => ({ status: "breaking", output: "in API GET /v1/x\n\t\tapi path removed" }),
  });
  assert.equal(code, 1);
  assert.match(out, new RegExp(`::error::Breaking API change\\(s\\) against shipped mobile build\\(s\\) ios/1\\.0\\.0\\+12, android/1\\.0\\.0\\+12 \\(built from ${SHA_A}\\)`));
  assert.match(out, /api path removed/);
});

test("oasdiff failing to run fails the check", () => {
  const { code, out } = run([build()], {
    oasdiff: () => ({ status: "error", output: "exit status: 102" }),
  });
  assert.equal(code, 2);
  assert.match(out, /::error::oasdiff failed to run/);
});

test("a run that could not finish reports 2 even when another SHA broke", () => {
  const { code } = run([build(), build({ build: "13", sha: SHA_B })], {
    specAt: (sha) => (sha === SHA_A ? null : "{}"),
    oasdiff: () => ({ status: "breaking", output: "x" }),
  });
  assert.equal(code, 2);
});

test("compatible with every shipped build passes", () => {
  const { code, out, calls } = run([build(), build({ build: "13", sha: SHA_B })]);
  assert.equal(code, 0);
  assert.match(out, /Compatible with ios\/1\.0\.0\+12/);
  assert.match(out, /Compatible with ios\/1\.0\.0\+13/);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.headPath === "/head/openapi.json" && c.bin === "/bin/oasdiff"));
});

test("the ignore file is passed to oasdiff only when it exists", () => {
  const withFile = run([build()]);
  assert.equal(withFile.calls[0].ignorePath, "/ignore.txt");
  const without = run([build()], { exists: (p) => p !== "/ignore.txt" });
  assert.equal(without.calls[0].ignorePath, undefined);
});

// ── The CI wiring ───────────────────────────────────────────────────────────
//
// The check blocks only if its step can fail the required job. A
// `continue-on-error`, an `if:` that skips it on some event, or the job
// dropping out of the required roster each make it advisory again.

test("ci.yml runs the shipped check as a blocking step of the required contract job", () => {
  const ciPath = path.join(ROOT, ".github/workflows/ci.yml");
  const steps = workflowSteps(ciPath).filter((s) => /check:api-breaking:shipped/.test(s.body));
  assert.equal(steps.length, 1, "exactly one step runs check:api-breaking:shipped");
  const [step] = steps;
  assert.equal(step.jobId, "api-contract-check");
  assert.equal(step.if, null, "the step runs on every event");
  assert.doesNotMatch(step.body, /continue-on-error/);

  const job = workflowJobs(ciPath).find((j) => j.jobId === "api-contract-check");
  assert.equal(job.if, null);
  assert.doesNotMatch(String(job.keys.get("continue-on-error") ?? ""), /true/);
});

test("the contract job stays a required check", async () => {
  const { CI_CHECKS } = await import("../lib/required-checks.mjs");
  assert.ok(CI_CHECKS.includes("api-contract-check"));
});

test("the npm script points at the committed registry", () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.match(
    pkg.scripts["check:api-breaking:shipped"],
    /--shipped apps\/mobile\/store\/shipped-builds\.json$/,
  );
});
