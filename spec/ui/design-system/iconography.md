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
- The shipping legacy mobile app renders tab icons at 20px (`TAB_ICON_SIZE` in
  `apps/mobile/app/(tabs)/_layout.tsx`); the Canvas screens lock tab glyphs at
  24px for the reskin.

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
  fill variants only for explicit active/high-emphasis affordances.
- Do not mix icon packs within a single surface.
- Surfaces built or rebuilt under the Signet reskin use the duotone recipe
  (§1); legacy surfaces keep their pack until reskinned.

---

## 6. Semantic Intent Map

This map is the source of truth for intent → icon selection. No ad hoc
substitutions.

### 6.1 Mobile (Ionicons)

Shipping pairs live in `TAB_ICON_NAMES` in `apps/mobile/app/(tabs)/_layout.tsx`.
The Signet reskin collapses the tab bar to four tabs — Chat, Events, Tasks,
More (see [mobile navigation](../mobile/navigation.md)).

| Semantic intent | Inactive / neutral | Active / emphasis | In the 4-tab nav? |
|---|---|---|---|
| Chat tab (home) | `chatbubbles-outline` | `chatbubbles` | Yes |
| Events tab | `calendar-outline` | `calendar` | Yes |
| Tasks tab | `checkmark-circle-outline` | `checkmark-circle` | Yes — new; pair matches the Canvas circle-check glyph, not yet shipped |
| More tab | `ellipsis-horizontal-circle-outline` | `ellipsis-horizontal-circle` | Yes |
| Home tab | `home-outline` | `home` | No — legacy, retired with the Home tab |
| Points tab | `trophy-outline` | `trophy` | No — legacy, leaves the tab bar |
| Profile tab | `person-outline` | `person` | No — legacy, leaves the tab bar |

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
