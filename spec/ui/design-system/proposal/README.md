# Design system proposal (2026-11-20)

> **Proposed, not spec.** Nothing in this folder binds a screen. It is the snapshot of a design-system pass awaiting Paul's rulings. Until he rules, the owning docs win wherever they disagree with it: [`../principles.md`](../principles.md), [`../foundations.md`](../foundations.md), [`../components.md`](../components.md) and [`.claude/skills/ui-development/rulebook.md`](../../../../.claude/skills/ui-development/rulebook.md). Once he signs off, the UI system thread moves each accepted part to its owner (tokens to `packages/theme`, rules to the rulebook and the specs above, the drift counts into checks) and this folder is deleted.

## Where to look at it

The system is published as a private Claude artifact, where the previews render: <https://claude.ai/artifact/2bzU8h8jCkLoCYajxXoSu9>. Only its owner can open that link until it is shared from the page's Share menu. This folder is a copy of that artifact's own files at its version 7, taken so the work survives the session that made it. The artifact is where it is edited; if the two differ, the artifact is newer.

## What is here

Everything is under [`system/`](system/).

| File | What it is |
| --- | --- |
| [`system/README.md`](system/README.md) | The brand book: what makes it Frapp, the content rules, colour, type, shape, layout, glass, motion, iconography, accessibility. Every rule is marked Confirmed, Changed or Proposed |
| [`system/00-layouts.md`](system/00-layouts.md) | What is wrong with today's layouts, six page types, and what changes screen by screen |
| [`system/00-placement.md`](system/00-placement.md) | Where every action goes on both apps, and where the captured screens put them today |
| [`system/01-diagnosis.md`](system/01-diagnosis.md) | Why today's UI reads as a generic dashboard, from captures of the running apps |
| [`system/02-decisions.md`](system/02-decisions.md) | The 47 proposals and two questions for Paul, and the earlier rulings the system reverses |
| [`system/03-drift.md`](system/03-drift.md) | Every place the code breaks the system, counted per rule, with the command behind each count |
| [`system/tokens.json`](system/tokens.json) | The tokens, with a usage note and measured contrast on each. Values are copied from `packages/theme/src/signet.css` and `signet.ts` at `main@bb0805b` |
| `system/components/<Name>/README.md` | Guidelines for 16 components and 6 screen templates: the web file, the phone file, the anatomy, the rules, which app's version the system keeps |
| `system/components/<Name>/preview.html` | The preview the artifact renders. Static markup styled by `system/components/bundle.css`; it is not the app's component |
| `system/data/drift-web.json`, `drift-phone.json`, `drift-copy.json` | The full per-file lists and example lines behind `03-drift.md`: the baseline for checks that only let the counts go down |
| [`system/design-system.json`](system/design-system.json) | The artifact's index |

## What is not here

- **Fonts and the emblem.** The artifact carries copies of `packages/theme/fonts/FigtreeVF.woff2` and of three files in `packages/brand-assets/assets/`. They are not copied back.
- **The captures of today's screens.** They live in the artifact's asset store, and `screenshots/` is ignored by git. The previews that show them (`BrowsePage`, `StandingPage`, `RecordPage`) and the emblem in `PushNotification` point at `/_blob/<id>` addresses that resolve only inside the artifact.
- **The pass's working files** (preview sources, the local render harness, the 145 captures). They were in a session scratchpad and are gone with it.
- **The earlier proposal page** this pass was asked to read (`claude.ai/artifact/Vw5C7insv7ZsZxzibzUbKf`). It was not shared with the session, so the system was built without it.

## How far to trust it

- Token values and the contrast figures were read from the theme and measured on 2026-11-20; the contrast figures match [`../foundations.md`](../foundations.md) § 4.
- The drift counts were produced by `rg` commands recorded beside each count, run at `main@bb0805b`. Counts marked "proxy" are mechanical stand-ins with the share that were true when read by hand.
- "Where the screens put it today" in `00-placement.md` and the findings in `00-layouts.md` are observations from captures of the seeded demo chapter, not counts.
- The guideline sources named in `00-placement.md` are cited from memory and were not re-read.
- The data files are pretty-printed here; the artifact holds the same content minified.
