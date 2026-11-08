import { useLayoutEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useScreenBelow } from "@/lib/back-target";
import { goBackTo } from "@/lib/href";
import QRCode from "react-native-qrcode-svg";
import {
  countCheckedIn,
  deviceNow,
  elapsedSince,
  isCheckInCodesUnconfigured,
  useAttendance,
  useEvent,
  useMintCheckInToken,
  usePermissionList,
  type DeviceInstant,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { can } from "@repo/validation";
import {
  ErrorState,
  SkeletonBlock,
  SkeletonRegion,
} from "@/components/state-block";
import { CHECK_IN_TOKEN_WINDOW_MS } from "@/lib/events/check-in-code";
import { formatCountdown } from "@/lib/events/format";
import { selectEventDetail, selectMintedToken } from "@/lib/events/select";
import { MONO_FONT_FAMILY, typeRole, useFrappTheme } from "@/lib/theme";
import { InlineNote } from "@/components/inline-note";
import {
  GlassCloseButton,
  GlassCloseSpacer,
} from "@/components/glass-close-button";

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
 * The screen can stay mounted while the officer is elsewhere (the app in the
 * background, or a screen pushed over it). The code and the count are asked
 * for only while this screen has focus, so a screen nobody is looking at doesn't keep minting codes and
 * reading the roster for the rest of the session.
 *
 * That leaves a cached code behind, and an officer who comes back minutes
 * later would see it drawn at once, live dot and all, while the fresh one is
 * still on its way; a member who scanned it would be refused. So a code is
 * drawn only while it will still redeem for long enough to be scanned
 * ({@link SCAN_MARGIN_MS}), and the blank card stands in until the new one
 * lands.
 *
 * The same bound, and nothing else, decides whether a failed request takes
 * the code off screen. A refetch that fails keeps the last code beside its
 * error, and while that code is inside its bound it stays drawn, with no
 * error card, because members can still redeem it. "Code unavailable" shows
 * only when there is no live code to draw. Past its rotation such a code has
 * nothing left to count down, so the row under it says the next one is on its
 * way ("Getting a new code…") or didn't load ("New code didn't load. This one
 * still works."), and its dot turns from green to grey.
 *
 * ## The phone's clocks, from when the code was asked for
 *
 * The server signs window `floor(t / 30s)` and accepts the current window and
 * the previous one, so a code minted at `m` is current until the window
 * boundary (`m + rotatesInMs`) and redeems for one window after it. Every time
 * here is the time elapsed on this phone since the request *started*, which is
 * never later than the mint, against the response's `rotatesInMs`. Elapsed
 * time is the larger reading of the phone's two clocks (`elapsedSince` in
 * `@repo/hooks`), so neither a step of its wall clock nor a sleep, which stops
 * Android's monotonic one, can make a code look younger than it is. So the
 * countdown (`rotatesInMs - elapsed`) and the live bound fall at or before
 * the real moment, never after it, and neither compares the server's clock
 * with the phone's: a phone whose clock is off shows the same countdown.
 *
 * The rotation refetch (`useMintCheckInToken`) is the one time that falls
 * after the computed rotation, on purpose: it asks half a second later,
 * because the computed rotation is early by the request's trip to the server
 * and asking exactly then could get the old window's code back.
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
 * is drawn while, and only while, less than
 * `rotatesInMs + window - margin` has elapsed since it was asked for, whether
 * or not the requests since then failed.
 *
 * While the screen is up, the rotation refetch normally replaces the code
 * within a round trip of its rotation, so the margin takes a code off screen
 * in three cases: one left over from an earlier visit, one from before the
 * phone slept, and, on a focused screen, the last good code once its
 * refetches have kept failing past the bound. The first refetch goes out half
 * a second after the rotation and each one after a failure 10s after it, so a
 * code stays drawn through two failures in a row and the bound passes before
 * the third try. With no live code, the screen draws the error card if the
 * last request failed, and otherwise the blank card until the new code lands.
 */
const SCAN_MARGIN_MS = 10_000;

/**
 * The time on both of the phone's clocks, re-read every half second while
 * `active`. The token itself comes from the server; this only animates the
 * countdown and ages the cached code. It is re-read before paint when the
 * screen comes back, so the first frame of a return is never judged against
 * the time the officer left.
 */
