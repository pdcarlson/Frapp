import { forwardRef, useCallback, useRef, type ComponentType } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";
import { Circle, Path, Rect, Text as SvgText } from "react-native-svg";
import type { PlusMenuCommand, PlusMenuModel } from "@repo/chat-core/plus-menu";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetHeader,
  SheetScrim,
  SHEET_STACK_BEHAVIOR,
  useSheetBackgroundStyle,
  useSheetClose,
} from "@/components/sheet-scaffold";
import {
  EventsGlyph,
  GlyphFrame,
  glyphPaint,
  STROKE_WIDTH,
  TabGlyph,
  TasksGlyph,
  type TabGlyphProps,
} from "@/components/tab-glyphs";
import { ServiceHoursGlyph } from "./card-glyphs";

/**
 * The composer's **+** on the phone (#3865): Photo, then a row per form the
 * member can open here (Poll, Sign-up sheet, Event, Task, Service hours), in web's + menu
 * order. What it offers, greys and explains is `plusMenuModel` in
 * `@repo/chat-core/plus-menu`, web's own rule, so the two can't drift:
 *
 * - a row the role can't use, or whose module the chapter turned off, is left
 *   out, and a line at the bottom says why;
 * - a row that can't work this second (offline, a photo or a reply staged) is
 *   greyed with the reason beside it. A poll and a sign-up sheet queue like
 *   a message, so offline doesn't grey them.
 *
 * It always opens, even with Photo alone, so that line can show. Points has no
 * phone form yet, so the host doesn't list it.
 *
 * A row's action runs once this sheet has finished closing, not on the tap:
 * presenting the photo library or another sheet while this one animates out
 * can leave the next one drawing nothing.
 */

export interface ComposerPlusSheetProps {
  model: PlusMenuModel;
  /**
   * Why Photo can't be used this second (offline), ahead of the model's own
   * reason (the tray is full); `null` when nothing stops it but the model.
   */
  photoDisabledReason: string | null;
  onPhoto: () => void;
  /**
   * Opens the GIF picker (#4631); omitted when the server has no GIF search
   * set up, which leaves the row out.
   */
  onGif?: () => void;
  /** Why GIF can't be used this second (offline, a reply staged). */
  gifDisabledReason?: string | null;
  onOpenForm: (command: PlusMenuCommand) => void;
}

const ROW_GLYPH: Record<PlusMenuCommand, ComponentType<TabGlyphProps>> = {
  poll: PollGlyph,
  signup: SignupGlyph,
  form: FormGlyph,
  event: EventsGlyph,
  task: TasksGlyph,
  hours: ServiceHoursGlyph,
  points: PointsRowGlyph,
};

export const ComposerPlusSheet = forwardRef<
  BottomSheetModal,
  ComposerPlusSheetProps
>(function ComposerPlusSheet(
  { model, photoDisabledReason, onPhoto, onGif, gifDisabledReason, onOpenForm },
  ref,
) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const closeSheet = useSheetClose(ref);
  // The chosen row's action, run on dismiss (see the header).
  const chosen = useRef<(() => void) | null>(null);

  const choose = useCallback(
    (run: () => void) => {
      chosen.current = run;
      closeSheet();
    },
    [closeSheet],
  );
  const dismissed = useCallback(() => {
    const run = chosen.current;
    chosen.current = null;
    run?.();
  }, []);

  const photoReason = photoDisabledReason ?? model.attachDisabledReason;
  const muted = tokens.color.text.mutedForeground;

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      enableDynamicSizing
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onDismiss={dismissed}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetView onAccessibilityEscape={closeSheet} style={styles.body}>
        <SheetHeader title="Add to the conversation" onCancel={closeSheet} />
        <PlusRow
          label="Photo"
          glyph={PhotoGlyph}
          reason={photoReason}
          onPress={() => choose(onPhoto)}
          muted={muted}
          styles={styles}
        />
        {onGif ? (
          <PlusRow
            label="GIF"
            glyph={GifRowGlyph}
            reason={gifDisabledReason ?? null}
            onPress={() => choose(onGif)}
            muted={muted}
            styles={styles}
          />
        ) : null}
        {model.rows.map((row) => (
          <PlusRow
            key={row.command}
            label={row.label}
            glyph={ROW_GLYPH[row.command]}
            reason={row.disabledReason}
            onPress={() => choose(() => onOpenForm(row.command))}
            muted={muted}
            styles={styles}
          />
        ))}
        {model.footer.length > 0 ? (
          <View style={styles.footer}>
            {model.footer.map((line) => (
              <Text key={line} style={styles.footerLine}>
                {line}
              </Text>
            ))}
          </View>
        ) : null}
      </BottomSheetView>
    </BottomSheetModal>
  );
});

