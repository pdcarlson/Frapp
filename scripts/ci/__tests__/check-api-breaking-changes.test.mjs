import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { baselinesFor, checkShipped, registryAtRef, runOasdiff, waiverLines } from "../../check-api-breaking-changes.mjs";
import { compareRegistries, findRepeatedKeys, parseRegistry } from "../lib/shipped-builds-registry.mjs";
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
  assert.deepEqual(parseRegistry('{ "builds": [] }'), { builds: [], dropped: [] });
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

// #3783: a merge that splices two entries into one object is valid JSON, and
// JSON.parse keeps each repeated key's last value, so one build vanished from
// every gate. This is 5df56abc's real shape with its missing comma restored.
test("a key repeated inside one entry is refused, naming the line", () => {
  const spliced = `{
  "builds": [
    {
      "platform": "ios",
      "version": "0.10.0",
      "build": "11",
      "sha": "${SHA_A}",
      "version": "0.10.1",
      "build": "12",
      "sha": "${SHA_B}",
      "recorded": "2026-11-06"
    }
  ]
}
`;
  assert.equal(JSON.parse(spliced).builds.length, 1, "JSON.parse alone accepts it");
  assert.throws(
    () => parseRegistry(spliced),
    (error) =>
      /line 8 repeats the key `version`/.test(error.message) &&
      /line 9 repeats the key `build`/.test(error.message) &&
      /line 10 repeats the key `sha`/.test(error.message),
  );
});

test("findRepeatedKeys reads keys per object, not values or nested objects", () => {
  assert.deepEqual(findRepeatedKeys('{"a":1,"b":{"a":2},"c":"\\"a\\":"}'), []);
  assert.deepEqual(findRepeatedKeys('[{"a":1},{"a":2}]'), []);
  assert.deepEqual(findRepeatedKeys('{"a":1,\n"b":[{"x":1,"x":2}],\n"a":3}'), [
    { key: "x", line: 2 },
    { key: "a", line: 3 },
  ]);
  assert.deepEqual(findRepeatedKeys('{"a\\u0062":1,"ab":2}'), [{ key: "ab", line: 1 }], "keys compare decoded");
});

test("an unknown top-level key is refused", () => {
  assert.throws(() => parseRegistry('{ "builds": [], "retired": [] }'), /top level has an unknown key `retired`/);
});

const dropped = (overrides = {}) =>
  build({ dropped: "2026-12-01", reason: "MOBILE_MIN_VERSION_IOS 1.1.0 live on 2026-11-30", ...overrides });

test("a dropped entry keeps its fields and needs a date and a reason", () => {
  const text = (list) => JSON.stringify({ builds: [], dropped: list });
  assert.deepEqual(parseRegistry(text([dropped()])).dropped, [dropped()]);
  assert.throws(() => parseRegistry(text([dropped({ dropped: undefined })])), /dropped\[0\]\.dropped must be the date/);
  assert.throws(() => parseRegistry(text([dropped({ reason: " " })])), /dropped\[0\]\.reason must say why/);
  assert.throws(() => parseRegistry(text([dropped({ sha: "abc" })])), /dropped\[0\]\.sha/);
  assert.throws(() => parseRegistry(JSON.stringify({ builds: [], dropped: {} })), /`dropped` must be an array/);
  assert.throws(() => parseRegistry(JSON.stringify({ builds: [build()], dropped: [dropped()] })), /dropped\[0\] repeats ios\/1\.0\.0\+12/);
});

// ── Against the base branch's registry (#3783) ──────────────────────────────

const reg = (builds, droppedList = []) => ({ builds, dropped: droppedList });

test("a head that keeps every base entry, and adds, passes", () => {
  assert.deepEqual(compareRegistries(reg([build()]), reg([build({ build: "13" }), build()])), []);
});

test("a base entry missing from the head is reported", () => {
  const [problem] = compareRegistries(reg([build(), build({ build: "13", sha: SHA_B })]), reg([build()]));
  assert.match(problem, /ios\/1\.0\.0\+13 \(bbbbbbbbbbbb\) is in `builds` on the base branch and missing here/);
});

