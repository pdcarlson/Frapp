## 2. Git Branching Model

**One** long-lived branch maps to an environment. Production maps to a *commit*.

| Branch      | Environment   | Vercel                            | Render              | Supabase        |
| ----------- | ------------- | --------------------------------- | ------------------- | --------------- |
| `main`      | **Staging**   | CI deploys Preview → staging domains | `frapp-api-staging` | Staging project |
| `feature/*` | **Ephemeral** | No Vercel deploys                    | —                   | —               |

> ⚠️ **2026-09-04:** "Preview deploys" in this section no longer means a *push-triggered* Vercel
> build — both projects are unlinked from Git (ADR-21), so no push to `main` produces anything on
> Vercel. Merging to `main` still deploys staging web and landing, but through
> `deploy-vercel-staging.yml` after CI passes (#1578), which creates a Preview-target deployment
> itself. Render's `frapp-api-staging` is unchanged. See [§ 4 Vercel Setup](vercel.md).

**How it flows:**

```
feature/xyz ──PR──▶ main (staging) ──Deploy production (dispatch a SHA)──▶ production
```

1. Feature branches are typically created from `main`.
2. Feature PRs target `main`. Merging triggers staging deployments.
3. Test on staging domains (e.g. `app.staging.frapp.live`).
4. When ready for production, run the **Deploy production** workflow and give it the
   commit SHA you want live.
5. The workflow refuses any SHA that is not an ancestor of `main` or whose CI was not
   green, then migrates, deploys, and tags that exact commit.

> `develop` is not used, and neither is `production`. The `production` branch was retired
> in #1340: merging into it never named a commit, and Render's auto-deploy-on-commit meant
> a push shipped whatever was at the tip without waiting for CI. See `CONTRIBUTING.md` for
> the full branch model, merge strategy, and required checks.

**Vercel environment mapping:**

| Vercel environment           | Trigger                                      | Domain example                                 |
| ---------------------------- | -------------------------------------------- | ---------------------------------------------- |
| **Production**               | `deploy-production.yml` (API, `target: production`) | `app.frapp.live`, `frapp.live`          |
| **Preview** (pre-production) | `deploy-vercel-staging.yml`, after green CI on `main` | `app.staging.frapp.live`, `staging.frapp.live` |
| **Disabled**                 | Any other branch / PR                        | No deployment                                  |

The `main` branch's staging domain is configured by assigning the domain to the Preview environment and filtering to the `main` branch in Vercel's domain settings; `deploy-vercel-staging.yml` also aliases the hostname to each new deployment explicitly, because Vercel does not always attach it. Each app's `vercel.json` still carries `git.deploymentEnabled` (`"**": false` matches feature branch names that include `/`), but it is **inert** while the projects are unlinked — it governs the Git integration, and there is none. ADR-21 says to keep it regardless: it is the versioned form of a setting that is otherwise dashboard-only.

Production deployments are **built fresh from the named commit**, not promoted from its
`main` preview. `NEXT_PUBLIC_*` values are inlined at build time, so a preview build
carries the staging API URL and staging Supabase keys; promoting one would put the
production dashboard on staging infrastructure. See the header of
[`scripts/ci/deploy-vercel.mjs`](../../../../scripts/ci/deploy-vercel.mjs).

---
