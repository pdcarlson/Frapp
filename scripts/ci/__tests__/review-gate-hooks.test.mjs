import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const readJson = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), "utf8"));

test("Claude has no provider-specific review interception", () => {
  const config = readJson(".claude/settings.json");
  assert.equal(config.hooks.PreToolUse, undefined);
  assert.equal(existsSync(path.join(ROOT, ".claude/hooks/pre-push-review-gate.sh")), false);
  assert.ok(config.hooks.SessionStart, "unrelated sandbox hook must remain installed");
});

test("the checked-in Git pre-push hook is executable", () => {
  accessSync(path.join(ROOT, ".githooks/pre-push"), constants.X_OK);
});

test("the installer activates and chmods the pre-push hook", () => {
  const installer = readFileSync(path.join(ROOT, "scripts/setup-git-hooks.mjs"), "utf8");
  assert.match(installer, /core\.hooksPath \.githooks/);
  assert.match(installer, /\.githooks\/pre-push/);
});
