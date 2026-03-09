# Iconography Guidelines

> Last updated: 2026-03-08  
> Scope: landing, dashboard, mobile

These rules define consistent icon sizing and usage for Frapp UI surfaces.

## 1) Size scale

Use only these icon sizes in product UI:

- **16px**: dense table controls, inline metadata rows
- **20px**: default action/icon buttons, standard nav items
- **24px**: high-emphasis hero/feature spots only

Avoid custom in-between values unless there is a documented accessibility reason.

## 2) Stroke and weight

- Web (Lucide): keep default stroke weight; do not mix arbitrary icon packs within one surface.
- Mobile (Ionicons): use outline variants for navigation and neutral states; fill variants only for explicit active/high-emphasis affordances.

## 3) Context map

- Sidebar + dashboard utility controls: 16px
- Tab bar icons (mobile): 20px
- Badge/status companion icons: 14–16px max

## 4) Color usage

- Default icon color should inherit semantic text color (`text.secondary` or equivalent).
- Status icons should use semantic feedback roles (`success`, `warning`, `error`, `info`).
- Never encode status with icon color alone—pair with text label.

## 5) Accessibility requirements

- Icon-only controls must include accessible labels.
- Decorative icons should not steal focus or be announced redundantly.
- Ensure sufficient contrast for icon strokes against their background.

## 6) Implementation references

- Dashboard shell nav icons: `apps/web/components/layout/dashboard-shell.tsx`
- Mobile tab icons: `apps/mobile/app/(tabs)/_layout.tsx`
- Semantic intent map: `docs/internal/ICON_INTENT_MAP.md`
