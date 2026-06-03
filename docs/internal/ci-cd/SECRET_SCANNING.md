# Secret scanning (gitleaks)

Local **pre-commit** + **CI** secret scanning with [gitleaks](https://github.com/gitleaks/gitleaks).
This is the ADR-13 mitigation for the GitHub-native secret scanning and **push protection** lost when
`pdcarlson/Frapp` went private — see ADR-13 / ADR-17 in
[`spec/architecture/README.md`](../../../spec/architecture/README.md).

## How it works

One pinned gitleaks binary and one config (`/.gitleaks.toml`, which extends gitleaks' maintained default
ruleset) drive three layers, all routed through `scripts/scan-secrets.mjs`:

| Layer | When | Scans | Enforcement |
| --- | --- | --- | --- |
| **Pre-commit hook** (`.githooks/pre-commit`) | `git commit` | staged changes | local primary; bypass with `--no-verify` |
| **Local gate** (`npm run ci:local-gate`) | before opening a PR | branch range (`merge-base..HEAD`) | local; warns if gitleaks is missing |
| **CI `secret-scan` job** (`.github/workflows/ci.yml`) | every PR + push to `main`/`production` | the PR/push commit range | **required check** — the real push-protection replacement |

The hook and local gate pass `--soft-missing`, so a contributor without the binary (e.g. offline) gets a
warning instead of a hard block — **CI is the authoritative gate**.

## Setup

The pre-commit hook installs itself: the root `package.json` `prepare` script
(`scripts/setup-git-hooks.mjs`) points git at `.githooks/` via `core.hooksPath` on `npm install`. That
supersedes any other local `.git/hooks` you have configured; undo it with `git config --unset core.hooksPath`.

The pinned gitleaks binary is the source of truth: `scripts/scan-secrets.mjs` ensures it on every run
(idempotent, checksum-verified) in the gitignored `.cache/gitleaks/`. A compatible `gitleaks` on PATH is
used only as a fallback when that installer can't run (e.g. offline). To pre-install:

```bash
bash scripts/install-gitleaks.sh   # pinned version → .cache/gitleaks/
# or, as an offline fallback:
brew install gitleaks
```

Run a scan manually:

```bash
npm run check:secrets                                    # full-history audit
node scripts/scan-secrets.mjs --staged                   # staged changes (what the hook runs)
node scripts/scan-secrets.mjs --base <sha> --head <sha>  # a commit range
```

## When gitleaks flags something

`scan-secrets.mjs` exits non-zero and prints the finding (secret value redacted). Then:

- **Real secret?** Remove it from the diff and **rotate it** — treat anything committed as compromised,
  even after a force-push (the history may already be cloned).
- **False positive?** Use the narrowest fix:
  1. An inline `gitleaks:allow` comment on the offending line.
  2. A tight entry in `/.gitleaks.toml` `[allowlist]` (`paths` / `regexes` / `stopwords`).
  3. For a batch of pre-existing accepted findings, commit a `/.gitleaks-baseline.json`
     (`scan-secrets.mjs` passes `--baseline-path` automatically when that file exists).

Keep the allowlist tight — broad path globs hide real leaks. A full-history audit at adoption found no
existing secrets, so no baseline ships by default.

## Required check / branch protection

The `secret-scan` job is registered in `scripts/configure-branch-protection.mjs` (`CI_CHECKS`). Like the
ADR-14 review gate, it only becomes merge-blocking once the job exists on the target branch and has run
green — apply it with `GITHUB_PAT=… npm run configure:branch-protection` (a one-time admin step). Until
then the check still runs and surfaces failures, just non-blocking.

## Bumping the pinned version

Edit `GITLEAKS_VERSION` in `scripts/install-gitleaks.sh` — the single source of truth for the hook, the
local gate, and CI. Re-run `bash scripts/install-gitleaks.sh` to refresh the local cache.
