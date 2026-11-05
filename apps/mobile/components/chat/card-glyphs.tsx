import { Path } from "react-native-svg";
import { ServiceGlyph } from "@/components/more/more-glyphs";
import {
  GlyphFrame,
  glyphPaint,
  STROKE_WIDTH,
  type TabGlyphProps,
} from "@/components/tab-glyphs";

/**
 * The eyebrow glyphs of the chat cards that have no tab of their own.
 *
 * Geometry is transcribed from web's chat family
 * (`apps/web/components/chat/chat-glyphs.tsx` and the shell's
 * `components/layout/nav-glyphs.tsx`), so one intent draws one shape on both
 * surfaces (`spec/ui/design-system/iconography.md` §6.2). The recipe and the
 * props are the tab bar's (`components/tab-glyphs.tsx`), which is what
 * `CardEyebrow` draws: the primary silhouette carries the stroke's own hue at
 * low opacity, and the detail strokes stay stroke-only.
 *
 * The event and task cards draw the Events and Tasks tab glyphs themselves.
 * The hours card's heart is the More hub's `ServiceGlyph`, adapted below
 * rather than drawn a second time.
 */

/** Points — the star. */
export function PointsGlyph(props: TabGlyphProps) {
  const { stroke, fill } = glyphPaint(props);
  return (
    <GlyphFrame size={props.size}>
      <Path
        d="M12 3.5l2.3 4.9 5.2.6-3.9 3.6 1.1 5.2-4.7-2.7-4.7 2.7 1.1-5.2-3.9-3.6 5.2-.6z"
        fill={fill}
        stroke={stroke}
        strokeWidth={STROKE_WIDTH}
        strokeLinejoin="round"
      />
    </GlyphFrame>
  );
}

/** Announcement — the megaphone, its sound arc stroke-only. */
export function AnnouncementGlyph(props: TabGlyphProps) {
  const { stroke, fill } = glyphPaint(props);
  return (
    <GlyphFrame size={props.size}>
      <Path
        d="M4 10.2v3.6a1.6 1.6 0 001.6 1.6h2.1L14 19V5l-6.3 3.6H5.6A1.6 1.6 0 004 10.2z"
        fill={fill}
        stroke={stroke}
        strokeWidth={STROKE_WIDTH}
        strokeLinejoin="round"
      />
      <Path
        d="M17.2 9.2a4 4 0 010 5.6"
        fill="none"
        stroke={stroke}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </GlyphFrame>
  );
}

/** `#chapter-audit` — a shield with two record lines. */
export function AuditGlyph(props: TabGlyphProps) {
  const { stroke, fill } = glyphPaint(props);
  return (
    <GlyphFrame size={props.size}>
      <Path
        d="M12 3.2l7 2.6v5.4c0 4.6-3 7.7-7 9.3-4-1.6-7-4.7-7-9.3V5.8z"
        fill={fill}
        stroke={stroke}
        strokeWidth={STROKE_WIDTH}
        strokeLinejoin="round"
      />
      <Path
        d="M9.2 10.4h5.6M9.2 13.4h3.6"
        fill="none"
        stroke={stroke}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </GlyphFrame>
  );
}

/** Service hours — the More hub's heart, in the eyebrow's props. */
export function ServiceHoursGlyph({ focused, accent, muted, size }: TabGlyphProps) {
  return (
    <ServiceGlyph
      color={focused ? accent : muted}
      neutral={!focused}
      size={size}
    />
  );
}
