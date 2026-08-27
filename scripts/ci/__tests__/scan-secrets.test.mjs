import { test } from "node:test";
import assert from "node:assert/strict";

// scan-secrets.mjs is a general-purpose script under scripts/ (a peer of check-*.mjs); its
// test lives here so the existing `test:ci-scripts` glob (scripts/ci/__tests__/*.test.mjs)
// runs it — hence the ../../ reach back up to scripts/.
import {
  buildGitleaksArgs,
  coveragePercent,
  evaluateRefCompleteness,
  fullModeIsFallback,
  gatherRefState,
  gitSpawnOptions,
  parseRefLines,
  refCompletenessOutcome,
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
const NARROW_GLOB = ["+refs/heads/main:refs/remotes/origin/main"];
/** A remote ref as `ls-remote` reports it. */
const ref = (name, sha) => ({ name, sha });

/** A fully-fetched clone — the baseline every case below deviates from. */
const COMPLETE = {
  isShallow: false,
  fetchSpecs: FULL_GLOB,
  localObjects: ["sha-main", "sha-one", "sha-two"],
  remoteHeads: [ref("main", "sha-main"), ref("feat/one", "sha-one"), ref("feat/two", "sha-two")],
  remotePrRefs: [],
};

test("a fully-fetched clone is complete", () => {
  const result = evaluateRefCompleteness(COMPLETE);
  assert.equal(result.status, "complete");
  assert.deepEqual(result.reasons, []);
});

// SECRET_SCANNING.md's middle row: full depth, so `--is-shallow-repository`
// says false and `--unshallow` is a no-op, yet history is largely absent.
test("full-depth but under-fetched is incomplete even though it is NOT shallow", () => {
  const result = evaluateRefCompleteness({ ...COMPLETE, localObjects: ["sha-main"] });
  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.missing, ["feat/one", "feat/two"]);
});

// Counts are not enough: git never prunes remote-tracking refs on its own, so a
// stale ref would pay for a never-fetched head and the clone would report full
// coverage it does not have — the exact false all-clear this guard prevents.
test("a stale ref does not mask a head that was never fetched", () => {
  const result = evaluateRefCompleteness({
    ...COMPLETE,
    // Same COUNT as the remote: `sha-deleted` is gone upstream, `sha-new` was never fetched.
    localObjects: ["sha-main", "sha-one", "sha-deleted"],
    remoteHeads: [ref("main", "sha-main"), ref("feat/one", "sha-one"), ref("brand-new", "sha-new")],
  });
  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.missing, ["brand-new"]);
});

// Names are not enough either: a clone that is simply behind holds every branch
// NAME and none of the new commits. This is the "~27% of history at exit 0" row.
test("a clone behind on commits is incomplete despite holding every branch name", () => {
  const result = evaluateRefCompleteness({
    ...COMPLETE,
    localObjects: ["sha-main-old", "sha-one", "sha-two"],
    remoteHeads: [
      ref("main", "sha-main-new"), // same name, advanced upstream
      ref("feat/one", "sha-one"),
      ref("feat/two", "sha-two"),
    ],
  });
  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.missing, ["main"]);
  assert.match(result.reasons.join(" "), /absent or behind/);
});

