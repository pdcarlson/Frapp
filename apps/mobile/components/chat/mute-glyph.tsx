import Svg, { Path } from "react-native-svg";
import { tint } from "@/lib/theme";

/**
 * Per-channel notification level (`spec/ui/design-system/iconography.md`
 * §6.2.2). Geometry matches web's `MuteGlyph` — a bell, with the slash as a
 * detail stroke when `active` (muted) so the off state reads at a glance.
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
  /** `true` means muted — the slash is the "this is off" mark. */
  active?: boolean;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path
        d="M6.5 10.5a5.5 5.5 0 0111 0c0 3.2.8 4.7 1.6 5.6.4.5.1 1.2-.6 1.2H5.5c-.7 0-1-.7-.6-1.2.8-.9 1.6-2.4 1.6-5.6z"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={active ? tint(color, ACTIVE_FILL_ALPHA) : INACTIVE_FILL}
      />
      <Path
        d="M10.2 20a2 2 0 003.6 0"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {active ? (
        <Path
          d="M4.5 4.5l15 15"
          stroke={color}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ) : null}
    </Svg>
  );
}
