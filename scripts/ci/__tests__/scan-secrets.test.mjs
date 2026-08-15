import { test } from "node:test";
import assert from "node:assert/strict";

// scan-secrets.mjs is a general-purpose script under scripts/ (a peer of check-*.mjs); its
// test lives here so the existing `test:ci-scripts` glob (scripts/ci/__tests__/*.test.mjs)
// runs it — hence the ../../ reach back up to scripts/.
import { buildGitleaksArgs } from "../../scan-secrets.mjs";

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
