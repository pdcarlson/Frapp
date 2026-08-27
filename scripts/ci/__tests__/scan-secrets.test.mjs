import { test } from "node:test";
import assert from "node:assert/strict";

// scan-secrets.mjs is a general-purpose script under scripts/ (a peer of check-*.mjs); its
// test lives here so the existing `test:ci-scripts` glob (scripts/ci/__tests__/*.test.mjs)
// runs it — hence the ../../ reach back up to scripts/.
import {
  buildGitleaksArgs,
  coveragePercent,
  evaluateRefCompleteness,
  gatherRefState,
  refCompletenessOutcome,
  shortHeadNames,
} from "../../scan-secrets.mjs";

const CONFIG = "/repo/.gitleaks.toml";

// ── Each mode maps to the right gitleaks invocation ─────────────────────────

test("staged mode scans the git index via --pre-commit --staged", () => {
  const args = buildGitleaksArgs({ mode: "staged", configPath: CONFIG });
  assert.deepEqual(args, [
    "git",
    "--no-banner",
    "--redact",
    "-c",
    CONFIG,
    "--pre-commit",
    "--staged",
  ]);
});

test("range mode scans only base..head via --log-opts", () => {
  const args = buildGitleaksArgs({ mode: "range", base: "aaa", head: "bbb", configPath: CONFIG });
  assert.ok(args.includes("--log-opts=aaa..bbb"));
  assert.ok(!args.includes("--staged"));
});

test("full mode scans whole history (no range/staged flags)", () => {
  const args = buildGitleaksArgs({ mode: "full", configPath: CONFIG });
  assert.deepEqual(args, ["git", "--no-banner", "--redact", "-c", CONFIG]);
});

// ── Cross-cutting guarantees ────────────────────────────────────────────────

test("a baseline path is threaded through when present", () => {
  const args = buildGitleaksArgs({
    mode: "full",
    configPath: CONFIG,
    baselinePath: "/repo/.gitleaks-baseline.json",
  });
  const i = args.indexOf("--baseline-path");
  assert.notEqual(i, -1);
  assert.equal(args[i + 1], "/repo/.gitleaks-baseline.json");
});

test("always passes the config explicitly (-c) so local and CI agree", () => {
  for (const mode of ["staged", "range", "full"]) {
    const args = buildGitleaksArgs({ mode, base: "a", head: "b", configPath: CONFIG });
    const i = args.indexOf("-c");
    assert.equal(args[i + 1], CONFIG);
  }
});

test("secrets are redacted in output for every mode", () => {
  for (const mode of ["staged", "range", "full"]) {
    const args = buildGitleaksArgs({ mode, base: "a", head: "b", configPath: CONFIG });
    assert.ok(args.includes("--redact"));
  }
});

// ── Ref completeness: can this clone support a real audit? (#931) ────────────

const FULL_GLOB = ["+refs/heads/*:refs/remotes/origin/*"];
/** A fully-fetched clone — the baseline every case below deviates from. */
const COMPLETE = {
  isShallow: false,
  fetchSpecs: FULL_GLOB,
  localRefs: ["main", "feat/one", "feat/two"],
  remoteRefs: ["main", "feat/one", "feat/two"],
};

test("a fully-fetched clone is complete", () => {
  const result = evaluateRefCompleteness(COMPLETE);
  assert.equal(result.status, "complete");
  assert.deepEqual(result.reasons, []);
  assert.deepEqual(result.missing, []);
});

// The reason this guard exists. SECRET_SCANNING.md's middle row: full depth, so
// `--is-shallow-repository` says false and `--unshallow` is a no-op, yet the
// scan covers a fraction of history and exits 0.
test("full-depth but under-fetched is incomplete even though it is NOT shallow", () => {
  const result = evaluateRefCompleteness({
    ...COMPLETE,
    localRefs: ["main"],
    remoteRefs: ["main", "feat/one", "feat/two"],
  });
  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.missing, ["feat/one", "feat/two"]);
});

