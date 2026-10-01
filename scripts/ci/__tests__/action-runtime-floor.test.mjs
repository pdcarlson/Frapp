import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { actionFiles, WORKFLOW_DIR, workflowFiles } from "./helpers/workflow-yaml.mjs";

// Keeps every action this repo runs on a release that runs on Node 24 (#3108).
//
// GitHub forces a `runs.using: node20` action onto Node 24 with a deprecation
// warning on every run, Deploy production included, and has announced Node 20's
// removal from the runner, after which such an action stops running. #3108 moved
// nine actions off node20; nothing else stops the next workflow from copying
// `actions/checkout@v4` out of an old snippet, or a bump from moving all three
// setup-node sites back together, and CI stays green either way.
//
// FLOORS holds, per action, the oldest release verified to run on Node 24: for
// a JavaScript action the first release whose own `action.yml` (at that tag)
// declares `runs.using: node24`, for a composite one the release whose steps,
// and everything they nest, were read. Any ref at or above its floor passes, so
// a forward bump needs no edit here. An action with no floor fails, because
// nobody has read its runtime yet: read `runs.using` in its `action.yml` at the
// tag you'd pin (`git fetch --depth 1 <repo> refs/tags/<tag>`, then
// `git show FETCH_HEAD:action.yml`), not its release notes, and add the entry.
const FLOORS = {
  "actions/cache": { floor: "v5", checked: "v4 node20, v5 node24; `cache/restore` the same" },
  "actions/checkout": { floor: "v5", checked: "v4 node20, v5 node24" },
  "actions/create-github-app-token": { floor: "v3", checked: "v2 node20, v3 node24" },
  "actions/download-artifact": { floor: "v7", checked: "v6 node20, v7 node24" },
  "actions/setup-node": { floor: "v5", checked: "v4 node20, v5 node24" },
  "actions/upload-artifact": { floor: "v6", checked: "v5 node20, v6 node24" },
  "docker/build-push-action": { floor: "v7", checked: "v6 node20, v7 node24" },
  "docker/setup-buildx-action": { floor: "v4", checked: "v3 node20, v4 node24" },
  "dorny/paths-filter": { floor: "v4", checked: "v3 node20, v4 node24" },
  "infisical/secrets-action": { floor: "v1.0.16", checked: "v1.0.15 node20, v1.0.16 node24" },
  "lycheeverse/lychee-action": { floor: "v2", checked: "composite at v2, nesting no action" },
  "supabase/setup-cli": { floor: "v2.1.2", checked: "composite at v2.1.2, nesting oven-sh/setup-bun@0c5077e (node24)" },
};

