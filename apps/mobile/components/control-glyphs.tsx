import { Platform } from "react-native";
import { Circle, Path } from "react-native-svg";
import { Frame, paint } from "@/components/more/more-glyphs";

/**
 * The verbs an icon-only control draws (`spec/ui/design-system/components.md`
 * § Icon-only actions, `iconography.md` §6.1.5): close or dismiss, edit, mark
 * all read and share. Share also leads a labelled button (setup's `Share
 * invite`), and the invite link's own mark, `LinkGlyph`, lives here beside
 * it. Control furniture, so they draw only the §1 stroke recipe's detail
 * strokes, with no silhouette fill, from `more-glyphs.tsx`'s `Frame` and
 * `paint`, so a change to the recipe reaches them too.
 *
 * One file, so every dismiss on mobile is the same ×: the network banner, the
 * thread's error banner, the composer's chips, the image viewer, the
 * service-hours proof row and Chat home's setup-checklist hide all draw
 * {@link CloseGlyph}.
 *
 * 20px by default, §2's size for an icon button. The image viewer passes 24.
 * Decorative: the control that holds the glyph carries the label.
 */

interface ControlGlyphProps {
  color: string;
  size?: number;
}

const DEFAULT_SIZE = 20;

export function CloseGlyph({ color, size = DEFAULT_SIZE }: ControlGlyphProps) {
  const { detail } = paint({ color });
  return (
    <Frame size={size}>
      <Path d="M6 6l12 12M18 6L6 18" {...detail} />
    </Frame>
  );
}

/** Edit: web draws Lucide's `Pencil` for the same intent. */
export function PencilGlyph({ color, size = DEFAULT_SIZE }: ControlGlyphProps) {
  const { detail } = paint({ color });
  return (
    <Frame size={size}>
      <Path
        d="M15.5 4.5a2.12 2.12 0 013 3L8 18l-4 1 1-4 10.5-10.5z"
        {...detail}
      />
      <Path d="M13.5 6.5l4 4" {...detail} />
    </Frame>
  );
}

/** Mark all read: web draws Lucide's `CheckCheck` for the same intent. */
export function CheckAllGlyph({
  color,
  size = DEFAULT_SIZE,
}: ControlGlyphProps) {
  const { detail } = paint({ color });
  return (
    <Frame size={size}>
      <Path d="M2.5 12.5l4.5 4.5L17 7" {...detail} />
      <Path d="M12.5 16l1 1L22 8.5" {...detail} />
    </Frame>
  );
}

/**
 * Share: each platform's own mark, because that is the mark its members
 * already read as "send this somewhere": iOS's box with an arrow out of it,
 * Android's three joined nodes. The image viewer draws it at 24, the setup
 * invite step's gold button at 20.
 */
export function ShareGlyph({ color, size = DEFAULT_SIZE }: ControlGlyphProps) {
  const { detail } = paint({ color });
  if (Platform.OS === "android") {
    return (
      <Frame size={size}>
        <Circle cx={17.5} cy={5.5} r={2.5} {...detail} />
        <Circle cx={6.5} cy={12} r={2.5} {...detail} />
        <Circle cx={17.5} cy={18.5} r={2.5} {...detail} />
        <Path d="M8.7 10.7l6.6-3.9M8.7 13.3l6.6 3.9" {...detail} />
      </Frame>
    );
  }
  return (
    <Frame size={size}>
      <Path d="M12 3.5v11M8 7.5l4-4 4 4" {...detail} />
      <Path
        d="M8.5 10.5H7a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-1.5"
        {...detail}
      />
    </Frame>
  );
}

/** An invite link: the setup invite step's link card and its shared rows. */
export function LinkGlyph({ color, size = DEFAULT_SIZE }: ControlGlyphProps) {
  const { detail } = paint({ color });
  return (
    <Frame size={size}>
      <Path
        d="M10 14a4.5 4.5 0 006.4 0l3-3a4.5 4.5 0 00-6.4-6.4l-1 1"
        {...detail}
      />
      <Path
        d="M14 10a4.5 4.5 0 00-6.4 0l-3 3a4.5 4.5 0 006.4 6.4l1-1"
        {...detail}
      />
    </Frame>
  );
}
