// Resolve a PR's merge conflicts when every conflicted hunk is one where both
// sides only ADDED lines at the same place (2026-11-14 conflict plan).
//
// The usual shape: two PRs each append a line to the same barrel, a row to the
// same spec list, or a section to the same README. Git can't order the two
// insertions, so it stops, and pr-base-sync used to wake the PR's session to
// type "keep both". On 2026-11-14, 11 of the 18 hunks resolved by hand were this
// kind. `pr-base-sync.mjs` calls this before it posts its conflict comment; when
// the plan holds, it pushes the merge itself and wakes no one.
//
// A hunk is settled only when it is unambiguous: the merge base had nothing
// there (diff3's base section is empty), and the two added blocks can stand side
// by side. The result is main's lines first, then the branch's, as if the branch
// had been cut after main's change. Everything else is left to a person, who
// gets the usual conflict comment, and the whole PR is all or nothing: a PR with
// one real conflict left gets no partial push.
//
// "Keep both" can still produce broken code, so a hunk is refused when:
//   * both sides add the same line (other than blanks and lone punctuation),
//     after lines the two blocks share at their edges are kept once;
//   * outside prose, both sides add the same name: an import, an export, an
//     object, JSON or YAML key, an identifier alone on its line (keyCollisions);
//   * in code or data, either block's brackets don't balance on their own, so it
//     is a fragment of something larger that keep-both could interleave;
//   * in Markdown, either block opens or closes a code fence.
// And a PR is refused when:
//   * a file both sides changed is not a text file all three commits have with
//     one mode (modify/delete, add/add, binary, a mode change, a submodule);
//   * a conflict is in a generated file or a lockfile (merge:main regenerates
//     those), or a merged JSON file no longer parses;
//   * this merge finds no conflict where GitHub found one: the two disagree, so
//     a person looks;
//   * the head branch is in a fork, or the branch changes `.github/workflows`:
//     the base-sync App has no Workflows permission, and GitHub refuses it a ref
//     whose workflows differ from main's (resolve-migration-order.mjs);
//   * the branch adds a migration that now sorts before main's newest: the
//     renumber is merge:main's job, and the wake carries that command.
// Typecheck, tests and the other CI gates still run on the pushed merge, so a
// keep-both that compiles but means something wrong is caught where any other
// merge would be.
//
// GitHub runs no merge for a conflicted PR, so the merge is done here, in
// JavaScript and over the API alone: pr-base-sync never shells out
// (pr-base-sync-workflow.test.mjs), and git never runs on PR content while the
// App token is in the job. Three recursive tree reads (merge base, head, base)
// say which files each side changed. A file only the branch changed takes the
// branch's blob; a file both changed gets a line-level three-way merge (diff3)
// of its three blobs. The push is the registry merge's: one tree on the base's,
// one two-parent commit (the head, then the base), and a non-forced ref update,
// so a head that moved since it was read refuses it.

import { ghCaller } from "./lib/github.mjs";
import { planMigrationRenames } from "./resolve-migration-order.mjs";

const WORKFLOWS = ".github/workflows/";
const MIGRATION = /^supabase\/migrations\/([^/]+\.sql)$/;
// More files changed on both sides than this is not "a few appended lines"; a
// person looks. Each costs three blob reads through GITHUB_TOKEN.
export const MAX_BOTH_CHANGED = 25;
// The diff trace for one file pair, after trimming what both share at the ends:
// about (differing lines) x 2 x (lines) cells. 16M cells is 64 MB; a pair past
// it is refused, not swapped.
export const MAX_LCS_CELLS = 16_000_000;

// Generated or lockfile paths: never hand-merged; merge:main regenerates them.
// The contract pair mirrors CONTRACT_ARTIFACTS in scripts/check-api-contract-drift.mjs.
const REFUSED_PATH = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)(yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/,
  /^apps\/api\/openapi\.json$/,
  /^packages\/api-sdk\/src\/types\.ts$/,
  /^supabase\/migrations\//,
];
const MARKDOWN = /\.(md|mdx|markdown)$/i;
// Prose-like files where brackets carry no structure.
const PROSE = /\.(md|mdx|markdown|txt)$/i;

