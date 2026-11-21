// The pure half of `npm run migration:renumber` (scripts/migration.mjs): how
// versions are picked, which of a branch's migrations move, and how references
// to them are rewritten. No git, no file system, so the base-sync sweep
// (scripts/ci/resolve-migration-order.mjs), whose job holds an App key and may
// not shell out, plans its renumber with the same code the command runs.

const pad = (n, w = 2) => String(n).padStart(w, "0");

/** A 14-digit UTC version for a Date. */
export function versionOf(date) {
  return (
    `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

/**
 * The version one second after `version`. Hand-picked versions such as
 * `20261112250000` (hour 25) are not real times; Date.UTC rolls them over, and
 * the result still sorts after the input, which is all ordering needs.
 */
export function nextVersion(version) {
  const ms = Date.UTC(
    Number(version.slice(0, 4)),
    Number(version.slice(4, 6)) - 1,
    Number(version.slice(6, 8)),
    Number(version.slice(8, 10)),
    Number(version.slice(10, 12)),
    Number(version.slice(12, 14)),
  );
  const next = versionOf(new Date(ms + 1000));
  return next > version ? next : String(BigInt(version) + 1n).padStart(14, "0");
}

/**
 * `text` with each renamed migration's stem (`<version>_<name>`) replaced, in one
 * pass, so one rename's new name can never be rewritten again by another. Bare
 * versions are left alone: a bare `…150000` may be main's migration of the same
 * version. `stale` lists the bare old versions still present, for a person to check.
 */
export function rewriteReferences(text, renames) {
  const map = new Map(renames.map(({ from, to }) => [from.slice(0, -4), to.slice(0, -4)]));
  let next = text;
  if (map.size > 0) {
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // The lookahead keeps `…_a` from matching inside main's `…_ab`.
    const pattern = new RegExp(
      `(?:${[...map.keys()].sort((a, b) => b.length - a.length).map(escape).join("|")})(?![a-z0-9_])`,
      "g",
    );
    next = text.replace(pattern, (stem) => map.get(stem));
  }
  const stale = [...new Set(renames.map(({ from }) => from.slice(0, 14)))].filter((v) =>
    next.includes(v),
  );
  return { text: next, stale };
}

/** The first version after every version in `taken`, and no earlier than `now`. */
export function freshVersion(taken, now = new Date()) {
  const clock = versionOf(now);
  const newest = [...taken].sort().at(-1);
  if (!newest) return clock;
  const after = nextVersion(newest);
  return after > clock ? after : clock;
}

/**
 * The renames that put a branch's migrations after the base branch's.
 *
 * @param {string[]} introduced filenames the branch adds (absent on the base and the merge base)
 * @param {string[]} base filenames on the base branch
 * @returns {Array<{ from: string, to: string }>} empty when every introduced
 *   migration already sorts after the base's newest and no two share a version.
 *   Otherwise every introduced migration moves, in its original order, so the
 *   branch's own migrations keep their relative order.
 */
export function planRenames(introduced, base, now = new Date()) {
  const baseVersions = base.map((f) => f.slice(0, 14));
  const floor = [...baseVersions].sort().at(-1) ?? "";
  const mine = [...introduced].sort();
  const versions = mine.map((f) => f.slice(0, 14));
  const clean =
    versions.every((v) => v > floor) && new Set(versions).size === versions.length;
  if (clean) return [];

  const renames = [];
  let version = freshVersion(baseVersions, now);
  for (const from of mine) {
    const to = `${version}${from.slice(14)}`;
    if (to !== from) renames.push({ from, to });
    version = nextVersion(version);
  }
  return renames;
}