function useNow(active: boolean): DeviceInstant {
  const [now, setNow] = useState(deviceNow);

  useLayoutEffect(() => {
    if (!active) return;
    const tick = () => setNow(deviceNow());
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [active]);

  return now;
}

export default function HostCheckInScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  const below = useScreenBelow();

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
  const age = cached ? elapsedSince(cached.requestedAt, now) : 0;
  // The code to draw: the cached one only while it will still redeem for a
  // scan (see `SCAN_MARGIN_MS`), even when the last request failed. Past that
  // the screen shows the error card if that request failed, and otherwise the
  // blank card it shows while loading, until the refetch focus started
  // replaces it.
  const minted =
    cached &&
    age < cached.rotatesInMs + CHECK_IN_TOKEN_WINDOW_MS - SCAN_MARGIN_MS
      ? cached
      : null;
  // Counted down on the phone's clocks alone: no `expiresAt - now`, which
  // would put the phone's clock error on screen.
  const remaining = minted ? minted.rotatesInMs - age : 0;
  // Past its rotation a drawn code still redeems on the server's
  // previous-window grace, but there is nothing left to count down. A frozen
  // "Rotates in 0:00" beside a live dot would say a rotation is about to
  // happen when the next code is late or failed, so the row says which, and
  // the dot stops reading as live.
  const rotated = minted !== null && remaining <= 0;
  const nextFailed = tokenQuery.isError && !tokenQuery.isFetching;
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

  // The API's own 503 for a missing signing secret, matched on its message
  // (the same match that stops the hook's poll). A bare 503 from an
  // intermediary is transient, so it gets the transient wording and a retry.
  const unconfigured = isCheckInCodesUnconfigured(tokenQuery.error);

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={["top", "left", "right", "bottom"]}
    >
      <View style={styles.header}>
        {/*
          Pops back where the officer started (the event's page, or More), as
          the edge swipe and Android's back do (`spec/ui/mobile/navigation.md`
          § Going back); More when nothing is under it. The app's glass close,
          not the bare "✕ End" it used to be (#3703).
        */}
        <GlassCloseButton
          accessibilityLabel="End hosting and go back"
          onPress={() => (below ? below.goBack() : goBackTo(router, "/more"))}
        />
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={styles.headerTitle}
        >
          {event?.name ?? "Host check-in"}
        </Text>
        <GlassCloseSpacer />
      </View>

      {!eventId ? (
        <View style={styles.stateWrap}>
          <InlineNote>Open an event to host its check-in.</InlineNote>
        </View>
      ) : !canHost ? (
        <View style={styles.stateWrap}>
          <InlineNote>Hosting check-in is for officers who manage events.</InlineNote>
        </View>
      ) : !minted &&
        (tokenQuery.isError || (!tokenQuery.isPending && !cached)) ? (
        <View style={styles.stateWrap}>
          {/*
            Only with no live code to draw: a code that still redeems stays
            on screen through a failed refetch (see `SCAN_MARGIN_MS`).

            Two genuinely different causes, and the screen must not assert the
            wrong one. The unconfigured 503 means the environment has no signing
            secret and no amount of waiting fixes it, so it offers no retry and
            the hook stops asking; anything else gets a retry, and a failure
            that may go through next time (a network blip, a 5xx) or a sign-in
            being renewed (a 401) is asked again on the hook's 10s poll too.
            Naming "not configured" for a dropped request would send an officer
            to chase an infra problem that does not exist.
          */}
          <ErrorState
            title="Code unavailable"
            body={
              unconfigured
                ? "Rotating check-in codes aren't set up for this environment. Members can still check in from the event."
                : "The code didn't load. Members can still check in from the event."
            }
            onRetry={unconfigured ? undefined : () => void tokenQuery.refetch()}
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
                  <View
                    testID={
                      rotated ? "rotates-dot-waiting" : "rotates-dot-live"
                    }
                    style={[styles.liveDot, rotated ? styles.waitingDot : null]}
                  />
                  {rotated ? (
                    <Text style={styles.rotates}>
                      {nextFailed
                        ? "New code didn't load. This one still works."
                        : "Getting a new code…"}
                    </Text>
                  ) : (
                    <Text style={styles.rotates}>
                      Rotates in{" "}
                      <Text style={styles.rotatesTime}>
                        {formatCountdown(remaining)}
                      </Text>
                    </Text>
                  )}
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
              // Loading: a block the size of the code's white card, so the
              // screen doesn't jump when it lands (components.md §10,
              // content-shaped), pulsing with every other skeleton.
              <SkeletonRegion label="Loading check-in code">
                <SkeletonBlock
                  width={qrSize + 2 * tokens.spacing.lg}
                  height={qrSize + 2 * tokens.spacing.lg}
                  radius={tokens.radius.cardLarge}
                />
              </SkeletonRegion>
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

function createStyles(tokens: SignetTokens) {
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
    waitingDot: {
      backgroundColor: tokens.color.text.mutedForeground,
    },
    rotates: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.label),
    },
    rotatesTime: {
      color: tokens.color.text.foreground,
      fontVariant: ["tabular-nums"],
    },
    // A count is a number, so the foreground text, never the chapter accent
    // (foundations.md §6, "Where the accent goes", 2026-11-05).
    count: {
      marginTop: tokens.spacing.sm,
      color: tokens.color.text.foreground,
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
  });
}
