import { useLayoutEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import {
  countCheckedIn,
  useAttendance,
  useEvent,
  useMintCheckInToken,
  usePermissionList,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { can } from "@repo/validation";
import { EmptyState, ErrorState } from "@/components/state-block";
import { useChapterBranding } from "@/lib/chapter-branding";
import { CHECK_IN_TOKEN_WINDOW_MS } from "@/lib/events/check-in-code";
import { formatCountdown } from "@/lib/events/format";
import { selectEventDetail, selectMintedToken } from "@/lib/events/select";
import { MONO_FONT_FAMILY, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s22 — Host check-in, admin (`canvas-screens.dc.html:704`).
 *
 * An officer projects this; members scan it with s18. The code rotates every 30
 * seconds and the server accepts the current and previous window, so a scan
 * racing a rotation still lands (`spec/ui/mobile/patterns.md`).
 *
 * ## The QR is dark-on-white even though the app is dark-only
 *
 * `patterns.md`: "QR rendering is always dark-on-white (s22: white card on the
 * dark screen), even in dark UI. Scan reliability beats theme purity." Camera
 * decoders expect dark modules on a light background; inverting for the theme
 * costs real scans in a dim room. This is the one place in the app where a
 * hardcoded white is correct — and it is a *canvas* for a machine-read code,
 * not chrome, so it does not breach the no-raw-hex rule for screen styling.
 *
 * ## Not on ScreenShell
 *
 * The QR needs to be as large as the screen allows so it scans from across a
 * room; the shell's padded, max-width ScrollView actively works against that.
 * The body measures its own width and sizes the code to it, up to
 * {@link QR_MAX_SIZE}.
 *
 * ## What the board draws that this doesn't
 *
 * The board's count reads "23 / 31 checked in" over a progress bar. Nothing
 * here knows how many are expected (the roster is only who has a row), so the
 * denominator and the bar are left out rather than invented. Its "Manual
 * override" is drawn as an accent link to the officer override (marking a
 * member present by hand). `spec/ui/mobile/patterns.md` § QR check-in lists
 * that override among mobile's fallbacks, but no mobile screen builds it yet,
 * so the bottom row keeps only the code members type in s18's sheet.
 *
 * ## Live only while it is on screen
 *
 * `host-check-in` is a `Tabs.Screen`, which stays mounted after the officer
 * leaves. The code and the count poll only while this screen has focus, so a
 * screen nobody is looking at doesn't mint a code every 10 seconds for the
 * rest of the session.
 *
 * That leaves a cached code behind, and an officer who comes back minutes
 * later would see it drawn at once, live dot and all, while the fresh one is
 * still on its way; a member who scanned it would be refused. So a code is
 * drawn only while it will still redeem for long enough to be scanned
 * ({@link SCAN_MARGIN_MS}), and the blank card stands in until the new one
 * lands.
 *
 * ## One clock: the phone's, from when the code was asked for
 *
 * The server signs window `floor(t / 30s)` and accepts the current window and
 * the previous one, so a code minted at `m` is current until the window
 * boundary (`m + rotatesInMs`) and redeems for one window after it. Every time
 * here is measured on this phone's clock from when the request *started*,
 * which is never later than the mint, plus the response's `rotatesInMs`
 * (`selectMintedToken`'s `rotatesAt`). So the countdown, the rotation refetch
 * (`useMintCheckInToken`) and the live bound each fall at or before the real
 * moment, never after it, and none of them compares the server's clock with
 * the phone's: a phone whose clock is off shows the same countdown.
 */

/** Until the body has measured itself: the size the screen always drew. */
const QR_FALLBACK_SIZE = 260;
/** Past this the code only gets coarser, not easier to scan. */
const QR_MAX_SIZE = 340;
/** On a phone narrow enough to go below this, the code still scans. */
const QR_MIN_SIZE = 180;
/** The live dot beside the countdown, as drawn. */
const LIVE_DOT_SIZE = 8;

/**
 * How often the "N checked in" count is re-read while the officer watches it.
 * The roster isn't pushed to this screen (nothing invalidates it when *another*
 * member checks in), so without a poll it froze at its value when the screen
 * opened. Ten seconds is fresh enough for a number read across a room.
 */
const ATTENDANCE_POLL_MS = 10_000;

/**
 * How long a drawn code must still redeem for: a member has to raise the
 * phone and decode it, s18 may need a location fix (a cold one at the
 * "balanced" accuracy it asks for takes a few seconds), and the check-in then
 * has to reach the server. Ten seconds covers that on poor venue Wi-Fi. A code
 * is drawn as live only until `rotatesAt + window - margin`; while the screen
 * is up the rotation refetch replaces it within a round trip of `rotatesAt`,
 * so the margin only ever blanks a code left over from an earlier visit.
 */
const SCAN_MARGIN_MS = 10_000;

/**
 * The time, re-read every half second while `active`. The token itself comes
 * from the server; this only animates the countdown and ages the cached code.
 * It is re-read before paint when the screen comes back, so the first frame
 * of a return is never judged against the time the officer left.
 */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useLayoutEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [active]);

  return now;
}