/**
 * For each line of `a`, the index of the line of `b` it matches in a shortest
 * edit script (Myers, as git diffs by default), or -1. Null when the two differ
 * in too many lines to trace. Pure.
 */
export function lcsMatches(a, b) {
  const match = new Int32Array(a.length).fill(-1);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) match[p] = p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) {
    match[a.length - 1 - s] = b.length - 1 - s;
    s++;
  }
  const n = a.length - p - s;
  const m = b.length - p - s;
  if (n === 0 || m === 0) return match;
  // Myers' O((N+M)D) diff, git's default, on the middle; the trace of each
  // step's furthest reach is kept to walk the matches back. Its size grows
  // with the number of differing lines, so a middle that differs a lot is
  // refused rather than held in memory.
  const max = n + m;
  const offset = max;
  let v = new Int32Array(2 * max + 2);
  const trace = [];
  let cells = 0;
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    cells += v.length;
    if (cells > MAX_LCS_CELLS) return null;
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[p + x] === b[p + y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  // Walk back from (n, m) through each step's snapshot taken before it.
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d];
    const k = x - y;
    const down = k === -d || (k !== d && prev[offset + k - 1] < prev[offset + k + 1]);
    const prevK = down ? k + 1 : k - 1;
    const prevX = prev[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      match[p + x] = p + y;
    }
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    match[p + x] = p + y;
  }
  return match;
}

/**
 * Three-way merge of line arrays: stable runs where all three agree, and
 * between them the region each side changed, taken from whichever side changed
 * it (or either, when both made the same change), else a conflict. Pure.
 *
 * @returns {Array<{ ok: string[] } | { conflict: { ours: string[], base: string[], theirs: string[] } }> | null}
 */
export function diff3(base, ours, theirs) {
  const mo = lcsMatches(base, ours);
  const mt = lcsMatches(base, theirs);
  if (!mo || !mt) return null;
  const chunks = [];
  const same = (x, y) => x.length === y.length && x.every((l, k) => l === y[k]);
  let i = 0;
  let a = 0;
  let b = 0;
  while (i < base.length || a < ours.length || b < theirs.length) {
    const stable = [];
    while (i < base.length && mo[i] === a && mt[i] === b) {
      stable.push(base[i]);
      i++;
      a++;
      b++;
    }
    if (stable.length) chunks.push({ ok: stable });
    let j = i;
    while (j < base.length && !(mo[j] >= 0 && mt[j] >= 0)) j++;
    const oEnd = j < base.length ? mo[j] : ours.length;
    const tEnd = j < base.length ? mt[j] : theirs.length;
    const O = ours.slice(a, oEnd);
    const B = base.slice(i, j);
    const T = theirs.slice(b, tEnd);
    if (O.length || B.length || T.length) {
      if (same(O, B)) chunks.push({ ok: T });
      else if (same(T, B) || same(O, T)) chunks.push({ ok: O });
      else chunks.push({ conflict: { ours: O, base: B, theirs: T } });
    }
    i = j;
    a = oEnd;
    b = tEnd;
  }
  return chunks;
}

/**
 * Merge one file both sides changed, settling each conflict by keeping both
 * sides' added lines, main's first. Pure.
 *
 * @param {object} input
 * @param {string} input.path the file's path, which picks the safety checks
 * @param {string} input.base the file at the merge base
 * @param {string} input.ours the file on the PR head
 * @param {string} input.theirs the file on the base branch's tip
 * @returns {{ ok: true, text: string, hunks: number } | { ok: false, reason: string }}
 */
