# Internal Operations Docs

This folder holds operator-facing runbooks and rollout trackers that are intended
for the engineering team.

Use this area for:

- environment rollout status
- deployment checklists
- incident and postmortem templates
- provider-specific operational procedures

## Current runbooks

- `DEPLOYMENT_STATUS.md`
- `DB_PROMOTION_RUNBOOK.md`
- `DB_ROLLBACK_PLAYBOOK.md`
- `CODERABBIT_RUNBOOK.md`
- `LOCAL_DEV.md` — **Default `npm run dev:stack`; ports, per-app commands, fallbacks**
- `ENV_REFERENCE.md` — **Definitive reference for all environment variables**
- `GITHUB_BRANCH_PROTECTION_RUNBOOK.md`
- `PR_REVIEW_PROCESS.md`
- `INCIDENT_RESPONSE_API_DOWN.md`
- `INCIDENT_RESPONSE_WEBHOOK_FAILURES.md`
- `INCIDENT_RESPONSE_DB_LATENCY.md`
- `SECRETS_MANAGEMENT.md` — Infisical setup and rotation policy
- `AGENT_INFRA.md` — CI/GitHub/PAT reference for agents
- `ALERT_ROUTING.md`
- `ACCESSIBILITY_TESTING_PROTOCOL.md`
- `STATE_MICROCOPY_PACK.md`
- `UX_WRITING_GUIDE.md`
- `ICONOGRAPHY_GUIDELINES.md`
- `ICON_INTENT_MAP.md`
- `TYPOGRAPHY_GUIDELINES.md`
- `BRAND_ASSETS.md` — Frapp logos, favicons, OG, Expo export notes
- `MOBILE_INTERACTION_SMOKE_CHECKLIST.md`
- `MOBILE_THREAD_RESOLUTION_MAP.md`
- `PR_CONSOLIDATION_CANONICAL_PR_BODY.md`
- `PR_CONSOLIDATION_OPERATOR_CHECKLIST.md`
- `DOCS_CI.md` — docs/spec PR gate (`check-docs-impact.mjs`) and trade-offs

Developer-facing guides (canonical, markdown) live in [`docs/guides/`](../guides/README.md). The Next.js site at `apps/docs` is a shell with guide routes on **content freeze** (links to those files on GitHub).