// Counts are not enough: git never prunes remote-tracking refs on its own, so a
// stale ref would pay for a never-fetched head and the clone would report full
// coverage it does not have — the exact false all-clear this guard prevents.
test("a stale ref does not mask a head that was never fetched", () => {
  const result = evaluateRefCompleteness({
    ...COMPLETE,
    // Same COUNT as the remote, but `deleted-upstream` is gone and
    // `brand-new` was never fetched.
    localRefs: ["main", "feat/one", "deleted-upstream"],
    remoteRefs: ["main", "feat/one", "brand-new"],
  });
  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.missing, ["brand-new"]);
});

test("holding more stale refs than the remote has does not read as complete", () => {
  const result = evaluateRefCompleteness({
    ...COMPLETE,
    localRefs: ["main", "gone-1", "gone-2", "gone-3", "gone-4"],
    remoteRefs: ["main", "brand-new"],
  });
  assert.equal(result.status, "incomplete");
  assert.equal(result.presentCount, 1);
  assert.equal(result.remoteCount, 2);
});

test("a shallow clone is incomplete", () => {
  const result = evaluateRefCompleteness({ ...COMPLETE, isShallow: true });
  assert.equal(result.status, "incomplete");
  assert.match(result.reasons.join(" "), /shallow/);
});

// A mirror is the most complete clone shape there is; refusing it would turn the
// guard away from precisely the clone an auditor is most likely to make.
test("a mirror clone's `+refs/*:refs/*` is accepted, not misread as single-branch", () => {
  const result = evaluateRefCompleteness({ ...COMPLETE, fetchSpecs: ["+refs/*:refs/*"] });
  assert.equal(result.status, "complete");
});

// Regression: a narrow refspec must not fail a clone whose refs are all present,
// or a dev who ran the printed remedy (a command-line fetch, which does not
// rewrite the persisted refspec) would be refused forever with no way out.
test("a narrow refspec alone does not refuse a clone that holds every head", () => {
  const result = evaluateRefCompleteness({
    ...COMPLETE,
    fetchSpecs: ["+refs/heads/main:refs/remotes/origin/main"],
  });
  assert.equal(result.status, "complete");
});

test("a narrow refspec is reported alongside genuinely missing refs, as the fix", () => {
  const result = evaluateRefCompleteness({
    ...COMPLETE,
    fetchSpecs: ["+refs/heads/main:refs/remotes/origin/main"],
    localRefs: ["main"],
  });
  assert.equal(result.status, "incomplete");
  assert.match(result.reasons.join(" "), /set-branches origin/);
});

test("a repo with no configured refspec is not faulted for it", () => {
  const result = evaluateRefCompleteness({ ...COMPLETE, fetchSpecs: [] });
  assert.equal(result.status, "complete");
});

// ── Offline must not hard-block (the --soft-missing precedent) ───────────────

test("an unreachable origin is 'unknown', never 'incomplete'", () => {
  const result = evaluateRefCompleteness({ ...COMPLETE, remoteRefs: null });
  assert.equal(result.status, "unknown");
  assert.equal(result.remoteCount, null);
});

test("a local signal still proves incompleteness with no network", () => {
  const result = evaluateRefCompleteness({ ...COMPLETE, isShallow: true, remoteRefs: null });
  assert.equal(result.status, "incomplete");
});

// An empty remote list means "origin has no branches"; it must not be conflated
// with null, which would make an offline clone read as complete.
test("an empty remote ref list is distinct from null", () => {
  const result = evaluateRefCompleteness({ ...COMPLETE, localRefs: [], remoteRefs: [] });
  assert.equal(result.status, "complete");
  assert.equal(result.remoteCount, 0);
});

// ── The severity split — what keeps the required CI check off red ────────────

test("an explicit audit refuses an incomplete clone", () => {
  const result = evaluateRefCompleteness({ ...COMPLETE, localRefs: [] });
  assert.equal(refCompletenessOutcome(result, false).action, "refuse");
});

test("the same clone only warns when full mode was a fallback from range mode", () => {
  const result = evaluateRefCompleteness({ ...COMPLETE, localRefs: [] });
  assert.equal(refCompletenessOutcome(result, true).action, "warn");
});