export function mergeFile({ path, base, ours, theirs }) {
  if ([base, ours, theirs].some((t) => t.includes("\0"))) return { ok: false, reason: `${path} is binary` };
  const chunks = diff3(base.split("\n"), ours.split("\n"), theirs.split("\n"));
  if (!chunks) return { ok: false, reason: `${path} changed too much on both sides to compare line by line` };
  const out = [];
  let hunks = 0;
  for (const chunk of chunks) {
    if (chunk.ok) {
      out.push(...chunk.ok);
      continue;
    }
    if (chunk.conflict.base.length > 0) {
      return { ok: false, reason: `${path} has a conflict where a side changed or removed existing lines` };
    }
    const verdict = keepBoth({ ...chunk.conflict, path });
    if (!verdict.ok) return verdict;
    out.push(...verdict.lines);
    hunks++;
  }
  const text = out.join("\n");
  if (hunks > 0 && /\.json$/i.test(path)) {
    try {
      JSON.parse(text);
    } catch {
      return { ok: false, reason: `${path} would not parse as JSON after keeping both` };
    }
  }
  return { ok: true, text, hunks };
}

const meaningful = (line) => line.trim() !== "" && !/^[\s\p{P}\p{S}]*$/u.test(line);

/**
 * One hunk: main's added lines (`theirs`) then the branch's (`ours`), with the
 * meaningful lines both blocks share at their edges kept once. Pure.
 */
export function keepBoth({ ours, theirs, path }) {
  let a = [...ours];
  let b = [...theirs];
  const prefix = [];
  while (a.length && b.length && a[0] === b[0] && meaningful(a[0])) {
    prefix.push(a.shift());
    b.shift();
  }
  const suffix = [];
  while (a.length && b.length && a.at(-1) === b.at(-1) && meaningful(a.at(-1))) {
    suffix.unshift(a.pop());
    b.pop();
  }

  const shared = a.find((l) => meaningful(l) && b.some((m) => m.trim() === l.trim()));
  if (shared !== undefined) {
    return { ok: false, reason: `${path}: both sides add the line "${clip(shared)}"` };
  }
  // In prose, "Note:" on two lines is not a duplicate key.
  const collisions = PROSE.test(path) ? [] : keyCollisions(a, b);
  if (collisions.length) {
    return { ok: false, reason: `${path}: both sides add ${collisions.map((k) => `\`${k}\``).join(", ")}` };
  }
  if (MARKDOWN.test(path)) {
    if ([...a, ...b].some((l) => /^\s*(```|~~~)/.test(l))) {
      return { ok: false, reason: `${path}: an added block opens or closes a code fence` };
    }
  } else if (!PROSE.test(path)) {
    for (const block of [a, b]) {
      if (!balanced(block)) {
        return { ok: false, reason: `${path}: an added block is part of a larger bracketed structure` };
      }
    }
  }
  return { ok: true, lines: [...prefix, ...b, ...a, ...suffix] };
}

const clip = (s) => {
  const t = s.trim();
  return t.length > 80 ? `${t.slice(0, 77)}...` : t;
};

