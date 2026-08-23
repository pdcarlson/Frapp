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
  background: "#0E0D0B",
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

- The raw seed **MUST NOT** paint UI directly — no component may reference the seed hex. Only the generated steps and the contrast color are paintable. (The seed may appear as data, e.g. a swatch in the admin color picker.)
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

The alpha scale backs translucent variants of the same roles (e.g. a ring glow) where a solid step would occlude content; alpha steps map 1:1 to their solid steps.

## 3. Default seed

The house default seed is **`#F2B72E`**. A chapter with no custom accent runs this seed through the same pipeline — the default is not a separate palette. House gold `#EFB63B` itself is a brand color, not a seed output; see [`../brand-identity.md`](../brand-identity.md).

## 4. Caching and persistence

The generated scale is computed once and cached on the chapter (tenant) record — never regenerated on read.

| Aspect | Behavior |
|---|---|
| Storage | `chapters.theme_palette` (jsonb), holding the `--signet-*` role tokens. It held the legacy web token map alongside them until the #920 slice-9 cutover; the namespace is what let the two ship side by side, because the legacy web reader iterated every key of the column (§6). The column is unconstrained and no backfill prunes it, so a row written before the cutover still carries the dead keys — inert, and kept off `:root` by the allow-lists in the Delivery rows. |
| Regenerate when | An admin changes the accent, through **either** door: `PATCH /chapters/:id/config` carrying `branding.colors` (the onboarding wizards), or `PATCH /v1/chapters/current` carrying `accent_color` (the Settings accent editor, and the only path that UI actually uses). Also via the manual recompute endpoint. Never on read, never client-side. |
| Recompute endpoint | `POST /chapters/:id/theme-palette` (`apps/api/src/interface/controllers/chapter-config.controller.ts`), guarded by `CHAPTER_CONFIG_MANAGE`. See [`../../behavior/chapter-config.md`](../../behavior/chapter-config.md). |
| Delivery | Web: CSS custom properties set from the cached tokens. Native: theme context providing the same roles. |

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
| `resolveChapterAccentColor(accent, {background, fallbackAccent})` | `packages/theme/src/accent.ts` | Client-side re-validation of a stored accent against an actual background. Two call sites remain: the Settings accent preview (`apps/web/components/settings/settings-page.tsx`, which passes the real dark card surface and a dark-legible fallback per #1157) and mobile's pre-Signet-map fallback (`apps/mobile/lib/chapter-branding.ts`). The web shell call site is deleted — the engine never falls back, so the "Accent adjusted" notice went with it. It is **independent of `derivePalette`** and outlived it: it re-validates `accent_color`, and never read that engine's token map. The mobile arm retires when every chapter has been through one save or recompute. Behavior canon: [`../../behavior/branding.md`](../../behavior/branding.md). |

### Implemented

| Unit | Location | Behavior |
|---|---|---|
| `deriveSignetPalette(seed?)` | `packages/chapter-theme/src/signet.ts` | Wraps `generateRadixColors` with the §1 parameters and emits the §2 role tokens as flat `--signet-*` CSS custom properties, plus their alpha counterparts. DOM-free and CommonJS-safe. Never throws — an absent seed resolves to house gold, an unparseable one does too and sets `invalidSeed`. |
| `signetAccentSemanticVars(palette)` | `packages/chapter-theme/src/signet.ts` | Re-keys an already-generated palette onto the semantic names [`foundations.md`](foundations.md) §6 gives the accent slot (`--primary`, `--ring`, …). Pure remap; the §8 guarantees carry through. Opt-in, and **not** what is persisted — see the storage row above and the note below. |
| Persistence | `apps/api/src/application/services/chapter-palette.ts` (`buildChapterPalette`) | One builder behind all three writers — onboarding, the config PATCH / recompute endpoint, and the Settings accent save (`chapter.service.ts`). It writes one map: the Signet roles, produced for **every** chapter, including one that supplied no colours (§3). Until the slice-9 cutover it merged `{...legacy, ...signet}` and the legacy half was produced only when a brand colour was given, so a palette could hold one map or both — that conditional half is gone, and with it the second brand colour (`branding.colors.dark`) that fed it. The seed is `branding.colors.accent`, per §7. An invalid seed and any sub-AA contrast check are logged, never thrown: a colour problem must not fail a save the officer asked for. |
| Delivery (native) | `apps/mobile/lib/chapter-branding.ts` | `useChapterBranding()` reads **`--signet-accent-text`** (step 11) off the served palette. Step 11, not step 9: the hook's single value is consumed as a foreground (tab tint, glyphs, chip labels), and §8 gates only the text roles — `accent-primary` is the solid fill and is not held to 4.5:1, measuring 1.71:1 for a crimson chapter on the mobile card surface. A surface wanting a solid accent fill reads `--signet-accent-primary` with `--signet-accent-on-primary`. The legacy `resolveChapterAccentColor` remains only as the fallback for a chapter whose palette predates the Signet map. |
| Delivery (web) | `apps/web/lib/hooks/use-chapter-theme.ts` | Mounted once by `DashboardShell`, so branding applies shell-wide. Maps the persisted `--signet-accent-*` roles onto the semantic names the Signet stylesheet defines, via `signetAccentSemanticVars` — all-or-nothing: a row persisted before the Signet map existed lacks those keys, and the house-gold defaults baked into `packages/theme/src/signet.css` stand until a save or recompute refreshes it (#1165 tracks the backfill). No per-token client-side fallback runs — contrast is guaranteed at generation time (§8). **Nothing else is applied**, and the allow-list is why that is safe: a row written before the slice-9 cutover still holds the legacy map, six of whose eight tokens were composited over or validated against bone, so blind iteration would paint a light-calibrated value onto the dark surface. The remaining two were the branded sidebar's own fill and accent, for a sidebar that no longer exists. |
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

**The web preset is fully migrated: one format, no pairing rule.** Every colour token in
`packages/theme/src/globals.css` is stored as a **complete colour** (`hsl(30 45% 32%)`, `#C49A3A`,
`rgba(255,255,255,.08)`) and read through `colorVar()` as a bare `var(--token)`. There is no second
convention left to pair against, which is the precondition the shell cutover then built on:
`apps/web` now imports `packages/theme/src/signet.css` — which carries the same one-format rule —
while `globals.css` remains the landing stylesheet.

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

Because the conversion changed only the *format* of these tokens and never a value, `apps/landing`
— frozen pre-Signet, and explicitly out of scope for #920 — renders identically across it.

### Not yet implemented

- Rows persisted before the Signet map existed carry no `--signet-*` keys and render the house
  defaults until a save or recompute refreshes them — the backfill is #1165. The same column also
  still holds the deleted legacy engine's keys for those rows; nothing reads them, and no migration
  prunes them.
- `resolveChapterAccentColor` survives only at the two call sites in the residual table above; the
  mobile fallback goes when every chapter has been through one save.

## 7. Open decision

**Accent source of truth** — the seed is readable from both `chapters.accent_color` and `branding.colors.accent`. **#795 settled it** (closed by #911): `branding.colors.accent` is authoritative and the column mirrors it on every write path, backfilled by `supabase/migrations/20260814120000_backfill_chapter_accent_color_from_branding.sql`. Two readable copies remain, so new code MUST NOT add a third read path.

## 8. Validation

- The engine guarantees contrast **by construction** for its mapped roles: the Radix generator produces step 11 as legible text on steps 1–3 surfaces. No runtime per-token fallback (the legacy bronze-substitution pattern) applies to engine output.
- **`on-primary` needs one correction to make that true.** The generator's own contrast color is *not* reliably legible on step 9 for light seeds in dark appearance — it returns white for `#C9A56F` (2.31:1) and `#FF69B4` (2.65:1), where black would score 9.10:1 and 7.93:1. This is not a corner case: `#C9A56F` is the accent of 45 of the 50 chapters in `supabase/seed/chapter_directory.csv`. So `deriveSignetPalette` keeps the generator's choice when it clears AA — which it does for the house seed, `#2B2009` at 8.82:1 — and otherwise substitutes whichever of black or white scores higher. That substitution cannot itself fail: the two curves cross at luminance ≈0.179 where both score ≈4.58:1, so the better of the pair is always ≥4.5:1 for any color.
- Gate: accent-derived **text** roles MUST meet WCAG AA 4.5:1 on the surfaces they are specified for — `accent-text` (step 11) on the neutral backgrounds and on `accent-subtle-bg`, and `on-primary` on `accent-primary`. This is asserted at generation time and reported on `contrastChecks`, and pinned by `packages/chapter-theme/src/signet.spec.ts` across the 18 distinct colors the seed directory has carried, plus the house seed. That corpus is **frozen in the spec, not read from the CSV** — #1225 dropped the dead `default_colors.dark` half, which is where 13 of the 18 came from, so a list derived from the file today would cover 5. A generator upgrade is the realistic way it breaks, which is why the generator is vendored rather than floated.
- Save-time validation of the seed itself (format, and legacy light-mode contrast checks) is behavior canon in [`../../behavior/branding.md`](../../behavior/branding.md).
