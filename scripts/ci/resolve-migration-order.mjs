// Renumber a PR's migrations when `main` took a later version first (#4558 item 6).
//
// Many sessions write migrations at once. A PR's migration version is picked when
// the file is written, and the order is decided when PRs merge, so the usual
// story is: a PR adds `…150000_a`, another PR merges `…160000_b` first, and now
// the first PR's migration sorts before `main`'s newest. Git sees no conflict
// (different file names), the PR's checks stay green from before, and if it
// merges like that, staging's `db push` refuses it ("insert before the last
// migration on remote"). `npm run migration:renumber` (scripts/migration.mjs) is
// the one-command fix, but running it meant waking the PR's session, which
// re-reads its whole context to run one command.
//
// So `pr-base-sync.mjs` calls this for every clean, same-repository PR when
// `main` moves. When the PR's migrations no longer sort after `main`'s, it
// pushes the fix itself: ONE two-parent merge commit (the PR head, then `main`)
// whose tree is GitHub's own test merge of the two, with the branch's
// migrations (and their ledger pages) moved to fresh versions and every
// reference to them rewritten in the files the branch changed. That is exactly
// what the session would have done (`git merge origin/main` then
// `npm run migration:renumber`), with the same planner (`planRenames`) and the
// same rewriter (`rewriteReferences`).
//
// The push is refused, and the PR gets a wake comment carrying the exact command
// instead, whenever the fix is not mechanical or not safe to push from here:
//   * the head branch is not in this repository (a fork), or is the base itself;
//   * GitHub's test merge is not of this head and this base (computed against an
//     older base, or not at all);
//   * the branch changes `.github/workflows`: GitHub refuses an App without the
//     Workflows permission a ref whose workflows differ from `main`'s
//     (docs/ci-cd/agent-infra.md, the Release tags row), and that permission is
//     deliberately not granted;
//   * a changed file still names an old version on its own after the rewrite (an
//     anchor, a prose mention): it may be `main`'s migration of the same version,
//     which a person has to judge, as the local command says;
//   * the branch changes more files than this reads in one sweep.
// Reads go through GITHUB_TOKEN; the tree, commit and non-forced ref update go
// through the base-sync App's token, because only its push starts the PR's CI.
//
// One limit carries over from `migration:renumber`: it assumes no hosted
// database has applied the branch's own migrations. Staging and production apply
// from `main`, so that holds unless someone applied one by hand.

import { ghRequest } from "./lib/github.mjs";
import { MIGRATION_LEDGER_DIR } from "./lib/ops-docs.mjs";
import { planRenames, rewriteReferences } from "./lib/migration-versions.mjs";

export const MIGRATIONS_DIR = "supabase/migrations";
const MIGRATION_PATH = /^supabase\/migrations\/(\d{14}_[a-z0-9_]+\.sql)$/;
const MIGRATION_FILE = /^\d{14}_[a-z0-9_]+\.sql$/;
const WORKFLOWS = ".github/workflows/";
// Compare-API statuses for a path that did not exist at the merge base.
const NEW_FILE = new Set(["added", "renamed", "copied"]);

// The compare API lists at most this many files. A list that long may be cut,
// and a cut list could hide a reference, so the sweep never pushes on one.
export const COMPARE_FILE_CAP = 300;
// Each changed file costs one blob read, inside the sweep's ten-minute job.
export const MAX_REWRITE_FILES = 150;

const ledgerPage = (file) => `${MIGRATION_LEDGER_DIR}/${file.replace(/\.sql$/, ".md")}`;

/**
 * The renames that put a PR's migrations after the base's, and the paths that
 * move with them. Pure.
 *
 * @param {object} input
 * @param {Array<{ filename: string, status: string }>} input.files the PR's changed files (merge base to head)
 * @param {string[]} input.baseMigrations migration file names on the base tip
 * @param {string[]} [input.taken] versions this sweep already gave other PRs, kept clear
 * @returns {{ introduced: string[], renames: Array<{ from: string, to: string }> }}
 */
export function planMigrationRenames({ files, baseMigrations, taken = [], now = new Date() }) {
  const onBase = new Set(baseMigrations);
  // New since the merge base, as `migration:renumber` counts them: a modified
  // file was already there, whatever the base has done with it since.
  const introduced = files
    .filter((f) => NEW_FILE.has(f.status))
    .map((f) => MIGRATION_PATH.exec(f.filename)?.[1])
    .filter((name) => name && !onBase.has(name));
  // `taken` holds bare versions; planRenames reads only a name's first 14 characters.
  const floor = [...baseMigrations, ...taken.map((v) => `${v}_taken.sql`)];
  return { introduced, renames: planRenames(introduced, floor, now) };
}

/**
 * The tree entries for the renumber, or why there are none. Pure.
 *
 * @param {object} input
 * @param {Array<{ from: string, to: string }>} input.renames migration file names
 * @param {Map<string, { mode: string, sha: string }>} input.tree the test merge's blobs by path
 * @param {Map<string, string|null>} input.texts each changed file's text in the test merge; null when binary
 * @returns {{ ok: true, entries: object[], rewritten: string[] } | { ok: false, reason: string }}
 */
