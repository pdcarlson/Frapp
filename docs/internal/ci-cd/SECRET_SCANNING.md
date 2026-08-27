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

> ### The audit is only as complete as the clone's refs
>
> **This is enforced, not just documented.** Since #931, `scan-secrets.mjs` checks ref completeness
> in **full mode only**, before scanning, and reports coverage on the success line so an audit
> record entry can quote what was actually covered. Severity depends on how full mode was reached:
>
> | How full mode was reached | Incomplete clone | Origin unreachable |
> | --- | --- | --- |
> | Explicitly requested (`npm run check:secrets`) — an audit | **refuses**, exits non-zero | warns, proceeds |
> | Fallen back to from range mode (unreachable `--base`, or the all-zeros new-branch sentinel) | warns, proceeds | warns, proceeds |
>
> The fallback row never fails on purpose: CI drops to full mode on a force-push, and hard-failing
> there would red-light the required `secret-scan` check. `--staged` and `--base/--head` are not
> gated at all — they only ever scan a diff and legitimately run in shallow checkouts.
>
> **`check:secrets` deliberately passes no `--log-opts`.** Bare `gitleaks git` already defaults to
> `git log -p -U0 --full-history --all --diff-filter=tuxdb`, so `--all` is *already* in effect.
> Do not "helpfully" add it: supplying any `--log-opts` **replaces** that whole default set rather
> than extending it, silently dropping `--full-history` and `--diff-filter=tuxdb`.
>
> What `--all` cannot do is walk refs the clone does not have — and **this, not the flag, is the
> real way an audit under-reports.** Two traps, neither caught by the obvious check:
>
> | Clone shape | `--is-shallow-repository` | Commits scanned (measured 2026-08-15) |
> | --- | --- | --- |
> | Shallow (`--depth`, many CI/cloud sandboxes) | `true` | as few as 1 |
> | Full-depth but `--single-branch` / only `main` fetched | **`false`** | 445 of 1659 |
> | All heads + PR refs | `false` | 1659 |
>
> These are absolute counts from one day; they grow as commits land. **The ratio is the point, not
> the number** — if your own run reports far fewer than the remote's history should yield, suspect
> the ref set before anything else.
>
> The middle row is the dangerous one: `git rev-parse --is-shallow-repository` says `false`,
> `git fetch --unshallow` errors as a no-op, and the scan reports clean having covered ~27% of
> history. **Do not use shallowness as the completeness check** — the guard above does not, and
> neither should you. A cloud sandbox measured on 2026-08-27 makes the point sharper still: its
> `remote.origin.fetch` was exactly the full glob while it held **2 of origin's 324 heads**, so a
> refspec check alone would have passed it too. Only the ref-count comparison catches both rows.
>
> To fix a clone the guard rejects, fetch everything and check that you hold as many refs as the
> remote offers:
>
> ```bash
> git fetch origin '+refs/heads/*:refs/remotes/origin/*' '+refs/pull/*/head:refs/remotes/pr/*'
> # local refs vs what the remote actually has — these two should agree
> git for-each-ref --format='%(refname)' 'refs/remotes/**' | wc -l
> { git ls-remote --heads origin; git ls-remote origin 'refs/pull/*/head'; } | wc -l
> ```
>
> **Compare refs, not commit counts.** `git rev-list --count --all` will *not* match the "commits
> scanned" figure gitleaks prints — gitleaks' default `--diff-filter=tuxdb` skips merge commits and
> some patch types, so on a fully-fetched clone here `rev-list --count --all` reads ~1998 against
> gitleaks' ~1659. Both are correct; they count different things. Chasing that gap is a dead end.
>
> PR refs matter: a secret pushed to a pull request that was closed or whose branch was deleted is
> still on the remote and still fetchable, but a plain `git clone` never retrieves it. The three
> incremental layers above are unaffected by all of this — they only ever scan a diff.

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

A `/.gitleaks-baseline.json` **does** ship, holding the **five** accepted historical false positives
triaged in the audit record below. Without it `npm run check:secrets` exits non-zero on every run,
which is why the audit command was unusable as a recorded check before 2026-08-15.

It is generated `--redact`, so it carries fingerprints and no secret values. Entries are pinned to a
specific commit + file + rule, so they suppress only those exact findings; a newly introduced secret
is still caught (verified with a token-shaped probe). Regenerate it only alongside a new audit record
entry, **from a clone with the full ref set** — regenerating from a partial clone silently drops the
entries whose commits it cannot reach, and the result red-lights `check:secrets` for everyone else:

```bash
# Note: deliberately WITHOUT --baseline-path, and note the temporary move.
mv .gitleaks-baseline.json .gitleaks-baseline.json.bak
.cache/gitleaks/gitleaks git --no-banner --redact -c .gitleaks.toml \
  --report-format json --report-path .gitleaks-baseline.json --exit-code 0
```

> **Do not "align" this command with `buildGitleaksArgs`.** Full mode adds `--baseline-path` whenever
> the file exists (`scan-secrets.mjs:148`), and a generator run with that flag filters every finding
> against the baseline already on disk and writes **`[]`** — with `--exit-code 0` suppressing any
> complaint. Committing that empty array silently un-accepts all five findings. Moving the file aside
> first (above) makes the run independent of whatever is already committed. Otherwise the flags must
> match the scan's, because baseline matching compares findings field by field — which is also why
> `--redact` appears on both sides.

