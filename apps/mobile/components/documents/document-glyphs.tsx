import Svg, { Path } from "react-native-svg";
import { STROKE_WIDTH } from "@/components/more/more-glyphs";

/**
 * s12's back-row upload arrow (`canvas-screens.dc.html` s12), path for path.
 * Drawn to iconography.md's recipe rather than the board's 22pt at a 1.8
 * stroke, which is off §2's scale: 20px, §2's size for an icon button, at §1's
 * 1.6 stroke. Stroke-only, since neither part is a closed silhouette to fill.
 * Decorative: the control that holds it carries the label.
 *
 * s21's file card reuses the More hub's `DocumentsGlyph` rather than drawing
 * the same page again.
 */
export function UploadGlyph({ color }: { color: string }) {
  const stroke = {
    fill: "none",
    stroke: color,
    strokeWidth: STROKE_WIDTH,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <Svg
      width={20}
      height={20}
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
