# Landing reskin reference

> **These boards now bind.** The epic's cutover landed in two parts — tokens in slice 1
> ([#2366](https://github.com/pdcarlson/Frapp/issues/2366)) and the composition in slice 2
> ([#2367](https://github.com/pdcarlson/Frapp/issues/2367)) — so the boards under [`canvas/`](canvas/)
> are the rank-1 visual truth for the landing surface ([`../../README.md`](../../README.md)
> § Precedence, rule 1). Drift between them and
> [`apps/landing/app/page.tsx`](../../../../apps/landing/app/page.tsx) is a filable bug now rather
> than an expected gap, with four standing exceptions, none of them drift:
>
> - the two decisions below that supersede what the boards draw (D8 and D9);
> - the signature moment, which is **cut** from the shipped page until brand sign-off clears
>   ([#2378](https://github.com/pdcarlson/Frapp/issues/2378));
> - anything [`spec/behavior/`](../../../behavior/README.md) contradicts, which wins over a board on
>   what the product does;
> - the product name. The boards draw "Signet", and the shipped page says whatever
>   [`brand-identity.md` § 1](../../brand-identity.md#1-identity) says, which is Frapp from
>   [ADR-25](../../../architecture/adr/adr-25.md) step 5.

## What this is

The crest-editorial redesign of frapp.live, delivered as a Claude Design canvas on 2026-09-17 and
copied here so agents and reviewers can read it as source. The editable original is the private
canvas `https://claude.ai/artifact/3VDnuMFjA38HuLiat85Zaz` (the owner's account); `canvas/` is a
copy of that canvas's own `project/` files as of the commit that added them. When the canvas is
edited, re-copy: the files are what an implementer reads, and the same rule that put
[`../../web-greenfield/reference/web-framework.dc.html`](../../web-greenfield/reference/web-framework.dc.html)
in the tree applies here: the commit is what makes a board a source of truth.

| File | Contents |
| ---- | -------- |
| [`canvas/Main.dc.html`](canvas/Main.dc.html) | Desktop page, 1440 wide, eight sections in scroll order. Hero A: the crest with the signature moment |
| [`canvas/Phone.dc.html`](canvas/Phone.dc.html) | The same page at 390 |
| [`canvas/HeroB.dc.html`](canvas/HeroB.dc.html), [`HeroC`](canvas/HeroC.dc.html), [`HeroD`](canvas/HeroD.dc.html) | Three alternative folds, 1440×900, identical except for the hero visual: the officer's chat, type as the image, the member's phone |
| [`canvas/System.dc.html`](canvas/System.dc.html) | Token sheet: stage and text ladders, both gold role sets, type roles and the three proposed marketing roles, controls, crest rules, grid, the motion decision |
| [`canvas/Spec.dc.html`](canvas/Spec.dc.html) | Section map with what each section replaces in `page.tsx`, copy rules, decisions D1 to D9, the staged code epic, routes and analytics, verified versus assumed |
| [`canvas/Motion.dc.html`](canvas/Motion.dc.html) | The motion spec with running CSS demos: signature moment, once-only reveals, chrome states, tokens, the amendment it asks for |
| [`canvas/canvas.json`](canvas/canvas.json) | The canvas index: frames, guides, and the sticky notes, including the decisions list |

## Reading the boards

They are Claude Design `.dc.html` artboards, consumed here as source text, not rendered. As with
[`../../design-system/reference/`](../../design-system/reference/canvas-screens.dc.html), the runtime
they reference (`./support.js`) is deliberately not committed, and
[`.github/workflows/links.yml`](../../../../.github/workflows/links.yml) excludes `canvas/` as a link
source for that reason while this README stays checked. Unlike the earlier boards these carry no
image assets: the crest is the single path from
[`packages/brand-assets/assets/signet-emblem-B-glyph.svg`](../../../../packages/brand-assets/assets/signet-emblem-B-glyph.svg),
inlined verbatim, filled `#DDB844`.

Two things to know before reading values off them:

- `{{accent}}`, `{{accentOn}}`, `{{accentText}}`, `{{accentSubtle}}` and `{{accentBorder}}` on the
  page boards are canvas template holes. The `data-dc-script` block at the foot of each board resolves
  them: default `#DDB844` with its `packages/theme/src/signet.css` accent-slot roles, alternative
  `#EFB63B` with the house-gold roles. Which gold the landing ships is decision D1.
- Type and spacing inside the two product frames are transcribed from
  [`canvas-screens.dc.html`](../../design-system/reference/canvas-screens.dc.html) and
  [`web-framework.dc.html`](../../web-greenfield/reference/web-framework.dc.html), re-pitched onto the
  current ladder in [`../../design-system/foundations.md`](../../design-system/foundations.md) §2.
  Landing chrome is on the scale and the grid; frame internals are not, on purpose.

## What is decided and what is not

The Spec sheet's §3 lists nine decisions, each drawn one way with the alternative a flip away; the
`decisions` note in `canvas.json` is the short form. **All nine are now taken** (2026-09-18), and
they are recorded once, in [`../README.md`](../README.md#decisions-d1-to-d9), with the epic
[#2364](https://github.com/pdcarlson/Frapp/issues/2364) carrying the owner's answers. They are not
restated here; read them there before implementing.

Seven answers match what these boards draw. **Two do not, and where they disagree the decision
wins, not the board:**

- **D9 takes hero B, not hero A.** The shipping fold is
  [`canvas/HeroB.dc.html`](canvas/HeroB.dc.html) — the officer's chat bleeding off the right edge —
  so the hero drawn on [`canvas/Main.dc.html`](canvas/Main.dc.html) and
  [`canvas/Phone.dc.html`](canvas/Phone.dc.html) is superseded. Everything below the fold on those
  two boards still stands. D4's signature moment was to move with it, onto the **closing** crest;
  it is cut from the shipped page until brand sign-off clears
  ([#2378](https://github.com/pdcarlson/Frapp/issues/2378)), so that crest paints whole.
- **D8 holds the tagline.** The close drawn on the page boards reads "Ask your chapter anything.";
  the page ships "Everything your chapter needs is already in chat." instead, until Ask is real.
  The scope is the page body only — `layout.tsx`'s meta title and the OG title keep the tagline as
  built.

Both are decisions about the page, not corrections to the boards: the boards are a record of the
design as delivered and are **not** edited to match. If the canvas itself is revised, re-copy it per
the rule above and re-check these two notes.

What the boards claim about the product was checked against `spec/behavior/` (Spec sheet §6):
pre-event RSVP is not modelled, the event chat card carries only Check in, the dues chat card is a
stub, and the Ask affordance cannot answer yet. The boards draw none of those four.