function PlusRow({
  label,
  glyph: Glyph,
  reason,
  onPress,
  muted,
  styles,
}: {
  label: string;
  glyph: ComponentType<TabGlyphProps>;
  /** Why it can't be used this second; greys the row and is read with it. */
  reason: string | null;
  onPress: () => void;
  muted: string;
  styles: ReturnType<typeof createStyles>;
}) {
  const disabled = reason !== null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={reason ? `${label}, ${reason}` : label}
      accessibilityState={disabled ? { disabled: true } : undefined}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        disabled ? styles.rowDisabled : null,
        pressed ? styles.rowPressed : null,
      ]}
    >
      <Glyph focused={false} accent={muted} muted={muted} size={20} />
      <Text style={styles.rowLabel}>{label}</Text>
      {reason ? <Text style={styles.rowReason}>{reason}</Text> : null}
    </Pressable>
  );
}

/** Photo: a framed picture, sun and hill, in the card eyebrows' stroke recipe. */
function PhotoGlyph(props: TabGlyphProps) {
  const { stroke, fill } = glyphPaint(props);
  return (
    <GlyphFrame size={props.size}>
      <Rect
        x={3.5}
        y={5}
        width={17}
        height={14}
        rx={2.4}
        fill={fill}
        stroke={stroke}
        strokeWidth={STROKE_WIDTH}
      />
      <Circle
        cx={9}
        cy={10}
        r={1.6}
        fill="none"
        stroke={stroke}
        strokeWidth={STROKE_WIDTH}
      />
      <Path
        d="M4 17l5-4.6 3.2 2.8 3.3-3.4L20 16"
        fill="none"
        stroke={stroke}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </GlyphFrame>
  );
}

/**
 * GIF (#4631): "GIF" lettered in a rounded frame, as Discord and Slack label
 * it, since no pictogram reads as a GIF on its own. Text in the SVG, so it
 * scales and takes the row's stroke color like every other row glyph.
 */
function GifRowGlyph(props: TabGlyphProps) {
  const { stroke } = glyphPaint(props);
  return (
    <GlyphFrame size={props.size}>
      <Rect
        x={2.8}
        y={6}
        width={18.4}
        height={12}
        rx={3}
        fill="none"
        stroke={stroke}
        strokeWidth={STROKE_WIDTH}
      />
      <SvgText
        x={12}
        y={14.6}
        fontSize={7.4}
        fontWeight="700"
        fill={stroke}
        textAnchor="middle"
      >
        GIF
      </SvgText>
    </GlyphFrame>
  );
}

/**
 * Sign-up sheet (#3926): web's `SignupGlyph` path data, a clipboard, its
 * board filled, the clip and a ticked line stroke-only.
 */
function SignupGlyph(props: TabGlyphProps) {
  const { stroke, fill } = glyphPaint(props);
  return (
    <GlyphFrame size={props.size}>
      <Path
        d="M6.6 5h10.8a1.6 1.6 0 011.6 1.6v12.8a1.6 1.6 0 01-1.6 1.6H6.6A1.6 1.6 0 015 19.4V6.6A1.6 1.6 0 016.6 5z"
        fill={fill}
        stroke={stroke}
        strokeWidth={STROKE_WIDTH}
        strokeLinejoin="round"
      />
      <Path
        d="M9.4 3.4h5.2v3.2H9.4zM8.8 12.2l1.6 1.6 3-3M8.8 16.8h6.4"
        fill="none"
        stroke={stroke}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </GlyphFrame>
  );
}

/**
 * Form (#3926 step 3): web's `FormGlyph` path data, a sheet with two
 * answered lines and a blank one, its sheet filled, the lines stroke-only.
 */
function FormGlyph(props: TabGlyphProps) {
  const { stroke, fill } = glyphPaint(props);
  return (
    <GlyphFrame size={props.size}>
      <Path
        d="M6.6 3.5h10.8a1.6 1.6 0 011.6 1.6v13.8a1.6 1.6 0 01-1.6 1.6H6.6A1.6 1.6 0 015 18.9V5.1a1.6 1.6 0 011.6-1.6z"
        fill={fill}
        stroke={stroke}
        strokeWidth={STROKE_WIDTH}
        strokeLinejoin="round"
      />
      <Path
        d="M8.4 8.6a.9.9 0 101.8 0 .9.9 0 10-1.8 0M12 8.6h3.6M8.4 12.6a.9.9 0 101.8 0 .9.9 0 10-1.8 0M12 12.6h3.6M8.6 16.6h6.8"
        fill="none"
        stroke={stroke}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </GlyphFrame>
  );
}

function PollGlyph(props: TabGlyphProps) {
  return <TabGlyph name="polls" {...props} />;
}

// Points isn't offered on the phone yet (no form); the map stays total.
function PointsRowGlyph(props: TabGlyphProps) {
  return <TabGlyph name="points" {...props} />;
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
    },
    row: {
      minHeight: tokens.touch.minimum,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
    },
    rowDisabled: {
      opacity: 0.4,
    },
    rowPressed: {
      opacity: 0.7,
    },
    rowLabel: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
      flex: 1,
    },
    rowReason: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    footer: {
      marginTop: tokens.spacing.sm,
      gap: tokens.spacing.xs,
    },
    footerLine: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
  });
}
