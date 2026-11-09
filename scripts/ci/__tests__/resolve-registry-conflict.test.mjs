// `resolve-registry-conflict.mjs`: base-sync's mechanical merge of a record PR (#3783).
// Offline: every GitHub call goes through `makeFetchMock`.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseRegistry } from "../../check-api-breaking-changes.mjs";
import { REGISTRY_PATH } from "../record-shipped-builds.mjs";
import { planRegistryMerge, resolveRegistryConflict } from "../resolve-registry-conflict.mjs";
import { makeFetchMock } from "./helpers.mjs";

const REPO = "pdcarlson/Frapp";
const MERGE_BASE = "1".repeat(40);
const HEAD = "2".repeat(40);
const BASE = "3".repeat(40);

const entry = (platform, version, build, over = {}) => ({
  platform,
  version,
  build,
  sha: "a".repeat(40),
  recorded: "2026-11-06",
  ...over,
});
const text = (builds, extra = {}) => `${JSON.stringify({ builds, ...extra }, null, 2)}\n`;

const M = [entry("ios", "0.10.0", "10"), entry("android", "0.10.0", "5")];
// Two record PRs cut from the same main: A records 0.10.0 (11)/(6), B 0.10.1 (12)/(7).
const A = [entry("ios", "0.10.0", "11", { sha: "b".repeat(40) }), entry("android", "0.10.0", "6", { sha: "b".repeat(40) })];
const B = [entry("ios", "0.10.1", "12", { sha: "c".repeat(40) }), entry("android", "0.10.1", "7", { sha: "c".repeat(40) })];

describe("planRegistryMerge", () => {
  it("merges the base's registry with the branch's additions, so record PRs never need a hand merge", () => {
    // B merged first; A is now conflicted.
    const plan = planRegistryMerge({ mergeBaseText: text(M), headText: text([...M, ...A]), baseText: text([...M, ...B]) });
    assert.equal(plan.ok, true);
    assert.deepEqual(parseRegistry(plan.text).builds, [...M, ...B, ...A]);
    assert.deepEqual(plan.added, A);
  });

  it("keeps what the base changed since the branch was cut, a drop included", () => {
    const dropped = { ...M[0], dropped: "2026-12-01", reason: "minimum 0.10.1 live since 2026-11-30" };
    const plan = planRegistryMerge({
      mergeBaseText: text(M),
      headText: text([...M, ...A]),
      baseText: text([M[1]], { dropped: [dropped] }),
    });
    assert.equal(plan.ok, true);
    assert.deepEqual(parseRegistry(plan.text), { builds: [M[1], ...A], dropped: [dropped] });
  });

  it("adds nothing twice when the base already lists the branch's entries", () => {
    const plan = planRegistryMerge({ mergeBaseText: text(M), headText: text([...M, ...A]), baseText: text([...M, ...A]) });
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.added, []);
  });

  it("reads a missing registry at the merge base as empty", () => {
    const plan = planRegistryMerge({ mergeBaseText: null, headText: text(A), baseText: text(B) });
    assert.deepEqual(parseRegistry(plan.text).builds, [...B, ...A]);
  });

  it("refuses a branch that removes, rewrites, annotates or drops an entry it started from", () => {
    const refuse = (headText) =>
      planRegistryMerge({ mergeBaseText: text(M), headText, baseText: text([...M, ...B]) });
    assert.match(refuse(text([M[0], ...A])).reason, /changes or drops/);
    assert.match(refuse(text([{ ...M[0], sha: "f".repeat(40) }, M[1]])).reason, /changes or drops/);
    assert.match(refuse(text([{ ...M[0], note: "edited" }, M[1]])).reason, /edits ios\/0\.10\.0\+10/);
    const dropped = { ...M[0], dropped: "2026-12-01", reason: "minimum raised" };
    assert.match(refuse(text([M[1]], { dropped: [dropped] })).reason, /changes or drops/);
  });

  it("refuses an id the base records differently", () => {
    const plan = planRegistryMerge({
      mergeBaseText: text(M),
      headText: text([...M, A[0]]),
      baseText: text([...M, { ...A[0], sha: "d".repeat(40) }]),
    });
    assert.match(plan.reason, /ios\/0\.10\.0\+11 is recorded differently on the base branch/);
  });

  it("refuses an invalid registry on any side, a spliced one included", () => {
    const spliced = text(M).replace('"build": "10",', '"build": "10",\n      "build": "12",');
    const plan = planRegistryMerge({ mergeBaseText: text(M), headText: spliced, baseText: text(M) });
    assert.match(plan.reason, /the registry on the PR head is invalid \(line \d+ repeats the key `build`/);
  });
});

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const pr = (over = {}) => ({
  number: 3614,
  head: { ref: "shipped-builds/run-1-1", sha: HEAD, repo: { full_name: REPO } },
  ...over,
});
const contents = (sha, body) => ({
  method: "GET",
  path: `/contents/${REGISTRY_PATH}?ref=${sha}`,
  ...(body === null ? { status: 404, body: { message: "Not Found" } } : { body: { content: b64(body) } }),
});
const routes = ({ files = [{ filename: REGISTRY_PATH }], head = text([...M, ...A]), refStatus = 200 } = {}) => [
  { method: "GET", path: `/compare/${BASE}...${HEAD}`, body: { merge_base_commit: { sha: MERGE_BASE }, files } },
  contents(MERGE_BASE, text(M)),
  contents(HEAD, head),
  contents(BASE, text([...M, ...B])),
  { method: "GET", path: `/git/commits/${BASE}`, body: { tree: { sha: "basetree" } } },
  { method: "POST", path: "/git/trees", body: { sha: "newtree" } },
  { method: "POST", path: "/git/commits", body: { sha: "9".repeat(40) } },
  {
    method: "PATCH",
    path: "/git/refs/heads/shipped-builds/run-1-1",
    status: refStatus,
    body: refStatus === 200 ? {} : { message: "Update is not a fast forward" },
  },
];
const resolve = (over = {}, routeOver = {}) => {
  const { fetchImpl, calls } = makeFetchMock(routes(routeOver));
  return resolveRegistryConflict({ token: "t", pushToken: "app", repo: REPO, pr: pr(), baseRef: "main", baseSha: BASE, fetchImpl, ...over }).then(
    (result) => ({ result, calls }),
  );
};
const bodyOf = (calls, method, path) => JSON.parse(calls.find((c) => c.method === method && c.url.includes(path)).body);

