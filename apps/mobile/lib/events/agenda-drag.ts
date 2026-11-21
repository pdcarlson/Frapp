/**
 * Where a held agenda row lands, and how the rows it passes move out of its
 * way (Paul 2026-11-19: "who thought arrows to move agenda items around was
 * smart?"). Rows wrap and some carry a "Tabled from" line, so each row's
 * place is measured (`onLayout`), not assumed a fixed height the way
 * Arrange channels' one-line rows are. Web's `use-sortable-list.ts` draws the
 * same arithmetic on its measured rects.
 *
 * Worklets: the agenda's animated styles read them on the UI thread.
 */

/** A row's measured place in its list: its top and its height. */
export interface AgendaRowBox {
  y: number;
  h: number;
}

/**
 * The index a held row drops at: the furthest row whose middle its own
 * middle has passed, dragged `dy` from where it was picked up.
 */
export function agendaDropIndex(
  rows: readonly (AgendaRowBox | undefined)[],
  held: number,
  dy: number,
): number {
  "worklet";
  const own = rows[held];
  if (!own) return held;
  const centre = own.y + own.h / 2 + dy;
  let to = held;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const mid = row.y + row.h / 2;
    if (i > held && centre > mid) to = Math.max(to, i);
    if (i < held && centre < mid) to = Math.min(to, i);
  }
  return to;
}

/**
 * How far row `index` slides while row `held` is over `to`: by the held
 * row's height and the gap after it, up when the held row passes it going
 * down, down when going up.
 */
export function agendaRowShift(
  rows: readonly (AgendaRowBox | undefined)[],
  held: number,
  to: number,
  index: number,
): number {
  "worklet";
  const own = rows[held];
  if (!own || index === held) return 0;
  const next = rows[held + 1];
  const prev = rows[held - 1];
  const gap = next
    ? next.y - (own.y + own.h)
    : prev
      ? own.y - (prev.y + prev.h)
      : 0;
  const step = own.h + Math.max(0, gap);
  if (to > held && index > held && index <= to) return -step;
  if (to < held && index < held && index >= to) return step;
  return 0;
}
