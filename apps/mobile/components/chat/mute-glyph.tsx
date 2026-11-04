import Svg, { Path } from "react-native-svg";
import { tint } from "@/lib/theme";

/**
 * Per-channel notification level (`spec/ui/design-system/iconography.md`
 * §6.2.2). Geometry matches web's `MuteGlyph`: a speaker (a box and its cone,
 * split by a detail stroke) with two sound waves, and an × for the waves when
 * `active` (muted) so the off state reads at a glance. The box, the split and
 * the second wave are what tell it from web's `AnnouncementGlyph`, a single
 * flared horn with one wave.
 *
 * A speaker, not a bell, since #3362: the bell is the notification inbox's
 * glyph on Chat home, and the two controls must not share a silhouette one tap
 * apart.
 *
 * Colors arrive as props rather than baked hexes, for the same reason
 * `components/tab-glyphs.tsx` states: the chapter accent is free to differ.
 */

const STROKE_WIDTH = 1.6;
const INACTIVE_FILL = "rgba(255,255,255,0.06)";
const ACTIVE_FILL_ALPHA = 0.18;

export function MuteGlyph({
  color,
  active = false,
  size = 24,
}: {
  color: string;
  /** `true` means muted: an × replaces the waves as the "this is off" mark. */
  active?: boolean;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path
        d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3a1 1 0 01-1-1v-3a1 1 0 011-1z"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={active ? tint(color, ACTIVE_FILL_ALPHA) : INACTIVE_FILL}
      />
      <Path
        d="M7.5 9.5v5"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        fill="none"
      />
      {active ? (
        <Path
          d="M15.5 9.5l5 5M20.5 9.5l-5 5"
          stroke={color}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ) : (
        <Path
          d="M15.5 9.2a4 4 0 010 5.6M18 6.8a7.4 7.4 0 010 10.4"
          stroke={color}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      )}
    </Svg>
  );
}
