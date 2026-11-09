// Resolve a shipped-builds registry conflict for a PR that only adds entries (#3783).
//
// Each Deploy production run that uploads store builds opens a record PR
// (`record-shipped-builds.mjs`) that appends its entries to the `builds` array
// of `apps/mobile/store/shipped-builds.json`. Two branches that append to one
// JSON array always edit the same lines (the last entry's `}` becomes `},`), so
// every record PR conflicts with the next one that merges, and no layout of a
// single JSON file avoids that. GitHub's server-side merge also ignores merge
// drivers in `.gitattributes`. So the conflict is resolved where it is found:
// `pr-base-sync.mjs` calls this before it posts its "merge conflicts" comment.
//
// The resolution is mechanical only when it is unambiguous:
//   * the PR changes no file but the registry (relative to its merge base),
//   * relative to its merge base the branch only ADDS entries to `builds`: it
//     changes, removes and drops nothing,
//   * no added entry collides with a different entry of the same id on the base.
// Then the merge is the base's registry plus the branch's added entries (via
// the record job's own `mergeRegistry`), and every other file is the base's,
// because the branch changed none. Anything else is left to a person, who gets
// the usual conflict comment.
//
// The result is pushed as a real two-parent merge commit through the git data
// API, with a non-force ref update: a branch that moved since it was read
// refuses it, and nothing is ever rewritten.

import { compareRegistries, entryId, parseRegistry } from "../check-api-breaking-changes.mjs";
import { ghRequest } from "./lib/github.mjs";
import { REGISTRY_PATH, mergeRegistry } from "./record-shipped-builds.mjs";

const FIELDS = ["platform", "version", "build", "sha", "recorded", "note"];
const sameEntry = (a, b) => FIELDS.every((f) => a[f] === b[f]);

/**
 * Decide the merged registry, or why there is none.
 *
 * @param {object} texts
 * @param {string|null} texts.mergeBaseText the registry at the merge base; null when absent
 * @param {string} texts.headText the registry on the PR head
 * @param {string} texts.baseText the registry on the base branch's tip
 * @returns {{ ok: true, text: string, added: object[] } | { ok: false, reason: string }}
 */
export function planRegistryMerge({ mergeBaseText, headText, baseText }) {
  const read = (text, which) => {
    try {
      return { registry: text === null ? { builds: [], dropped: [] } : parseRegistry(text) };
    } catch (error) {
      return { reason: `the registry on ${which} is invalid (${error.message.split("\n", 1)[0]})` };
    }
  };
  const mergeBase = read(mergeBaseText, "the merge base");
  const head = read(headText, "the PR head");
  const base = read(baseText, "the base branch");
  for (const side of [mergeBase, head, base]) if (side.reason) return { ok: false, reason: side.reason };

  // The branch must keep every entry it started from, unchanged and in place.
  const changed = compareRegistries(mergeBase.registry, head.registry);
  const startedWith = new Map(
    [...mergeBase.registry.builds, ...mergeBase.registry.dropped].map((e) => [entryId(e), e]),
  );
  const headDropped = head.registry.dropped;
  if (
    changed.length > 0 ||
    headDropped.length !== mergeBase.registry.dropped.length ||
    headDropped.some((e) => !startedWith.has(entryId(e)) || !sameEntry(e, startedWith.get(entryId(e))))
  ) {
    return { ok: false, reason: "the branch changes or drops registry entries, not only adds them" };
  }
  for (const e of head.registry.builds) {
    const before = startedWith.get(entryId(e));
    if (before && !sameEntry(e, before)) {
      return { ok: false, reason: `the branch edits ${entryId(e)}, not only adds entries` };
    }
  }
  const added = head.registry.builds.filter((e) => !startedWith.has(entryId(e)));

  // An id the base already lists must be the same entry, or the two sides disagree.
  const onBase = new Map(
    [...base.registry.builds, ...base.registry.dropped].map((e) => [entryId(e), e]),
  );
  for (const e of added) {
    const there = onBase.get(entryId(e));
    if (there && !sameEntry(e, there)) {
      return { ok: false, reason: `${entryId(e)} is recorded differently on the base branch` };
    }
  }
  const { text, added: fresh } = mergeRegistry(baseText, added);
  return { ok: true, text, added: fresh };
}

const label = (e) => `${e.platform} ${e.version} (${e.build})`;