test("a rewritten base entry is reported; an edited note is not", () => {
  const [problem] = compareRegistries(reg([build()]), reg([build({ sha: SHA_B })]));
  assert.match(problem, /ios\/1\.0\.0\+12 differs .*sha: a{40} → b{40}/);
  assert.deepEqual(compareRegistries(reg([build()]), reg([build({ note: "now with a note" })])), []);
});

test("an entry moved to dropped passes; one that leaves dropped is reported", () => {
  assert.deepEqual(compareRegistries(reg([build()]), reg([], [dropped()])), []);
  assert.match(compareRegistries(reg([], [dropped()]), reg([]))[0], /is in `dropped` on the base branch and missing here/);
  assert.match(compareRegistries(reg([], [dropped()]), reg([], [dropped({ dropped: "2027-01-01" })]))[0], /dropped: 2026-12-01 → 2027-01-01/);
  assert.deepEqual(compareRegistries(reg([], [dropped()]), reg([build()])), [], "back in builds only adds protection");
});

test("with a base registry, a lost entry fails the check", () => {
  const { code, out } = run([build()], {
    baseRegistryText: registry([build(), build({ build: "13", sha: SHA_B })]),
    baseLabel: "the base",
  });
  assert.equal(code, 1);
  assert.match(out, /::error::shipped-builds\.json: ios\/1\.0\.0\+13 .* missing here/);
  assert.match(out, /lost or rewrote 1 entry from the base/);
});

test("a lost entry fails the check even when nothing is left to compare against", () => {
  const { code } = run([], { baseRegistryText: registry([build()]), exists: () => false });
  assert.equal(code, 1);
});

