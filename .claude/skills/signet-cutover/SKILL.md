---
name: signet-cutover
description: >
  Signet-surface cutover checklist: which tokens and typefaces are current and which are retired
  Frapp legacy, why a cutover deletes what it replaces, and which committed reference board is
  visual truth. Use when building or reskinning UI, touching theme tokens, chapter accents or brand
  assets, working on the web rebuild or the landing, or editing anything under spec/ui/.
---

# Signet surface cutover

A rebuild or reskin deletes what it replaces in the same change: a second live implementation is
two ways to do one thing, and git history is already the backup. Read this before extending a
theme, copying a visual from an existing screen, or filing spec-vs-code drift on a UI surface.

Canonical docs (link to them; don't restate their values):

| Topic | Canonical |
| --- | --- |
| Web rebuild (#2140): trust order, brand locks, tokens, deletions | [`spec/ui/web-greenfield/`](../../../spec/ui/web-greenfield/README.md) |
| Brand (name, mark, typeface, lane) | [`spec/ui/brand-identity.md`](../../../spec/ui/brand-identity.md) |
| Token values | [`spec/ui/design-system/foundations.md`](../../../spec/ui/design-system/foundations.md) |
| Process rules + visual bans | [`spec/ui/design-system/README.md`](../../../spec/ui/design-system/README.md) |
| Chapter accent engine | [`spec/ui/design-system/accent-engine.md`](../../../spec/ui/design-system/accent-engine.md) |
| UI tree + visual precedence | [`spec/ui/README.md`](../../../spec/ui/README.md) |

## Visual truth

1. Committed HTML references beat written docs. When a doc disagrees with its reference, the doc is
   wrong; fix it. The product name is the exception. The boards draw "Signet", and shipped copy
   follows [`brand-identity.md` § 1](../../../spec/ui/brand-identity.md#1-identity), so Frapp copy
   is never drift from a board.
2. Where the two design-system references disagree,
   [`canvas-screens.dc.html`](../../../spec/ui/design-system/reference/canvas-screens.dc.html) wins
   over [`signet-design-system.dc.html`](../../../spec/ui/design-system/reference/signet-design-system.dc.html)
   (for example, 4 tabs, not the system board's stale 5-tab bar).
3. On the web surface, until the [#2140](https://github.com/pdcarlson/Frapp/issues/2140) fold-back into `web-dashboard/`,
   [`spec/ui/web-greenfield/`](../../../spec/ui/web-greenfield/README.md) and anything committed
   under its [`reference/`](../../../spec/ui/web-greenfield/reference/README.md) outrank
   [`web-dashboard/`](../../../spec/ui/web-dashboard/README.md) on visuals and structure. Distrust
   only `web-dashboard/`'s chrome: its nav map, gating, routing and data contracts are still truth,
   and its visual prose is not grounds for a drift issue until then. Mobile is unaffected.
4. The behavior spec wins over UI specs for what the product does. UI specs never override
   [`spec/behavior/`](../../../spec/behavior/README.md).
5. For the landing, the boards under
   [`spec/ui/landing/reference/`](../../../spec/ui/landing/reference/README.md) bind as rank-1
   visual truth, and drift against them is filable. Their README is the one place their status and
   standing exceptions are stated.

## Current vs legacy — do not mix on one surface

Every surface is Signet: `apps/mobile`, all of `apps/web` (the #920 reskin is complete), and
`apps/landing` since its token cutover ([#2366](https://github.com/pdcarlson/Frapp/issues/2366)).
Legacy Frapp survives only as leftovers to remove, so never copy bone, bronze, Geist or `#2563EB`
onto a screen. In `apps/web` the migration window is closed: a legacy class or a live `dark:`
variant on a dashboard screen is a defect, not a pending slice
([`ui-development`](../ui-development/SKILL.md)). No surface is visually frozen; the seven mobile
hotspot files are frozen for merge contention instead
([`spec/ui/mobile/navigation.md`](../../../spec/ui/mobile/navigation.md) § Hotspot freeze).

| | Signet (current) | Legacy Frapp (retired) |
| --- | --- | --- |
| Direction | Dark-first, warm, consumer (Notion dark / Cash App) | Light-first bone / bronze / ink |
| Typeface | **Figtree**. Both web surfaces ship `packages/theme/fonts/FigtreeVF.woff2` (`next/font/local`, `--font-figtree`); static `Figtree-{Regular,Bold}.ttf` sit beside it for `next/og`, which can't parse a variable woff2. Read `packages/theme/README.md` before vendoring a fourth copy. | Geist Sans: rejected, and `GeistVF.woff2` is deleted |
| House accent | Gold/amber: house gold `#EFB63B`; the default accent seed is [`accent-engine.md` § 3](../../../spec/ui/design-system/accent-engine.md#3-default-seed). Never brown-bronze, never royal blue. | Bronze `primary`; royal blue in old specs |
| Tokens | Values in `foundations.md` (ladder `#131211` / `#1A1A1A` / `#211E1A` / `#2A2621`). Web: `packages/theme/src/signet.css` + `packages/theme/src/signet.ts`, bound as Tailwind keys in the shared preset `packages/theme/src/tailwind.config.ts`. Each app keeps one surface-specific remainder: `gold.*` in `apps/web/tailwind.config.ts`, the three marketing type roles in `apps/landing/tailwind.config.ts`. | `packages/theme/src/globals.css` and its package export, deleted in #2366 |

## The landing

[`spec/ui/landing/README.md`](../../../spec/ui/landing/README.md) is live, not frozen: it carries the
reskin's nine decisions, three marketing type roles and copy rules, so read and implement them. The
token cutover, page rebuild and polish slice have all merged, so the page's composition is a pattern
to read, and drift is filable against its structure as well as its tokens.

- The marketing type roles (`--text-hero`, `--text-display-lg`, `--text-lead`) sit above
  `foundations.md` §7's locked six and are declared in `apps/landing/app/globals.css`. They are
  landing-only: using one on a product surface is an off-scale defect, like a raw hex. §7's
  amendment records why.
- Two carve-outs: the two product frames inside the page carry literal sizes and radii transcribed
  from the product boards, because frame internals deliberately sit off the marketing scale; and
  D4's signature moment on the crest is cut until brand sign-off
  ([#2378](https://github.com/pdcarlson/Frapp/issues/2378)).

Product marks ship locked emblem B from [`spec/ui/assets.md`](../../../spec/ui/assets.md); don't
restyle them piecemeal.

## Naming

The product is **Frapp**, and everything a user sees says Frapp
([ADR-25](../../../spec/architecture/adr/adr-25.md)). "Signet" is this design system's internal
name until the post-beta internals rename. "Legacy Frapp" in this skill means the retired visuals
in the table above, not the product name: a cutover deletes legacy Frapp visuals, never Frapp copy.
The one canonical rule is [`brand-identity.md` § 1](../../../spec/ui/brand-identity.md#1-identity).

## Cutover deletes what it replaces

When a reskin or rebuild supersedes an old implementation, delete the superseded code in the same
change. Keep both live only for a stated reason: a flag mid-rollout, or a documented migration
window.

- Don't add a parallel token set next to the one a surface already uses.
- Don't leave a shim that still serves the old look after the new one ships.
- Don't carry `apps/web/components/ui` (shadcn/Radix) patterns onto mobile.
- Confirm real consumers before extending anything ([`AGENTS.md`](../../../AGENTS.md) tech-debt
  protocol). A definition or an `index.ts` re-export is not evidence that anything calls it.

## Before you ship a visual change

1. Read the matching spec: brand-identity and foundations, plus the surface README (web-greenfield
   for web; the landing README for the landing).
2. When the reference board and the current code disagree, follow the board, not a screenshot of the
   code.
3. Confirm you aren't mixing token systems, and delete the path you replaced.
