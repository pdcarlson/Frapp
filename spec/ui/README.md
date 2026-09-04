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

## Per-surface rules

**The per-surface table below is machine-checked** against `DIRECTORIES` in
[`scripts/ci/lib/docs-structure.mjs`](../../scripts/ci/lib/docs-structure.mjs) by
`npm run check:doc-tables` — it must name every declared child of `spec/ui/`, and may not name a
child that is not declared. Add or retire a directory in the manifest and here in the same commit.

| Spec | Governs | Status |
| ---- | ------- | ------ |
| [`design-system/`](design-system/README.md) | Tokens and rules shared by every Signet surface: foundations (color, type, radius, spacing), components, iconography, writing, chapter accent engine | Active |
| [`mobile/`](mobile/README.md) | Mobile app: screen inventory, navigation, interaction patterns | Active |
| [`web-dashboard/`](web-dashboard/README.md) | Admin web app: shell, nav, screens, state | Active (Signet since the #920 shell slice) |
| [`landing/`](landing/README.md) | Marketing site | **Frozen** (pre-Signet) |
| [`brand-identity.md`](brand-identity.md) | Signet identity: name, tagline, mark/logo rules, house gold | Active |
| [`assets.md`](assets.md) | Logos, icons, asset sync | Active |
| [`resilience.md`](resilience.md) | Network resilience, loading/empty/error delivery guarantees, message delivery | Active |

### Frozen surfaces

`landing/` documents the pre-Signet (Frapp-era) implementation as built. It remains normative for that surface until its own reskin session, but it MUST NOT be extended with new design decisions — new visual rules belong in [`design-system/`](design-system/README.md). The web dashboard left this list with the #920 shell slice; its per-screen-family truing-up is tracked on #920.

## Related trees

- Behavior and logic: [`../behavior/`](../behavior/README.md)
- Product scope and personas: [`../product/`](../product/README.md)
- Architecture: [`../architecture/`](../architecture/README.md)
