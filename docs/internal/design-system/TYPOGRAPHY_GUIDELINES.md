# Typography Guidelines

> Last updated: 2026-03-08  
> Scope: landing, dashboard, mobile

This document defines the shared typography role map and where each role should be used.

## 1) Type roles (from `@repo/theme/tokens`)

| Role | Token | Default size | Use |
|---|---|---:|---|
| Display | `type.display` | 34 | Hero-level or top-of-screen anchors |
| Title | `type.title` | 30 | Primary page titles |
| Section | `type.section` | 18 | Card/section headers |
| Body | `type.body` | 15 | Main explanatory copy |
| Meta | `type.meta` | 13 | Supporting metadata and helper text |
| Label | `type.label` | 12 | Eyebrows, pills, compact labels |
| Mono | `type.mono` | 13 | Numeric/status strings where fixed-width readability matters |

## 2) Surface usage

- **Landing**: `display` for hero headlines, `section` for module titles, `body/meta` for conversion support copy.
- **Dashboard**: `title` for page header, `section` for card headings, `meta/label` for table metadata and status context.
- **Mobile**: `title` for screen titles, `section` for card titles, `body` for descriptions, `meta/label` for state and support text.

## 3) Rules

1. Prefer semantic role tokens over ad hoc sizes for new/updated UI.
2. If a role does not fit, add/update token definitions first, then adopt them consistently.
3. Keep hierarchy clear: each screen should have one obvious typographic anchor.

## 4) Implementation references

- Token source: `packages/theme/src/tokens.ts`
- Mobile examples: `apps/mobile/components/screen-shell.tsx`, `apps/mobile/components/task-loop-card.tsx`
