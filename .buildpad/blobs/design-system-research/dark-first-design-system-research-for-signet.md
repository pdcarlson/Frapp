# Signet design system: a dark-first token architecture with per-chapter accent injection

**Bottom line:** Build a fixed, near-monochrome dark base (Signet's own brand identity) and let each chapter inject a *single* accent hex that is algorithmically expanded at runtime into a full, contrast-guaranteed scale. This is not speculative — it is exactly what Linear ships today ("themes are generated from base color, accent color, and contrast" [linear](https://linear.app/now/how-we-redesigned-the-linear-ui)), and two production-grade libraries (`@material/material-color-utilities` and Radix's `generateRadixColors`) will do the color math for you with WCAG/APCA contrast enforcement built in. For the aesthetic, lean toward the **technical/utilitarian cluster (Linear/Vercel/Raycast)** — 4px spacing grid, ~8px radius, near-black surfaces separated by hairline borders rather than shadows — which reads as "premium AI product" and directly counters the current "AI slop" perception. Concrete hex palette and injection code are below.

---

## 1. How the premium reference apps actually build dark UI

The reference apps converge on a consistent recipe: **3–4 near-black surface layers, hairline borders instead of drop shadows, and one restrained chromatic accent** against an otherwise neutral palette.

**Surface layering (the near-black → dark-gray stack).** Every well-documented system uses a small ladder of progressively lighter surfaces:

