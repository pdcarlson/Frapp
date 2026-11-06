import { Path } from "react-native-svg";
import { Frame, paint } from "@/components/more/more-glyphs";

/**
 * The verbs an icon-only control draws (`spec/ui/design-system/components.md`
 * § Icon-only actions, `iconography.md` §6.1.5): close or dismiss, edit, mark
 * all read, and back. Control furniture, so they draw only the §1 stroke
 * recipe's detail strokes, with no silhouette fill, from `more-glyphs.tsx`'s
 * `Frame` and `paint`, so a change to the recipe reaches them too. Back keeps
 * the recipe but draws a heavier stroke.
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
 * The back arrow's stroke: heavier than the recipe's 1.6, the weight the
 * back-row capsule drew its own arrow at before it drew this one. Every back
 * arrow on mobile takes it.
 */
const BACK_STROKE_WIDTH = 2.2;

/**
 * Back: a left chevron. The chat thread header draws it at 20, and every
 * `BackRow` capsule (`‹ More`, `‹ Events`, `‹ Chat`) at 18, so the two
 * kinds of back control show one arrow. Drawn, never typed: a `‹` character
 * sits on the text's x-height, so in a centered row its ink lands below the
 * title's middle (foundations.md §7, Aligning a row).
 */
export function BackGlyph({ color, size = DEFAULT_SIZE }: ControlGlyphProps) {
  const { detail } = paint({ color });
  return (
    <Frame size={size}>
      <Path d="M14.5 6l-6 6 6 6" {...detail} strokeWidth={BACK_STROKE_WIDTH} />
    </Frame>
  );
}
