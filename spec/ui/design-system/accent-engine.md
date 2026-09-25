# Chapter Accent Engine

> How one chapter-chosen hex seed becomes every accent color in the Signet UI — the generation pipeline, the role map, caching, and what never derives from it.

Visual truth: panel 4c of [`reference/signet-design-system.dc.html`](reference/signet-design-system.dc.html) renders the engine's three stress-test seeds (navy, maroon, gold). Neutral and semantic values live in [`foundations.md`](foundations.md); brand color rules live in [`../brand-identity.md`](../brand-identity.md).

---

## 1. Pipeline

Each chapter has exactly **one accent input**: a single hex seed. Everything accent-colored derives from it through the Radix custom-color generator:

```
seed hex (one per chapter)
  │
  ▼
generateRadixColors({
  appearance: "dark",
  accent: seed,
  gray: "#191919",
  background: "#131211",
})
  │
  ▼
12-step accent scale  +  12-step alpha scale  +  contrast color
  │
  ▼
role tokens (§2) → persisted on the chapter record (§4)
  → injected as CSS custom properties (web) / theme context (native)
```

Rules:

- The raw seed **MUST NOT** paint UI directly: no component references the seed hex; only generated roles paint (§2), and §8 says which of them are contrast-gated. (The seed may appear as data, e.g. a swatch in the admin color picker.) The rule is about the reference, not the colour: the seed's own colour may still reach the screen as step 9 when it clears the §8 fill floor, and the engine lightens it when it doesn't. Decided on [#2541](https://github.com/pdcarlson/Frapp/issues/2541). The §6 residual call sites paint the stored accent only after `resolveChapterAccentColor` has validated it against the surface, and retire with that unit.
- The generator call is fixed as written above: `appearance` is always `"dark"` (Signet is dark-first), `gray` and `background` are constants matching the neutral ladder in [`foundations.md`](foundations.md).
- Generation runs **server-side** (§4). Clients read cached tokens; they never run the generator.

## 2. Role map

Every accent role maps to a fixed step of the generated scale. Components consume roles, never steps directly.

| Role | Source | Used for |
|---|---|---|
| `accent-primary` | step 9 | Primary button fill, active RSVP, solid chips, own chat bubble |
| `accent-hover` | step 10 | Hover/pressed state of primary fills |
| `accent-ring` | step 8 | Focus rings |
| `accent-subtle-bg` | step 3 | Tinted backgrounds: active nav item, badge/chip fills, selected rows |
| `accent-border` | step 7 | Borders on accent-tinted surfaces (badges, selected cards) |
| `accent-text` | step 11 | Accent-colored text and icons on neutral or subtle-bg surfaces |
| `on-primary` | contrast color | Text/icons on `accent-primary` |

`accent-primary` is the seed itself unless the seed sits within ΔE_OK 0.25 of step 1 (the dark background), in which case the generator takes its own, lighter step 9 (`getStep9Colors` in `packages/chapter-theme/src/vendor/generate-radix-colors.ts`). That catches most dark seeds, not only near-black ones: `#003087`'s step 9 is `#1C6CFE` and `#800000` paints `#F42F22`. Either way, a fill whose scale falls under the §8 floor is then lightened, so the fill may be a lifted version of the seed (or of the generator's own step 9): `#8B0000` paints `#D75748`, `#006400` paints `#41943C`, and `#003087`'s `#1C6CFE` becomes `#2D7BFF` for its hover's sake. That is how §1's rule holds in effect as well as in letter: step 9 is a generated, gated role even when it is the seed's own colour.

The alpha scale backs translucent variants of the same roles (e.g. a ring glow) where a solid step would occlude content; alpha steps map 1:1 to their solid steps.

## 3. Default seed

The house default seed is **`#DDB844`**, the spec'd mark gold ([`../brand-identity.md`](../brand-identity.md) §2). It moved from `#F2B72E` with the greenfield ladder ([#2143](https://github.com/pdcarlson/Frapp/issues/2143)) so that a chapter with no accent of its own would resolve to the same gold the crest is drawn in. It now does: the crest measured `#DDA220` until [#2153](https://github.com/pdcarlson/Frapp/issues/2153) re-exported it at the spec'd gold, so the seed and the mark finally hold the same value. They remain separate roles — the seed is a chapter input that the accent engine may recolour, the mark never retints. See L-08 in [`../web-greenfield/tokens.md`](../web-greenfield/tokens.md). A chapter with no custom accent runs this seed through the same pipeline — the default is not a separate palette. House gold `#EFB63B` itself is a brand color, not a seed output; see [`../brand-identity.md`](../brand-identity.md).

