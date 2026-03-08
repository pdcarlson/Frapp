# Frapp UI/UX System Contract

> Last updated: 2026-03-08  
> Scope: landing (`apps/landing`), dashboard (`apps/web`), mobile (`apps/mobile`)

This document is the implementation bridge between the product/UI specs and active UI code.

## 1) Experience Direction

Frapp’s UI direction is **Modern Ivy, Operationally Sharp**:

- Premium trust cues on public-facing surfaces
- Dense-but-clear controls in admin workflows
- Fast, motivating loops on member mobile surfaces

## 2) Color Role Map (Authoritative)

The color role map below resolves prior ambiguity across spec docs:

- **Brand anchor:** Navy (`#0F172A`)
- **Primary action:** Royal Blue (`#2563EB`)
- **Success/reward:** Emerald (`#10B981`)
- **Warning/error:** semantic amber/red tokens

Never treat emerald as global primary action color.

## 3) Component Ownership Matrix

| Layer | Location | Ownership |
|---|---|---|
| Shared primitives | `packages/ui` | Cross-app foundational controls only |
| Theme/tokens | `packages/theme` | Semantic tokens + animation/elevation defaults |
| Dashboard composites | `apps/web/components/*` | Workflow-specific and shadcn/radix compositions |
| Landing sections | `apps/landing/app/*` | Marketing-specific content modules |
| Mobile composites | `apps/mobile/components/*` | React Native/Expo-specific UX patterns |

Rules:
1. If a component is workflow-specific, keep it app-local.
2. If a component is style-agnostic + reusable across web/landing/docs, promote to `packages/ui`.
3. Never duplicate token values in app-local files when semantic tokens exist.

## 4) State Completeness Standard

Every async view must include all relevant states:

1. Loading
2. Empty
3. Error
4. Offline/degraded (if network-dependent)
5. Success confirmation (for mutating actions)

For web dashboards, use shared state modules in `apps/web/components/shared/async-states.tsx` unless there is a strong reason to diverge.

## 5) Accessibility Baseline (Release Gate)

Minimum release requirements:

- Visible focus indicator on all keyboard-focusable controls
- Focus order follows visual order
- Semantic labels for icon-only buttons
- 4.5:1 text contrast minimum
- 3:1 non-text UI contrast minimum
- Dialogs trap focus and return focus to trigger on close

Execution protocol and evidence requirements are documented in:
- `docs/internal/ACCESSIBILITY_TESTING_PROTOCOL.md`

## 6) Motion and Feedback

Adopt these timing ranges:

- Micro-feedback: 100–180ms
- Standard transitions: 180–260ms
- Context shifts: 240–320ms

Motion must remain subtle, functional, and compatible with reduced-motion preferences.

## 7) Chapter Accent Safety Rules

Chapter-provided accent colors must pass minimum contrast thresholds before use:

- Accent on white text: **4.5:1 minimum**
- Invalid hex values are rejected
- Failing colors are automatically replaced with the fallback accent (`royalBlue`)

Implementation reference:
- `packages/theme/src/accent.ts` (`resolveChapterAccentColor`)

## 8) Quality Gate Checklist

A UI change is not ready unless it passes:

1. Visual consistency with token system
2. Spacing consistency on the 4pt scale
3. Clear visual hierarchy
4. Complete state handling
5. Accessibility baseline checks
6. Responsive/adaptive behavior checks
7. Trust/copy clarity (no placeholder language)

Icon sizing and usage standards are documented in:
- `docs/internal/ICONOGRAPHY_GUIDELINES.md`

