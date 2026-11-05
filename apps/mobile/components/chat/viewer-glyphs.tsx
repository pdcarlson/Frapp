import { Platform } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

/**
 * The image viewer's controls (`image-viewer.tsx`): close, share and the two
 * step chevrons. They are control furniture (`spec/ui/design-system/
 * iconography.md` §6.2.2: a verb on a button), so they draw stroke only, with
 * no duotone fill, at the recipe's 1.6 stroke on a 24 grid.
 *
 * Share draws each platform's own mark, because that is the mark each
 * platform's members already read as "send this somewhere": iOS's box with an
 * arrow out of it, Android's three joined nodes.
 */

const STROKE_WIDTH = 1.6;

interface ViewerGlyphProps {
  color: string;
  size?: number;
}

function Frame({
  size = 24,
  children,
}: {
  size?: number;
  children: React.ReactNode;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      {children}
    </Svg>
  );
}

function stroke(color: string) {
  return {
    stroke: color,
    strokeWidth: STROKE_WIDTH,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };
}

export function CloseGlyph({ color, size }: ViewerGlyphProps) {
  return (
    <Frame size={size}>
      <Path d="M6 6l12 12M18 6L6 18" {...stroke(color)} />
    </Frame>
  );
}

export function ShareGlyph({ color, size }: ViewerGlyphProps) {
  if (Platform.OS === "android") {
    return (
      <Frame size={size}>
        <Circle cx={17.5} cy={5.5} r={2.5} {...stroke(color)} />
        <Circle cx={6.5} cy={12} r={2.5} {...stroke(color)} />
        <Circle cx={17.5} cy={18.5} r={2.5} {...stroke(color)} />
        <Path d="M8.7 10.7l6.6-3.9M8.7 13.3l6.6 3.9" {...stroke(color)} />
      </Frame>
    );
  }
  return (
    <Frame size={size}>
      <Path d="M12 3.5v11M8 7.5l4-4 4 4" {...stroke(color)} />
      <Path
        d="M8.5 10.5H7a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-1.5"
        {...stroke(color)}
      />
    </Frame>
  );
}

export function ChevronGlyph({
  color,
  size,
  direction,
}: ViewerGlyphProps & { direction: "left" | "right" }) {
  return (
    <Frame size={size}>
      <Path
        d={direction === "left" ? "M14.5 6l-6 6 6 6" : "M9.5 6l6 6-6 6"}
        {...stroke(color)}
      />
    </Frame>
  );
}