## 4. Caching and persistence

The generated scale is computed once and cached on the chapter (tenant) record — never regenerated on read.

| Aspect | Behavior |
|---|---|
| Engine version | Every palette is written with the `SIGNET_ENGINE_VERSION` of the engine that produced it, in `chapters.theme_palette_engine_version`. The stamp is what tells a stale row from a current one; the keys a row holds do not, because a row written between #1147 and the §8 fill floor holds every key and still paints a sub-3:1 fill. `NULL` means the row predates the stamp ([#1165](https://github.com/pdcarlson/Frapp/issues/1165)), or a config PATCH wrote its branding and the recompute after it has not landed (§6 Persistence). Either way it is stale. Bump the version in the same change as anything that alters the engine's output for any seed. `packages/chapter-theme/src/signet.spec.ts` pins a fingerprint of the output to the version and fails until you do, for any seed in its corpus: the directory seeds, enough extra seeds that each of the generator's 29 Radix scales is some seed's nearest (measured 2026-09-23), and the input forms a stored seed takes. A change confined to seeds outside that corpus passes unbumped, so widen it when touching hue-specific or input-handling code. |
| Engine changes | Reach every stored chapter within an hour of the deploy that ships them. The API's hourly stale-palette sweep (`ScheduledJobsService.sweepStalePalettes`) selects each row whose stamp is `NULL` or behind the running engine and recomputes it through `buildChapterPalette`, seeded from `branding.colors.accent` like every other writer. The write is compare-and-set: it lands only if the row is still stale **and** its seed is unchanged, so it never overwrites an officer's save that raced it, and on several replicas the second write is a no-op. One case escapes it, on a deploy that ships the stamp to an API running without it (the first, or a re-land after a rollback): a palette write (an accent save, a config PATCH, or the recompute route) served by a pre-#1165 instance after the row was stamped. The promotion runbook's #1165 entry therefore re-queues every row once after that deploy. Before #1165 an engine change reached only the chapters that saved after it, as the §8 fill floor ([#2541](https://github.com/pdcarlson/Frapp/issues/2541)) and its hover floor ([#2586](https://github.com/pdcarlson/Frapp/issues/2586)) both did: they reach the chapters saved before them only through the sweep. |
| Engine rollback | The sweep only moves a row forward. A row is stale when its stamp is `NULL` or *lower* than the running engine's, so API replicas on two versions during a rolling deploy leave each other's rows alone instead of rewriting them on every tick. The cost is that rolling the API back does not re-derive rows a newer engine already stamped: they keep its palette. To recover from a bad engine bump, either roll forward (revert the engine change and bump the version again; the sweep repaints every row within the hour), or, with the older code live, run `update public.chapters set theme_palette_engine_version = null where theme_palette_engine_version > <the live version>;` so the sweep re-derives those rows with the live engine. Clearing a stamp is always safe, because it only puts the row back in the sweep's queue. Setting one by hand never is: it marks a palette current without deriving it. |
| Storage | `chapters.theme_palette` (jsonb), holding the `--signet-*` role tokens. It held the legacy web token map alongside them until the #920 slice-9 cutover; the namespace is what let the two ship side by side, because the legacy web reader iterated every key of the column (§6). Every writer, the sweep included, replaces the whole map, so the sweep drops the dead legacy keys from every row it recomputes. The allow-lists in the Delivery rows still keep any non-role key off `:root`, and nothing else stops one reaching the column. |
| Regenerate when | An admin changes the accent, through **either** door: `PATCH /chapters/:id/config` carrying `branding.colors` (the onboarding wizards; that PATCH in fact re-derives on any `branding` write, colours or not, for the reason in §6 Persistence), or `PATCH /v1/chapters/current` carrying `accent_color` (the Settings accent editor, and the only path that UI actually uses). Also via the manual recompute endpoint, and by the hourly sweep when the row's engine version is behind (the Engine changes row). Never on read, never client-side. |
| Recompute endpoint | `POST /chapters/:id/theme-palette` (`apps/api/src/interface/controllers/chapter-config.controller.ts`), guarded by `CHAPTER_CONFIG_MANAGE`. See [`../../behavior/chapter-config.md`](../../behavior/chapter-config.md). |
| Delivery | Web: CSS custom properties set from the cached tokens, in two steps. The `(dashboard)` layout emits the **last known** palette for this member and chapter as an unlayered `:root` rule read out of a cookie, so first paint is the chapter's colour rather than the §3 house default baked into `signet.css`; `use-chapter-theme.ts` then writes the freshly fetched palette as an inline style on `<html>`, which outranks it. The browser cache is keyed on the auth uid and chapter id and read at the scope the request's own token names — [`../resilience/caching.md`](../resilience/caching.md) owns it. Native: theme context providing the same roles. |

