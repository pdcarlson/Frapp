import {
  useCallback,
  useRef,
  type ForwardedRef,
  type ReactNode,
  type RefObject,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  type BottomSheetModal,
} from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SignetTokens } from "@repo/theme/signet";
import { useBackToClose } from "@/lib/overlay";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";
import { CloseGlyph } from "@/components/control-glyphs";
import { IconButton } from "@/components/icon-button";

/**
 * The chrome every Signet bottom sheet draws: the grabber, the title row (with
 * a Cancel on a form), and the primary CTA — `spec/ui/design-system/components.md` § Bottom
 * sheet, drawn at `canvas-screens.dc.html` s19/s20/s21.
 *
 * Extracted because this is the third sheet in the app and the first two grew
 * byte-identical `grabber` / `sheetHeaderRow` / `sheetPrimaryButton` blocks.
 * That is the same duplication `components/state-block.tsx` was created to stop,
 * and the reason its header gives applies here: the copies drift, and the drift
 * is invisible until two sheets sit side by side.
 *
 * Every sheet in the app draws it, s20's log sheet
 * (`components/service-hours/log-hours-sheet.tsx`) included, which was the last
 * to carry its own copy (#1060).
 *
 * This owns chrome only. The caller supplies the modal itself, because
 * `BottomSheetModal`'s ref, snap behavior and keyboard mode are per-sheet
 * decisions, and `handleComponent` is passed {@link SheetGrabber} directly.
 */

/** `rgba(0,0,0,.55)` as drawn; the backdrop's own default is 0.5. */
const SCRIM_OPACITY = 0.55;

/** A sheet's ref, as a component holds it or as `forwardRef` hands it in. */
type SheetRef =
  ForwardedRef<BottomSheetModal> | RefObject<BottomSheetModal | null>;

/**
 * Closes the sheet `sheet` names, for a screen reader's escape: pass it as
 * `onAccessibilityEscape` on the view that holds the sheet's content, so
 * VoiceOver's two-finger scrub closes it from anywhere inside, as it closes a
 * native sheet. gorhom wires no escape of its own.
 *
 * It closes like a swipe, so a form keeps its draft. It is held only while the
 * content is mounted, which is while the sheet is up or closing, and gorhom's
 * `dismiss()` is safe on a sheet that is still closing.
 */
export function useSheetClose(sheet: SheetRef): () => void {
  return useCallback(() => {
    if (typeof sheet === "function" || !sheet?.current) return;
    sheet.current.dismiss();
  }, [sheet]);
}

/**
 * Android's back button closes the sheet, rather than going to the navigator
 * underneath and leaving the screen the sheet was opened over. Render it as a
 * child of the `BottomSheetModal`: gorhom mounts a modal's children only while
 * it is presented, so the handler is held exactly that long, and a sheet
 * stacked on top registers later and so closes first. gorhom handles no back
 * press of its own, and `lib/sheet-scrim.spec.ts` fails the build on a sheet
 * that leaves this out.
 */
export function SheetBackToClose({ onClose }: { onClose: () => void }) {
  useBackToClose(true, onClose);
  return null;
}

/**
 * The drawn scrim, for `BottomSheetModal`'s `backdropComponent`
 * (`spec/ui/mobile/patterns.md` § Bottom sheets). It belongs to the presented
 * sheet only: it fades in at the first detent and is gone once dismissed, so
 * nothing dims a screen that has no sheet over it. A plain function of its
 * props, so it can be passed directly without a per-sheet `useCallback`.
 *
 * Every `BottomSheetModal` passes a scrim, and `lib/sheet-scrim.spec.ts`
 * fails the build on one that doesn't: the sheets that predated this one shipped
 * without it, and the screen behind them read through at full brightness.
 * s17 (`components/ask/ask-sheet.tsx`) drew this first, at the drawn
 * `rgba(0,0,0,.55)`, and now passes this one too.
 */
export function SheetScrim(props: BottomSheetBackdropProps) {
  return (
    <BottomSheetBackdrop
      {...props}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      opacity={SCRIM_OPACITY}
      // Named for what a tap on it does, rather than gorhom's default
      // "Bottom sheet backdrop". A screen reader's sure way out of a sheet
      // with no Cancel is Android back or VoiceOver's escape
      // (`SheetBackToClose`, `useSheetClose`): gorhom closes on a touch
      // gesture, and activating the scrim taps its centre, which a tall
      // sheet covers.
      accessibilityLabel="Close"
      accessibilityHint="Closes the sheet."
    />
  );
}

/** The drawn grabber, for `BottomSheetModal`'s `handleComponent`. */
export function SheetGrabber() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View style={styles.grabberZone}>
      <View style={styles.grabber} />
    </View>
  );
}

/**
 * A sheet's title row. Pass `onCancel` on a **form** (a sheet with a commit
 * button: New task, Log service hours, Upload document, Edit profile, Report
 * message), where Cancel says "give the draft up" and differs from a swipe.
 * Leave it out on a **picker or a read-only sheet** (Study zone, Assign to,
 * Blocked members): the pick, the grabber, the scrim, Android back and
 * VoiceOver's escape (`SheetBackToClose`, `useSheetClose`) already close it,
 * so a Cancel or Done there is a second close button
 * (`spec/ui/design-system/components.md` § Chrome weight). An action menu
 * (the message long-press) draws no SheetHeader at all.
 */
