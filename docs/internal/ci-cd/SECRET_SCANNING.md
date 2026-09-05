# Secret scanning (gitleaks)

Local **pre-commit** + **CI** secret scanning with [gitleaks](https://github.com/gitleaks/gitleaks).
This began as the ADR-13 mitigation for the GitHub-native secret scanning and **push protection** lost
when `pdcarlson/Frapp` went private — see ADR-13 / ADR-17 in
[`spec/architecture/README.md`](../../../spec/architecture/README.md).

**That premise no longer holds, and this gate is not waiting on it.** The repo is **public** again
(confirmed 2026-08-21 by fetching the README over `raw.githubusercontent.com` with no credentials:
HTTP 200 against a 404 control — the method and evidence table are in
[`AGENT_INFRA.md`](AGENT_INFRA.md) § GitHub environments and bootstrap secrets), so GitHub-native
secret scanning and push protection are available to it. What is unchanged is what this doc
describes: the `secret-scan` CI job is still a **required** check on every PR and push to `main`, so
the enforcement below is live and nothing here is a stopgap waiting to be replaced. **Whether to
adopt the native features as well, or instead, has not been decided** — ADR-17's "repo re-opens"
revisit trigger has fired and is unactioned. Do not read this section as recording a decision to
keep gitleaks over GHAS; it records that the original reason for choosing it has lapsed and nobody
has revisited the choice.

## How it works

One pinned gitleaks binary and one config (`/.gitleaks.toml`, which extends gitleaks' maintained default
ruleset) drive three layers, all routed through `scripts/scan-secrets.mjs`:

| Layer | When | Scans | Enforcement |
| --- | --- | --- | --- |
| **Pre-commit hook** (`.githooks/pre-commit`) | `git commit` | staged changes | local primary; bypass with `--no-verify` |
| **Local gate** (`npm run ci:local-gate`) | before opening a PR | branch range (`merge-base..HEAD`) | local; warns if gitleaks is missing |
| **CI `secret-scan` job** (`.github/workflows/ci.yml`) | every PR + push to `main` | the PR/push commit range | **required check** — the real push-protection replacement |

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
> | Explicitly requested (`npm run check:secrets`) — an audit | **refuses**, exits non-zero | warns, proceeds\* |
> | Fallen back to from range mode (unreachable `--base`, or the all-zeros new-branch sentinel) | warns, proceeds | warns, proceeds\* |
>
> \* Unless shallowness or a narrow refspec already proves the clone incomplete — those need no
> network, so an offline audit over a shallow clone still refuses. "Origin unreachable" only
> downgrades the *comparison* against the remote, which is the one signal that needs it.
>
> The fallback row never fails on purpose: CI drops to full mode on a force-push, and hard-failing
> there would red-light the required `secret-scan` check. The **`staged` and `range` modes** are not
> gated at all — they only ever scan a diff and legitimately run in shallow checkouts. Note that is
> a statement about the *mode*, not the flags: a `--base/--head` invocation whose base is unreachable
> falls back to full mode and does get the (warn-only) check, which is what the second row describes.
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
> neither should you.
>
> The guard's load-bearing signal is a **ref set comparison** against `git ls-remote`, because it is
> the only one of the three that catches a third shape the table does not list: an ordinary clone
> that is neither shallow nor narrowly configured, and has simply **not fetched lately**. That is the
> normal state of any long-lived working copy of this repo, where hundreds of short-lived `claude/*`
> and `bolt/*` branches are created and deleted continuously.
>
> Concretely, it asks the only question that settles it: **does this clone hold the commit each
> remote ref points at?** Three cheaper formulations were each tried and each let a real gap through:
>
> | Compared | Misses |
> | --- | --- |
> | Ref **counts** | git never prunes remote-tracking refs (`fetch.prune` defaults to false), so one ref for a branch deleted upstream pays for one head never fetched — equal counts, missing branch |
> | Ref **names** | a clone merely *behind* holds every branch name and none of the new commits — this is the middle row above |
> | Refs in **one namespace** | heads sit under `refs/heads/*` in a mirror and `refs/remotes/origin/*` in a working clone; a bare repo with a remote uses the latter, and a linked worktree of a bare repo reports non-bare |
>
> Comparing **object ids across `refs/**`** sidesteps all three, and is the honest denominator
> because `gitleaks git` walks `--all` — a remote commit present under any local ref really is
> scanned. **PR refs are part of the verdict too**, for the reason given below: they are the one
> place a secret can hide that no branch fetch will ever reach.
>
> To fix a clone the guard rejects, widen the refspec, then fetch everything:
>
> ```bash
> git remote set-branches origin '*'          # a --single-branch clone needs this FIRST
> git fetch --unshallow 2>/dev/null || true   # only needed for a shallow clone
> git fetch --prune origin '+refs/heads/*:refs/remotes/origin/*' '+refs/pull/*/head:refs/remotes/pr/*'
> # local refs vs what the remote actually has — these two should agree
> # `grep -v` drops the symbolic origin/HEAD, which ls-remote never lists — without it
> # the left side reads one higher than the right on any ordinary clone.
> git for-each-ref --format='%(refname)' 'refs/remotes/**' | grep -v '/HEAD$' | wc -l
> { git ls-remote --heads origin; git ls-remote origin 'refs/pull/*/head'; } | wc -l
> ```
>
> `set-branches` is not optional on a `--single-branch` or `--depth` clone: a command-line
> `git fetch` retrieves the refs but never rewrites the persisted `remote.origin.fetch`, so the
> next `git fetch` narrows the clone straight back again. `--prune` matters for the same reason
> the set comparison does — it is what clears refs for branches deleted upstream.
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
> the file exists (`scan-secrets.mjs:448`), and a generator run with that flag filters every finding
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

The `secret-scan` job is registered in `scripts/ci/lib/required-checks.mjs` (`CI_CHECKS`), which is
the intended required set. Whether it is live on a given branch depends on when an admin last ran
`GITHUB_PAT=… npm run configure:branch-protection`. That apply is a human step with an admin PAT:
the bare command is a live `PUT` of the whole protection payload, and an agent session runs
`npm run configure:branch-protection:verify` (which writes nothing) and nothing else. Read live state
per [`GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](../ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md#required-status-checks)
rather than from this page.

## Bumping the pinned version

Edit `GITLEAKS_VERSION` in `scripts/install-gitleaks.sh` — the single source of truth for the hook, the
local gate, and CI. Re-run `bash scripts/install-gitleaks.sh` to refresh the local cache.
