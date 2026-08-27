import { test } from "node:test";
import assert from "node:assert/strict";

// scan-secrets.mjs is a general-purpose script under scripts/ (a peer of check-*.mjs); its
// test lives here so the existing `test:ci-scripts` glob (scripts/ci/__tests__/*.test.mjs)
// runs it — hence the ../../ reach back up to scripts/.
import {
  buildGitleaksArgs,
  coveragePercent,
  evaluateRefCompleteness,
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

// A fully-fetched clone, as the baseline every case below deviates from.
const COMPLETE = {
  isShallow: false,
  fetchSpecs: ["+refs/heads/*:refs/remotes/origin/*"],
  localRefCount: 323,
  remoteRefCount: 323,
};

test("a fully-fetched clone is complete", () => {
  const result = evaluateRefCompleteness(COMPLETE);
  assert.equal(result.status, "complete");
  assert.deepEqual(result.reasons, []);
});

// The whole reason this guard exists. SECRET_SCANNING.md's middle row: full
// depth, so `--is-shallow-repository` says false and `--unshallow` is a no-op,
// yet the scan covers a fraction of history and exits 0.
test("full-depth but under-fetched is incomplete even though it is NOT shallow", () => {
  const result = evaluateRefCompleteness({
    ...COMPLETE,
    isShallow: false,
    localRefCount: 445,
    remoteRefCount: 1659,
  });
  assert.equal(result.status, "incomplete");
  assert.match(result.reasons.join(" "), /445 remote-tracking head\(s\) but origin offers 1659/);
});

// Measured in a cloud sandbox on 2026-08-27: the refspec was exactly the full
// glob while the clone held 2 of 324 heads. A refspec-only check passes this.
test("the refspec glob alone does not prove completeness", () => {
  const result = evaluateRefCompleteness({
    isShallow: false,
    fetchSpecs: ["+refs/heads/*:refs/remotes/origin/*"],
    localRefCount: 2,
    remoteRefCount: 324,
  });
  assert.equal(result.status, "incomplete");
  // The refspec is correct, so that must NOT be among the reasons.
  assert.ok(!result.reasons.some((r) => r.includes("remote.origin.fetch")));
});

test("a shallow clone is incomplete", () => {
  const result = evaluateRefCompleteness({ ...COMPLETE, isShallow: true });
  assert.equal(result.status, "incomplete");
  assert.match(result.reasons.join(" "), /shallow/);
});

test("a single-branch refspec is incomplete even when the counts agree", () => {
  const result = evaluateRefCompleteness({
    ...COMPLETE,
    fetchSpecs: ["+refs/heads/main:refs/remotes/origin/main"],
    localRefCount: 1,
    remoteRefCount: 1,
  });
  assert.equal(result.status, "incomplete");
  assert.match(result.reasons.join(" "), /single-branch/);
});

test("every failing signal is reported, not just the first", () => {
  const result = evaluateRefCompleteness({
    isShallow: true,
    fetchSpecs: ["+refs/heads/main:refs/remotes/origin/main"],
    localRefCount: 1,
    remoteRefCount: 324,
  });
  assert.equal(result.reasons.length, 3);
});

// ── Offline must not hard-block (the --soft-missing precedent) ───────────────

test("an unreachable origin is 'unknown', never 'incomplete'", () => {
  const result = evaluateRefCompleteness({ ...COMPLETE, remoteRefCount: null });
  assert.equal(result.status, "unknown");
  assert.equal(result.remoteRefCount, null);
});

test("a local signal still proves incompleteness with no network", () => {
  const result = evaluateRefCompleteness({ ...COMPLETE, isShallow: true, remoteRefCount: null });
  assert.equal(result.status, "incomplete");
});

// A remote count of 0 would mean "origin has no branches"; it must not be
// conflated with null, which would make an offline clone read as complete.
test("remoteRefCount 0 is distinct from null", () => {
  const result = evaluateRefCompleteness({ ...COMPLETE, localRefCount: 0, remoteRefCount: 0 });
  assert.equal(result.status, "complete");
});

test("a repo with no configured refspec is not faulted for it", () => {
  const result = evaluateRefCompleteness({ ...COMPLETE, fetchSpecs: [] });
  assert.equal(result.status, "complete");
});

// ── Coverage reporting (so an audit record entry can quote it) ───────────────

test("coverage never rounds a partial clone up to 100%", () => {
  assert.equal(coveragePercent(1658, 1659), "<100%");
  assert.equal(coveragePercent(1659, 1659), "100%");
});

test("coverage keeps a decimal below 1% rather than reporting 0%", () => {
  assert.equal(coveragePercent(2, 324), "0.6%");
});
