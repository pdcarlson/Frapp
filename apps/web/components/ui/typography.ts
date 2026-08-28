/**
 * Type recipes shared across surfaces, in the sense `focus.ts` and
 * `duotone.tsx` are shared recipes rather than components.
 *
 * `EYEBROW` started in `components/chat/chip.ts`, where its own docstring
 * warned that "twelve copies of a four-part class string is how the eleventh
 * and the twelfth quietly become different eyebrows". The Directory & Finance
 * slice of #920 then added three more copies to the alumni filter labels — the
 * warning coming true in the same shape it predicted — so the recipe moves here
 * and both families import it. The alternative, importing a chat module into an
 * alumni screen, would have crossed a family boundary for a string that belongs
 * to neither.
 */

/**
 * The uppercase section label §2 draws above a grouped list.
 *
 * `caption` (12.5) at 600, tracked out 0.12em. Deliberately not `font-mono`:
 * foundations §7 reserves mono for numeric, status and code-like strings, and a
 * section label is a label. It carries no colour — callers pair it with the
 * tone their surface calls for, which is `--muted-foreground` in every current
 * consumer.
 */
export const EYEBROW = "text-[12.5px] font-semibold uppercase tracking-[0.12em]";
