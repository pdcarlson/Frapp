import { forwardRef, useEffect, useRef, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import { BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";
import {
  calendarAppLinks,
  useCalendarFeedLink,
  useResetCalendarFeedLink,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetHeader,
  SheetScrim,
  useSheetBackgroundStyle,
  useSheetClose,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import { selectionHaptic } from "@/lib/haptics";
import { typeRole, useFrappTheme } from "@/lib/theme";

/** How long "Copied" stands in for "Copy link" before it reads as a row again. */
const COPIED_HOLD_MS = 1500;

/**
 * Subscribe (#3322): the Events header's sheet that puts the chapter's events,
 * and the member's own open tasks, on the calendar they already use, through
 * a private link the calendar app keeps checking.
 * Behavior: `spec/behavior/events.md` § Calendar subscription.
 *
 * The same menu as web's Events toolbar, and shaped after the same apps:
 * TeamSnap's schedule Subscribe, Canvas's Calendar Feed, Heja's Google
 * Calendar or Copy link. Apple Calendar is offered on iPhone only, where
 * opening a `webcal://` link asks "Subscribe to …?" in one tap; Android has
 * no calendar app that subscribes to one, so it gets Google Calendar.
 *
 * Google Calendar adds a calendar by link only on a computer, never in its
 * phone app ("You can only add a calendar using a link on a computer, not the
 * Google Calendar app", Google's own help), so its row says so and offers to
 * share the link, the step TeamSnap and Canvas also send phone users through:
 * send it to yourself, then add it from a computer.
 *
 * The link is asked for only while the sheet is open (`open`), so a member
 * who never opens it never has one made. Until it arrives the rows are drawn
 * dimmed, so the sheet never changes height.
 */
export const CalendarSubscribeSheet = forwardRef<
  BottomSheetModal,
  { open: boolean; onDismiss: () => void }
>(function CalendarSubscribeSheet({ open, onDismiss }, ref) {
  const closeSheet = useSheetClose(ref);
  const backgroundStyle = useSheetBackgroundStyle();
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const link = useCalendarFeedLink({ enabled: open });
  const reset = useResetCalendarFeedLink();
  const apps = link.data ? calendarAppLinks(link.data) : null;
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  function openApp(url: string | undefined) {
    if (!url) return;
    void Linking.openURL(url).catch(() =>
      Alert.alert(
        "Couldn't open that app",
        "Copy the link instead and add it in your calendar app.",
      ),
    );
    closeSheet();
  }

  function explainGoogle() {
    const url = link.data?.url;
    if (!url) return;
    Alert.alert(
      "Add it from a computer",
      "Google Calendar adds a calendar by link only on a computer. Send yourself the link, then in Google Calendar on a computer choose Other calendars, From URL, and paste it.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Share link",
          onPress: () => void Share.share({ message: url }).catch(() => {}),
        },
      ],
    );
  }

  function copyLink() {
    if (!link.data) return;
    void Clipboard.setStringAsync(link.data.url)
      .then(() => {
        selectionHaptic();
        setCopied(true);
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(false), COPIED_HOLD_MS);
      })
      .catch(() => Alert.alert("Couldn't copy", "Try again in a moment."));
  }

  function confirmReset() {
    Alert.alert(
      "Reset your calendar link?",
      "Calendars using your current link will go empty at their next update. Subscribe again with the new link afterwards.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset link",
          style: "destructive",
          onPress: () =>
            void reset
              .mutateAsync()
              .catch(() =>
                Alert.alert("Couldn't reset your link", "Try again."),
              ),
        },
      ],
    );
  }

  const ready = !!apps;
  const rows: { key: string; label: string; onPress: () => void }[] = [
    ...(Platform.OS === "ios"
      ? [
          {
            key: "apple",
            label: "Apple Calendar",
            onPress: () => openApp(apps?.apple),
          },
        ]
      : []),
    {
      key: "google",
      label: "Google Calendar",
      onPress: explainGoogle,
    },
    {
      key: "copy",
      label: copied ? "Copied" : "Copy link",
      onPress: copyLink,
    },
  ];

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      enableDynamicSizing
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onDismiss={onDismiss}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetView style={styles.body} onAccessibilityEscape={closeSheet}>
        <SheetHeader title="Add to your calendar" />
        <Text style={styles.lead}>
          {link.isError
            ? "Couldn't get your calendar link. Close this and try again."
            : "Chapter events you can see and your open tasks, kept up to date."}
        </Text>
        <View>
          {rows.map((row) => (
            <Pressable
              key={row.key}
              accessibilityRole="button"
              accessibilityLabel={row.label}
              accessibilityState={{ disabled: !ready }}
              disabled={!ready}
              onPress={row.onPress}
              style={({ pressed }) => [
                styles.row,
                pressed ? styles.rowPressed : null,
              ]}
            >
              <Text style={[styles.rowLabel, ready ? null : styles.dimmed]}>
                {row.label}
              </Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reset link"
            accessibilityState={{ disabled: !ready || reset.isPending }}
            disabled={!ready || reset.isPending}
            onPress={confirmReset}
            style={({ pressed }) => [
              styles.row,
              pressed ? styles.rowPressed : null,
            ]}
          >
            <Text
              style={[
                styles.rowLabel,
                styles.destructive,
                ready ? null : styles.dimmed,
              ]}
            >
              Reset link
            </Text>
          </Pressable>
        </View>
        <Text style={styles.footnote}>
          Your calendar app checks for changes on its own schedule. Google
          Calendar can take several hours.
        </Text>
      </BottomSheetView>
    </BottomSheetModal>
  );
});

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.md,
    },
    lead: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    row: {
      minHeight: 44,
      justifyContent: "center",
      paddingVertical: tokens.spacing.sm,
    },
    rowPressed: { opacity: 0.6 },
    rowLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    destructive: { color: tokens.color.semantic.destructiveText },
    dimmed: { color: tokens.color.text.mutedForeground },
    footnote: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
  });
}
