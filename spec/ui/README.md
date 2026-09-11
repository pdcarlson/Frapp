# UI specs

Map of the canonical UI specification for Signet surfaces. This tree governs what the product looks like and how it is laid out; rules about what the product *does* live in [`../behavior/`](../behavior/README.md).

## Signet

Signet is the rebrand of Frapp. Its dark-first, warm, consumer design system was adopted 2026-08 and is specified under [`design-system/`](design-system/README.md). The visual sources of truth are two committed HTML references:

| Reference | Contents |
| --------- | -------- |
| [`design-system/reference/signet-design-system.dc.html`](design-system/reference/signet-design-system.dc.html) | Design-system panels: foundations, components, iconography, states |
| [`design-system/reference/canvas-screens.dc.html`](design-system/reference/canvas-screens.dc.html) | The 23 mobile screens (Canvas) |

Naming: spec prose says **Signet**. Code identifiers, package names, domains, and bundle ids remain `frapp` / `@repo/*` / `frapp.live` for now — the repo rename is deferred. When citing code, cite real current names.

## Precedence

1. **Visuals:** the reference HTML files win over any written doc in this tree. If a doc disagrees with the reference, the doc is wrong and MUST be fixed.
2. **Logic:** [`../behavior/`](../behavior/README.md) wins over anything in this tree. UI specs describe presentation; they never override behavior rules.
3. Where the two reference files disagree with each other, `canvas-screens.dc.html` wins. Known stale spots in the references are flagged in the owning doc under `design-system/` or `mobile/`.
4. **While [#2140](https://github.com/pdcarlson/Frapp/issues/2140) is open,** [`web-greenfield/`](web-greenfield/README.md) outranks [`web-dashboard/`](web-dashboard/README.md) on anything visual or structural the two disagree about, and its own [`reference/`](web-greenfield/reference/README.md) ranks with the boards in rule 1. This is scoped to the web surface and to that epic: it changes nothing for `mobile/`, and rules 1 to 3 still bind everything else. `web-greenfield/README.md` §1 carries the full order and what the distrust does **not** license — `web-dashboard/`'s navigation map, gating semantics, routing rules and data contracts are still truth.

## Per-surface rules

This table is kept for the **Status** column — which surface is Signet-active and which is frozen.
The frozen list is also stated below and in `.claude/skills/signet-cutover/SKILL.md`, which is the
one an agent loads before touching UI; change it there in the same edit. Where a UI change belongs is settled by
[`docs/internal/DOCUMENTATION_CONVENTIONS.md` § Where things go](../../docs/internal/DOCUMENTATION_CONVENTIONS.md#where-things-go),
not by the Governs column here. No CI check asserts this table is complete or its statuses current.

| Spec | Governs | Status |
| ---- | ------- | ------ |
| [`design-system/`](design-system/README.md) | Tokens and rules shared by every Signet surface: foundations (color, type, radius, spacing), components, iconography, writing, chapter accent engine | Active |
| [`mobile/`](mobile/README.md) | Mobile app: screen inventory, navigation, interaction patterns | Active |
| [`web-greenfield/`](web-greenfield/README.md) | The web UI rebuild (#2140): trust order, brand locks, foundation tokens, deletion acceptance | Active — **outranks `web-dashboard/` on visuals and structure while #2140 is open** |
| [`web-dashboard/`](web-dashboard/README.md) | Admin web app: shell, nav, screens, state | Active (Signet since the #920 shell slice), but see the note below |
| [`landing/`](landing/README.md) | Marketing site | **Visual freeze** (bone/bronze/Geist); copy and mark are Signet |
| [`brand-identity.md`](brand-identity.md) | Signet identity: name, tagline, mark/logo rules, house gold | Active |
| [`assets.md`](assets.md) | Logos, icons, asset sync | Active |
| [`resilience/`](resilience/README.md) | Network resilience, loading/empty/error delivery guarantees, message delivery | Active |

### Frozen surfaces

`landing/` documents the storefront as built. Product copy and the locked crest are Signet; Geist + bone/bronze tokens stay until the visual reskin. It MUST NOT be extended with new visual design decisions — those belong in [`design-system/`](design-system/README.md). The web dashboard left this list with the #920 shell slice; its per-screen-family truing-up is tracked on #920.

### The web dashboard during #2140

`web-dashboard/` is **not** frozen and **not** deleted, but it is no longer the first thing to read about how the web surface looks. [#2140](https://github.com/pdcarlson/Frapp/issues/2140) is rebuilding that surface from a Claude Design framework, so on visuals and structure the framework and [`web-greenfield/`](web-greenfield/README.md) win, and `web-dashboard/` prose is stale by construction until a lane trues it up.

Three consequences worth stating, because "distrusted" is easy to over-read:

- **Its contracts are still truth.** The navigation and permission map, module gating, routing and redirect semantics, and the data contracts are current, and most are owned by [`../behavior/`](../behavior/README.md) regardless.
- **Do not file spec-vs-code drift against its visual prose** while the epic is open. That gap is the plan, not a bug.
- **When #2140 closes**, the surviving truth folds back into `web-dashboard/` and `web-greenfield/` is retired in the same change.

## Related trees

- Behavior and logic: [`../behavior/`](../behavior/README.md)
- Product scope and personas: [`../product/`](../product/README.md)
- Architecture: [`../architecture/`](../architecture/README.md)
