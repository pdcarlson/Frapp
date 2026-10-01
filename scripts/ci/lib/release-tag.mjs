/**
 * Production's latest release tag, by `release.yml`'s own rule:
 * `git tag --list 'v*' --sort=-version:refname | head -n1`. A tag means "this
 * is what is live" (#1340), so every reader that asks what production runs
 * asks here, and they can't disagree.
 *
 * Readers: `check-migration-drift.mjs`'s release baseline, and
 * `resolve-deploy-sha.mjs`'s floor (#3114).
 *
 * The tag must be a plain `vX.Y.Z`, which is all `release.yml` mints. Anything
 * else on top (a hand-pushed `v1.9.0-rc1`, say) is an error rather than a quiet
 * step past it: `release.yml` would bump from that tag, so a reader that skipped
 * it would disagree with the next release about where production is.
 *
 * Never throws. `git` is required, so each caller keeps its own runner.
 */

export const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+$/;

/** `{ok: true, tag}`, or `{ok: false, tag, error}` (`tag` null when there is none). */
export function latestReleaseTag({ git }) {
  let tag;
  try {
    tag = git(["tag", "--list", "v*", "--sort=-version:refname"])
      .split("\n")
      .map((t) => t.trim())
      .find(Boolean);
  } catch (error) {
    return { ok: false, tag: null, error: `listing the v* tags failed: ${error.message}` };
  }
  if (!tag) return { ok: false, tag: null, error: "the checkout holds no v* tag" };
  if (!RELEASE_TAG_PATTERN.test(tag)) {
    return { ok: false, tag, error: `the latest v* tag, ${tag}, is not a vX.Y.Z release` };
  }
  return { ok: true, tag, error: null };
}
