The name of a group of rows, in sentence case, with its count.

**Status:** Changed. The all-caps tracked eyebrow (caption, 600, uppercase, 0.12em) was the documented recipe on both apps; Paul named it as slop on 2026-11-20. The replacement style below is Proposed.

| | File | Component |
| --- | --- | --- |
| Web | `apps/web/components/shared/section-label.tsx`; recipe `EYEBROW` in `apps/web/components/ui/typography.ts` | `SectionLabel` |
| Phone | `apps/mobile/components/list-section.tsx`; recipe in `apps/mobile/components/eyebrow.ts` | `SectionHeader` |

## Anatomy

- Name in `label` (14/600), `muted-foreground`, sentence case.
- Count beside it in `caption`, `muted`, tabular numerals. Spoken as "This week, 3".
- An optional quiet action at the trailing edge ("Show all") in `caption` at 600.
- 24 (`space-xl`) above, 8 (`space-sm`) below, 4 of inset so the text lines up with the group's rounded corner.
- A heading to assistive tech on both apps (`h2` on web, the header role on the phone).

## You provide

The name, an optional `count`, an optional trailing action.

## Rules

- Sentence case always. No capitals, no letter-spacing, anywhere in the product.
- The name is the chapter's word for the thing: "This week", "Officers", "To review". It never explains the group.
- No colour. A section header is never the accent.
- A header with nothing under it is not drawn, except where the empty group itself is the point (see States).

## Web and phone

Identical. The phone already writes this style in two places (`DayHeading`, and the group heading inside `OptionSheet`), and Chat home's "Chapter" and "Committees" headings. The system keeps that and retires `EYEBROW` and `eyebrowStyle`.

## Drift

W1: 115 on web in 77 files (64 `EYEBROW` uses, 39 `SectionLabel`, 12 raw `uppercase`), with six different tracking values. M1: 94 on the phone in 56 files. The phone's `SectionHeader` carries no header role.
