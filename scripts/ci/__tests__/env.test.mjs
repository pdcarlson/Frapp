import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { requireEnv, SECRETS_RUNBOOK } from "../lib/env.mjs";

/** Captures what the helper said and whether it tried to exit. */
function spy(env) {
  const logs = [];
  let exited = null;
  const value = (name, opts = {}) =>
    requireEnv(name, {
      env,
      log: (m) => logs.push(m),
      exit: (c) => {
        exited = c;
      },
      ...opts,
    });
  return { logs, value, exitedWith: () => exited };
}

describe("requireEnv", () => {
  it("returns the value and does not exit when the variable is set", () => {
    const s = spy({ TOKEN: "abc" });
    assert.equal(s.value("TOKEN"), "abc");
    assert.deepEqual(s.logs, []);
    assert.equal(s.exitedWith(), null);
  });

  it("exits 1 naming the missing variable", () => {
    const s = spy({});
    s.value("TOKEN");
    assert.equal(s.exitedWith(), 1);
    assert.match(s.logs[0], /TOKEN environment variable is required/);
  });

  // An empty string is not a usable credential, and every copy this replaced
  // treated it as missing (`if (!value)`). Pinned so the consolidation cannot
  // quietly turn `SUPABASE_ACCESS_TOKEN=""` into a valid token.
  it("treats an empty value as missing", () => {
    const s = spy({ TOKEN: "" });
    s.value("TOKEN");
    assert.equal(s.exitedWith(), 1);
  });

  // The 13 identical copies printed `Error: `; only the drift gate emitted a
  // GitHub Actions annotation. Both behaviours survive, selected by the environment.
  it("uses the plain prefix outside GitHub Actions", () => {
    const s = spy({});
    s.value("TOKEN");
    assert.ok(s.logs[0].startsWith("Error: "));
    assert.ok(!s.logs[0].includes("::error::"));
  });

  it("emits an Actions annotation under GITHUB_ACTIONS", () => {
    const s = spy({ GITHUB_ACTIONS: "true" });
    s.value("TOKEN");
    assert.ok(s.logs[0].startsWith("::error::"));
  });

  it("appends the hint, preserving the drift gate's runbook pointer", () => {
    const s = spy({});
    s.value("SUPABASE_ACCESS_TOKEN", { hint: SECRETS_RUNBOOK });
    assert.match(s.logs[0], /SECRETS_MANAGEMENT\.md/);
  });
});