export function SheetHeader({
  title,
  onCancel,
  cancelLabel = "Cancel",
  cancelDisabled = false,
}: {
  title: string;
  onCancel?: () => void;
  cancelLabel?: string;
  /**
   * Holds Cancel while a save is in flight, on a sheet whose Cancel gives the
   * draft up: the save can't be called back, so a Cancel then would clear
   * the draft and file it anyway, or lose it with no word if the save
   * failed. A swipe still closes such a sheet, keeping the draft.
   */
  cancelDisabled?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <View style={styles.headerRow}>
      <Text style={styles.title}>{title}</Text>
      {/* `hitSlop` meets the 44pt floor while keeping components.md §9's compact
          visual — the #939 ruling. */}
      {onCancel ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={cancelDisabled ? { disabled: true } : undefined}
          disabled={cancelDisabled}
          onPress={onCancel}
          hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
        >
          <Text
            style={[
              styles.cancel,
              cancelDisabled ? styles.cancelDisabled : null,
            ]}
          >
            {cancelLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const TALL_SHEET_SNAP_POINTS = ["100%"];

/**
 * The tall sheet: a sheet for content that should be big
 * (`spec/ui/design-system/components.md` § Surface size). A whole record (a
 * member's profile) or a roster to pick from (Assign to) opens at full height,
 * stopping just under the status bar, rather than in a fixed 65–70% box that
 * cuts the content off and scrolls it in a window. The owner called those
 * cramped (2026-11-05); web puts the same content in a full-height panel.
 *
 * Spread {@link useTallSheetProps} onto the `BottomSheetModal`, then pin the
 * header: `stickyHeaderIndices={[0]}` on the scroller, with the header painted
 * `surface.popover` so rows don't show through it. At full height there is no
 * scrim left to tap, so the header carries {@link SheetCloseButton}; the
 * grabber still drags it away.
 */
export function useTallSheetProps() {
  const { tokens } = useFrappTheme();
  return {
    snapPoints: TALL_SHEET_SNAP_POINTS,
    // Snap points alone don't turn dynamic sizing off in @gorhom v5: it
    // defaults on and adds a content-height detent below 100%, so a short
    // body would open the sheet short.
    enableDynamicSizing: false,
    // The status bar plus a sliver, so the screen behind still shows above
    // the rounded corners and the sheet reads as something to swipe away.
    topInset: useSafeAreaInsets().top + tokens.spacing.sm,
  } as const;
}

/**
 * The close control a tall sheet's header carries: the app-wide `CloseGlyph`
 * in the shared `IconButton` (`components.md` § Icon-only actions), muted,
 * whose slop reaches the 44pt touch floor (`foundations.md` § 9). A word
 * ("Done", "Cancel") would repeat what the X already says (`components.md`
 * § Surface size: a big surface closes with an X).
 */
export function SheetCloseButton({
  onPress,
  accessibilityLabel = "Close",
}: {
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const { tokens } = useFrappTheme();
  return (
    <IconButton label={accessibilityLabel} onPress={onPress}>
      <CloseGlyph color={tokens.color.text.mutedForeground} />
    </IconButton>
  );
}

/**
 * A tall sheet's header row: an optional title and the close X. A record
 * sheet passes no title, because the record's own name heads the body (the
 * member sheet used to say "Member" above "Marcus Ellison").
 */
export function TallSheetHeader({
  title,
  onClose,
}: {
  title?: string;
  onClose: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View style={[styles.headerRow, title ? null : styles.headerRowEnd]}>
      {title ? (
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <SheetCloseButton onPress={onClose} />
    </View>
  );
}

export function SheetPrimaryButton({
  label,
  onPress,
  disabled = false,
  /** Painted with the chapter accent, whose fallback is the drawn house gold. */
  accent,
  onAccent,
  /**
   * Why the button is disabled, wired to the control rather than only printed
   * above it: a screen reader lands on the disabled button, not on the
   * sentence before it.
   */
  accessibilityHint,
  /**
   * A glyph before the label, in the label's ink, for a verb with a mark
   * people know (Invite members' `Share invite`, the platform share mark), as
   * `OnboardingPrimaryButton` draws it in setup.
   */
  icon,
  /** Swaps the label for a spinner while a press waits on the server. */
  busy = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accent: string;
  onAccent: string;
  accessibilityHint?: string;
  icon?: (color: string) => ReactNode;
  busy?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={busy ? label : undefined}
      accessibilityState={{ disabled, busy }}
      accessibilityHint={accessibilityHint}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        { backgroundColor: accent },
        disabled ? styles.primaryButtonDisabled : null,
        pressed && !disabled ? styles.primaryButtonPressed : null,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={onAccent} />
      ) : (
        <View style={styles.primaryRow}>
          {icon ? icon(onAccent) : null}
          <Text style={[styles.primaryLabel, { color: onAccent }]}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/**
 * Which visit of a sheet is on screen. Any sheet whose save can settle after
 * the member closed it uses it; search for the hook to find them. Sheets that
 * still dismiss unguarded after a write are tracked in #3405.
 *
 * Wire `onAnimate` and call `markClosed` first thing in the modal's
 * `onDismiss`. Then:
 *
 * - `dismiss()` closes the sheet only while it is presented. gorhom 5.2's
 *   `dismiss()` on a dismissed modal leaves it stuck mid-dismiss, so the next
 *   `present()` draws nothing (`handlePortalRender`). "Presented" turns true
 *   on `onAnimate` towards an open position, which fires as the sheet starts
 *   to move, so a Cancel during the slide up still closes it, and false only
 *   on `onDismiss`: a close animation can be caught and snapped back without
 *   another `onAnimate`, and `dismiss()` on a sheet still closing is safe.
 * - `visit()` names the visit a write was sent from, and `isSameVisit(token)`
 *   tells a write that settles whether the member is still in that visit. A
 *   sheet closed and reopened since is the member's new visit, and the write
 *   doesn't close it under them.
 * - `isOpen()` tells a write that settles whether any visit is on screen, for
 *   a message that matters only to a member who is looking.
 */
export function useSheetVisit(ref: ForwardedRef<BottomSheetModal>) {
  const presented = useRef(false);
  const closes = useRef(0);

  const onAnimate = useCallback((_from: number, to: number) => {
    if (to >= 0) presented.current = true;
  }, []);

  const markClosed = useCallback(() => {
    presented.current = false;
    closes.current += 1;
  }, []);

  const dismiss = useCallback(() => {
    if (!presented.current) return;
    if (typeof ref === "function" || !ref?.current) return;
    ref.current.dismiss();
  }, [ref]);

  const isOpen = useCallback(() => presented.current, []);
  const visit = useCallback(() => closes.current, []);
  const isSameVisit = useCallback(
    (token: number) => closes.current === token,
    [],
  );

  return { onAnimate, markClosed, dismiss, isOpen, visit, isSameVisit };
}

/**
 * The text field a sheet form draws (s15's profile edit, s19's new task, s20's
 * log, s21's upload), as plain style objects for the caller's own
 * `StyleSheet.create`, so a sheet can add its own layout to `field`. Focus
 * swaps the border to the chapter accent, as every focusable control does
 * (`spec/ui/design-system/components.md` § States). Shared because those
 * sheets had grown three copies, and the focus border had already drifted to
 * house gold in two of them.
 *
 * `ring` / `ringActive` are the drawn focus ring, for a view wrapping the
 * field. Canvas draws `box-shadow: 0 0 0 3px` in the accent at 22%; React
 * Native has no `box-shadow`, and drop shadows are banned by the De-Google
 * guardrails, so the wrapper's border carries `focus.ringWidth` /
 * `focus.ringOpacity` instead. s19 and s20 draw it.
 */
export function sheetFieldStyles(tokens: SignetTokens, accent: string) {
  return {
    field: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    fieldFocused: {
      borderColor: accent,
    },
    ring: {
      borderRadius: tokens.radius.control + tokens.focus.ringWidth,
      borderWidth: tokens.focus.ringWidth,
      borderColor: "transparent",
    },
    ringActive: {
      borderColor: tint(accent, tokens.focus.ringOpacity),
    },
  };
}

/** Shared background for `BottomSheetModal`'s `backgroundStyle`. */
export function useSheetBackgroundStyle() {
  const { tokens } = useFrappTheme();
  return createStyles(tokens).background;
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    background: {
      backgroundColor: tokens.color.surface.popover,
      borderTopLeftRadius: tokens.radius.sheet,
      borderTopRightRadius: tokens.radius.sheet,
    },
    grabberZone: {
      paddingTop: tokens.spacing.sm,
      paddingBottom: tokens.spacing.md,
      alignItems: "center",
    },
    grabber: {
      width: 40,
      height: 4.5,
      borderRadius: tokens.radius.chip,
      backgroundColor: tint(tokens.color.text.foreground, 0.18),
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: tokens.spacing.sm,
    },
    headerRowEnd: {
      justifyContent: "flex-end",
    },
    title: {
      // TODO-DESIGN: Canvas draws the sheet title at 19px/700; `title` is 18/600.
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    cancel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.muted,
    },
    cancelDisabled: {
      opacity: 0.5,
    },
    primaryButton: {
      marginTop: tokens.spacing.sm,
      // The Primary step of foundations.md §9's control size scale. The board
      // draws 50; the owner's 2026-11-05 sizing pass rounded every primary
      // onto the scale's 48.
      height: tokens.touch.buttonLarge,
      borderRadius: tokens.radius.control,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    primaryButtonDisabled: {
      opacity: 0.5,
    },
    primaryButtonPressed: {
      opacity: 0.85,
    },
    primaryLabel: {
      ...typeRole(tokens.typography.role.label),
    },
  });
}