export function planRenumberTree({ renames, tree, texts }) {
  const moves = new Map();
  for (const { from, to } of renames) {
    moves.set(`${MIGRATIONS_DIR}/${from}`, `${MIGRATIONS_DIR}/${to}`);
    if (tree.has(ledgerPage(from))) moves.set(ledgerPage(from), ledgerPage(to));
  }
  for (const from of moves.keys()) {
    if (!tree.has(from)) return { ok: false, reason: `${from} is not in the test merge` };
  }
  for (const to of moves.values()) {
    if (tree.has(to)) return { ok: false, reason: `${to} already exists` };
  }

  const entries = [];
  const rewritten = [];
  const leftovers = [];
  const handled = new Set();
  for (const [path, text] of texts) {
    const target = moves.get(path) ?? path;
    const blob = tree.get(path);
    if (!blob) continue; // removed on the merge side
    handled.add(path);
    let next = text;
    if (text !== null) {
      const result = rewriteReferences(text, renames);
      next = result.text;
      for (const version of result.stale) leftovers.push(`${path} (${version})`);
    }
    if (next !== text && path.startsWith(WORKFLOWS)) {
      return { ok: false, reason: `${path} names a migration, and the App may not push workflow files` };
    }
    if (next !== text) rewritten.push(target);
    if (target !== path) entries.push({ path, mode: blob.mode, type: "blob", sha: null });
    if (next !== text) entries.push({ path: target, mode: blob.mode, type: "blob", content: next });
    else if (target !== path) entries.push({ path: target, mode: blob.mode, type: "blob", sha: blob.sha });
  }
  // A moved file the branch did not change itself (a ledger page from an earlier
  // commit is still "changed"; this is belt and braces): move it as it is.
  for (const [from, to] of moves) {
    if (handled.has(from)) continue;
    const blob = tree.get(from);
    entries.push({ path: from, mode: blob.mode, type: "blob", sha: null });
    entries.push({ path: to, mode: blob.mode, type: "blob", sha: blob.sha });
  }
  if (leftovers.length > 0) {
    return {
      ok: false,
      reason: `a changed file still names an old version on its own, which may be main's migration: ${leftovers.join(", ")}`,
    };
  }
  return { ok: true, entries, rewritten };
}

/** A `ghRequest` that returns the data or throws naming the call. */
function caller({ token, fetchImpl }) {
  return async (method, path, body) => {
    const res = await ghRequest({ token, fetchImpl, method, path, body, retry: method === "GET" });
    if (!res.ok) {
      const detail = typeof res.data === "string" ? res.data : res.data?.message ?? "";
      throw new Error(`${method} ${path.split("?")[0]} failed (HTTP ${res.status}${detail ? `: ${detail}` : ""})`);
    }
    return res.data;
  };
}

/**
 * The migration file names on the base tip, or null when they can't be read.
 * One read per sweep: the caller keeps the answer.
 */
export async function readBaseMigrations({ token, repo, baseSha, fetchImpl = fetch }) {
  const res = await ghRequest({
    token,
    fetchImpl,
    path: `/repos/${repo}/contents/${MIGRATIONS_DIR}?ref=${baseSha}`,
    retry: true,
  });
  // The contents API lists at most 1,000 entries; past that it would be cut.
  if (!res.ok || !Array.isArray(res.data) || res.data.length >= 1000) return null;
  return res.data.map((e) => e?.name).filter((name) => MIGRATION_FILE.test(name ?? ""));
}

const decode = (base64) => {
  const bytes = Buffer.from(base64, "base64");
  const text = bytes.toString("utf8");
  // Binary, or not UTF-8: leave it alone rather than mangle it on the way back.
  if (text.includes("\u0000") || !Buffer.from(text, "utf8").equals(bytes)) return null;
  return text;
};

/**
 * Whether a clean PR's migrations sort before the base's newest, and if so the
 * whole renumber, ready to push. Reads only, through `token`.
 *
 * @param {() => Promise<string[]|null>} getBaseMigrations the base's migrations, read once per sweep
 * @returns {Promise<
 *   | { needed: false }
 *   | { needed: null, reason: string }
 *   | { needed: true, ok: false, reason: string, renames: object[] }
 *   | { needed: true, ok: true, renames: object[], entries: object[], rewritten: string[],
 *       treeSha: string, headSha: string, branch: string }>}
 *   `needed: null` means the sweep could not tell, and should carry on as before.
 */