export default function HostCheckInScreen() {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const router = useRouter();

  const params = useLocalSearchParams<{ eventId?: string | string[] }>();
  const eventId = Array.isArray(params.eventId)
    ? params.eventId[0]
    : (params.eventId ?? "");

  // True on a focused screen's first render, so the code is asked for at once
  // rather than a commit later.
  const focused = useIsFocused();

  // `can` from @repo/validation, not a local `includes` — an owner's grant is
  // the wildcard `*`, so a bare membership test would lock out exactly the
  // people most likely to be hosting.
  const permissions = usePermissionList();
  const canHost = can("events:update", permissions);

  const eventQuery = useEvent(eventId);
  const event = useMemo(
    () => selectEventDetail(eventQuery.data),
    [eventQuery.data],
  );

  // Both requests are officer-gated, so neither is fired for a member who would
  // only get a 403 back.
  const tokenQuery = useMintCheckInToken(eventId, canHost && focused);
  const { data: attendance } = useAttendance(canHost ? eventId : "", {
    refetchInterval: focused ? ATTENDANCE_POLL_MS : false,
  });

  const now = useNow(focused);
  const cached = useMemo(
    () => selectMintedToken(tokenQuery.data),
    [tokenQuery.data],
  );
  // The code to draw: the cached one only while it will still redeem for a
  // scan (see `SCAN_MARGIN_MS`). Past that the screen shows the blank card it
  // shows while loading, and the refetch focus started replaces it.
  const minted =
    cached &&
    now < cached.rotatesAt + CHECK_IN_TOKEN_WINDOW_MS - SCAN_MARGIN_MS
      ? cached
      : null;
  // Counted down on the phone's clock alone: no `expiresAt - now`, which
  // would put the phone's clock error on screen.
  const remaining = minted ? minted.rotatesAt - now : 0;
  const checkedIn = countCheckedIn(attendance);

  const [bodyWidth, setBodyWidth] = useState<number | null>(null);
  const qrSize =
    bodyWidth === null
      ? QR_FALLBACK_SIZE
      : Math.max(
          QR_MIN_SIZE,
          Math.min(
            QR_MAX_SIZE,
            Math.floor(
              bodyWidth -
                2 * tokens.spacing["2xl"] -
                2 * tokens.spacing.lg,
            ),
          ),
        );

  // The API's error bodies carry `statusCode`; anything else stays null so the
  // copy below falls through to the transient wording rather than guessing.
  const tokenStatus = ((): number | null => {
    // `unknown` first: TanStack types the error as `Error`, but what actually
    // lands here is the API's JSON body, which is not an Error instance.
    const raw = tokenQuery.error as unknown;
    if (!raw || typeof raw !== "object") return null;
    const code = (raw as { statusCode?: unknown }).statusCode;
    return typeof code === "number" ? code : null;
  })();

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={["top", "left", "right", "bottom"]}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="End hosting and go back"
          // A fixed destination, by the rule `components/back-row.tsx` states:
          // this is a hidden tab, so `router.back()` follows the tab
          // navigator's default `backBehavior` ("firstRoute") to Chat home.
          // More, because its Host check-in row is the one way in; "End"
          // names no place, so it goes back where the officer started.
          onPress={() => router.navigate("/more")}
          style={({ pressed }) => [styles.end, pressed ? styles.pressed : null]}
        >
          <Text style={styles.endText}>✕ End</Text>
        </Pressable>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={styles.headerTitle}
        >
          {event?.name ?? "Host check-in"}
        </Text>
        <View style={styles.end} />
      </View>

      {!eventId ? (
        <View style={styles.stateWrap}>
          <EmptyState
            glyph="◎"
            title="No event selected"
            body="Open an event to host its check-in."
          />
        </View>
      ) : !canHost ? (
        <View style={styles.stateWrap}>
          <EmptyState
            glyph="◎"
            title="Officers only"
            body="Hosting check-in needs the events permission."
          />
        </View>
      ) : tokenQuery.isError || (!tokenQuery.isPending && !cached) ? (
        <View style={styles.stateWrap}>
          {/*
            Two genuinely different causes, and the screen must not assert the
            wrong one. A 503 means the environment has no signing secret and no
            amount of waiting fixes it, so it offers no retry; anything else (a
            network blip, a 5xx) is transient, and both the button and the 10s
            poll can clear it. Naming "not configured" for a dropped request
            would send an officer to chase an infra problem that does not exist.
          */}
          <ErrorState
            title="Code unavailable"
            body={
              tokenStatus === 503
                ? "Rotating check-in codes aren't set up for this environment. Members can still check in from the event."
                : "The code didn't load. Members can still check in from the event."
            }
            onRetry={
              tokenStatus === 503 ? undefined : () => void tokenQuery.refetch()
            }
            isRetrying={tokenQuery.isFetching}
          />
        </View>
      ) : (
        <>
          <View
            style={styles.body}
            onLayout={(layout) =>
              setBodyWidth(layout.nativeEvent.layout.width)
            }
          >
            {minted ? (
              <>
                <View style={styles.qrCard}>
                  <QRCode
                    value={minted.qrPayload}
                    size={qrSize}
                    // Explicit, not inherited: see the header note on why this
                    // stays dark-on-white regardless of the app's dark theme.
                    color="#000000"
                    backgroundColor="#FFFFFF"
                  />
                </View>

                <View style={styles.rotatesRow}>
                  <View style={styles.liveDot} />
                  <Text style={styles.rotates}>
                    Rotates in{" "}
                    <Text style={styles.rotatesTime}>
                      {formatCountdown(remaining)}
                    </Text>
                  </Text>
                </View>

                {checkedIn !== null ? (
                  <Text
                    accessibilityLabel={`${checkedIn} checked in`}
                    style={styles.count}
                  >
                    {checkedIn}
                    <Text style={styles.countLabel}> checked in</Text>
                  </Text>
                ) : null}
              </>
            ) : (
              // Loading: a blank card where the code will be, so the screen
              // doesn't jump when it lands (components.md §10, content-shaped).
              <View
                accessibilityRole="progressbar"
                accessibilityLabel="Loading"
                style={[
                  styles.qrPlaceholder,
                  {
                    width: qrSize + 2 * tokens.spacing.lg,
                    height: qrSize + 2 * tokens.spacing.lg,
                  },
                ]}
              />
            )}
          </View>

          {minted ? (
            <View style={styles.footer}>
              <Text style={styles.manualLabel}>Show code</Text>
              <Text selectable style={styles.manualCode}>
                {minted.manualCode}
              </Text>
            </View>
          ) : null}
        </>
      )}
    </SafeAreaView>
  );
}