test("a base that kept everything, or has no registry, passes; an invalid base can't be compared", () => {
  assert.equal(run([build()], { baseRegistryText: registry([build()]) }).code, 0);
  const none = run([build()], { baseRegistryText: null, baseLabel: "the base" });
  assert.equal(none.code, 0);
  assert.match(none.out, /the base doesn't exist/);
  // A PR that fixes a bad base, or tightens the parser with the file, must pass...
  const notJson = run([build()], { baseRegistryText: "{", baseLabel: "the base" });
  assert.equal(notJson.code, 0);
  assert.match(notJson.out, /::warning::the base doesn't pass this branch's parse .* isn't JSON, so this registry was not compared/);
  const stricter = registry([{ ...build(), legacy: "a key this branch no longer allows" }]);
  const fixed = run([build()], { baseRegistryText: stricter, baseLabel: "the base" });
  assert.equal(fixed.code, 0);
  assert.match(fixed.out, /::warning::the base doesn't pass this branch's parse .* so its entries were compared as written/);
  // ...without losing an entry on the way.
  const lost = run([build({ build: "13" })], { baseRegistryText: stricter, baseLabel: "the base" });
  assert.equal(lost.code, 1);
  assert.match(lost.out, /ios\/1\.0\.0\+12 .* missing here/);
});

test("registryAtRef reads the file at a commit, null when it has none, undefined when the commit is unreadable", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "registry-at-ref-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("commit", "-q", "--allow-empty", "-m", "before the registry");
  const before = git("rev-parse", "HEAD");
  mkdirSync(path.join(dir, "store"));
  writeFileSync(path.join(dir, "store/shipped-builds.json"), registry([build()]));
  git("add", ".");
  git("commit", "-q", "-m", "registry");
  const after = git("rev-parse", "HEAD");
  assert.equal(registryAtRef(after, "store/shipped-builds.json", dir), registry([build()]));
  assert.equal(registryAtRef(before, "store/shipped-builds.json", dir), null);
  assert.equal(registryAtRef("f".repeat(40), "store/shipped-builds.json", dir), undefined);
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

test("WARN-level changes pass but are printed as a warning", () => {
  const { code, out } = run([build()], {
    oasdiff: () => ({
      status: "clean",
      output: "2 changes: 0 error, 2 warning\n[response-optional-property-removed]",
    }),
  });
  assert.equal(code, 0);
  assert.match(out, /::warning::Lower-severity API changes against shipped mobile build\(s\) ios\/1\.0\.0\+12/);
  assert.match(out, /response-optional-property-removed/);
});

// ── The ignore file ─────────────────────────────────────────────────────────
//
// oasdiff's --err-ignore has no comment syntax: a line holding `METHOD /path`
// and the change text waives it whether or not it starts with `#`. A
// commented-out waiver that still waived would pass the break it was meant to
// catch, so oasdiff only ever sees the entries.

test("comment and blank lines are not waivers", () => {
  assert.deepEqual(
    waiverLines(
      "# GET /v1/foo api path removed without deprecation\n\n  POST /v1/bar api path removed without deprecation  \r\n   # indented comment\n",
    ),
    ["POST /v1/bar api path removed without deprecation"],
  );
});

test("oasdiff reads only the ignore file's entries", () => {
  const ignoreText = "# evidence: GET /v1/foo api path removed without deprecation\nPOST /v1/bar api path removed without deprecation\n";
  const { calls, dir } = run([build()], { ignoreText });
  assert.equal(calls[0].ignorePath, path.join(dir, "err-ignore.txt"));
  assert.equal(
    readFileSync(calls[0].ignorePath, "utf8"),
    "POST /v1/bar api path removed without deprecation\n",
  );
});

test("an ignore file with no entries, or none at all, passes no --err-ignore", () => {
  assert.equal(run([build()], { ignoreText: "# only a comment\n" }).calls[0].ignorePath, undefined);
  assert.equal(run([build()], { ignoreText: null }).calls[0].ignorePath, undefined);
});

// ── runOasdiff ──────────────────────────────────────────────────────────────
//
// The gate's verdict rests on two things here: `--fail-on ERR` (without it
// oasdiff exits 0 on a breaking change) and exit 1 meaning "breaking". Every
// checkShipped test above stubs oasdiff, so these run the real function
// against a stand-in binary that records its arguments and exits as told.

function fakeOasdiff(exitCode, stdout = "") {
  const dir = mkdtempSync(path.join(tmpdir(), "fake-oasdiff-"));
  const bin = path.join(dir, "oasdiff");
  const argsFile = path.join(dir, "args");
  writeFileSync(
    bin,
    `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsFile}'\nprintf '%s' '${stdout}'\necho 'oasdiff says no' >&2\nexit ${exitCode}\n`,
  );
  chmodSync(bin, 0o755);
  return { bin, args: () => readFileSync(argsFile, "utf8").trim().split("\n") };
}

test("runOasdiff asks oasdiff to fail on ERR, and passes the ignore file", () => {
  const fake = fakeOasdiff(0);
  runOasdiff({ bin: fake.bin, basePath: "/b.json", headPath: "/h.json", ignorePath: "/i.txt" });
  assert.deepEqual(fake.args(), [
    "breaking", "/b.json", "/h.json", "--format", "text", "--fail-on", "ERR", "--err-ignore", "/i.txt",
  ]);
  runOasdiff({ bin: fake.bin, basePath: "/b.json", headPath: "/h.json" });
  assert.ok(!fake.args().includes("--err-ignore"));
});

test("runOasdiff reads exit 0 as clean, 1 as breaking, anything else as an error", () => {
  assert.deepEqual(
    runOasdiff({ bin: fakeOasdiff(0, "No breaking changes").bin, basePath: "/b", headPath: "/h" }),
    { status: "clean", output: "No breaking changes" },
  );
  assert.deepEqual(
    runOasdiff({ bin: fakeOasdiff(1, "1 changes: 1 error").bin, basePath: "/b", headPath: "/h" }),
    { status: "breaking", output: "1 changes: 1 error" },
  );
  const failed = runOasdiff({ bin: fakeOasdiff(102).bin, basePath: "/b", headPath: "/h" });
  assert.equal(failed.status, "error");
  assert.match(failed.output, /exit status: 102/);
  assert.match(failed.output, /oasdiff says no/);
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
  // On a PR or merge queue entry it compares the registry with the base's (#3783); on a push, with nothing.
  assert.match(step.body, /REGISTRY_BASE: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.merge_group\.base_sha \|\| '' \}\}/);
  assert.match(step.body, /\$\{REGISTRY_BASE:\+--registry-base "\$REGISTRY_BASE"\}/);
  assert.equal(step.if, null, "the step runs on every event");
  assert.doesNotMatch(step.body, /continue-on-error/);

  // The advisory base comparison must still run when the blocking step fails:
  // it is the only report of breaks to routes no shipped build had.
  const [advisory] = workflowSteps(ciPath).filter((s) => /check:api-breaking -- --base/.test(s.body));
  assert.match(String(advisory.if), /!cancelled\(\)/);

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
