# Documentation conventions

Where to put updates so **`docs/`** and **`spec/`** stay navigable and do not drift. PR checklist: [`.github/pull_request_template.md`](../../.github/pull_request_template.md).

## `spec/` vs `docs/`

| Kind of change                                | Primary place                         | Notes                                                                                                          |
| --------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Product behavior, rules, flows                | `spec/product.md`, `spec/behavior.md` | Link from guides only if onboarding must mention the flow                                                      |
| Architecture, data model, API patterns        | `spec/architecture.md`                | OpenAPI/SDK artifacts are code-owned; spec describes intent                                                    |
| Environments, CI/CD model                     | `spec/environments.md`                | Pair with `docs/DEPLOYMENT.md` when rollout steps change                                                       |
| UI product requirements                       | `spec/ui-*.md`                        | Design-system ops: `docs/internal/UI_UX_SYSTEM.md`, `UX_WRITING_GUIDE.md`                                      |
| Security requirements / threat notes          | `spec/security-*.md`                  | Historical fixes: `docs/SECURITY_FIXES.md`—do not duplicate long mitigation writeups; link to spec or runbooks |
| Test intent / coverage targets                | `spec/tests/*.spec.md`                | All test spec files use the `*.spec.md` suffix                                                                |
| How to run locally, test, contribute          | `docs/guides/`                        |                                                                                                                |
| Secrets, incidents, branch protection, agents | `docs/internal/`                      |                                                                                                                |
| Full deployment procedures                    | `docs/DEPLOYMENT.md`                  | Short overview: `docs/guides/deployment.md`                                                                    |

### Edge cases

- **Deployment:** Update **`docs/DEPLOYMENT.md`** and **`spec/environments.md`** when DNS, providers, or environment topology change. Adjust **`docs/guides/deployment.md`** only if contributor-facing “where to read” needs change.
- **DRY:** One canonical place per fact. Elsewhere, link to it (path + heading if helpful). If two docs must summarize, keep one paragraph max and link out.

## CI: same PR, one docs/spec touch

`scripts/check-docs-impact.mjs` fails if the PR changes **any** path outside `docs/` or `spec/` without also changing **at least one** path under `docs/` or `spec/`. It does not pick _which_ file—maintainers still judge relevance.

- **API / domain:** `spec/architecture.md` and/or `spec/behavior.md`, plus `docs/guides/api-architecture.md` or `database.md` when contributor docs need it.
- **UI:** Relevant `spec/ui-*.md` and/or `docs/internal/UI_UX_SYSTEM.md` / `UX_WRITING_GUIDE.md` per PR template.
- **Infra / CI:** `spec/environments.md` and/or `docs/internal/AGENT_INFRA.md`, `DOCS_CI.md`, or focused runbooks.
- **Mechanical / non-user-visible:** A short note in an existing related doc (e.g. `docs/internal/refactor-notes.md` or the nearest guide) is enough.

**Root-level files** such as `AGENTS.md` or `CONTRIBUTING.md` count as outside `docs/`/`spec/`—still require a `docs/` or `spec/` change in the same PR when edited.

## Agents and humans

- Map of folders: [`docs/README.md`](../README.md).
- Docs gate behavior: [`DOCS_CI.md`](DOCS_CI.md).