function createStyles(tokens: SignetTokens, accent: string) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: tokens.color.surface.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: tokens.spacing.lg,
      gap: tokens.spacing.sm,
    },
    end: {
      minWidth: 64,
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
    },
    endText: {
      color: accent,
      ...typeRole(tokens.typography.role.label),
    },
    headerTitle: {
      flex: 1,
      textAlign: "center",
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.title),
    },
    stateWrap: {
      padding: tokens.spacing.lg,
    },
    body: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: tokens.spacing["2xl"],
      gap: tokens.spacing.md,
    },
    qrCard: {
      borderRadius: tokens.radius.cardLarge,
      backgroundColor: "#FFFFFF",
      padding: tokens.spacing.lg,
      alignItems: "center",
      justifyContent: "center",
    },
    qrPlaceholder: {
      borderRadius: tokens.radius.cardLarge,
      backgroundColor: tokens.color.surface.popover,
    },
    rotatesRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      marginTop: tokens.spacing.xs,
    },
    liveDot: {
      width: LIVE_DOT_SIZE,
      height: LIVE_DOT_SIZE,
      borderRadius: LIVE_DOT_SIZE / 2,
      backgroundColor: tokens.color.semantic.success,
    },
    rotates: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.label),
    },
    rotatesTime: {
      color: tokens.color.text.foreground,
      fontVariant: ["tabular-nums"],
    },
    count: {
      marginTop: tokens.spacing.sm,
      color: accent,
      ...typeRole(tokens.typography.role.display),
      fontVariant: ["tabular-nums"],
    },
    countLabel: {
      color: tokens.color.text.muted,
      ...typeRole(tokens.typography.role.title),
    },
    footer: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "center",
      gap: tokens.spacing.sm,
      paddingHorizontal: tokens.spacing["2xl"],
      paddingBottom: tokens.spacing.xl,
    },
    manualLabel: {
      color: tokens.color.text.muted,
      ...typeRole(tokens.typography.role.label),
    },
    // Mono, as members type it in s18's sheet, so `0` and `O` look the same
    // on both screens.
    manualCode: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.title),
      fontFamily: MONO_FONT_FAMILY,
      letterSpacing: 1,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