const IDENT = "[A-Za-z_$][\\w$]*";
const NAMED_LIST = new RegExp(`^\\s*(?:import|export)\\s+(?:type\\s+)?(?:${IDENT}\\s*,\\s*)?\\{([^}]*)\\}`);
const DEFAULT_IMPORT = new RegExp(`^\\s*import\\s+(?:type\\s+)?(${IDENT})\\s*(?:,|from\\b)`);
const NAMESPACE = new RegExp(`^\\s*(?:import|export)\\s+\\*\\s+as\\s+(${IDENT})`);
const DECLARATION = new RegExp(
  `^\\s*export\\s+(?:default\\s+)?(?:declare\\s+)?(?:async\\s+)?(?:abstract\\s+)?` +
    `(?:const|let|var|function\\*?|class|type|interface|enum|namespace)\\s+(${IDENT})`,
);
// `key:` in an object, JSON or YAML, quoted or not, optionally `key?:` (a TS
// member). `::` and `://` are not keys.
const KEY = /^\s*(?:-\s+)?["']?([\w$@.-]+)["']?\??\s*:(?!:|\/\/)/;
// An identifier alone on its line: a multi-line import or export list, an enum
// member, an array of names.
const BARE = new RegExp(`^\\s*(${IDENT})\\s*,?\\s*$`);

/** The names a line declares or keys, for the duplicate check. Pure. */
export function namesOf(line) {
  const names = [];
  const list = NAMED_LIST.exec(line);
  if (list) {
    for (const part of list[1].split(",")) {
      const m = new RegExp(`(?:type\\s+)?(${IDENT})(?:\\s+as\\s+(${IDENT}))?`).exec(part.trim());
      if (m) names.push(m[2] ?? m[1]);
    }
  }
  for (const re of [DEFAULT_IMPORT, NAMESPACE, DECLARATION]) {
    const m = re.exec(line);
    if (m) names.push(m[1]);
  }
  if (names.length === 0) {
    const key = KEY.exec(line) ?? BARE.exec(line);
    if (key) names.push(key[1]);
  }
  return names;
}

/** Names both added blocks declare. Pure. */
export function keyCollisions(a, b) {
  const left = new Set(a.flatMap(namesOf));
  return [...new Set(b.flatMap(namesOf))].filter((n) => left.has(n));
}

/**
 * Whether a block's (), [] and {} close what they open, outside quotes and
 * comments as far as one line at a time can tell. Pure.
 */
export function balanced(block) {
  const stack = [];
  const pairs = { ")": "(", "]": "[", "}": "{" };
  let inBlockComment = false;
  for (const line of block) {
    let quote = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inBlockComment) {
        if (c === "*" && line[i + 1] === "/") {
          inBlockComment = false;
          i++;
        }
        continue;
      }
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === "/" && line[i + 1] === "/") break;
      if (c === "#" && /^\s*$/.test(line.slice(0, i))) break;
      if (c === "/" && line[i + 1] === "*") {
        inBlockComment = true;
        i++;
      } else if (c === '"' || c === "'" || c === "`") {
        quote = c;
      } else if (c === "(" || c === "[" || c === "{") {
        stack.push(c);
      } else if (c in pairs) {
        if (stack.pop() !== pairs[c]) return false;
      }
    }
  }
  return stack.length === 0 && !inBlockComment;
}

/**
 * Merge the PR head with the base and settle every conflict, or say why not.
 * Reads only, through `token`.
 *
 * @returns {Promise<{ ok: true, branch: string, headSha: string, baseTree: string,
 *   entries: object[], files: string[], hunks: number } | { ok: false, reason: string }>}
 */