test("an unreachable origin never refuses, even on an explicit audit", () => {
  const result = evaluateRefCompleteness({ ...COMPLETE, remoteRefs: null });
  assert.equal(refCompletenessOutcome(result, false).action, "warn");
});

test("a complete clone passes either way", () => {
  const result = evaluateRefCompleteness(COMPLETE);
  for (const isFallback of [true, false]) {
    assert.equal(refCompletenessOutcome(result, isFallback).action, "pass");
  }
});

// A run proven incomplete by a local signal must stay marked INCOMPLETE in the
// audit record even when origin happened to be unreachable.
test("a known-incomplete run is not softened to 'unverified' when offline", () => {
  const result = evaluateRefCompleteness({ ...COMPLETE, isShallow: true, remoteRefs: null });
  assert.match(refCompletenessOutcome(result, true).note, /INCOMPLETE/);
});

// ── Coverage reporting (so an audit record entry can quote it) ───────────────

test("coverage never rounds a partial clone up to 100%", () => {
  // 199/200 is exactly 99.5, which Math.round takes to 100.
  assert.equal(coveragePercent(199, 200), "<100%");
  assert.equal(coveragePercent(1658, 1659), "<100%");
  assert.equal(coveragePercent(1659, 1659), "100%");
});

test("a sub-1% clone does not render as 0.0%", () => {
  assert.equal(coveragePercent(2, 324), "0.6%");
  assert.equal(coveragePercent(1, 2500), "<0.1%");
  assert.equal(coveragePercent(0, 324), "0%");
});

// ── Parsing both git output shapes ──────────────────────────────────────────

test("short names are read from ls-remote's <sha>TAB<refname> shape", () => {
  const stdout = "abc123\trefs/heads/main\ndef456\trefs/heads/claude/next-steps\n";
  assert.deepEqual(shortHeadNames(stdout, "refs/heads/"), ["main", "claude/next-steps"]);
});

test("short names are read from for-each-ref's bare refname shape", () => {
  const stdout = "refs/remotes/origin/main\nrefs/remotes/origin/claude/next-steps\n";
  assert.deepEqual(shortHeadNames(stdout, "refs/remotes/origin/"), ["main", "claude/next-steps"]);
});

test("the symbolic origin/HEAD pointer is not counted as a branch", () => {
  const stdout = "refs/remotes/origin/HEAD\nrefs/remotes/origin/main\n";
  assert.deepEqual(shortHeadNames(stdout, "refs/remotes/origin/"), ["main"]);
});

test("null stdout yields no names rather than throwing", () => {
  assert.deepEqual(shortHeadNames(null, "refs/heads/"), []);
});

// ── gatherRefState drives git through an injectable runner ───────────────────

test("a bare/mirror repo's heads are read from refs/heads, not refs/remotes", () => {
  const calls = [];
  const fakeGit = (args) => {
    calls.push(args.join(" "));
    if (args[1] === "--is-bare-repository") return "true\n";
    if (args[1] === "--is-shallow-repository") return "false\n";
    if (args[0] === "config") return "+refs/*:refs/*\n";
    if (args[0] === "for-each-ref") return "refs/heads/main\nrefs/heads/feat/one\n";
    if (args[0] === "ls-remote") return "a\trefs/heads/main\nb\trefs/heads/feat/one\n";
    return null;
  };
  const state = gatherRefState(fakeGit);
  assert.ok(calls.some((c) => c.includes("refs/heads/**")));
  assert.deepEqual(state.localRefs, ["main", "feat/one"]);
  assert.equal(evaluateRefCompleteness(state).status, "complete");
});

test("an unreachable origin yields remoteRefs null, not an empty list", () => {
  const fakeGit = (args) => {
    if (args[0] === "ls-remote") return null;
    if (args[1] === "--is-bare-repository") return "false\n";
    if (args[1] === "--is-shallow-repository") return "false\n";
    if (args[0] === "config") return "+refs/heads/*:refs/remotes/origin/*\n";
    if (args[0] === "for-each-ref") return "refs/remotes/origin/main\n";
    return null;
  };
  assert.equal(gatherRefState(fakeGit).remoteRefs, null);
});
