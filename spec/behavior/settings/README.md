# Chapter Settings

The settings surface is the chapter's configuration home. It is organized as a **settings rail**, in the order board `4d` draws, with **Danger zone pinned last**. The rail's membership is `SETTINGS_TAB_VALUES` in `apps/web/components/settings/settings-page.tsx` and is not restated here — a hand-copied list of ten tab names is how this paragraph came to name two that no longer exist. This file covers the cross-cutting behavior plus the **Chapter** (formerly Org), **Modules** and **Privacy** tabs; the customization-heavy tabs (Accent, Roles, Fields, Workflows, Dues) are specced in [`customization.md`](customization.md).

Two renames and one split landed with the greenfield Admin lane ([#2146](https://github.com/pdcarlson/Frapp/issues/2146)), and the `?tab=` deep-link values did **not** change with the labels: **Org** is labelled "Chapter" (`?tab=org`), **Theme** is labelled "Accent" (`?tab=theme`), and Org's semester and billing/danger cards moved to their own **Semester** (`?tab=semester`) and **Danger zone** (`?tab=danger`) entries.

Related canon lives in:

- [`../chapter-config.md`](../chapter-config.md) — `GET/PATCH /chapters/:id/config` endpoints.
- [`../rbac.md`](../rbac.md) — role lifecycle and permission catalog.
- [`../branding.md`](../branding.md) — chapter logo and accent color.
- [`../billing.md`](../billing.md) — dues invoicing.
- [`../data-retention.md`](../data-retention.md) — pseudonymous analytics + the chapter opt-out surfaced by the Privacy tab.

## Chapter Tab (`?tab=org`)

- Identity fields: name, university, Greek letters, designation, school short, founded year, donation URL.
- **Archetype** is selectable from the eight supported archetypes. Switching archetype **resets modules, role pack, and vocabulary** to the new archetype's defaults; identity, branding, and custom fields are kept. The switch is confirmed before applying because of the reset.
- Archetype lookups always resolve through the `getArchetype()` helper, which falls back to the `ifc` archetype when the stored key is missing or unknown. Settings must never crash on a stale or in-flight archetype value, and must never read an archetype map directly by key without that guard.
- **Vocabulary** is configurable per chapter via three substitutable terms: pledge/aspirant/candidate, rush/recruitment/intake, and class/line/cohort. All settings copy and downstream surfaces render the chapter's chosen term through the vocabulary helper rather than hardcoding "rush" or "pledge."

## Modules Tab

- `enabled_modules` is a boolean map (`Record<string, boolean>`). The tab renders per-module **on/off toggles**.
- Modules are labeled by tier: **Free** (always-on, locked on) or **Chapter Pro** (the single paid tier). There is no per-module price.
- `enabled_modules` writes go through the config PATCH mutation (optimistic update, rollback on error). No tab component writes directly to the database.
- **In-flight state is per control, not per page.** `usePendingConfigKeys()` reports the config leaves currently saving (`enabled_modules.events`, `dues`, `branding`, …). Toggling one module switch disables only that switch; sibling switches and the other settings tabs stay interactive. Concurrent PATCHes against the same chapter config are serialised so two overlapping toggles cannot clobber each other.
- **Disabling a module immediately:**
  - Hides its nav item (gated on `isModuleEnabled`).
  - Removes its slash commands from the chat palette.
  - Mutes its system channel — it is **not** deleted, so re-enabling restores it.
- Module state is read from chapter config, never from a `window.*` global.

## Privacy Tab

- Chapter-wide data controls, gated by `chapter-config:manage`. Non-managers see the toggles read-only.
- **Analytics opt-out.** A single toggle writes the `chapters.analytics_opt_out` scalar through the config PATCH mutation (so it is audit-logged like every other settings change). The switch is framed positively ("Chapter analytics" on/off) to avoid a double-negative — *checked = analytics enabled = `analytics_opt_out` false*. Default is opt-in (analytics on); onboarding discloses this. The same flag gates PostHog session replay ([`observability.md` § Privacy and replay](../observability.md#privacy-and-replay)).
- When opted out, **web and mobile** emit **zero** events for the chapter's members (enforced at each app's `AnalyticsProvider` via the shared `isAnalyticsOptedOut` gate in `@repo/validation`) and the API repeats the check server-side as defense-in-depth. Full pipeline + keying semantics live in [`../data-retention.md`](../data-retention.md) (#analytics-events-pseudonymous).

## Beta Tab

> **Not yet built, and there is no longer a renderer or a rail entry.** The API contract below
> exists; the UI does not. The Beta tab used to render a coming-soon placeholder; the greenfield
> Admin lane ([#2146](https://github.com/pdcarlson/Frapp/issues/2146)) deleted that stub, its
> `COMING_SOON_TABS` constant and its rail entry, on the same "generated chrome advertising unbuilt
> work" reading that took `beta-badge.tsx`. Whoever builds this tab adds the rail entry back.
>
> The dashboard shell used to paint the badge from a hardcoded `BETA_CONFIG` constant, so every
> signed-in user saw a sidebar pill regardless of what was saved. The greenfield shell
> ([#2141](https://github.com/pdcarlson/Frapp/issues/2141)) **deleted that row and `beta-badge.tsx`
> outright** as generated chrome. So `beta_config` is now write-only end to end: the API still
> accepts and stores it, and nothing renders it anywhere.
>
> Whoever builds this tab is therefore building the renderer too, not wiring an existing one — and
> two of the four enum values below (`sidebar_pill`, `breadcrumb_pill`) name chrome that no longer
> exists, so the enum needs revisiting in the same change rather than being implemented literally.

- Beta preferences live in the chapter's `beta_config` object (`{ enabled, style }`), read and written through the audited config GET/PATCH like every other tab — shape in [`../chapter-config.md`](../chapter-config.md). Writes already work; nothing reads them yet.
- **Build channel.** A stable / beta selector writes `beta_config.enabled`. Beta would show a BETA badge; stable hides it. No badge renders today (see above). The channel is chapter-level — there is no per-user override.
- **Badge style.** `beta_config.style` is one of `sidebar_pill | breadcrumb_pill | top_banner | corner_badge`. The enum is enforced at the API boundary (`apps/api/src/interface/dtos/chapter-config.dto.ts`), so an unrecognized style is rejected rather than silently coerced to a default.
- **When the UI lands**, the badge MUST be sourced from the chapter's stored `beta_config` rather than a build-time constant, so a saved style takes effect without a redeploy. That was the defect the old hardcoded constant had; deleting the renderer removed the symptom, not the rule.

## Audit Rules

- **Audit-write on save:** a settings PATCH that **changes something** writes a row to `chapter_audit_log`. Each audit row is created `member_visible = true` and is mirrored to the `#chapter-audit` channel via the audit bridge. Read this as one row per *effective change*, not one row per request.
- **The two writers differ on a no-op save, and neither is "one row per request".** The core-profile `PATCH /chapters/current` writes **no** row when its diff is empty. `PATCH /chapters/:id/config` returns early only when its *update payload* is empty, which is not the same test: it assigns `branding`, `vocabulary`, `enabled_modules` and `beta_config` whenever the DTO merely carries the key, so a client that re-sends an unchanged jsonb object still gets a row whose `diff` has `from` equal to `to` (#1605). Do not assume a row means something changed, and do not assume a save without changes produced no row.
- **Audit writes are not transactional with the mutation they describe** (#1599). The row is inserted after the change commits, so an insert failure surfaces as a `500` on a change that persisted. Whether an identical retry then recovers the record depends on the writer: on the core-profile route the diff is now empty and nothing is written, so the change stays unaudited; on the config route a re-sent jsonb field writes a `from`-equals-`to` row. Do not build a compliance check on the assumption that every mutation has a row.
- **The Audit tab is not built, and has no rail entry.** When it lands it presents a paginated, filterable table of `chapter_audit_log` rows (filter by actor, action type, date range), with per-row expansion of the change `diff`. It rendered a coming-soon placeholder until [#2146](https://github.com/pdcarlson/Frapp/issues/2146) deleted that stub with the Beta one above. Not to be confused with the **Points** admin Audit tab, which is built and is a different surface.
- **Who sees which rows (#1773).** `GET /v1/audit-log` returns **only `member_visible` rows to every caller except the chapter's President**, who sees all of them, exec-only included. "President" is the member holding the chapter's seeded `PRESIDENT` system role — the one role that may carry the wildcard — not any permission a custom role can be minted with, so a custom role holding `chapter-config:view` + `members:view` reads the same member-visible history the `#chapter-audit` mirror shows. The filter is applied in the API (`ChapterAuditLogService.list` → the repository's `member_visible = true` predicate, which is what `idx_audit_log_chapter_visible` exists for); `chapter_audit_log` carries no SELECT policy because the service-role query is the only reader. A chapter with no President role (orphaned, or mid-transfer) has no exec-only readers until one exists.
- **`member_visible` is togglable per row, president-only.** Toggling `member_visible` **off retracts** the corresponding `#chapter-audit` message for non-president members **and** drops the row from their `GET /v1/audit-log` reads; toggling it back **on re-posts** it and restores the row. The toggle itself is not built yet; the read-side rule above is, so the toggle cannot ship visibly present and silently ineffective.