export async function planAddedLinesConflict({ token, repo, pr, baseRef, baseSha, fetchImpl = fetch, now = new Date() }) {
  const headSha = pr?.head?.sha;
  const branch = pr?.head?.ref;
  if (pr?.head?.repo?.full_name !== repo || typeof headSha !== "string" || typeof branch !== "string") {
    return { ok: false, reason: "the head branch is not in this repository" };
  }
  if (branch === baseRef) return { ok: false, reason: "the head branch is the base branch" };
  const call = ghCaller({ token, fetchImpl });
  try {
    const compare = await call("GET", `/repos/${repo}/compare/${baseSha}...${headSha}`);
    const mergeBase = compare?.merge_base_commit?.sha;
    if (typeof mergeBase !== "string") return { ok: false, reason: "the compare with the base returned no merge base" };

    const readTree = async (sha) => {
      const commit = await call("GET", `/repos/${repo}/git/commits/${sha}`);
      const tree = await call("GET", `/repos/${repo}/git/trees/${commit?.tree?.sha}?recursive=1`);
      if (tree?.truncated || !Array.isArray(tree?.tree)) throw new Error(`the tree at ${sha.slice(0, 12)} is too big to read whole`);
      const entries = new Map();
      for (const e of tree.tree) if (e.type !== "tree") entries.set(e.path, { mode: e.mode, type: e.type, sha: e.sha });
      return { sha: commit.tree.sha, entries };
    };
    const [mb, head, base] = await Promise.all([readTree(mergeBase), readTree(headSha), readTree(baseSha)]);
    const same = (x, y) => x?.sha === y?.sha && x?.mode === y?.mode;

    const changed = [...new Set([...mb.entries.keys(), ...head.entries.keys()])]
      .filter((path) => !same(mb.entries.get(path), head.entries.get(path)))
      .sort();
    if (changed.some((path) => path.startsWith(WORKFLOWS))) {
      return { ok: false, reason: "the PR changes `.github/workflows`, which the base-sync App may not push" };
    }
    const { renames } = planMigrationRenames({
      files: changed.map((filename) => ({ filename, status: mb.entries.has(filename) ? "modified" : "added" })),
      baseMigrations: [...base.entries.keys()].map((p) => MIGRATION.exec(p)?.[1]).filter(Boolean),
      now,
    });
    if (renames.length > 0) {
      return { ok: false, reason: "the PR's migrations need renumbering after main's, which `npm run merge:main` does" };
    }

    const entries = [];
    const both = [];
    for (const path of changed) {
      const m = mb.entries.get(path);
      const h = head.entries.get(path);
      const b = base.entries.get(path);
      if (same(b, m)) {
        // Only the branch changed it: the branch's version, or its deletion.
        entries.push(h ? { path, ...h } : { path, mode: m.mode, type: m.type, sha: null });
      } else if (!same(b, h)) {
        both.push(path);
      }
      // Else both made the same change, and the base already has it.
    }
    if (both.length > MAX_BOTH_CHANGED) {
      return { ok: false, reason: `${both.length} files changed on both sides, more than ${MAX_BOTH_CHANGED}` };
    }
    const blob = async (sha) => {
      const data = await call("GET", `/repos/${repo}/git/blobs/${sha}`);
      return Buffer.from(data?.content ?? "", data?.encoding === "base64" ? "base64" : "utf8").toString("utf8");
    };
    const files = [];
    let hunks = 0;
    for (const path of both) {
      const [m, h, b] = [mb, head, base].map((t) => t.entries.get(path));
      if (!m || !h || !b) return { ok: false, reason: `${path} was added or deleted on one side and changed on the other` };
      if (m.type !== "blob" || h.type !== "blob" || b.type !== "blob" || h.mode !== b.mode || m.mode !== h.mode) {
        return { ok: false, reason: `${path} is not a plain file with one mode on all three sides` };
      }
      const [baseText, ours, theirs] = await Promise.all([blob(m.sha), blob(h.sha), blob(b.sha)]);
      const merged = mergeFile({ path, base: baseText, ours, theirs });
      if (!merged.ok) return merged;
      // A clean merge of one is what git (and update-branch) would make too;
      // a conflict in one is never kept-both.
      if (merged.hunks > 0 && REFUSED_PATH.some((re) => re.test(path))) {
        return { ok: false, reason: `${path} is generated or a lockfile; \`npm run merge:main\` handles it` };
      }
      entries.push({ path, mode: h.mode, type: "blob", content: merged.text });
      if (merged.hunks > 0) files.push(path);
      hunks += merged.hunks;
    }
    if (files.length === 0) {
      return { ok: false, reason: "this merge finds no conflict where GitHub found one, so a person looks" };
    }
    return { ok: true, branch, headSha, baseTree: base.sha, entries, files, hunks };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

/**
 * Push a planned merge: a tree on the base's with the branch's changes and the
 * merged files, a two-parent commit (the PR head, then the base), and a
 * non-forced ref update. Reads through `token`; writes through `pushToken` (the
 * base-sync App's), because only a push through it starts the PR's CI.
 *
 * @returns {Promise<{ resolved: true, sha: string } | { resolved: false, reason: string }>}
 */
export async function pushAddedLinesMerge({ pushToken, repo, plan, baseRef, baseSha, fetchImpl = fetch }) {
  const write = ghCaller({ token: pushToken, fetchImpl });
  try {
    const tree = await write("POST", `/repos/${repo}/git/trees`, { base_tree: plan.baseTree, tree: plan.entries });
    const commit = await write("POST", `/repos/${repo}/git/commits`, {
      message:
        `Merge branch '${baseRef}' into ${plan.branch}\n\n` +
        `Resolved by pr-base-sync: in ${plan.files.join(", ")}, both sides only added lines at ` +
        `the same place (${plan.hunks} hunk${plan.hunks === 1 ? "" : "s"}), so the merge keeps both, ` +
        `${baseRef}'s lines first. CI checks the result like any other merge.`,
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
