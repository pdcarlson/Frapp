import Svg, { Path, Rect } from "react-native-svg";

/**
 * The two glyphs the tasks cluster draws, transcribed from
 * `spec/ui/design-system/reference/canvas-screens.dc.html` — the visual truth
 * that wins over prose per #937. Nothing here is invented.
 *
 * Colors arrive as props rather than baked hexes, for the reason
 * `components/tab-glyphs.tsx` states: the values agree with Canvas today, but
 * the chapter accent is free to differ and a baked hex would not follow it.
 */

/**
 * The checkmark inside a completed task's filled checkbox.
 *
 * Canvas s08 draws it at 13px on a 14-unit grid with a 2.2 stroke — heavier
 * than the 1.6 the iconography recipe specifies for the 24px tab family,
 * because this mark is drawn at half that size and a 1.6 stroke disappears.
 */
export function CheckGlyph({ color, size = 13 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14">
      <Path
        d="M2.5 7.5l3 3 6-7"
        stroke={color}
        strokeWidth={2.2}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * The calendar on the s19 due-date field.
 *
 * Stroke-only, unlike the `EventsGlyph` in `tab-glyphs.tsx` which carries the
 * duotone fill: `iconography.md` §1 reserves the fill for a primary silhouette,
 * and inside a form field this is a label affordance rather than a nav target.
 * Canvas draws it exactly this way.
 */
export function CalendarGlyph({
  color,
  size = 17,
}: {
  color: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect
        x={4}
        y={5}
        width={16}
        height={15}
        rx={3}
        stroke={color}
        strokeWidth={1.7}
        fill="none"
      />
      <Path
        d="M4 9.5h16M8.5 3v4M15.5 3v4"
        stroke={color}
        strokeWidth={1.7}
        fill="none"
        strokeLinecap="round"
      />
    </Svg>
  );
}