describe("resolveRegistryConflict", () => {
  it("pushes a two-parent merge commit whose tree is the base's with the merged registry", async () => {
    const { result, calls } = await resolve();
    assert.equal(result.resolved, true);
    assert.equal(result.sha, "9".repeat(40));
    const tree = bodyOf(calls, "POST", "/git/trees");
    assert.equal(tree.base_tree, "basetree");
    assert.deepEqual(tree.tree.map(({ path, mode, type }) => ({ path, mode, type })), [
      { path: REGISTRY_PATH, mode: "100644", type: "blob" },
    ]);
    assert.deepEqual(parseRegistry(tree.tree[0].content).builds, [...M, ...B, ...A]);
    const commit = bodyOf(calls, "POST", "/git/commits");
    assert.deepEqual(commit.parents, [HEAD, BASE]);
    assert.equal(commit.tree, "newtree");
    assert.match(commit.message, /^Merge branch 'main' into shipped-builds\/run-1-1\n\n/);
    assert.match(commit.message, /ios 0\.10\.0 \(11\), android 0\.10\.0 \(6\)/);
    assert.deepEqual(bodyOf(calls, "PATCH", "/git/refs/heads/"), { sha: "9".repeat(40), force: false });
    // Reads through GITHUB_TOKEN; only the writes that make and push the commit use the App's.
    for (const c of calls) assert.equal(c.token, c.method === "GET" ? "t" : "app", `${c.method} ${c.url}`);
  });

  it("writes nothing for a PR that changes any other file", async () => {
    const { result, calls } = await resolve({}, { files: [{ filename: REGISTRY_PATH }, { filename: "README.md" }] });
    assert.deepEqual(result, { resolved: false, reason: `the PR changes more than ${REGISTRY_PATH}` });
    assert.ok(calls.every((c) => c.method === "GET"));
  });

  it("writes nothing for a branch that does more than add entries", async () => {
    const { result, calls } = await resolve({}, { head: text([M[0], ...A]) });
    assert.equal(result.resolved, false);
    assert.match(result.reason, /changes or drops/);
    assert.ok(calls.every((c) => c.method === "GET"));
  });

  it("never touches a fork's branch", async () => {
    const { result, calls } = await resolve({ pr: pr({ head: { ...pr().head, repo: { full_name: "someone/Frapp" } } }) });
    assert.equal(result.resolved, false);
    assert.equal(calls.length, 0);
  });

  it("reports a head that moved (a refused, non-forced ref update) as unresolved", async () => {
    const { result } = await resolve({}, { refStatus: 422 });
    assert.equal(result.resolved, false);
    assert.match(result.reason, /PATCH .* failed \(HTTP 422: Update is not a fast forward\)/);
  });
});
