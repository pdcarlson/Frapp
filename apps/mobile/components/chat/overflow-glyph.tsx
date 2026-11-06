import Svg, { Circle } from "react-native-svg";

/**
 * The overflow mark, three dots in a row: web's `MoreHorizontal` on the
 * channel header's `⋯` menu, drawn at the header glyphs' 24pt grid. It names
 * no state of its own; what sits behind it does (`components.md` § Chrome
 * weight, "a couple of taps away").
 */
export function OverflowGlyph({
  color,
  size = 24,
}: {
  color: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Circle cx={5.5} cy={12} r={1.6} fill={color} />
      <Circle cx={12} cy={12} r={1.6} fill={color} />
      <Circle cx={18.5} cy={12} r={1.6} fill={color} />
    </Svg>
  );
}
