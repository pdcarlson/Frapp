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
| Storage | `chapters.theme_palette` (jsonb). Today it holds the legacy web token map (§6). The Signet scale lands as an **additive** field alongside those tokens — not yet implemented (§6) — so legacy readers keep working. |
| Regenerate when | An admin changes the accent (config PATCH touching branding colors triggers recompute), or via the manual recompute endpoint. Never on read, never client-side. |
| Recompute endpoint | `POST /chapters/:id/theme-palette` (`apps/api/src/interface/controllers/chapter-config.controller.ts`), guarded by `CHAPTER_CONFIG_MANAGE`. See [`../../behavior/chapter-config.md`](../../behavior/chapter-config.md). |
| Delivery | Web: CSS custom properties set from the cached tokens. Native: theme context providing the same roles. |

## 5. Never derived from the accent

These are fixed regardless of chapter accent; the engine's output MUST NOT replace them:

- **Mention/DM red** — a direct-address signal, not a themeable one; value and rule in [`foundations.md`](foundations.md) §5.
- **Semantic status colors** (success/warning/danger/info) — status-only, values in [`foundations.md`](foundations.md).
- **The Signet mark** — the logo never takes the chapter accent ([`../brand-identity.md`](../brand-identity.md)).
- **Neutral ladder** — backgrounds, borders, and text colors are constants, not gray-scale outputs of the generator.

## 6. Implementation status

This spec documents the target engine. The code that exists today serves the legacy Frapp web/mobile theme and stays running until the reskin.

### Current (legacy — remains until web reskin)

| Unit | Location | Behavior |
|---|---|---|
| `derivePalette({dark, accent})` | `packages/chapter-theme/src/index.ts` | Generates the legacy 8-token CSS map (`--side-bg` … `--ring`) from two brand colors. Per-token WCAG AA 4.5:1 check with bronze fallback; reports `invalidInputs` instead of throwing. DOM-free. |
| Callers of `derivePalette` | `apps/api/src/application/services/chapter-onboarding.service.ts`, `apps/api/src/application/services/chapter-config.service.ts` | Onboarding seeds `theme_palette`; config PATCH/recompute persists it. |
| `resolveChapterAccentColor(accent, {background, fallbackAccent})` | `packages/theme/src/accent.ts` | Client-side per-surface re-validation of the stored accent (contrast against the actual background, mode-specific fallback). Behavior canon: [`../../behavior/branding.md`](../../behavior/branding.md). |

### Implemented

| Unit | Location | Behavior |
|---|---|---|
| `deriveSignetPalette(seed?)` | `packages/chapter-theme/src/signet.ts` | Wraps `generateRadixColors` with the §1 parameters and emits the §2 role tokens as flat `--signet-*` CSS custom properties, plus their alpha counterparts. DOM-free and CommonJS-safe. Never throws — an absent seed resolves to house gold, an unparseable one does too and sets `invalidSeed`. |
| `generateRadixColors` | `packages/chapter-theme/src/vendor/` | Vendored from `radix-ui/website` (MIT, © 2024 WorkOS); it is not published to npm. Provenance and resync procedure in that directory's README. |

Token names are flat and string-valued so the additive field cannot disturb legacy readers: `apps/web/lib/hooks/use-chapter-theme.ts` iterates every key of `theme_palette` and sets it as a custom property, and nothing in the legacy stylesheet references `--signet-*`.

### Not yet implemented

- `chapters.theme_palette` gains the additive Signet field (§4); the recompute endpoint writes both maps.
- Legacy `derivePalette` and `resolveChapterAccentColor` are removed only after the web reskin stops reading their tokens.

## 7. Open decision

**Accent source of truth** — the seed is currently readable from both `chapters.accent_color` and `branding.colors.accent`, which can disagree. Which column feeds the engine is open in issue **#795**. Until that decision lands, new code MUST NOT add a third read path.

## 8. Validation

- The engine guarantees contrast **by construction** for its mapped roles: the Radix generator produces step 11 as legible text on steps 1–3 surfaces. No runtime per-token fallback (the legacy bronze-substitution pattern) applies to engine output.
- **`on-primary` needs one correction to make that true.** The generator's own contrast color is *not* reliably legible on step 9 for light seeds in dark appearance — it returns white for `#C9A56F` (2.31:1) and `#FF69B4` (2.65:1), where black would score 9.10:1 and 7.93:1. This is not a corner case: `#C9A56F` is 45 of the 100 color values in `supabase/seed/chapter_directory.csv`. So `deriveSignetPalette` keeps the generator's choice when it clears AA — which it does for the house seed, `#2B2009` at 8.82:1 — and otherwise substitutes whichever of black or white scores higher. That substitution cannot itself fail: the two curves cross at luminance ≈0.179 where both score ≈4.58:1, so the better of the pair is always ≥4.5:1 for any color.
- Gate: accent-derived **text** roles MUST meet WCAG AA 4.5:1 on the surfaces they are specified for — `accent-text` (step 11) on the neutral backgrounds and on `accent-subtle-bg`, and `on-primary` on `accent-primary`. This is asserted at generation time and reported on `contrastChecks`, and pinned by `packages/chapter-theme/src/signet.spec.ts` across every distinct chapter color in the seed directory. A generator upgrade is the realistic way it breaks, which is why the generator is vendored rather than floated.
- Save-time validation of the seed itself (format, and legacy light-mode contrast checks) is behavior canon in [`../../behavior/branding.md`](../../behavior/branding.md).
