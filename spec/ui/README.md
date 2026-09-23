# UI specs

Map of the canonical UI specification for Signet surfaces. This tree governs what the product looks like and how it is laid out; rules about what the product *does* live in [`../behavior/`](../behavior/README.md).

## Signet

Signet is the rebrand of Frapp. Its dark-first, warm, consumer design system was adopted 2026-08 and is specified under [`design-system/`](design-system/README.md). The visual sources of truth are two committed HTML references:

| Reference | Contents |
| --------- | -------- |
| [`design-system/reference/signet-design-system.dc.html`](design-system/reference/signet-design-system.dc.html) | Design-system panels: foundations, components, iconography, states |
| [`design-system/reference/canvas-screens.dc.html`](design-system/reference/canvas-screens.dc.html) | The 23 mobile screens (Canvas) |

A third set of boards, the landing reskin under [`landing/reference/`](landing/reference/README.md), **ranks with those two under rule 1** for the landing surface. It was committed as target state and stopped being that when the cutover merged in two parts, tokens in [#2366](https://github.com/pdcarlson/Frapp/issues/2366) and the composition in [#2367](https://github.com/pdcarlson/Frapp/issues/2367). Its README owns the boards' status, including the three standing exceptions that are not drift.

Naming: spec prose says **Signet**. Code identifiers, package names, domains, and bundle ids remain `frapp` / `@repo/*` / `frapp.live` for now — the repo rename is deferred. When citing code, cite real current names.

## Precedence

1. **Visuals:** the reference HTML files win over any written doc in this tree. If a doc disagrees with the reference, the doc is wrong and MUST be fixed.
2. **Logic:** [`../behavior/`](../behavior/README.md) wins over anything in this tree. UI specs describe presentation; they never override behavior rules.
3. Where the two reference files disagree with each other, `canvas-screens.dc.html` wins. Known stale spots in the references are flagged in the owning doc under `design-system/` or `mobile/`.
4. **While [#2140](https://github.com/pdcarlson/Frapp/issues/2140) is open,** [`web-greenfield/`](web-greenfield/README.md) outranks [`web-dashboard/`](web-dashboard/README.md) on anything visual or structural the two disagree about, and its own [`reference/`](web-greenfield/reference/README.md) ranks with the boards in rule 1. This is scoped to the web surface and to that epic: it changes nothing for `mobile/`, and rules 1 to 3 still bind everything else. `web-greenfield/README.md` §1 carries the full order and what the distrust does **not** license — `web-dashboard/`'s navigation map, gating semantics, routing rules and data contracts are still truth.

## Per-surface rules

This table is kept for the **Status** column: which surface is Signet-active. No surface is
visually frozen today; `.claude/skills/signet-cutover/SKILL.md`, which an agent loads before
touching UI, says the same, so change both in the same edit if that ever changes. Where a UI change belongs is settled by
[`docs/internal/DOCUMENTATION_CONVENTIONS.md` § Where things go](../../docs/internal/DOCUMENTATION_CONVENTIONS.md#where-things-go),
not by the Governs column here. No CI check asserts this table is complete or its statuses current.

| Spec | Governs | Status |
| ---- | ------- | ------ |
| [`design-system/`](design-system/README.md) | Tokens and rules shared by every Signet surface: foundations (color, type, radius, spacing), components, iconography, writing, chapter accent engine | Active |
| [`mobile/`](mobile/README.md) | Mobile app: screen inventory, navigation, interaction patterns | Active |
| [`web-greenfield/`](web-greenfield/README.md) | The web UI rebuild (#2140): trust order, brand locks, foundation tokens, deletion acceptance | Active — **outranks `web-dashboard/` on visuals and structure until the #2140 fold-back** |
| [`web-dashboard/`](web-dashboard/README.md) | Admin web app: shell, nav, screens, state | Active (Signet since the #920 shell slice), but see the note below |
| [`landing/`](landing/README.md) | Marketing site | **Reskin built out** ([#2364](https://github.com/pdcarlson/Frapp/issues/2364)) — the visual freeze is lifted, the decisions are taken, and both cutover slices have merged; `apps/landing` is on Figtree, the Signet ladder and the boards' composition, and slice 3 ([#2368](https://github.com/pdcarlson/Frapp/issues/2368)) closed out the polish; what remains of the epic is owner decisions rather than build work |
| [`brand-identity.md`](brand-identity.md) | Signet identity: name, tagline, mark/logo rules, house gold | Active |
| [`assets.md`](assets.md) | Logos, icons, asset sync | Active |
| [`resilience/`](resilience/README.md) | Network resilience, loading/empty/error delivery guarantees, message delivery | Active |

### The landing during its reskin

`landing/` is **no longer frozen.** [#2364](https://github.com/pdcarlson/Frapp/issues/2364) reskinned the storefront from a committed set of boards that now bind it, so that README records the reskin's nine decisions, the marketing type roles and the marketing copy rules alongside the storefront as built. Two things are worth stating alongside it:

- **`apps/landing` is on the Signet tokens** since the token cutover ([#2366](https://github.com/pdcarlson/Frapp/issues/2366)) merged — Figtree, the `signet.css` ladder and the inlined crest. The two systems still MUST NOT mix on the surface; there is simply nothing legacy left on this one. The page's **composition** moved with slice 2 ([#2367](https://github.com/pdcarlson/Frapp/issues/2367)): `apps/landing/app/page.tsx` renders the boards' section map, so the surface is current Signet in structure as well as tokens, and the boards under [`landing/reference/`](landing/reference/README.md) bind it now.
- **It still MUST NOT be extended with new visual design decisions of its own** — those belong in [`design-system/`](design-system/README.md). What `landing/` owns is this surface's application of them: its decisions, its three marketing type roles, and its copy rules.

The web dashboard left the frozen list with the #920 shell slice; its per-screen-family truing-up is tracked on #920.

### The web dashboard after #2140

`web-dashboard/` is **not** frozen and **not** deleted, but it is not yet the first thing to read about how the web surface looks. [#2140](https://github.com/pdcarlson/Frapp/issues/2140) rebuilt that surface and has closed; until its surviving truth folds back into `web-dashboard/`, [`web-greenfield/`](web-greenfield/README.md) wins on visuals and structure. What that does and does not license, and the fold-back itself: [`web-greenfield/README.md` § Why `web-dashboard/` is distrusted](web-greenfield/README.md#why-web-dashboard-is-distrusted-and-what-that-does-not-mean).

## Related trees

- Behavior and logic: [`../behavior/`](../behavior/README.md)
- Product scope and personas: [`../product/`](../product/README.md)
- Architecture: [`../architecture/`](../architecture/README.md)
