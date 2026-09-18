---
name: signet-cutover
description: >
  Signet-surface cutover checklist — which tokens and typefaces are current vs legacy Frapp, that
  a cutover deletes what it replaces, and which committed reference board is visual truth. Use
  when building or reskinning UI, touching theme tokens, chapter accents, brand assets, the
  web/landing surfaces mid-cutover, or anything under spec/ui/.
---

# Signet surface cutover

> A rebuild or reskin **deletes what it replaces in the same change**. Do not leave a second live
> implementation "in case we need it later" — git history is the backup. Reach for this skill
> before extending a theme, copying a visual from an existing screen, or filing spec-vs-code drift
> on a UI surface.

Canonical docs (link, don't restate values):

| Topic | Canonical |
| --- | --- |
| **Web rebuild (#2140): trust order, brand locks, tokens, deletions** | [`spec/ui/web-greenfield/`](../../../spec/ui/web-greenfield/README.md) |
| Brand (name, mark, typeface, lane) | [`spec/ui/brand-identity.md`](../../../spec/ui/brand-identity.md) |
| Token values | [`spec/ui/design-system/foundations.md`](../../../spec/ui/design-system/foundations.md) |
| Process rules + visual bans | [`spec/ui/design-system/README.md`](../../../spec/ui/design-system/README.md) |
| Chapter accent engine | [`spec/ui/design-system/accent-engine.md`](../../../spec/ui/design-system/accent-engine.md) |
| UI tree + visual precedence | [`spec/ui/README.md`](../../../spec/ui/README.md) |

## Visual truth

1. **Committed HTML references beat written docs.** If a doc disagrees with the reference, the doc
   is wrong and must be fixed.
2. Where the two references disagree, **[`canvas-screens.dc.html`](../../../spec/ui/design-system/reference/canvas-screens.dc.html)
   wins** over [`signet-design-system.dc.html`](../../../spec/ui/design-system/reference/signet-design-system.dc.html)
   (known case: 4 tabs, not the system board's stale 5-tab bar).
3. **On the web surface while [#2140](https://github.com/pdcarlson/Frapp/issues/2140) is open,**
   anything committed under
   [`spec/ui/web-greenfield/reference/`](../../../spec/ui/web-greenfield/reference/README.md) is the
   board for that surface, and [`spec/ui/web-greenfield/`](../../../spec/ui/web-greenfield/README.md)
   outranks [`web-dashboard/`](../../../spec/ui/web-dashboard/README.md) on visuals and structure.
   Distrust `web-dashboard/`'s **chrome**, not its contracts: its nav map, gating, routing and data
   contracts are still truth. Do not file drift against its visual prose during the epic. Mobile is
   unaffected.
4. **Behavior spec wins over UI spec** for what the product *does*. UI specs never override
   [`spec/behavior/`](../../../spec/behavior/README.md).

## Current vs legacy — do not mix on one surface

| | **Signet (current)** | **Legacy Frapp (retired)** |
| --- | --- | --- |
| Surfaces | **Every surface.** `apps/mobile`; all of `apps/web` (the #920 reskin is complete); `apps/landing` since its token cutover ([#2366](https://github.com/pdcarlson/Frapp/issues/2366)) | None. `apps/landing` was the last legacy consumer and is on Signet tokens now |
| Direction | Dark-first, warm, consumer (Notion dark / Cash App) | Light-first bone / bronze / ink |
| Typeface | **Figtree**. Geist is rejected. Both web surfaces ship it vendored at `packages/theme/fonts/FigtreeVF.woff2` (`next/font/local`, `--font-figtree`); static `Figtree-{Regular,Bold}.ttf` sit beside it for `next/og`, which cannot parse a variable woff2 — see that package's README before vendoring any fourth copy. | Geist Sans — deleted; `GeistVF.woff2` went with its last consumer |
| House accent | Gold/amber: house gold `#EFB63B`, accent seed `#DDB844` (the mark gold) — never brown-bronze, never royal blue | Bronze `primary`, royal blue leftovers in old specs |
| Token home | `spec/ui/design-system/foundations.md` (ladder `#131211` / `#1A1A1A` / `#211E1A` / `#2A2621` since #2143); web implementation: `packages/theme/src/signet.css` + `packages/theme/src/signet.ts`, bound as Tailwind keys in the shared preset `packages/theme/src/tailwind.config.ts` since [#2371](https://github.com/pdcarlson/Frapp/issues/2371), plus one surface-specific remainder per app (`gold.*` in `apps/web/tailwind.config.ts`, the three marketing type roles in `apps/landing/tailwind.config.ts`) | `packages/theme/src/globals.css` — **deleted** (#2366), with its package export |
| Spec status | Live — [`web-dashboard`](../../../spec/ui/web-dashboard/README.md) is **Active (Signet)**, but [`web-greenfield`](../../../spec/ui/web-greenfield/README.md) outranks it on web visuals while #2140 is open | None. [`landing`](../../../spec/ui/landing/README.md) was the last one, and [#2364](https://github.com/pdcarlson/Frapp/issues/2364) built it out through slice 3 ([#2368](https://github.com/pdcarlson/Frapp/issues/2368)) |

**The two systems MUST NOT mix on one surface**, and there is no longer a surface on the legacy
side of that line — so in practice: do not copy bone/bronze/Geist/`#2563EB` onto a Signet
screen. The `apps/web` migration window is **closed**: a legacy class or a live `dark:` variant on a
dashboard screen is a defect now, not a pending slice
([`ui-development`](../ui-development/SKILL.md)).

**The landing's reskin is built out, and that changes what its README means.** Its visual freeze was
lifted by [#2364](https://github.com/pdcarlson/Frapp/issues/2364) slice 0, so that doc carries the
reskin's nine decisions, three marketing type roles and marketing copy rules — read and implement
them. The **token** cutover ([#2366](https://github.com/pdcarlson/Frapp/issues/2366)), the **page
rebuild** ([#2367](https://github.com/pdcarlson/Frapp/issues/2367)) and the **polish slice**
([#2368](https://github.com/pdcarlson/Frapp/issues/2368)) have all merged: the surface is on
Figtree, the Signet ladder and the boards' section map, so drift is filable against its structure as
well as its tokens, and its composition IS a pattern to read now. Two carve-outs survive: the two
product frames inside the page carry literal sizes and radii transcribed from the product boards,
because frame internals deliberately sit off the marketing scale, and D4's signature moment on the
crest is cut until brand sign-off clears ([#2378](https://github.com/pdcarlson/Frapp/issues/2378)).

The landing's three marketing type roles (`--text-hero`, `--text-display-lg`, `--text-lead`) sit
**above** `foundations.md` §7's locked six and are declared in `apps/landing/app/globals.css`.
They are landing-only: reaching for one on a product surface is an off-scale defect, exactly as a
raw hex is. §7's amendment records why. The boards under
[`spec/ui/landing/reference/`](../../../spec/ui/landing/reference/README.md) were target state and
**now bind** — both cutover slices merged, so they are rank-1 visual truth for this surface and drift
against them is filable. Their README is the one place that status is stated, including the standing
exceptions.

Product marks ship locked emblem B from [`spec/ui/assets.md`](../../../spec/ui/assets.md); do not
restyle them piecemeal.

## Naming

Prose (specs, UI copy, marketing) says **Signet**. Code identifiers, package names (`@repo/*`),
domains (`frapp.live`), and bundle ids stay **frapp** until the deferred rename. When citing code,
cite the real current names.

## Cutover deletes what it replaces

When a reskin or rebuild supersedes an old implementation, **delete the superseded code in the
same change**, unless there is an explicit, stated reason to keep both live (a flag mid-rollout, a
documented migration window). Concrete:

- Do not add a parallel token set "next to" the one in use on that surface.
- Do not leave a shim that still serves the old look after the new one ships.
- Do not extend `apps/web/components/ui` (shadcn/Radix) or `@repo/theme` (legacy web exports) patterns onto Signet mobile — confirm real consumers
  first ([`AGENTS.md`](../../../AGENTS.md) tech-debt protocol).
- A definition or `index.ts` re-export is not evidence anything still calls it.

## Before you ship a visual change

1. Name the surface: Signet, or legacy pending its cutover.
2. Read the matching spec (brand-identity + foundations for Signet; the surface README for web/landing — the landing's is live, not frozen, and carries the reskin's decisions).
3. Check the reference board, not a screenshot of current code, when the two disagree.
4. Confirm you are not mixing token systems.
5. Delete the path you replaced.
