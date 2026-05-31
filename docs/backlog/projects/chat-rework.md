# Chat rework

**Status:** active
**Epic:** [#426 — Chat rework (chunks 5–12)](https://github.com/pdcarlson/Frapp/issues/426)
**Spec:** canonical behavior lives in [`spec/behavior/chat/`](../../../spec/behavior/chat/), [`spec/behavior/settings/`](../../../spec/behavior/settings/), [`spec/ui/web-dashboard/`](../../../spec/ui/web-dashboard/), [`spec/architecture/`](../../../spec/architecture/), and the per-module behavior files. Architectural narrative + engineering principles: [`spec/architecture/`](../../../spec/architecture/) and [`spec/engineering.md`](../../../spec/engineering.md).
**Updated:** 2026-05-31

> The chat-first rework of `apps/web` (with downstream `apps/mobile`, `apps/landing`): chat is the
> product spine, ops modules are integrations on top of it. Delivered as numbered chunks. Chunks
> 01–06 are shipped; 07 is in progress (07a/07b/07d shipped; 07c/07e queued); 08–12 are queued.
> This file tracks delivery; the durable behavior these chunks
> implement now lives in the real `spec/` files linked above (no more chunk briefs in spec).

## Work units

> `State` mirrors the GitHub issue. Chunks 05/06 shipped (PRs #400/#487); their tracking issues
> #433/#434 were reconciled **closed** on 2026-05-30 to match this backlog. Chunks 01–04 predate the
> per-chunk sub-issues and are tracked by their merge PRs.

| Chunk | Issue | State | Shipped via | Notes |
| ----- | ----- | ----- | ----------- | ----- |
| 01 — Foundation: theme + shell | — | shipped | PR #229 | palette/type/shell → `spec/ui/brand-identity.md`, `spec/ui/web-dashboard/` |
| 02 — Data model + chapter directory + Edge Function | — | shipped | PR #231 | hot-path schema/ADRs → `spec/architecture/`; config → `spec/behavior/chapter-config.md` |
| 03 — Onboarding wizard | — | shipped | PR #239 | → `spec/behavior/onboarding.md`, `spec/ui/web-dashboard/` |
| 04 — Chat foundation + hot-path client | — | shipped | PR #278 | → `spec/behavior/chat/`, `spec/ui/web-dashboard/`, `spec/architecture/` |
| 05 — Chat integrations + slash commands + push | [#433](https://github.com/pdcarlson/Frapp/issues/433) | shipped | PR #400 | issue closed (reconciled). Canon → `spec/behavior/chat/`, `spec/behavior/notifications.md` |
| 06 — Settings shell + Org + Modules tabs | [#434](https://github.com/pdcarlson/Frapp/issues/434) | shipped | PR #487 | issue closed (reconciled). Canon → `spec/behavior/settings/`, `spec/ui/web-dashboard/` |
| 07 — Settings: Theme + Roles + Fields + Workflows + Dues | [#435](https://github.com/pdcarlson/Frapp/issues/435) | in progress | — | umbrella; split into 07a–07e sub-issues (was too big + mostly backend-blocked). Supersedes dup #490. Canon → `spec/behavior/settings/customization.md`, `spec/behavior/chapter-config.md`, `spec/ui/web-dashboard/` |
| ↳ 07a — Settings: Workflows tab | [#537](https://github.com/pdcarlson/Frapp/issues/537) | shipped | PR #542 | UI + config wiring (`workflows[]` read/write via config endpoint, audit-logged). No new migration. Canon → `spec/behavior/settings/customization.md` → Workflows |
| ↳ 07b — Settings: Roles tab | [#538](https://github.com/pdcarlson/Frapp/issues/538) | shipped | this PR | Pack / Matrix / Custom + **Live roles** sub-tabs; new `chapter_custom_roles` CRUD API (`/custom-roles`; reads require `chapter-config:view`, writes require `chapter-config:manage`; audit-logged, 409 dup-key, 403 core-delete). `/roles` redirects to `/settings?tab=roles` (live RBAC folded in). Custom-role **enforcement wiring** deferred → #555. Canon → `spec/behavior/settings/customization.md` → Roles, `spec/behavior/rbac.md`, `spec/ui/web-dashboard/screens.md` |
| ↳ 07c — Settings: Fields tab | [#539](https://github.com/pdcarlson/Frapp/issues/539) | open | — | custom member fields + new `chapter_custom_fields` CRUD API; options deep-cloned per chapter |
| ↳ 07d — Settings: Dues tab | [#540](https://github.com/pdcarlson/Frapp/issues/540) | in progress | this PR | wired `chapter_dues_config` read/write (DTO/schema declared `dues` but the service dropped it) + guard-parsed UI; **aligned cadence to spec** (`monthly`/`per_semester`/`per_quarter`) + added `installment_count` (migration `20260530193000`). Archetype-seed cadence vocab + onboarding dues provisioning deferred → follow-up |
| ↳ 07e — Settings: Theme dark color | [#541](https://github.com/pdcarlson/Frapp/issues/541) | open | — | UI-only (backend ready): add dark picker beside accent + WCAG + palette re-apply |
| 08 — Settings: Beta + Audit + ops-setup nudges | [#436](https://github.com/pdcarlson/Frapp/issues/436) | open | — | depends on 06. Canon → `spec/behavior/settings/`, `spec/ui/web-dashboard/` |
| 09 — Members directory + custom fields rendering | [#437](https://github.com/pdcarlson/Frapp/issues/437) | open | — | depends on 06. Canon → `spec/behavior/members.md`, `spec/ui/web-dashboard/` |
| 10a — Ops: Events (slash + RSVP renderer + check-in) | [#438](https://github.com/pdcarlson/Frapp/issues/438) | open | — | integration pattern → `spec/behavior/integrations.md`; module → `spec/behavior/events.md` |
| 10b — Ops: Tasks (slash + assignment renderer) | [#439](https://github.com/pdcarlson/Frapp/issues/439) | open | — | → `spec/behavior/tasks.md` |
| 10c — Ops: Points (slash + ledger renderer) | [#440](https://github.com/pdcarlson/Frapp/issues/440) | shipped | PR #535 | `/points grant\|deduct`; server-originated card. Canon → `spec/behavior/points.md`, `spec/behavior/chat/integrations.md` |
| 10d — Ops: Dues / Billing (slash + invoice renderer) | [#441](https://github.com/pdcarlson/Frapp/issues/441) | open | — | → `spec/behavior/billing.md` |
| 10e — Ops: Rush / Recruitment / Intake (vocab-aware) | [#442](https://github.com/pdcarlson/Frapp/issues/442) | open | — | → new `spec/behavior/rush.md` |
| 10f — Ops: Backwork (chat share + dashboard upload) | [#443](https://github.com/pdcarlson/Frapp/issues/443) | open | — | → `spec/behavior/backwork.md` |
| 10g — Ops: Reports (dashboard-only) | [#444](https://github.com/pdcarlson/Frapp/issues/444) | open | — | → `spec/behavior/reports.md` |
| 10h — Ops: Onboarding pathway (8-week milestones) | [#445](https://github.com/pdcarlson/Frapp/issues/445) | open | — | → `spec/behavior/onboarding.md` |
| 11 — Mobile chat parity (Expo) | [#446](https://github.com/pdcarlson/Frapp/issues/446) | open | — | → `spec/behavior/chat/`, `spec/architecture/`; smoke → `docs/internal/mobile/` |
| 12 — Marketing site refresh (chat-first CTA) | [#447](https://github.com/pdcarlson/Frapp/issues/447) | open | — | → `spec/ui/landing/`, `spec/product/positioning.md` |

## Dependency graph

- 01 → 02 → 03, 04 (foundation + data before onboarding/chat).
- 05 builds on 04 (chat hot path). 06 → {07, 08, 09} (settings shell before its tabs/members).
- 10a–10h build on 05 (chat integration pattern) and can proceed in parallel once 05 shipped.
- 11 (mobile parity) and 12 (marketing) can slip to immediately post-launch.

## Notes / decisions

- Chat is the spine; ops modules are integrations (slash command + rich renderer + system channel +
  optional dashboard). The integration pattern is canonical in `spec/behavior/integrations.md`.
- Solo project: an issue's open/closed state is its status; PRs close issues via `Closes #N`.
- 07d (#540) follow-ups: [#547](https://github.com/pdcarlson/Frapp/issues/547) (live GET/PATCH dues verification — blocked this session by the sandbox Supabase stack), [#548](https://github.com/pdcarlson/Frapp/issues/548) (annual-cadence decision + provision `chapter_dues_config` at onboarding).
- 07b (#538) decisions: `/roles` IA reconciled by **redirecting** the standalone page into Settings → Roles (live RBAC folded into a "Live roles" sub-tab); `chapter_custom_roles` got dedicated CRUD endpoints (rather than the config blob) since rows are individually addressable. Follow-up: [#555](https://github.com/pdcarlson/Frapp/issues/555) (wire `chapter_custom_roles` into permission enforcement + member assignment — presentation-only today). Also fixed in-PR: [#556](https://github.com/pdcarlson/Frapp/issues/556) (pre-existing `semester-rollover` spec date-math bug that was turning this PR's CI red).
- Stragglers not yet parented under #426 (re-parent or fold during triage): #374 (Chunk 05 slash
  dispatch), #485/#486 (Chunk 06 follow-ups), #491 (Chunk 12 landing), #492 (ops-module nudges),
  #494 (Chunk 10e Rush), #510 (Chunk 08 Beta/Audit), #519 (chunk-NN labels). #490 (Chunk 07 tabs)
  closed 2026-05-30 as a duplicate of #435.
