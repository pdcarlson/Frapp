---
name: signet-cutover
description: >
  Signet-surface cutover checklist — which tokens and typefaces are current vs legacy Frapp, that
  a cutover deletes what it replaces, and which committed reference board is visual truth. Use
  when building or reskinning UI, touching theme tokens, chapter accents, brand assets, frozen
  web/landing surfaces, or anything under spec/ui/.
---

# Signet surface cutover

> A rebuild or reskin **deletes what it replaces in the same change**. Do not leave a second live
> implementation "in case we need it later" — git history is the backup. Reach for this skill
> before extending a theme, copying a visual from an existing screen, or filing spec-vs-code drift
> on a UI surface.

Canonical docs (link, don't restate values):

| Topic | Canonical |
| --- | --- |
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
3. **Behavior spec wins over UI spec** for what the product *does*. UI specs never override
   [`spec/behavior/`](../../../spec/behavior/README.md).

## Current vs legacy — do not mix on one surface

| | **Signet (current)** | **Legacy Frapp (frozen)** |
| --- | --- | --- |
| Surfaces | `apps/mobile` now; web dashboard and landing **when they reskin** | `apps/web` and `apps/landing` until their Signet pass |
| Direction | Dark-first, warm, consumer (Notion dark / Cash App) | Light-first bone / bronze / ink |
| Typeface | **Figtree**. Geist is rejected. | Geist Sans in `@repo/theme` |
| House accent | Gold/amber `#EFB63B` / seed `#F2B72E` — never brown-bronze, never royal blue | Bronze `primary`, royal blue leftovers in old specs |
| Token home | `spec/ui/design-system/foundations.md` | `packages/theme` (`@repo/theme`, `globals.css`) |
| Spec status | Live | Frozen READMEs: [`web-dashboard`](../../../spec/ui/web-dashboard/README.md), [`landing`](../../../spec/ui/landing/README.md) |

**The two systems MUST NOT mix on one surface.** Do not import Signet tokens onto a frozen
web/landing screen, and do not copy bone/bronze/Geist/`#2563EB` onto a Signet screen. Frozen
READMEs mean: do not implement visual changes from those docs, and do not file spec-vs-implementation
drift against them.

New Signet work MUST NOT copy visual patterns from frozen surfaces. Assets still shipping the
legacy "F" mark / bone lockup are expected until the Signet asset pass — do not restyle them
piecemeal ([`spec/ui/assets.md`](../../../spec/ui/assets.md)).

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
- Do not extend `@repo/ui` / `@repo/theme` patterns onto Signet mobile — confirm real consumers
  first ([`AGENTS.md`](../../../AGENTS.md) tech-debt protocol).
- A definition or `index.ts` re-export is not evidence anything still calls it.

## Before you ship a visual change

1. Name the surface: Signet or frozen-legacy.
2. Read the matching spec (brand-identity + foundations for Signet; frozen README for web/landing).
3. Check the reference board, not a screenshot of current code, when the two disagree.
4. Confirm you are not mixing token systems.
5. Delete the path you replaced.
