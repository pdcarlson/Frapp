import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Pins the fix for #1379, whose failure mode is invisible in a diff: a workflow
// that keys `concurrency.group` on `github.ref` and cancels unconditionally puts
// EVERY push to main in one group, because `github.ref` is `refs/heads/main` for
// all of them. Two merges minutes apart then cancel the earlier commit's run,
// its required checks conclude `cancelled`, nothing re-runs them, and
// `validate-deploy-sha.mjs` refuses to deploy that commit forever after — which
// lands on exactly the operation that needs it, since DB_ROLLBACK_PLAYBOOK
// recovery is redeploying an older commit.
//
// The reason this is a test and not just four edited files: nothing about a new
// workflow with `cancel-in-progress: true` looks wrong. The cost only appears
// weeks later, on a rollback, as "CI is not green" for a commit whose tests
// never ran.
//
// Parsed by hand rather than with a YAML library on purpose: every other test in
// this directory imports `node:` modules only, and `yaml` is present here as a
// transitive override rather than a declared dependency.

const WORKFLOWS = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  ".github",
  "workflows",
);

/** Lines of the block under a column-0 `key:`, comments stripped. */
function topLevelBlock(text, key) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.replace(/\s+$/, "") === `${key}:`);
  if (start === -1) return null;
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    if (!/^\s/.test(lines[i])) break; // next top-level key
    out.push(lines[i]);
  }
  return out.filter((l) => !/^\s*#/.test(l)).join("\n");
}

function pushesToMain(text) {
  const on = topLevelBlock(text, "on");
  if (on === null) return false;
  const lines = on.split("\n");
  const start = lines.findIndex((l) => /^ {2}push:\s*$/.test(l));
  if (start === -1) return false;
  const sub = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}\S/.test(lines[i])) break;
    sub.push(lines[i]);
  }
  return /\bmain\b/.test(sub.join("\n"));
}

function concurrencyOf(text) {
  const block = topLevelBlock(text, "concurrency");
  if (block === null) return null;
  const group = block.match(/^\s*group:\s*(.+?)\s*$/m);
  const cancel = block.match(/^\s*cancel-in-progress:\s*(.+?)\s*$/m);
  return { group: group?.[1] ?? null, cancel: cancel?.[1] ?? null };
}

const workflows = readdirSync(WORKFLOWS)
  .filter((f) => f.endsWith(".yml"))
  .sort()
  .map((name) => ({ name, text: readFileSync(join(WORKFLOWS, name), "utf8") }));

const GUARD = "${{ github.ref != 'refs/heads/main' }}";

describe("workflow concurrency — a main push run must never cancel another", () => {
  it("reads the workflow directory at all", () => {
    // Guards the whole file: a path typo would make every assertion below pass
    // vacuously, which is the classic way an invariant test stops invariant-ing.
    assert.ok(workflows.length >= 10, `expected the workflow set, got ${workflows.length}`);
    assert.ok(
      workflows.some((w) => w.name === "ci.yml"),
      "ci.yml must be among the parsed workflows",
    );
  });

  it("never cancels unconditionally when the group is keyed on github.ref", () => {
    const offenders = [];
    for (const { name, text } of workflows) {
      const c = concurrencyOf(text);
      if (!c || !c.group?.includes("github.ref")) continue;
      if (!pushesToMain(text)) continue;
      if (c.cancel === "true") offenders.push(name);
    }
    assert.deepEqual(
      offenders,
      [],
      `these run on pushes to main with a github.ref-keyed concurrency group and ` +
        `cancel unconditionally, so one merge cancels the previous commit's checks ` +
        `and makes it undeployable. Use \`cancel-in-progress: ${GUARD}\`.`,
    );
  });

  it("carries the guard verbatim in the four workflows that need it", () => {
    // Byte-identical on purpose — four near-identical spellings would each have
    // to be re-reasoned about by the next reader.
    for (const name of [
      "ci.yml",
      "docs.yml",
      "links.yml",
      "migration-drift-gate.yml",
    ]) {
      const wf = workflows.find((w) => w.name === name);
      assert.ok(wf, `${name} must exist`);
      assert.equal(concurrencyOf(wf.text)?.cancel, GUARD, `${name} must carry the guard`);
    }
  });

  it("documents why the two push-to-main exemptions are not this bug", () => {
    // Asserted rather than described so an edit that turns either INTO the bug
    // fails here instead of shipping.

    // pr-base-sync: a static group, so it never collapses per-ref. Cancelling a
    // superseded sweep is deliberate — the next sweep re-reads every open PR
    // against the newest base tip — and it emits no required check.
    const sync = workflows.find((w) => w.name === "pr-base-sync.yml");
    assert.ok(sync, "pr-base-sync.yml must exist");
    assert.equal(concurrencyOf(sync.text)?.group, "pr-base-sync");
    assert.ok(
      !concurrencyOf(sync.text)?.group.includes("github.ref"),
      "pr-base-sync's exemption rests on its group NOT being ref-keyed",
    );

    // pr-base-guard: no push trigger at all, so it has no main-push run to
    // cancel; its group is keyed on the PR number, not the ref.
    const guard = workflows.find((w) => w.name === "pr-base-guard.yml");
    assert.ok(guard, "pr-base-guard.yml must exist");
    assert.equal(pushesToMain(guard.text), false, "pr-base-guard must not run on push");
    assert.ok(
      !concurrencyOf(guard.text)?.group.includes("github.ref"),
      "pr-base-guard's exemption rests on its group NOT being ref-keyed",
    );
  });
});