/**
 * Merge the base branch into a conflicted PR whose only change is new registry
 * entries, and push the merge commit to its head branch.
 *
 * `token` reads; `pushToken` (the base-sync App's) makes the commit and moves
 * the branch, because only a push through it starts the PR's CI.
 *
 * @returns {Promise<{ resolved: true, sha: string, added: object[] } | { resolved: false, reason: string }>}
 */
export async function resolveRegistryConflict({ token, pushToken, repo, pr, baseRef, baseSha, fetchImpl = fetch }) {
  const call = async (method, path, body) => {
    const res = await ghRequest({
      token: method === "GET" ? token : pushToken,
      fetchImpl,
      method,
      path,
      body,
      retry: method === "GET",
    });
    if (!res.ok) {
      const detail = typeof res.data === "string" ? res.data : res.data?.message ?? "";
      throw new Error(`${method} ${path.split("?")[0]} failed (HTTP ${res.status}${detail ? `: ${detail}` : ""})`);
    }
    return res.data;
  };
  const headSha = pr?.head?.sha;
  const branch = pr?.head?.ref;
  if (pr?.head?.repo?.full_name !== repo || typeof headSha !== "string" || typeof branch !== "string") {
    return { resolved: false, reason: "the head branch is not in this repository" };
  }

  try {
    const compare = await call("GET", `/repos/${repo}/compare/${baseSha}...${headSha}`);
    const mergeBaseSha = compare?.merge_base_commit?.sha;
    const files = Array.isArray(compare?.files) ? compare.files : null;
    if (typeof mergeBaseSha !== "string" || files === null) {
      return { resolved: false, reason: "the compare with the base returned no merge base or file list" };
    }
    // The compare lists at most 300 files; a list that long is not registry-only anyway.
    if (files.length !== 1 || files[0]?.filename !== REGISTRY_PATH) {
      return { resolved: false, reason: `the PR changes more than ${REGISTRY_PATH}` };
    }

    const fileAt = async (ref) => {
      const res = await ghRequest({
        token,
        fetchImpl,
        path: `/repos/${repo}/contents/${REGISTRY_PATH}?ref=${ref}`,
        retry: true,
      });
      if (res.status === 404) return null;
      if (!res.ok || typeof res.data?.content !== "string") {
        throw new Error(`GET ${REGISTRY_PATH} at ${ref.slice(0, 12)} failed (HTTP ${res.status})`);
      }
      return Buffer.from(res.data.content, "base64").toString("utf8");
    };
    const [mergeBaseText, headText, baseText] = await Promise.all([
      fileAt(mergeBaseSha),
      fileAt(headSha),
      fileAt(baseSha),
    ]);
    if (headText === null || baseText === null) {
      return { resolved: false, reason: `${REGISTRY_PATH} is missing on one side` };
    }
    const plan = planRegistryMerge({ mergeBaseText, headText, baseText });
    if (!plan.ok) return { resolved: false, reason: plan.reason };

    // Every file but the registry is the base's: the branch changed no other.
    const baseCommit = await call("GET", `/repos/${repo}/git/commits/${baseSha}`);
    const tree = await call("POST", `/repos/${repo}/git/trees`, {
      base_tree: baseCommit?.tree?.sha,
      tree: [{ path: REGISTRY_PATH, mode: "100644", type: "blob", content: plan.text }],
    });
    const added = plan.added.length > 0 ? plan.added.map(label).join(", ") : "nothing new (the base already lists them)";
    const commit = await call("POST", `/repos/${repo}/git/commits`, {
      message:
        `Merge branch '${baseRef}' into ${branch}\n\n` +
        `Resolved by pr-base-sync (#3783): ${REGISTRY_PATH} is the only file this branch ` +
        `changes, and it only adds entries, so the merge is ${baseRef}'s registry plus this ` +
        `branch's: ${added}.`,
      tree: tree?.sha,
      parents: [headSha, baseSha],
    });
    // Not forced: a head that moved since it was read refuses the update.
    const ref = branch.split("/").map(encodeURIComponent).join("/");
    await call("PATCH", `/repos/${repo}/git/refs/heads/${ref}`, { sha: commit?.sha, force: false });
    return { resolved: true, sha: commit.sha, added: plan.added };
  } catch (error) {
    return { resolved: false, reason: error.message };
  }
}