const USES_RE = /(?:^|[\s{,-])uses:\s*["']?([^"'\s,}#]+)["']?(.*)$/;
const VERSION_RE = /^v\d+(?:\.\d+)*$/;
const SHA_RE = /^[0-9a-f]{40}$/;

/** `{ where, ref, comment }` for every `uses:` in the workflows and composite actions. */
function usesRefs() {
  const files = [
    ...workflowFiles().map((name) => ({
      where: `.github/workflows/${name}`,
      text: readFileSync(join(WORKFLOW_DIR, name), "utf8"),
    })),
    ...actionFiles().map((a) => ({ where: `.github/actions/${a.name}/${a.file}`, text: a.text })),
  ];
  return files.flatMap(({ where, text }) =>
    text.split(/\r?\n/).flatMap((line, i) => {
      if (/^\s*#/.test(line)) return [];
      const m = line.match(USES_RE);
      return m ? [{ where: `${where}:${i + 1}`, ref: m[1], comment: m[2] }] : [];
    }),
  );
}

/** The external refs: not a local action or reusable workflow, not a Docker image (no Node runtime). */
const externalRefs = () => usesRefs().filter((u) => !u.ref.startsWith("./") && !u.ref.startsWith("docker://"));

/** `owner/repo`, lowercased (GitHub resolves it case-insensitively), and the version a ref pins. */
function parse({ ref, comment }) {
  const [path, pinned = ""] = ref.split("@");
  const action = path.split("/").slice(0, 2).join("/").toLowerCase();
  if (VERSION_RE.test(pinned)) return { action, version: pinned };
  // A commit pin carries its version as the trailing comment (#2647's form).
  const commented = comment.match(/#\s*(v\d+(?:\.\d+)*)\b/)?.[1];
  return { action, version: SHA_RE.test(pinned) && commented ? commented : null };
}

/** `a` is at or above `b`, comparing `v1.2.3` component-wise; a missing component is 0. */
function atLeast(a, b) {
  const [x, y] = [a, b].map((v) => v.slice(1).split(".").map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return true;
}

describe("action runtime floor (#3108)", () => {
  it("reads every external action ref", () => {
    // 68 refs at #3108. Far fewer means the reader broke, and every check below
    // would pass over the refs it missed.
    assert.ok(externalRefs().length >= 50, `expected the repo's external action refs, saw ${externalRefs().length}`);
  });

  it("every ref pins a version it can be checked by: a tag, or a commit with its version as a comment", () => {
    const bad = externalRefs()
      .filter((u) => parse(u).version === null)
      .map((u) => `${u.where}: ${u.ref}`);
    assert.deepEqual(bad, [], "pin `@vN` / `@vN.N.N`, or `@<40-hex sha> # vN.N.N`");
  });

  it("every action has a recorded floor", () => {
    const unknown = [...new Set(externalRefs().map((u) => parse(u).action))].filter((a) => !FLOORS[a]);
    assert.deepEqual(
      unknown,
      [],
      "read `runs.using` in each new action's action.yml at the tag you pin, and add its floor to FLOORS",
    );
  });

  it("every ref is at or above its action's node24 floor", () => {
    const below = externalRefs()
      .map((u) => ({ ...u, ...parse(u) }))
      .filter((u) => u.version && FLOORS[u.action] && !atLeast(u.version, FLOORS[u.action].floor))
      .map((u) => `${u.where}: ${u.ref} is below ${u.action}'s floor ${FLOORS[u.action].floor} (${FLOORS[u.action].checked})`);
    assert.deepEqual(below, [], "these releases run on Node 20, which GitHub is removing from its runners");
  });

  // A floor nothing uses is a check of nothing, and a stale one would let an
  // action come back later at whatever version its entry once recorded.
  it("every floor names an action the repo still runs", () => {
    const used = new Set(externalRefs().map((u) => parse(u).action));
    assert.deepEqual(
      Object.keys(FLOORS).filter((a) => !used.has(a)),
      [],
      "drop the FLOORS entry for an action no workflow or action uses any more",
    );
  });

  it("compares versions component-wise", () => {
    assert.ok(atLeast("v7", "v5"));
    assert.ok(atLeast("v5", "v5"));
    assert.ok(!atLeast("v4", "v5"));
    assert.ok(atLeast("v1.0.18", "v1.0.16"));
    assert.ok(!atLeast("v1.0.15", "v1.0.16"));
    assert.ok(atLeast("v2", "v1.9.9"));
    assert.ok(atLeast("v1.0.16", "v1.0.16"));
    assert.ok(!atLeast("v1", "v1.0.16"));
    assert.deepEqual(parse({ ref: "actions/cache/restore@v6", comment: "" }), { action: "actions/cache", version: "v6" });
    assert.deepEqual(parse({ ref: `Owner/Repo@${"a".repeat(40)}`, comment: " # v1.2.3" }), {
      action: "owner/repo",
      version: "v1.2.3",
    });
    assert.equal(parse({ ref: `owner/repo@${"a".repeat(40)}`, comment: "" }).version, null);
    assert.equal(parse({ ref: "owner/repo@main", comment: "" }).version, null);
  });
});
