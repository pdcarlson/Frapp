# Iconography

> Icon style, sizing, color, accessibility rules, and the semantic intent → icon map for every Signet surface.

---

## 1. Canonical Style — Signet Duotone

All Signet-reskinned surfaces draw icons with the duotone recipe locked in the
[design-system reference](reference/signet-design-system.dc.html) and rendered
throughout the [Canvas screens](reference/canvas-screens.dc.html):

| Layer | Spec |
|-------|------|
| Stroke | 1.6px on a 24px grid, rounded caps and joins |
| Fill | The icon's primary silhouette carries a low-opacity fill of the same hue as the stroke |
| Details | Secondary strokes (clock hands, checkmarks, calendar rules, bell clappers) stay stroke-only, no fill |

Color per state (roles defined in [foundations](foundations.md)):

| State | Stroke | Fill |
|-------|--------|------|
| Neutral / inactive | Muted text role | White at 6% opacity |
| Active / emphasis | Accent text (step 11) | Stroke hue at 16–18% opacity |
| Status | Semantic role color (see §3) | Stroke hue at low opacity, same recipe |

Rules:

1. A state change **recolors** the glyph (stroke + fill together). It MUST NOT
   swap to a solid-filled variant — solid fills are not part of the duotone
   family.
2. Tab bar active state = accent duotone glyph + 700-weight label. No pill or
   container shape behind the glyph.
3. The rounded-square "S" mark is a brand asset, not an icon — it never takes
   the duotone treatment or the chapter accent (see
   [brand identity](../brand-identity.md)).

---

## 2. Size Scale

Use only these icon sizes in product UI:

| Size | Context |
|------|---------|
| 16px | Dense table controls, inline metadata rows, web sidebar items |
| 20px | Default action/icon buttons, list-row leading icons |
| 24px | Mobile tab bar glyphs, high-emphasis hero/feature spots |

- Badge/status companion icons: 14–16px max.
- Avoid custom in-between values unless there is a documented accessibility
  reason.
- Mobile tab glyphs are 24px (`TAB_GLYPH_SIZE` in
  `apps/mobile/components/tab-glyphs.tsx`), matching the Canvas lock. The
  pre-reskin bar drew them at 20px.

---

## 3. Color Usage

- Default icon color MUST inherit the text role it accompanies (secondary or
  muted text — see [foundations](foundations.md)).
- Status icons MUST use the semantic feedback roles (success, warning, danger,
  info). Semantic colors are status-only, never decorative.
- Never encode status with icon color alone — always pair with a text label.

---

## 4. Accessibility

- Icon-only controls MUST include accessible labels (`aria-label` on web,
  `accessibilityLabel` on mobile).
- Decorative icons MUST be hidden from assistive technology and MUST NOT
  receive focus or be announced redundantly.
- Icon strokes MUST have sufficient contrast against their background surface.
- Icon-only controls follow the 44px minimum touch target
  ([foundations](foundations.md)).

---

## 5. Interim Packs (Until Reskin)

The shipping apps use off-the-shelf packs until each surface is reskinned to
duotone. Interim rules:

- **Web (Lucide)** — keep the default stroke weight; do not restyle individual
  icons.
- **Mobile (Ionicons)** — outline variants for navigation and neutral states;
  fill variants only for explicit active/high-emphasis affordances. **The tab
  bar has left this interim path**: its four glyphs are now duotone
  `react-native-svg` components in `apps/mobile/components/tab-glyphs.tsx`,
  transcribed from the Canvas reference. Ionicons remains the interim pack for
  in-screen icons until each screen is reskinned.
- Do not mix icon packs within a single surface.
- Surfaces built or rebuilt under the Signet reskin use the duotone recipe
  (§1); legacy surfaces keep their pack until reskinned.
- Note the interim outline/fill pairs below are a *deliberate* violation of §1
  rule 1, which forbids swapping to a filled variant. They are tolerated only
  while a surface still rides an off-the-shelf pack; a reskinned surface
  recolors one glyph instead.

---

## 6. Semantic Intent Map

This map is the source of truth for intent → icon selection. No ad hoc
substitutions.

### 6.1 Mobile tab bar (duotone, shipped)

The tab bar is reskinned. Its four glyphs live in
`apps/mobile/components/tab-glyphs.tsx` as `react-native-svg` components at
24px, with geometry transcribed from the tab bar drawn in
[`reference/canvas-screens.dc.html`](reference/canvas-screens.dc.html). There is
one component per tab and it recolors between states per §1 rule 1 — there is no
second, filled variant to swap to.

| Semantic intent | Glyph | Notes |
|---|---|---|
| Chat tab (home) | Speech bubble with tail | |
| Events tab | Calendar body; rules and hangers stay stroke-only | |
| Tasks tab | Circle-check; the checkmark stays stroke-only | |
| More tab | **2×2 grid of rounded squares** | Not an ellipsis. Canvas draws the grid, and Canvas wins for visuals — the earlier `ellipsis-horizontal-circle` mapping here was wrong. |

Retired with the 4-tab collapse: the Home, Points, and Profile tabs. Home and
Points no longer exist as screens; Profile moved into the More hub.

### 6.1.1 Mobile in-screen icons (Ionicons, interim)

Screens that have not been reskinned yet still draw Ionicons per §5. Each
cluster replaces its own as it rebuilds; there is no separate icon migration.

### 6.2 Web Dashboard (Lucide)

This table reflects the shipping legacy web app until its reskin. Nav picks
live in `apps/web/components/layout/nav-config.ts`; notifications in
`apps/web/components/layout/dashboard-shell.tsx`; theme toggle in
`apps/web/components/layout/theme-toggle.tsx`.

| Semantic intent | Icon |
|---|---|
| Chat | `MessagesSquare` |
| Profile | `Sparkles` |
| Members | `Users` |
| Alumni | `GraduationCap` |
| Roles | `ShieldCheck` |
| Events | `Calendar` |
| Points | `Star` |
| Tasks | `ClipboardCheck` |
| Service Hours | `FileText` |
| Polls | `Vote` |
| Backwork | `BookOpen` |
| Documents | `FolderOpen` |
| Study session | `Timer` |
| Study Zones | `MapPin` |
| Billing | `CircleDollarSign` |
| Reports | `FileText` |
| Settings | `Settings` |
| Notifications | `Bell` |
| Theme: system | `Monitor` |
| Theme: light | `Sun` |
| Theme: dark | `Moon` |

Notes:

- `FileText` serves both Service Hours and Reports in the shipping nav; the
  reskin SHOULD disambiguate.
- Event **content** surfaces (event cards, event detail) use `CalendarDays`
  for date rows; the nav intent is `Calendar`.
- **Reserved:** `LayoutDashboard` is held for the **Overview** intent and is
  deliberately unused today — the dashboard home screen was removed in the
  chat-first redesign and the index route redirects to `/chat`. If an Overview
  surface is ever built it MUST take this glyph rather than pick a new one.

### 6.3 Maintenance Rule

Any new icon choice — duotone glyph or interim pack pick — MUST be added to
this map in the same PR that introduces it.