test("holding more stale refs than the remote has does not read as complete", () => {
  const result = evaluateRefCompleteness({
    ...COMPLETE,
    localObjects: ["sha-main", "gone-1", "gone-2", "gone-3", "gone-4"],
    remoteHeads: [ref("main", "sha-main"), ref("brand-new", "sha-new")],
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

// A secret pushed to a PR whose branch was deleted is still on the remote and
// still fetchable, but `git clone` never retrieves it and `--all` cannot walk it.
test("missing pull-request refs make an audit incomplete", () => {
  const result = evaluateRefCompleteness({
    ...COMPLETE,
    remotePrRefs: [ref("pull/7/head", "sha-pr7")],
  });
  assert.equal(result.status, "incomplete");
  assert.match(result.reasons.join(" "), /pull-request refs are absent/);
});

test("pull-request refs already held do not fault the clone", () => {
  const result = evaluateRefCompleteness({
    ...COMPLETE,
    localObjects: [...COMPLETE.localObjects, "sha-pr7"],
    remotePrRefs: [ref("pull/7/head", "sha-pr7")],
  });
  assert.equal(result.status, "complete");
});

test("a mirror clone's `+refs/*:refs/*` is accepted, not misread as single-branch", () => {
  const result = evaluateRefCompleteness({ ...COMPLETE, fetchSpecs: ["+refs/*:refs/*"] });
  assert.equal(result.status, "complete");
});

// Regression: a narrow refspec must not fail a clone whose refs are all present,
// or a dev who ran the printed remedy (a command-line fetch, which does not
// rewrite the persisted refspec) would be refused forever with no way out.
test("a narrow refspec alone does not refuse a clone that holds every head", () => {
  const result = evaluateRefCompleteness({ ...COMPLETE, fetchSpecs: NARROW_GLOB });
  assert.equal(result.status, "complete");
});

test("a narrow refspec is reported alongside genuinely missing refs, as the fix", () => {
  const result = evaluateRefCompleteness({
    ...COMPLETE,
    fetchSpecs: NARROW_GLOB,
    localObjects: ["sha-main"],
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
  const result = evaluateRefCompleteness({ ...COMPLETE, remoteHeads: null });
  assert.equal(result.status, "unknown");
  assert.equal(result.remoteCount, null);
});

test("a local signal still proves incompleteness with no network", () => {
  const result = evaluateRefCompleteness({ ...COMPLETE, isShallow: true, remoteHeads: null });
  assert.equal(result.status, "incomplete");
});

test("offline, a narrow refspec still proves the clone incomplete", () => {
  const result = evaluateRefCompleteness({
    ...COMPLETE,
    fetchSpecs: NARROW_GLOB,
    remoteHeads: null,
  });
  assert.equal(result.status, "incomplete");
});

// An empty remote list means "origin has no branches"; it must not be conflated
// with null, which would make an offline clone read as complete.
test("an empty remote ref list is distinct from null", () => {
  const result = evaluateRefCompleteness({ ...COMPLETE, localObjects: [], remoteHeads: [] });
  assert.equal(result.status, "complete");
  assert.equal(result.remoteCount, 0);
});

// ── The severity split — what keeps the required CI check off red ────────────

test("an explicit audit refuses an incomplete clone", () => {
  const result = evaluateRefCompleteness({ ...COMPLETE, localObjects: [] });
  assert.equal(refCompletenessOutcome(result, false).action, "refuse");
});

test("the same clone only warns when full mode was a fallback from range mode", () => {
  const result = evaluateRefCompleteness({ ...COMPLETE, localObjects: [] });
  assert.equal(refCompletenessOutcome(result, true).action, "warn");
});

test("an unreachable origin never refuses, even on an explicit audit", () => {
  const result = evaluateRefCompleteness({ ...COMPLETE, remoteHeads: null });
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
  const result = evaluateRefCompleteness({ ...COMPLETE, isShallow: true, remoteHeads: null });
  assert.match(refCompletenessOutcome(result, true).note, /INCOMPLETE/);
});

// ── The wiring behind the severity split, not just the policy ────────────────

test("full mode reached with --base/--head is recognised as a fallback", () => {
  assert.equal(fullModeIsFallback(["node", "s.mjs", "--base", "0000", "--head", "abc"]), true);
  // CI's push step passes only --base when the range collapses.
  assert.equal(fullModeIsFallback(["node", "s.mjs", "--base", "0000"]), true);
});

test("a bare `npm run check:secrets` is NOT a fallback — it is an audit", () => {
  assert.equal(fullModeIsFallback(["node", "s.mjs"]), false);
  assert.equal(fullModeIsFallback(["node", "s.mjs", "--soft-missing"]), false);
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

// ── git invocation hardening ────────────────────────────────────────────────

test("git never gets to prompt for credentials", () => {
  assert.equal(gitSpawnOptions().env.GIT_TERMINAL_PROMPT, "0");
});

// The prompt guard must survive a caller passing its own env, or a future
// caller could silently reintroduce the hang.
test("a caller-supplied env cannot clobber the prompt guard", () => {
  const options = gitSpawnOptions({ env: { GIT_TERMINAL_PROMPT: "1", FOO: "bar" } });
  assert.equal(options.env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(options.env.FOO, "bar");
});

test("a caller-supplied timeout is threaded through", () => {
  assert.equal(gitSpawnOptions({ timeout: 15_000 }).timeout, 15_000);
});

// ── Parsing git's ref output ────────────────────────────────────────────────

test("ls-remote's <sha>TAB<refname> shape is parsed to sha + short name", () => {
  const stdout = "abc123\trefs/heads/main\ndef456\trefs/heads/claude/next-steps\n";
  assert.deepEqual(parseRefLines(stdout), [
    { sha: "abc123", name: "main" },
    { sha: "def456", name: "claude/next-steps" },
  ]);
});

test("remote-tracking refnames are shortened the same way, so SHAs line up", () => {
  const stdout = "abc123\trefs/remotes/origin/main\n";
  assert.deepEqual(parseRefLines(stdout), [{ sha: "abc123", name: "main" }]);
});

test("the symbolic origin/HEAD pointer is skipped", () => {
  const stdout = "abc123\trefs/remotes/origin/HEAD\ndef456\trefs/remotes/origin/main\n";
  assert.deepEqual(parseRefLines(stdout), [{ sha: "def456", name: "main" }]);
});

test("null or malformed stdout yields no refs rather than throwing", () => {
  assert.deepEqual(parseRefLines(null), []);
  assert.deepEqual(parseRefLines("no-tab-here\n"), []);
});

// ── gatherRefState drives git through an injectable runner ───────────────────

test("every namespace counts toward what the clone holds", () => {
  const seen = [];
  const fakeGit = (args) => {
    seen.push(args.join(" "));
    if (args[1] === "--is-shallow-repository") return "false\n";
    if (args[0] === "config") return "+refs/*:refs/*\n";
    // A mirror keeps heads under refs/heads/*; a working clone under
    // refs/remotes/origin/*. Reading refs/** picks up both.
    if (args[0] === "for-each-ref") return "s1\trefs/heads/main\ns2\trefs/remotes/origin/feat\n";
    if (args[0] === "ls-remote" && args[1] === "--heads") return "s1\trefs/heads/main\n";
    if (args[0] === "ls-remote") return "";
    return null;
  };
  const state = gatherRefState(fakeGit);
  assert.ok(seen.some((c) => c.includes("refs/**")));
  assert.deepEqual(state.localObjects, ["s1", "s2"]);
  assert.equal(evaluateRefCompleteness(state).status, "complete");
});

test("an unreachable origin yields remoteHeads null, not an empty list", () => {
  const fakeGit = (args) => {
    if (args[0] === "ls-remote") return null;
    if (args[1] === "--is-shallow-repository") return "false\n";
    if (args[0] === "config") return "+refs/heads/*:refs/remotes/origin/*\n";
    if (args[0] === "for-each-ref") return "s1\trefs/remotes/origin/main\n";
    return null;
  };
  assert.equal(gatherRefState(fakeGit).remoteHeads, null);
});

// An unreachable origin has no coverage figure to quote; "0 heads" would read as
// a measurement rather than the absence of one.
test("the offline note reports no coverage figure, not a zero", () => {
  const unknown = evaluateRefCompleteness({ ...COMPLETE, remoteHeads: null });
  assert.match(refCompletenessOutcome(unknown, false).note, /unverified \(origin unreachable\)/);
  assert.doesNotMatch(refCompletenessOutcome(unknown, false).note, /0 (of|local|heads)/);

  const known = evaluateRefCompleteness({ ...COMPLETE, isShallow: true, remoteHeads: null });
  const note = refCompletenessOutcome(known, true).note;
  assert.match(note, /INCOMPLETE/);
  assert.doesNotMatch(note, /Covered 0/);
});
