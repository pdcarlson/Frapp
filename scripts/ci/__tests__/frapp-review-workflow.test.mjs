import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Runs .claude/workflows/frapp-review.js with its harness globals mocked, so the finder bundles,
// arg validation and verify rule are checked without launching an agent.
const source = readFileSync(fileURLToPath(new URL("../../../.claude/workflows/frapp-review.js", import.meta.url)), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const script = new AsyncFunction("args", "agent", "parallel", "log", "phase", source.replace(/^export const meta = /m, "const meta = "));

const SHA = (c) => c.repeat(40);
const scope = (extra) => ({ mode: "full", base: SHA("a"), head: SHA("c"), branchBase: SHA("a"), root: "/repo", dirty: false, ...extra });

async function run(args, reply = () => ({ candidates: [] })) {
  const labels = [];
  const agent = async (prompt, opts) => {
    labels.push(opts.label);
    return reply(prompt, opts);
  };
  const parallel = (thunks) => Promise.all(thunks.map((t) => t().catch(() => null)));
  return { labels, out: await script(args, agent, parallel, () => {}, () => {}) };
}

test("a first review runs four finders, two when small, plus the acceptance-and-tests finder", async () => {
  assert.deepEqual((await run(scope({ changedLines: 400 }))).labels, ["find:changes", "find:dependents", "find:docs-reuse", "find:invariants", "find:acceptance-tests"]);
  assert.deepEqual((await run(scope({ changedLines: 20 }))).labels, ["find:code", "find:docs-invariants", "find:acceptance-tests"]);
  assert.equal((await run(scope({ changedLines: 0 }))).labels.length, 3, "zero lines (generated files only) is small");
  assert.equal((await run(scope({ changedLines: undefined }))).labels.length, 5, "an unknown size is not");
});

test("a delta round runs the two light finders and the acceptance-and-tests finder", async () => {
  const { labels } = await run(scope({ mode: "delta", base: SHA("b"), changedLines: 900 }));
  assert.deepEqual(labels, ["find:code", "find:docs-invariants", "find:acceptance-tests"]);
});

test("args: an explicit target needs no branchBase, a delta does, and only full or delta run", async () => {
  await run({ mode: "full", base: SHA("a"), head: SHA("c") });
  await assert.rejects(run(scope({ mode: "delta", branchBase: undefined })), /needs branchBase/);
  await assert.rejects(run(scope({ mode: "none" })), /only full and delta/);
  await assert.rejects(run(scope({ base: "HEAD" })), /needs base as a SHA/);
});

test("same-line candidates share one verifier; a second lens runs only on REFUTED, and both must refute", async () => {
  const cand = (file, line, summary) => ({ file, line, angle: "Hunk scan", summary, failure_scenario: "x" });
  const { labels, out } = await run(scope({ changedLines: 400 }), (prompt, opts) => {
    if (opts.label === "find:changes") return { candidates: [cand("/repo/a.ts", 1, "first"), cand("b.ts", 2, "gone")] };
    if (opts.label === "find:dependents") return { candidates: [cand("a.ts", 1, "second")] };
    if (opts.label === "find:invariants") return null;
    if (opts.label.startsWith("find:")) return { candidates: [] };
    const n = (prompt.match(/^\d+\. /gm) || []).length;
    const refute = opts.label.startsWith("verify:") ? /second|gone/ : /gone/;
    const lines = prompt.split("\n").filter((l) => /^\d+\. /.test(l));
    return { verdicts: Array.from({ length: n }, (_, i) => ({ finding: i + 1, verdict: refute.test(lines[i]) ? "REFUTED" : "CONFIRMED", evidence: "e", confidence: "high" })) };
  });
  assert.equal(labels.filter((l) => l === "verify:a.ts:1").length, 1, "one verifier for both findings at a.ts:1");
  assert.deepEqual(out.kept.map((k) => [k.summary, k.escalated]).sort(), [["first", false], ["second", true]]);
  assert.deepEqual(out.refuted.map((r) => r.summary), ["gone"]);
  assert.deepEqual(out.finderFailures.map((f) => f.source), ["find:invariants"]);
});