export async function planMigrationRenumber({
  token,
  repo,
  pr,
  baseSha,
  getBaseMigrations,
  taken = [],
  fetchImpl = fetch,
  now = new Date(),
}) {
  const headSha = pr?.head?.sha;
  const branch = pr?.head?.ref;
  const call = caller({ token, fetchImpl });
  let files;
  try {
    // per_page=1 keeps the commit list short; the file list is the whole comparison.
    const compare = await call("GET", `/repos/${repo}/compare/${baseSha}...${headSha}?per_page=1`);
    files = Array.isArray(compare?.files) ? compare.files : null;
  } catch (error) {
    return { needed: null, reason: error.message };
  }
  if (files === null) return { needed: null, reason: "the compare with the base returned no file list" };
  if (!files.some((f) => MIGRATION_PATH.test(f?.filename ?? ""))) return { needed: false };

  const baseMigrations = await getBaseMigrations();
  if (baseMigrations === null) return { needed: null, reason: `could not list ${MIGRATIONS_DIR} on the base` };
  const { renames } = planMigrationRenames({ files, baseMigrations, taken, now });
  if (renames.length === 0) return { needed: false };

  const refuse = (reason) => ({ needed: true, ok: false, reason, renames });
  if (pr?.head?.repo?.full_name !== repo) return refuse("the head branch lives in a fork, which this sweep cannot push to");
  if (typeof branch !== "string" || branch === pr?.base?.ref) return refuse("the head branch is not a PR branch of this repository");
  if (files.length >= COMPARE_FILE_CAP) return refuse(`the PR changes ${COMPARE_FILE_CAP} files or more, more than the sweep reads`);
  const changed = files.filter((f) => f.status !== "removed").map((f) => f.filename);
  if (changed.length > MAX_REWRITE_FILES) return refuse(`the PR changes more than ${MAX_REWRITE_FILES} files`);
  if (files.some((f) => f.filename?.startsWith(WORKFLOWS))) {
    return refuse("the PR changes `.github/workflows`, which the base-sync App may not push");
  }

  try {
    // GitHub's test merge of this head into this base: its tree is the merge the
    // session would have made. A test merge of another head or an older base is
    // stale, and nothing is pushed on it.
    const mergeSha = pr?.merge_commit_sha;
    if (typeof mergeSha !== "string") return refuse("GitHub has no test merge for this PR yet");
    const merge = await call("GET", `/repos/${repo}/git/commits/${mergeSha}`);
    const parents = new Set((merge?.parents ?? []).map((p) => p?.sha));
    if (parents.size !== 2 || !parents.has(baseSha) || !parents.has(headSha)) {
      return refuse("GitHub's test merge is not of this head and the new base yet");
    }
    const treeSha = merge?.tree?.sha;
    const listing = await call("GET", `/repos/${repo}/git/trees/${treeSha}?recursive=1`);
    if (listing?.truncated || !Array.isArray(listing?.tree)) {
      return refuse("the test merge's file list came back cut short");
    }
    const tree = new Map(
      listing.tree.filter((e) => e?.type === "blob").map((e) => [e.path, { mode: e.mode, sha: e.sha }]),
    );
    const texts = new Map();
    for (const path of changed) {
      const blob = tree.get(path);
      if (!blob) continue;
      const data = await call("GET", `/repos/${repo}/git/blobs/${blob.sha}`);
      texts.set(path, typeof data?.content === "string" ? decode(data.content) : null);
    }
    const plan = planRenumberTree({ renames, tree, texts });
    if (!plan.ok) return refuse(plan.reason);
    return { needed: true, ok: true, renames, entries: plan.entries, rewritten: plan.rewritten, treeSha, headSha, branch };
  } catch (error) {
    return refuse(error.message);
  }
}

/**
 * Push a planned renumber: a two-parent merge commit (the PR head, then the base)
 * on the test merge's tree with the renames applied, moving the head branch
 * without force. Writes through `pushToken` (the base-sync App's), because only a
 * push through it starts the PR's CI.
 *
 * @returns {Promise<{ resolved: true, sha: string } | { resolved: false, reason: string }>}
 */
export async function pushMigrationRenumber({ pushToken, repo, plan, baseRef, baseSha, fetchImpl = fetch }) {
  const write = caller({ token: pushToken, fetchImpl });
  try {
    const tree = await write("POST", `/repos/${repo}/git/trees`, {
      base_tree: plan.treeSha,
      tree: plan.entries,
    });
    const moved = plan.renames.map(({ from, to }) => `- ${from} -> ${to}`).join("\n");
    const rewritten = plan.rewritten.length > 0 ? plan.rewritten.map((p) => `- ${p}`).join("\n") : "- none";
    const commit = await write("POST", `/repos/${repo}/git/commits`, {
      message:
        `Merge branch '${baseRef}' into ${plan.branch} and renumber its migrations\n\n` +
        `${baseRef} took a later migration first, so this branch's migrations no longer sorted ` +
        `after ${baseRef}'s. pr-base-sync merged ${baseRef} and moved them, as ` +
        "`npm run migration:renumber` would (#4558):\n\n" +
        `${moved}\n\nReferences rewritten in:\n${rewritten}\n`,
      tree: tree?.sha,
      parents: [plan.headSha, baseSha],
    });
    // Not forced: a head that moved since it was read refuses the update.
    const ref = plan.branch.split("/").map(encodeURIComponent).join("/");
    await write("PATCH", `/repos/${repo}/git/refs/heads/${ref}`, { sha: commit?.sha, force: false });
    return { resolved: true, sha: commit.sha };
  } catch (error) {
    return { resolved: false, reason: error.message };
  }
}