## Audit history

The three layers above gate *new* commits. They cannot prove the two things only a full sweep can:
that nothing secret survives in history, and that nothing secret reaches a browser bundle. Record
every such audit here so the claim stays checkable.

### 2026-08-15 — full-history + browser-bundle audit (#851)

**Result: no Frapp secrets in git history, and none in any client bundle. Rotation list: empty.**

| Scope | Method | Result |
| --- | --- | --- |
| Git history — **204 heads + 400 PR refs** | `gitleaks 8.30.1`, repo config, defaults, **1659 commits / 25.2 MB** | 5 findings, **all false positives** (below) |
| `apps/web` client bundle | production build (`turbo build`), `gitleaks dir` over `.next/static` | no leaks |
| `apps/landing` client bundle | production build, `gitleaks dir` over `.next/static` | no leaks |
| `apps/web` + `apps/landing` | swept emitted client output for the 15 server-only variable *names* listed below | none present |
| `apps/mobile` | every `process.env.*` read in source + `eas.json` | only the three documented `EXPO_PUBLIC_*` values |

All five history findings are accepted into `/.gitleaks-baseline.json`:

1. `stripe-access-token` — `scripts/check-api-contract-drift.mjs` @ `9b4ffd5`. An `sk_`-prefixed
   literal whose body is the word "placeholder": the `STRIPE_SECRET_KEY` fallback for the OpenAPI
   export, which never calls Stripe. No key material — it matches only because the rule keys on the
   prefix. Already neutralised on `main`, which now uses prefix-free placeholders.
2. `generic-api-key` — `apps/api/README.md` @ `6a2d71c`. The stock `nest new` scaffold README. The
   match is the scaffold's literal dummy badge-URL token (`abc123…`), shipped identically in every
   NestJS scaffold — not a credential belonging to Frapp or to anyone. Replaced by a real README.
3–5. `jwt` ×2 and `stripe-access-token` — `docs/internal/environment/ENV_REFERENCE.md` @ `9d43093`, a commit
   reachable **only from PR refs**, never from `main`. The two JWTs decode to `iss: supabase-demo`,
   roles `service_role` and `anon`: the deterministic **local** Supabase keys that ship with
   `supabase start`, published in Supabase's own docs and byte-identical for every developer on
   earth. They authenticate only against `127.0.0.1:54321`. The line documenting them says so
   explicitly. The third is the same `sk_`-prefixed placeholder literal as finding 1.

> Writing these values out in full would re-trip the very rules that flagged them — the pre-commit
> hook rejected an earlier draft of this section for exactly that reason. Describe findings by
> prefix and location, never by value; that is also why the baseline is generated `--redact`.

**Nothing here is rotatable, so the rotation list is empty and no `[human]` rotation issues were
filed.** Findings 3–5 are the reason the ref-completeness rule above exists: they are invisible to
any clone that has not fetched PR refs, which is every default `git clone`.

The 15 server-only names swept for in the client bundles, so a re-run is comparable:
`SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ANALYTICS_HMAC_SALT`,
`POSTHOG_API_KEY`, `SUPABASE_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN`, `RENDER_DEPLOY_HOOK_URL`,
`SENTRY_AUTH_TOKEN`, `INFISICAL_CLIENT_SECRET`, `INFISICAL_TOKEN`, `JWT_SECRET`,
`SUPABASE_JWT_SECRET`, `GITHUB_PAT`, `CLAUDE_CODE_OAUTH_TOKEN`.

Method notes:

* The client-bundle sweep ran on a build using **placeholder** env values, so it proves *which
  variables reach the browser*, not which values. That is the durable property — whether a variable
  is client-visible is decided by its `NEXT_PUBLIC_`/`EXPO_PUBLIC_` prefix and where it is read, not
  by its value. A positive control confirmed the sweep's sensitivity: the injected placeholders were
  found inlined in the web bundle, so a real value would have been found too. It covers
  `.next/static`; server-rendered output is out of scope, which is sound only while no server-only
  secret is read in `apps/web` (today only `SUPABASE_AUTH_BYPASS`, a CI flag, is).
* **Correcting the prior record.** This entry replaces "a full-history audit at adoption found no
  existing secrets, so no baseline ships", which was undated and is now known to be wrong: the same
  history yields five findings, so the audit command had been exiting non-zero. It is also *not*
  true that the audit was ever branch-scoped by a missing flag — gitleaks' default has always
  included `--all`. Coverage was, and remains, a function of the clone's ref set alone.

## Required check / branch protection

The `secret-scan` job is registered in `scripts/configure-branch-protection.mjs` (`CI_CHECKS`), which is
the intended required set. Whether it is live on a given branch depends on when an admin last ran
`GITHUB_PAT=… npm run configure:branch-protection`; read live state per
[`GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](../ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md#required-status-checks)
rather than from this page.

## Bumping the pinned version

Edit `GITLEAKS_VERSION` in `scripts/install-gitleaks.sh` — the single source of truth for the hook, the
local gate, and CI. Re-run `bash scripts/install-gitleaks.sh` to refresh the local cache.
