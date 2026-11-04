import Svg, { Path } from "react-native-svg";
import { tint } from "@/lib/theme";

/**
 * The two glyphs the board draws for s12's upload and s21's file card
 * (`canvas-screens.dc.html` s12, s21), path for path. Decorative: the control
 * that holds each one carries the label.
 */

/** s12's back-row upload arrow, 22pt at a 1.8 stroke as drawn. */
export function UploadGlyph({ color }: { color: string }) {
  const stroke = {
    fill: "none",
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <Svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" {...stroke} />
      <Path
        d="M5 15v3.5A1.5 1.5 0 006.5 20h11a1.5 1.5 0 001.5-1.5V15"
        {...stroke}
      />
    </Svg>
  );
}

/** s21's file card page, 24pt at a 1.6 stroke over a 14% fill of its hue. */
export function FileGlyph({ color }: { color: string }) {
  return (
    <Svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path
        d="M6 3.5h8l4 4V20a1.5 1.5 0 01-1.5 1.5h-10A1.5 1.5 0 015 20V5A1.5 1.5 0 016.5 3.5z"
        fill={tint(color, 0.14)}
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Path
        d="M14 3.5V8h4.5"
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </Svg>
  );
}
