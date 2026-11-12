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
import * as WebBrowser from "expo-web-browser";
import { BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";
import {
  calendarAppLinks,
  errorCopy,
  readGoogleCalendarReturn,
  useCalendarFeedLink,
  useConfirmGoogleCalendarConnect,
  useDisconnectGoogleCalendar,
  useGoogleCalendarStatus,
  useResetCalendarFeedLink,
  useStartGoogleCalendarConnect,
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
 * Where Google's sign-in comes back to: the Events tab, which is where the
 * member started, so the router has a real screen to land on when the system
 * also hands the address to the app.
 */
const GOOGLE_RETURN_PATH = "events";
const GOOGLE_CALENDAR_WEB = "https://calendar.google.com/calendar/r";
/**
 * Sign-ins this app has already finished, by return address and by sign-in.
 * Kept for the life of the process, not the sheet: `Linking.useURL` hands
 * every new mount the address that launched the app, so a sheet that mounts
 * again (a chapter switch, signing in again) would post a spent code and say
 * the connection failed. `join.tsx` keeps its launch address the same way.
 */
const finishedSignIns = new Set<string>();

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
 *
 * Google Calendar (#3322, step 2; § Google Calendar): where the server offers
 * it, the Google row connects the member's Google account instead, which works
 * on a phone, unlike Google's add-by-link. It opens Google's own sign-in in
 * the system's sign-in sheet, the same one "Sign in with Google" uses, and
 * Frapp then keeps a calendar of its own in the account. Connected, the row
 * opens Google Calendar, and Disconnect sits beside Reset link, as on web.
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
  const google = useGoogleCalendarStatus();
  const startGoogle = useStartGoogleCalendarConnect();
  const confirmGoogle = useConfirmGoogleCalendarConnect().mutateAsync;
  const disconnectGoogle = useDisconnectGoogleCalendar();
  const googleConnect = google.data?.available ? google.data : null;
  const returnUrl = Linking.useURL();
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

  /**
   * Finish a sign-in Google sent back. The same address can arrive twice (the
   * sign-in sheet's result, and the system handing it to the app), and the
   * code is single use, so each sign-in is finished once.
   */
  function finishGoogle(url: string) {
    const query = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
    const outcome = readGoogleCalendarReturn(new URLSearchParams(query));
    if (!outcome || finishedSignIns.has(url)) return;
    finishedSignIns.add(url);
    if (outcome.kind !== "confirm") {
      if (outcome.kind !== "denied") {
        Alert.alert(
          "Google Calendar wasn't connected",
          outcome.kind === "expired"
            ? "That Google sign-in expired. Connect Google Calendar again."
            : "Google didn't finish the sign-in. Connect Google Calendar again.",
        );
      }
      return;
    }
    if (finishedSignIns.has(outcome.state)) return;
    finishedSignIns.add(outcome.state);
    void confirmGoogle({ code: outcome.code, state: outcome.state })
      .then(() =>
        Alert.alert(
          "Google Calendar connected",
          "Your chapter's events and your tasks show up there within a minute.",
        ),
      )
      .catch((error: unknown) =>
        Alert.alert(
          "Google Calendar wasn't connected",
          errorCopy(error, "Google didn't finish the sign-in. Connect Google Calendar again.", {
            serverWritesForMembers: true,
          }),
        ),
      );
  }

  useEffect(() => {
    if (returnUrl) finishGoogle(returnUrl);
    // finishGoogle reads only refs and stable mutations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnUrl]);

  async function connectGoogle() {
    const back = Linking.createURL(GOOGLE_RETURN_PATH);
    closeSheet();
    try {
      const url = await startGoogle.mutateAsync({
        client: "mobile",
        returnUrl: back,
      });
      const result = await WebBrowser.openAuthSessionAsync(url, back);
      if (result.type === "success") finishGoogle(result.url);
    } catch (error) {
      Alert.alert(
        "Couldn't open Google",
        errorCopy(error, "Try again in a moment."),
      );
    }
  }

  function openGoogleCalendar() {
    closeSheet();
    void Linking.openURL(GOOGLE_CALENDAR_WEB).catch(() => {});
  }

  function confirmDisconnectGoogle() {
    const account = googleConnect?.google_email;
    Alert.alert(
      "Disconnect Google Calendar?",
      `Frapp's calendar is removed from ${
        account ? `your Google account (${account})` : "your Google account"
      }. Your other calendars aren't touched.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () =>
            void disconnectGoogle
              .mutateAsync()
              .catch((error: unknown) =>
                Alert.alert(
                  "Couldn't disconnect",
                  errorCopy(error, "Try again in a moment."),
                ),
              ),
        },
      ],
    );
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
  const googleRow: Row = !googleConnect
    ? { key: "google", label: "Google Calendar", onPress: explainGoogle }
    : googleConnect.connected && googleConnect.status === "active"
      ? {
          key: "google",
          label: "Google Calendar",
          detail: "Connected",
          onPress: openGoogleCalendar,
          alwaysReady: true,
        }
      : {
          key: "google",
          label: "Google Calendar",
          detail:
            googleConnect.status === "needs_reconnect" ? "Reconnect" : undefined,
          detailTone: "destructive",
          onPress: () => void connectGoogle(),
          alwaysReady: true,
          busy: startGoogle.isPending,
        };
  const rows: Row[] = [
    ...(Platform.OS === "ios"
      ? [
          {
            key: "apple",
            label: "Apple Calendar",
            onPress: () => openApp(apps?.apple),
          },
        ]
      : []),
    googleRow,
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
          {rows.map((row) => {
            const enabled = (row.alwaysReady || ready) && !row.busy;
            return (
              <Pressable
                key={row.key}
                accessibilityRole="button"
                accessibilityLabel={
                  row.detail ? `${row.label}, ${row.detail}` : row.label
                }
                accessibilityState={{ disabled: !enabled }}
                disabled={!enabled}
                onPress={row.onPress}
                style={({ pressed }) => [
                  styles.row,
                  pressed ? styles.rowPressed : null,
                ]}
              >
                <Text
                  style={[styles.rowLabel, enabled ? null : styles.dimmed]}
                >
                  {row.label}
                </Text>
                {row.detail ? (
                  <Text
                    style={[
                      styles.rowDetail,
                      row.detailTone === "destructive"
                        ? styles.destructive
                        : null,
                    ]}
                  >
                    {row.detail}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
          {googleConnect?.connected ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Disconnect Google Calendar"
              accessibilityState={{ disabled: disconnectGoogle.isPending }}
              disabled={disconnectGoogle.isPending}
              onPress={confirmDisconnectGoogle}
              style={({ pressed }) => [
                styles.row,
                pressed ? styles.rowPressed : null,
              ]}
            >
              <Text style={[styles.rowLabel, styles.destructive]}>
                Disconnect Google Calendar
              </Text>
            </Pressable>
          ) : null}
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
          {googleConnect?.connected && googleConnect.google_email
            ? `Google Calendar is connected as ${googleConnect.google_email} and updates within minutes. Other calendar apps check on their own schedule.`
            : googleConnect
              ? "Google Calendar updates within minutes once connected. Other calendar apps check on their own schedule."
              : "Your calendar app checks for changes on its own schedule. Google Calendar can take several hours."}
        </Text>
      </BottomSheetView>
    </BottomSheetModal>
  );
});

interface Row {
  key: string;
  label: string;
  /** Said after the label, at the row's end: "Connected", "Reconnect". */
  detail?: string;
  detailTone?: "destructive";
  onPress: () => void;
  /** Usable before the subscription link arrives (it doesn't need it). */
  alwaysReady?: boolean;
  busy?: boolean;
}

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
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.sm,
      paddingVertical: tokens.spacing.sm,
    },
    rowDetail: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
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