## 5. Never derived from the accent

These are fixed regardless of chapter accent; the engine's output MUST NOT replace them:

- **Mention/DM red** — a direct-address signal, not a themeable one; value and rule in [`foundations.md`](foundations.md) §5.
- **Semantic status colors** (success/warning/danger/info) — status-only, values in [`foundations.md`](foundations.md).
- **The Signet mark** — the logo never takes the chapter accent ([`../brand-identity.md`](../brand-identity.md)).
- **Neutral ladder** — backgrounds, borders, and text colors are constants, not gray-scale outputs of the generator.

## 6. Implementation status

The engine is live on mobile and, since the #920 shell cutover, on the web dashboard. The legacy `derivePalette` engine it replaced was deleted in the #920 slice-9 cutover. One legacy unit survives, for the consumers named in its row.

### Residual (legacy)

| Unit | Location | Behavior |
|---|---|---|
| `resolveChapterAccentColor(accent, {background, fallbackAccent})` | `packages/theme/src/accent.ts` | Client-side re-validation of a stored accent against an actual background. Two call sites remain: the Settings accent preview (`apps/web/components/settings/settings-page.tsx`, which passes the real dark card surface and a dark-legible fallback per #1157) and mobile's fallback for a palette without the Signet map (`apps/mobile/lib/chapter-branding.ts`). The web shell call site is deleted — the engine never falls back, so the "Accent adjusted" notice went with it. It is **independent of `derivePalette`** and outlived it: it re-validates `accent_color`, and never read that engine's token map. When the mobile arm can go is in "Not yet implemented" below ([#2595](https://github.com/pdcarlson/Frapp/issues/2595)). Behavior canon: [`../../behavior/branding.md`](../../behavior/branding.md). |

### Implemented

| Unit | Location | Behavior |
|---|---|---|
| `deriveSignetPalette(seed?)` | `packages/chapter-theme/src/signet.ts` | Wraps `generateRadixColors` with the §1 parameters and emits the §2 role tokens as flat `--signet-*` CSS custom properties, plus their alpha counterparts, applying the §8 fill lift ahead of the generator (which stays unmodified). DOM-free and CommonJS-safe. Never throws — an absent seed resolves to the house seed (`#DDB844`), an unparseable one does too and sets `invalidSeed`. Reports the text gate on `contrastChecks` and the fill gate on `fillChecks` (`signetFillChecks`, fill and hover on each ladder step: the same measure the lift judges by, along with the text gate's label-on-hover check). The lightened accent is internal; only the fill it paints is returned, in the palette. |
| `signetAccentSemanticVars(palette)` | `packages/chapter-theme/src/signet.ts` | Re-keys an already-generated palette onto the semantic names [`foundations.md`](foundations.md) §6 gives the accent slot (`--primary`, `--ring`, …). Pure remap; the §8 guarantees carry through. Opt-in, and **not** what is persisted — see the storage row above and the note below. |
| Persistence | `apps/api/src/application/services/chapter-palette.ts` (`buildChapterPalette`) | One builder behind the three request-path writers — onboarding, the config PATCH / recompute endpoint, and the Settings accent save (`chapter.service.ts`) — and the §4 stale-palette sweep, which re-runs it over stored rows. It writes one map: the Signet roles, produced for **every** chapter, including one that supplied no colours (§3). Until the slice-9 cutover it merged `{...legacy, ...signet}` and the legacy half was produced only when a brand colour was given, so a palette could hold one map or both — that conditional half is gone, and with it the second brand colour (`branding.colors.dark`) that fed it. The seed is `branding.colors.accent`, per §7. Every write sets `theme_palette_engine_version` beside the map, through one helper (`chapterPaletteColumns`), so a palette never parts from the version that wrote it (§4). The writes that derive from a seed read in an earlier statement (the config PATCH's recompute, `POST /v1/chapters/:id/theme-palette`, and the sweep) are compare-and-set on that seed, so an accent save landing in between is never overwritten with the old seed's palette. Every config PATCH that writes `branding` recomputes, with or without colours, and clears the stamp in the branding write itself. That write stores the whole merged branding as it was read, accent included, so it can put an older seed back under a palette an accent save just stamped current. The recompute re-derives from the seed it stored, and if that recompute fails, the cleared stamp leaves the row stale for the sweep rather than stamped current over another seed's palette. (The accent save itself is still lost in that race: [#2607](https://github.com/pdcarlson/Frapp/issues/2607).) An invalid seed, any sub-AA contrast check and any fill check under 3:1 are logged by every writer, the sweep included (`logChapterPaletteWarnings`), never thrown: a colour problem must not fail a save the officer asked for. The fill checks are never returned to a client, since only a broken lift fails them. The Settings save path (`PATCH /v1/chapters/current`) also returns `failedContrastChecks` to the caller — disclosure, not correction, since §8 forbids a runtime substitution here (#1183); it is empty in the normal case, since the checks are contrast-correct by construction for every hue this repo has sampled. The web accent editor renders it, naming the failing role, its measured ratio, and a suggested next action. |
| Delivery (native) | `apps/mobile/lib/chapter-branding.ts` | `useChapterBranding()` reads **`--signet-accent-text`** (step 11) off the served palette. Step 11, not step 9: the hook's single value is consumed as a foreground (tab tint, glyphs, chip labels), and §8 holds `accent-primary` only to the 3:1 fill floor, not the 4.5:1 text floor — a crimson palette written since #2586 measures 4.23:1 on `--card`, and a stored one less until the §4 sweep recomputes it. A surface wanting a solid accent fill reads `--signet-accent-primary` with `--signet-accent-on-primary`. The legacy `resolveChapterAccentColor` remains only as the fallback for a chapter whose palette lacks the Signet map (one written before the map existed and not yet swept, or one inserted without a palette since the sweep's last tick); when it can go is in "Not yet implemented" below ([#2595](https://github.com/pdcarlson/Frapp/issues/2595)). |
| Delivery (web) | `apps/web/lib/hooks/use-chapter-theme.ts` | Mounted once by `DashboardShell`, so branding applies shell-wide. Maps the persisted `--signet-accent-*` roles onto the semantic names the Signet stylesheet defines, via `signetAccentSemanticVars` — all-or-nothing: a row missing any of those keys applies nothing, so what already paints stands: the palette this browser last cached for the chapter (the §4 Delivery row), if any, otherwise the default-seed (`#DDB844`) palette baked into `packages/theme/src/signet.css`. Rows persisted before the Signet map existed were the case this was written for, and the §4 sweep recomputes them. The gate still catches a row inserted without a palette since the sweep's last tick (a demo seed, or `POST /v1/chapters`) for up to an hour, and a malformed row. No per-token client-side fallback runs — contrast is guaranteed at generation time (§8), so a row with the keys that an older engine wrote is applied as stored, sub-3:1 fill or hover included, until the §4 sweep recomputes it. **Nothing else is applied**, and the allow-list is why that is safe: a row written before the slice-9 cutover held the legacy map until the §4 sweep rewrote it (and holds it until production has run that sweep), and six of those eight tokens were composited over or validated against bone, so blind iteration would paint a light-calibrated value onto the dark surface. The remaining two were the branded sidebar's own fill and accent, for a sidebar that no longer exists. |
| `generateRadixColors` | `packages/chapter-theme/src/vendor/` | Vendored from `radix-ui/website` (MIT, © 2024 WorkOS); it is not published to npm. Provenance and resync procedure in that directory's README. |

Token names are flat and string-valued so the additive field could not disturb legacy readers while both systems shipped: until the #920 shell cutover, `apps/web/lib/hooks/use-chapter-theme.ts` iterated every key of `theme_palette` onto `:root`, and nothing in the legacy stylesheet referenced `--signet-*`. The hook now applies the deliberate mapping in the Delivery (web) row instead — the stored map is data, not a stylesheet.

**Why the persisted map keeps the `--signet-` prefix.** `apps/web/lib/hooks/use-chapter-theme.ts`
used to apply the column by iterating every key onto `:root`. The prefix was originally what kept a hex
away from a legacy **HSL triple** (`--primary: 30 45% 32%`) that the preset wrapped as
`hsl(var(--primary))` — a hex stored under such a name resolved to `hsl(#C49A3A)` and every surface
using it lost its colour at once. That format hazard is now gone (see the next paragraph), but the
namespace stays, because a namespaced field is **additive**: it cannot collide with a token a
surface has not deliberately opted into. `signetAccentSemanticVars` is that opt-in — a surface calls
it once its own preset reads bare `var(--token)` throughout. The web shell made that call in the
#920 cutover (the Delivery (web) row), and native has no stylesheet to collide with at all.

**The web preset is fully migrated: one format, no pairing rule.** Every colour token in both
stylesheets is stored as a **complete colour** (`hsl(30 45% 32%)`, `#C49A3A`,
`rgba(255,255,255,.08)`, and `color-mix(...)` for the two derived button states `--primary-pressed`
and `--accent-subtle-hover`) and read through `colorVar()` as a bare `var(--token)`.
A `color-mix()` resolves to no fill at all below its browser support floor, so it is reserved for
hover/pressed states that stay legible without it — never a rest state. There is no second
convention left to pair against, which is the precondition the shell cutover then built on. Both
web surfaces now import `packages/theme/src/signet.css` — `apps/web` since the #920 shell slice,
`apps/landing` since its token cutover ([#2366](https://github.com/pdcarlson/Frapp/issues/2366)) —
so the one-format rule is the only rule on any shipping surface. The legacy `globals.css`, which
used the same format, was deleted with that cutover.

The `--ring` / `--side-*` family moved first, in #1143: those were the tokens chapter branding rewrote,
and the engine persists hex, so under the old bare-triple convention an injected `#C49A3A` became
`hsl(#C49A3A)` and the chapter's branding silently did not paint. The rest of the file followed in
the #920 reskin's groundwork, which is what removed the mixed-format hazard entirely — Signet's
`--border` is `rgba(255,255,255,.08)` and cannot be expressed as a triple at all, so the conversion
had to happen before any Signet value could land.

Two guards in `packages/theme/src/tailwind.config.spec.ts` hold the invariant:

- every token the preset reads is defined, and defined as a complete colour;
- **nothing hand-writes `hsl(var(--token))` around a preset colour token** — not this stylesheet,
  not `apps/web`, `apps/landing` or `apps/mobile` (#1151). The wrapper now always emits
  `hsl(hsl(...))`, which the browser drops. In a Tailwind arbitrary value the correct form carries
  the type hint: `text-[color:var(--x)]`.

Because the conversion changed only the *format* of these tokens and never a value, it was visually
inert on every surface. `apps/landing` was frozen pre-Signet and out of scope for #920 at the time,
so it rendered identically across the conversion; it has since cut over to Signet
([#2366](https://github.com/pdcarlson/Frapp/issues/2366)) and carries no pre-Signet carve-out
today.

### Not yet implemented

- Mobile's `resolveChapterAccentColor` fallback (the Residual row) is still in the tree. The §4
  stale-palette sweep recomputes every row that lacks the Signet map, but it can only go once
  production has run that sweep, since a mobile build without it would paint house gold for any
  chapter still unstamped. After that it serves only a row inserted without a palette since the
  last tick (a demo seed, or `POST /v1/chapters`), for under an hour. Web applies nothing to such
  a row either, so it keeps whatever already paints: this browser's cached palette for the
  chapter, or the `signet.css` defaults. Deleting it is [#2595](https://github.com/pdcarlson/Frapp/issues/2595).

What the sweep settled, so the next reader does not re-derive it ([#1165](https://github.com/pdcarlson/Frapp/issues/1165)):
before it, a stored row could lack every `--signet-*` key (written before #1147, 2026-08-20),
hold them with a sub-3:1 fill (written before the §8 fill floor) or a sub-3:1 hover and a label
under 4.5:1 on it (written before the floor took in hover, #2586), or carry the eight dead legacy
keys. On a row lacking the keys, web showed the default-seed (`#DDB844`) palette from `signet.css`,
and mobile showed the chapter's own `accent_color` only where it cleared 4.5:1 on the card, house
gold (`#EFB63B`) otherwise. Staleness could not be read off the seed either: #2152 (`057bb1c`,
2026-09-10) moved the generator's background from `#0E0D0B` to `#131211`, so a row written before
then can hold a fill today's engine never produces for its seed (maroon `#800000` stored itself,
1.37:1 on `--popover`, where it now paints `#F42F22`). Recomputing every row with `NULL` engine
version fixes all three cases, because every writer replaces the whole map. The one precondition was the seed: a
Settings save from before the #795 mirror wrote `accent_color` but never
`branding.colors.accent`, so a recompute of such a row would have derived it from the default
seed instead of the chapter's colour.
`supabase/migrations/20260923170100_backfill_chapter_branding_accent_from_accent_color.sql`
repairs those rows first (§7).

## 7. Open decision

**Accent source of truth** — the seed is readable from both `chapters.accent_color` and `branding.colors.accent`. **#795 settled it** (closed by #911): `branding.colors.accent` is authoritative and the column mirrors it on every write path, backfilled by `supabase/migrations/20260814120000_backfill_chapter_accent_color_from_branding.sql`. The reverse divergence, where a Settings save from before the mirror wrote the column and left `branding.colors.accent` empty, is repaired by `20260923170100_backfill_chapter_branding_accent_from_accent_color.sql` (#1165), which copies the column into branding unless it holds the never-written schema default `#2563EB`. Two readable copies remain, so new code MUST NOT add a third read path.

## 8. Validation

- The engine guarantees contrast **by construction** for its **text** roles, at 4.5:1: the Radix generator produces step 11 as legible text on steps 1–3 surfaces, and `on-primary` is corrected below.
- It also guarantees the **`accent-primary` fill and its `accent-hover` shade at 3:1** (WCAG 1.4.11 non-text) against every step of the neutral ladder — `--background`, `--surface-1`, `--card` and `--popover` ([`foundations.md`](foundations.md) §2) — because several consumers use the fill as the only cue for a state: the switch track, the active tab underline, the focus border, poll selection. Hover is held too because pointing at such a control swaps its fill for the hover shade while the state still has to read: the voted poll option is a primary `Button`, whose hover is `accent-hover`. The reasoning, and the rejected alternatives, are on [#2541](https://github.com/pdcarlson/Frapp/issues/2541); the hover floor was decided on [#2586](https://github.com/pdcarlson/Frapp/issues/2586).
  - **How:** a seed's scale fails when step 9 or step 10 falls under 3:1 on `--popover` (the lightest step, so clearing it clears the rest), or when `on-primary` falls under 4.5:1 on step 10. Then `deriveSignetPalette` raises step 9's OKLCH lightness in 0.002 steps, keeping its hue and chroma and gamut-mapping to sRGB, until the scale the generator produces from the lifted colour passes all three. It then uses that whole generation, so hover, the alpha steps and `on-primary` derive from the fill that paints. The final generated steps 9 and 10 are what get judged, because `getStep9Colors` (§2) can swap in its own step 9 and hover exists only as the generator derives it.
  - **Why the label sets how far it goes:** for a fill this light the generator makes hover darker, by about a fifth in luminance. Where hover first clears 3:1 the fill is about 3.5–3.7:1 on `--popover`: white text on the fill is under 4.5:1 there, and black text on the hover is about 4.2:1. No label clears both, and the label does not change under a pointer, so the lift runs on until black clears the hover. Every lifted fill therefore takes a black `on-primary`.
  - **What it moves:** 10 of the 19 seeds the spec pins: the 9 whose fill failed, and `#003087`, whose fill cleared (`#1C6CFE`, 3.31:1) but whose hover did not (2.79:1). Crimson `#8B0000` → `#D75748` is the largest shift. Lifted fills land at 3.82–3.95:1 on `--popover`, their hovers at 3.22–3.32:1, and their black labels at 4.50:1 or better on hover. What moves is lightness, except where the lighter colour leaves sRGB: `#003087` and `#4B0082` reach the gamut's edge, where the mapping gives up about 0.02 of chroma and turns hue by 1.0° and 2.6°, inside its 0.02 ΔE_OK tolerance. The house seed and `#C9A56F` are untouched, and every text gate below still passes. Beyond the corpus the floor also reaches vivid mid-tones whose fill clears but whose hover does not (`#3366FF` → `#4479FF`, `#0066FF` → `#287CFF`), and, with small shifts, a few whose label alone misses 4.5:1 on hover (`#9966CC` → `#9D6AD0`). A seed whose scale already clears is used as is: a floor, not a restyle.
  - **Pressed is not floored, because it is momentary.** `--primary-pressed` is hover with 8% black (`packages/theme/src/signet.css`), so it can sit under 3:1: 2.80–2.90:1 on `--popover` for the lifted seeds, and 2.83:1 and 2.98:1 for `#800000` and `#4B2E2E`, whose scales the floor leaves alone. The label can fall short on it too, under the 4.5:1 text floor: black on the pressed shade measures 3.92–4.06:1 for the lifted seeds, whose `on-primary` this floor turned black (their white label measured 6.1–7.0:1 there before), and 3.95:1 and 4.17:1 for `#800000` and `#4B2E2E`, whose labels were already black. Both are accepted because pressed shows only while the pointer is down, and releasing it returns the control to a floored fill or hover; a pressed recipe that keeps the label at 4.5:1 is [#2604](https://github.com/pdcarlson/Frapp/issues/2604). The shade **MUST NOT** be held as a state (a toggled-on look, a selected row): a held state paints `accent-primary`. Decided on [#2586](https://github.com/pdcarlson/Frapp/issues/2586).
  - A palette stored before this landed was written without it; the §4 stale-palette sweep recomputes every such row within an hour of the deploy that carries the sweep ([#1165](https://github.com/pdcarlson/Frapp/issues/1165)).
- No runtime per-token fallback (the legacy bronze-substitution pattern) applies to engine output.
- **`on-primary` needs one correction to make that true.** The generator's own contrast color is *not* reliably legible on step 9 for light seeds in dark appearance — it returns white for `#C9A56F` (2.31:1) and `#FF69B4` (2.65:1), where black would score 9.10:1 and 7.93:1. This is not a corner case: `#C9A56F` is the accent of 45 of the 50 chapters in `supabase/seed/chapter_directory.csv`. So `deriveSignetPalette` keeps the generator's choice when it clears AA — which it does for the house seed, `#292109` at 8.37:1 — and otherwise substitutes whichever of black or white scores higher. That substitution cannot itself fail: the two curves cross at luminance ≈0.179 where both score ≈4.58:1, so the better of the pair is always ≥4.5:1 for any color.
- Gate: accent-derived **text** roles MUST meet WCAG AA 4.5:1 on the surfaces they are specified for — `accent-text` (step 11) on the neutral backgrounds and on `accent-subtle-bg`, and `on-primary` on `accent-primary` and on `accent-hover`, which it sits on under a pointer (not on the momentary pressed shade; see the pressed bullet above). This is asserted at generation time and reported on `contrastChecks` (the fill floor on `fillChecks`, kept separate so the API's `failedContrastChecks` stays the text gate), and both are pinned by `packages/chapter-theme/src/signet.spec.ts` across the 18 distinct colors the seed directory has carried, plus the house seed. That corpus is **frozen in the spec, not read from the CSV** — #1225 dropped the dead `default_colors.dark` half, which is where 13 of the 18 came from, so a list derived from the file today would cover 5. A generator upgrade is the realistic way it breaks, which is why the generator is vendored rather than floated.
- Save-time validation of the seed itself is behavior canon in [`../../behavior/branding.md`](../../behavior/branding.md).