| Product | Base canvas | Elevated card | Modal/overlay |
|---|---|---|---|
| GitHub (Primer) | **#0D1117** | **#161B22** | **#1C2128** [themeandcolor](https://themeandcolor.com/blog/github-dark-mode-colors) |
| Linear | **#08090a** / **#0f1011** | surface ladder (surface-1…4) | lighter step [designmd](https://designmd.cc/benchmarks/linear) |
| Raycast | input **#07080a** | card **#101111** | (border-defined) [oh-my-design](https://oh-my-design.kr/design-systems/raycast) |
| Notion | **#191919** | **#252525** | colored block surfaces [matthiasfrank](https://matthiasfrank.de/en/notion-colors/) |
| Vercel Geist | Background 1/2 roles | component bg 1–3 | menu/modal (radii documented; raw dark hex not published) [vercel](https://vercel.com/geist/materials) |

**Elevation without shadows.** The universal dark-mode principle is *"higher elevation = lighter surface"* implemented via semi-transparent overlays rather than shadows [material](https://m2.material.io/design/color/dark-theme.html) , with a recommended minimum of ~4 surface levels [muz](https://muz.li/blog/dark-mode-design-systems-a-complete-guide-to-patterns-tokens-and-hierarchy/) . Linear is described as using a "surface ladder + hairline borders … without shadow" [identityforge](https://identityforge.io/learn/linear-design-system) ; GitHub uses "hairline gray borders" to define panes [open-design](https://open-design.ai/plugins/design-system-github/) .

**Border/divider treatment.** Two documented conventions: (a) a fixed dark-gray hex — GitHub default border **#30363D**, muted **#21262D** [themeandcolor](https://themeandcolor.com/blog/github-dark-mode-colors) ; or (b) low-opacity white — Raycast cards use **1px solid rgba(255,255,255,0.06)** and buttons **rgba(255,255,255,0.1)** [oh-my-design](https://oh-my-design.kr/design-systems/raycast) . The rgba-white approach is superior for a *themeable* product because it reads correctly over any surface layer.

**Single accent, used sparingly.** The technical apps are "near-monochrome with a single high-chroma accent" [identityforge](https://identityforge.io/learn/linear-design-system) : Linear indigo-violet **#5e6ad2** [voltagent](https://github.com/voltagent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md) , GitHub blue **#2F81F7** (Primer token `--fgColor-accent` **#0969da**) [primer](https://primer.style/product/primitives/color/) , Notion link **#529CCA** [embednotion](https://embednotion.com/blog/notion-colors) , Cash App green **#00e013** [oh-my-design](https://oh-my-design.kr/design-systems/cashapp) . The accent appears only on primary CTAs, focus rings, links, and active states — everything else is neutral. **This restraint is the key insight for Signet:** because the accent surface area is small and confined to specific roles, swapping it per chapter does not destabilize the overall look.

---

## 2. Per-tenant accent customization: what real products allow (and the one that nails it)

The dominant pattern in mainstream SaaS is a **fixed product accent with only icon/avatar-level tenant identity** — which makes Signet's per-chapter accent a genuine differentiator, but Linear proves it's achievable without breaking the base UI.

- **Notion:** workspaces can change name and icon only; no per-workspace accent theming of the app UI was found [notion](https://www.notion.com/help/workspace-settings) .
- **GitHub:** org/team identity is limited to profile pictures/avatars; no per-org accent theming of the app chrome [docs.github](https://docs.github.com/en/organizations/organizing-members-into-teams/setting-your-teams-profile-picture) .
- **Discord:** has role-level color styling (Solid/Gradient/Holographic via boosts) [support.discord](https://support.discord.com/hc/en-us/articles/31444213087255-Enhanced-Role-Styles) and an *experimental* server-wide color theme (3 boosts) that members can opt into [support.discord](https://support.discord.com/hc/en-us/articles/207260127-How-to-Change-Discord-Color-Themes-and-Customize-Appearance-Settings) — but not documented full chrome replacement. Relevant because Signet is replacing Discord: role colors are a *within-tenant* feature, distinct from the *per-tenant* accent.
- **Slack:** custom sidebar themes are **per-user, not per-workspace** — an 8-field color model (Column BG, Active Item, Mention Badge, etc.) that "will only be visible to you" [slack](https://slack.com/help/articles/205166337-Change-your-Slack-theme) . This is the wrong model for Signet (you want per-chapter, admin-set, seen by all members).

**Linear is the reference implementation.** It supports custom themes where an admin sets "background, text and accent colors" and **"Linear generates complimentary shades for borders and elevated boxes"** [linear](https://linear.app/changelog/2020-12-04-themes) , with the full theme derived from just "base color, accent color, and contrast" [linear](https://linear.app/now/how-we-redesigned-the-linear-ui) . This is precisely Signet's model: fixed neutral base, one chapter accent, everything else derived.

**Products that do full per-tenant accent theming** (mostly white-label/embedded analytics and support widgets) confirm the architecture is standard: Front inbox "Choose a color" tints sidebar/headers [front](https://help.front.com/en/articles/2076) ; Intercom's "Action color (Primary color)" drives buttons/links per brand with separate light/dark palettes [intercom](https://www.intercom.com/help/en/articles/6612589-set-up-and-customize-the-messenger) ; embedded-analytics vendors offer "per-client or per-tenant branding" of colors/typography [datatako](https://datatako.com/blog/white-label-embedded-analytics) .

**The delivery pattern is unanimous: CSS custom properties injected per tenant.** Real implementations store a tenant `accentColor` and build `--color-accent` custom properties in the root layout per request [viprasol](https://viprasol.com/blog/saas-white-label/) ; the Reddit/CSS-community consensus is to serve tenant colors as `:root` custom properties referenced by one stylesheet rather than generating many CSS files [reddit](https://www.reddit.com/r/css/comments/oob53o/best_way_to_apply_styles_for_a/) ; Tailwind v4 multi-theme systems override `--primary`-style tokens under a theme class toggled at runtime [dev](https://dev.to/praveen-sripati/how-i-built-a-multi-theme-system-using-new-tailwind-css-v4-react-27j3) .

---

## 3. The core technical method: expanding one accent hex into an accessible scale

This is the most important question, and there are **two production-ready methods** plus a fallback algorithm. Both guarantee contrast against a dark background automatically, which solves the hard problem: a chapter's navy or dark-maroon official color must still yield a *visible, readable* accent on a near-black UI.

### Method A (recommended): Radix `generateRadixColors`

Radix's custom-palette engine takes exactly the inputs you have and produces a dark-appropriate 12-step scale:

```
generateRadixColors({ appearance: 'dark', accent: chapterHex, gray: '#191919', background: '#0a0a0a' })
```

It returns `accentScale[0..11]` (12 solid steps) and `accentScaleAlpha[0..11]`, which you export as CSS variables `--accent-1 … --accent-12` [github](https://github.com/radix-ui/website/blob/52578d3c5956b26c117ad8328ee40ecc6170b648/pages/colors/custom.tsx) . The 12 steps map to fixed UI roles, so you never hand-pick shades:

| Step | Role |
|---|---|
| 1–2 | App / subtle background |
| 3–5 | Component bg, hover, active/selected |
| 6–8 | Subtle border, border/focus ring, hover border |
| 9–10 | **Solid fill (primary buttons), hover** |
| 11–12 | **Low-contrast text, high-contrast text** [radix](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale) |

**Contrast is guaranteed by construction:** Radix states steps 11 and 12 are "guaranteed to Lc 60 and Lc 90 APCA contrast … on top of a step 2 background from the same scale," and "most step 9 colors are designed for white foreground text" [radix](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale) . This directly gives you `accent-foreground` (text *on* the accent button = white, or black when step 9 is light) and `accent` text-on-dark (= step 11/12). The `accent` = step 9 is the standard override point [radix](https://www.radix-ui.com/themes/docs/theme/color) .

### Method B: Material Design 3 `@material/material-color-utilities`

M3 generates a 13-tone tonal palette (tones 0,10,20…95,99,100) from one seed via the HCT (Hue-Chroma-Tone) space [github](https://github.com/material-foundation/material-color-utilities) . In JS:

```
const hct = Hct.fromInt(argbFromHex(chapterHex));
const scheme = new SchemeTonalSpot(hct, /*isDark*/ true, /*contrastLevel*/ 0.0);
```

Contrast is enforced automatically: every color role runs through embedded contrast curves targeting WCAG AA (default) or AAA (`contrastLevel: 1.0`) [deepwiki](https://deepwiki.com/material-foundation/material-color-utilities/3-dynamic-color-system) . The math is deterministic — **a tone difference of 40 guarantees ≥3.0:1 contrast, and a tone difference of 50 guarantees ≥4.5:1** [docs.materialkolor](https://docs.materialkolor.com/material-color-utilities/com.materialkolor.hct/-hct/index.html) — which is why you can programmatically pick the accent tone that clears text (4.5:1) vs. UI-element (3:1 per WCAG 1.4.11 [webaim](https://webaim.org/articles/contrast/) ) thresholds against your `#0a0a0a` base.

### Fallback / normalization algorithm (the "dark navy problem")

If you want to own the code rather than depend on a library, the general algorithm is: **work in OKLCH, hold hue roughly constant, step lightness along a curve, and clamp chroma to gamut** [css-tricks](https://css-tricks.com/almanac/functions/o/oklch/) . OKLCH is perceptually uniform, so stepping lightness avoids the "washed-out/invisible" artifacts of HSL [colors.jarhalab](https://colors.jarhalab.com/wiki/oklch-color) ; out-of-gamut colors are handled by "reducing chroma while preserving lightness and hue" [oklchcolorpalettegenerator](https://oklchcolorpalettegenerator.com/) . Compute contrast with `chroma.contrast()` (WCAG) [gka](https://gka.github.io/chroma.js/) or `apca-w3`'s `APCAcontrast(sRGBtoY(text), sRGBtoY(bg))` [npmjs](https://www.npmjs.com/package/apca-w3) , and select the lightness step that clears 4.5:1 (text) / 3:1 (UI) against `#0a0a0a` [developer.mozilla](https://developer.mozilla.org/en-US/docs/Web/Accessibility/Guides/Understanding_WCAG/Perceivable/Color_contrast) . `culori`'s `toGamut()` handles clamping [github](https://github.com/Evercoder/culori/blob/main/docs/api.md) .

**Critical normalization rule:** a dark, low-chroma brand color (navy, maroon) will be invisible as a *solid button fill* on near-black. Do **not** use the chapter's raw hex as `accent-solid`. Instead, feed it as the *seed/hue source* and let the generator pick the tonal step with sufficient lightness — M3's contrast enforcement and Radix's role-mapping both do this automatically, guaranteeing a usable accent regardless of the input. **Recommendation: use Method A (Radix) as primary**, because its APCA text guarantees are documented per-step and its output maps 1:1 onto shadcn's token model (below), minimizing integration work.

---

## 4. Typography, spacing, radius: pick the technical end of the spectrum

The reference apps split cleanly into two clusters:

| Dimension | Technical/utilitarian (Linear, Vercel, Raycast) | Softer consumer (Notion, Cash App) |
|---|---|---|
| Radius | 4/6/8px default [designmd](https://designmd.cc/benchmarks/linear) ; Vercel 6px base, 12px cards [vercel](https://vercel.com/geist/materials) | Notion 8/12px [designmd](https://designmd.cc/benchmarks/notion) ; Cash App **20px** [oh-my-design](https://oh-my-design.kr/design-systems/cashapp) |
| Spacing | 4px base grid: 4,8,12,16,24,32,48 [voltagent](https://github.com/voltagent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md) | Notion also 4px grid but larger type range [designmd](https://designmd.cc/benchmarks/notion) |
| Type | Geist Sans/Mono, Inter, system-ui; constrained weights [github](https://github.com/educlopez/design-bites/blob/main/design-mds/vercel.com/DESIGN.md) | NotionInter 14–54px; Cash Sans [designmd](https://designmd.cc/benchmarks/notion) |

**Recommendation for Signet: technical/utilitarian, softened by one notch.** The product is a data-dense daily driver (chat, events, points, AI search) for a "premium AI OS" — the Linear/Vercel aesthetic *is* the antidote to "AI slop." But because the users are college students (not enterprise engineers), soften slightly: **default radius 8px** (between Linear's 6 and Notion's 12), **4px spacing grid** (4/8/12/16/24/32/48), **Inter or Geist Sans** for UI with a mono for code/IDs, and constrained font weights (400/500/600, avoid 700+ display per Vercel's convention). Keep chat bubbles and the AI-answer surface a touch rounder (12px) for approachability while cards/inputs stay at 8px.

---

## 5. Concrete, hand-off-ready recommendation

### 5a. Base dark palette (fixed Signet identity)

Inspired by Radix `grayDark` [unpkg](https://app.unpkg.com/@radix-ui/colors@3.0.0/files/gray-dark.css) , Tailwind `zinc`/`neutral` [designrevision](https://designrevision.com/tools/tailwind-colors/zinc) , and GitHub/Linear's stacks. Use rgba-white borders (Raycast pattern) so they read correctly on every surface and under any accent.

| Token | Hex / value | Role |
|---|---|---|
| `--background` | `#0a0a0a` | App canvas (base) |
| `--surface-1` | `#141416` | Raised (sidebar, subtle panels) |
| `--card` | `#1c1c1f` | Elevated card |
| `--popover` | `#232326` | Modal / popover / menu |
| `--border` | `rgba(255,255,255,0.08)` | Hairline divider/border |
| `--border-strong` / `--input` | `rgba(255,255,255,0.14)` | Input border, stronger dividers |
| `--foreground` | `#ededed` | Text primary (high contrast) |
| `--muted-foreground` | `#a1a1aa` | Text secondary |
| `--muted` text | `#71717a` | Text muted/tertiary |
| text-disabled | `#52525b` | Disabled |
| `--success` | `#3fb950` | Positive (readable on dark) |
| `--warning` | `#e5a000` | Caution [designsystem.digital](https://designsystem.digital.gov/design-tokens/color/state-tokens/) |
| `--destructive` | `#f85149` | Danger/error |
| `--info` | `#2f81f7` | Informational |

Note: semantic hues follow dark-mode conventions (brighter than USWDS light-mode "-dark" tokens, which are tuned as *text on white*) [designsystem.digital](https://designsystem.digital.gov/design-tokens/color/state-tokens/) — verify each at 4.5:1 against `#0a0a0a` before locking.

### 5b. Token structure (shadcn/ui-compatible, so components work unchanged)

Adopt shadcn's exact semantic variable names — `background/foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, each with a `-foreground` pair — consumed by Tailwind as `hsl(var(--x))` (v3) or via `@theme` (v4) [shadcn](https://ui.shadcn.com/docs/theming) . **Map the chapter accent onto the `--primary`/`--ring`/`--accent` tokens** so every shadcn button, focus ring, and active state inherits it automatically:

```
/* fixed base — packages/theme/src/globals.css */
:root, .dark {
  --background:#0a0a0a; --foreground:#ededed;
  --card:#1c1c1f; --popover:#232326;
  --muted:#141416; --muted-foreground:#a1a1aa;
  --border: 255 255 255 / 0.08; --input: 255 255 255 / 0.14;
  /* accent tokens injected per tenant (defaults = Signet house accent) */
  --primary: var(--accent-9);
  --primary-foreground: var(--accent-contrast);
  --ring: var(--accent-8);
  --accent: var(--accent-5);
  --accent-foreground: var(--accent-11);
}
```

### 5c. Accent-injection mechanism

1. Chapter admin sets one hex in tenant settings (their official color).
2. At tenant resolve time (server), run `generateRadixColors({ appearance:'dark', accent:hex, gray:'#191919', background:'#0a0a0a' })` → `accentScale[0..11]` + `accentContrast` [github](https://github.com/radix-ui/website/blob/52578d3c5956b26c117ad8328ee40ecc6170b648/pages/colors/custom.tsx) . Cache the result on the tenant record (regenerate only when the admin changes the color).
3. **Web:** inject `--accent-1 … --accent-12` and `--accent-contrast` into a `<style>` in the root layout scoped to the tenant, per the standard per-tenant CSS-custom-property pattern [viprasol](https://viprasol.com/blog/saas-white-label/) . Everything referencing `--primary`/`--ring`/`--accent` retints automatically.
4. **Mobile (NativeWind):** NativeWind v5 supports runtime token override via `VariableContextProvider`, passing the computed accent scale so the wrapped subtree picks up the new values [nativewind](https://www.nativewind.dev/v5/guides/themes) ; NativeWind can also back Tailwind color utilities with CSS custom properties [nativewind](https://www.nativewind.dev/docs/guides/themes) . Define accent variables in both `@theme` and `:root` per NativeWind's requirement [nativewind](https://www.nativewind.dev/v5/guides/themes) .

### 5d. Shared `packages/theme` across web + mobile

Put the base tokens and the accent-generation function in one package. The proven monorepo pattern: a shared styles package exports a CSS entrypoint with `@theme` token definitions that both apps import (no build step) [nx](https://nx.dev/blog/sharing-tailwind-styles-nx-monorepo) . Structure:

- `packages/theme/src/globals.css` — base neutral tokens + `@theme` mappings (imported by web Tailwind entry and native global CSS).
- `packages/theme/src/generateAccent.ts` — the `generateRadixColors` wrapper (used by both server-side web injection and the mobile `VariableContextProvider`).
- `packages/theme/tailwind-preset.ts` — shared Tailwind/NativeWind preset mapping semantic tokens to `hsl(var(--x))`.

**One caveat to flag:** NativeWind's CSS-variable and dynamic-theming support is less mature than the web's `.dark`-class model, so prefer its provider-based theming on native rather than assuming web-identical `.dark` toggling [nativewind](https://www.nativewind.dev/v5/guides/themes) — budget a small amount of native-specific integration work here.

---

## Where more research would most change the recommendation

Two areas would strengthen this before final lock. **First, Vercel Geist's actual dark hex values** were not publicly extractable (only role/radius docs) — if you want a Vercel-grade base rather than a Radix/GitHub-derived one, a direct inspection of Geist's rendered CSS variables would refine the exact surface hex ladder. **Second, empirical validation of the accent generator against real fraternity/sorority official colors** (many of which are dark navy, maroon, dark green, or gold) — run 20–30 actual chapter color pairs through `generateRadixColors` on the `#0a0a0a` base and eyeball button/focus/text legibility, since the "invisible dark brand color" edge case is where a per-tenant accent system most often fails in practice. Both are execution checks, not open questions — the architecture itself is well-supported by the Linear precedent and the two production color libraries.