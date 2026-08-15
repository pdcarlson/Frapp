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
npm run check:secrets                                    # full-history audit (every ref)
node scripts/scan-secrets.mjs --staged                   # staged changes (what the hook runs)
node scripts/scan-secrets.mjs --base <sha> --head <sha>  # a commit range
```

> **The audit needs a complete clone.** `check:secrets` scans **every ref** (`--log-opts=--all`),
> not just the checked-out branch — an unmerged branch's history counts. Git can only walk the
> commits it actually has, so running it in a shallow checkout (`--depth`, and some CI/cloud
> sandboxes by default) silently scans a fraction and reports clean. Check with
> `git rev-parse --is-shallow-repository`; if it says `true`, run `git fetch --unshallow` first.
> The three incremental layers above are unaffected — they only ever scan a diff.

## When gitleaks flags something

`scan-secrets.mjs` exits non-zero and prints the finding (secret value redacted). Then:

- **Real secret?** Remove it from the diff and **rotate it** — treat anything committed as compromised,
  even after a force-push (the history may already be cloned).
- **False positive?** Use the narrowest fix:
  1. An inline `gitleaks:allow` comment on the offending line.
  2. A tight entry in `/.gitleaks.toml` `[allowlist]` (`paths` / `regexes` / `stopwords`).
  3. For a batch of pre-existing accepted findings, commit a `/.gitleaks-baseline.json`
     (`scan-secrets.mjs` passes `--baseline-path` automatically when that file exists).

Keep the allowlist tight — broad path globs hide real leaks.

A `/.gitleaks-baseline.json` **does** ship, holding two accepted historical false positives — see the
audit record below for what they are and why. It is generated `--redact`, so it carries fingerprints
and no secret values. Baseline entries are pinned to a specific commit + file + rule, so they suppress
only those exact findings; a newly introduced secret is still caught. Regenerate it only alongside an
audit record entry:

```bash
.cache/gitleaks/gitleaks git --no-banner --redact -c .gitleaks.toml --log-opts=--all \
  --report-format json --report-path .gitleaks-baseline.json --exit-code 0
```

## Audit history

The three layers above gate *new* commits. They cannot prove the two things only a full sweep can:
that nothing secret survives in history, and that nothing secret reaches a browser bundle. Record
every such audit here so the claim stays checkable.

### 2026-08-15 — full-history + browser-bundle audit (#851)

**Result: no Frapp secrets in git history, and none in any client bundle. Rotation list: empty.**

| Scope | Method | Result |
| --- | --- | --- |
| Git history, **all refs** | `gitleaks 8.30.1`, repo config, 1087 commits / 20.9 MB | 2 findings, **both false positives** (below) |
| `apps/web` client bundle | production build, `gitleaks dir` over `.next/static` | no leaks |
| `apps/landing` client bundle | production build, `gitleaks dir` over `.next/static` | no leaks |
| `apps/web` + `apps/landing` | swept emitted client output for 15 server-only variable *names* | none present |
| `apps/mobile` | every `process.env.*` read in source + `eas.json` | only the three documented `EXPO_PUBLIC_*` values |

Both history findings are accepted into `/.gitleaks-baseline.json`:

1. `stripe-access-token` — `scripts/check-api-contract-drift.mjs` @ `9b4ffd5`. A literal placeholder
   string used as the `STRIPE_SECRET_KEY` fallback for the OpenAPI export, which never calls Stripe.
   No key material. Already neutralised on `main`, which now uses prefix-free placeholders.
2. `generic-api-key` — `apps/api/README.md` @ `6a2d71c`. The stock `nest new` scaffold README,
   carrying **upstream `nestjs/nest`'s own public CI badge token** — boilerplate, not a Frapp
   credential. Replaced wholesale by a real README.

Method notes, so a re-run is comparable:

* The client-bundle sweep was run on a build using **placeholder** env values, so it proves *which
  variables reach the browser*, not which values. That is the durable property — whether a variable
  is client-visible is decided by its `NEXT_PUBLIC_`/`EXPO_PUBLIC_` prefix and where it is read, not
  by its value. A positive control confirmed the sweep's sensitivity: the injected public
  placeholders were found inlined in the web bundle.
* This audit is what surfaced the `--log-opts=--all` gap — before it, `check:secrets` scanned 481 of
  1087 commits. Any audit predating 2026-08-15 covered one branch only.

## Required check / branch protection

The `secret-scan` job is registered in `scripts/configure-branch-protection.mjs` (`CI_CHECKS`). Like the
ADR-14 review gate, it only becomes merge-blocking once the job exists on the target branch and has run
green — apply it with `GITHUB_PAT=… npm run configure:branch-protection` (a one-time admin step). Until
then the check still runs and surfaces failures, just non-blocking.

## Bumping the pinned version

Edit `GITLEAKS_VERSION` in `scripts/install-gitleaks.sh` — the single source of truth for the hook, the
local gate, and CI. Re-run `bash scripts/install-gitleaks.sh` to refresh the local cache.
