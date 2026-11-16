import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  AppState,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  useFocusEffect,
  useIsFocused,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import * as Location from "expo-location";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import Svg, { Circle, Path } from "react-native-svg";
import { serverMessageOf, statusOf } from "@repo/api-sdk";
import {
  isTransientCheckInFailure,
  useCheckIn,
  useEvent,
  useMyAttendance,
} from "@repo/hooks";
import {
  CHECK_IN_CODE_CHANGED_COPY,
  checkInTargetFrom,
  parseCheckInLink,
  statusLabel,
} from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { useScreenBelow } from "@/lib/back-target";
import { CheckInScanner } from "@/components/check-in/check-in-scanner";
import { ManualCodeSheet } from "@/components/check-in/manual-code-sheet";
import { useSheetVisit } from "@/components/sheet-scaffold";
import { ErrorState } from "@/components/state-block";
import { useChapterBranding } from "@/lib/chapter-branding";
import { isPlausibleManualCode } from "@/lib/events/check-in-code";
import { createScanLatch, type ScanLatch } from "@/lib/events/scan-latch";
import {
  ALREADY_CHECKED_IN_TITLE,
  CHECK_IN_CODE_REFUSED_MESSAGE,
  checkInFailure,
  checkInSuccess,
  needsLocationRefusal,
} from "@/lib/events/check-in-outcome";
import {
  getCheckInLocation,
  locationBlockerCopy,
  type LocationBlocker,
} from "@/lib/events/check-in-location";
import { useWarmCheckInFix } from "@/lib/events/check-in-fix";
import { selectEventDetail, selectMyAttendance } from "@/lib/events/select";
import { useConnection } from "@/lib/connection/use-connection";
import { successHaptic } from "@/lib/haptics";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";
import { webAppOrigin } from "@/lib/onboarding/chapter-wizard/invite-link";
import {
  GlassCloseButton,
  GlassCloseSpacer,
} from "@/components/glass-close-button";

/**
 * s18 — Check in (2026-11-13: the phone's camera, or Scan code in the app).
 *
 * The officer's screen (s22) shows a QR that is an ordinary link,
 * `https://app.frapp.live/check-in?event=…&t=…` (`@repo/validation`
 * `check-in-link.ts`). A member points the phone's own camera at it and taps
 * the banner, as with a Venmo or Cash App code; the link opens this screen with
 * the event and the token, and the check-in goes at once. That is the fast
 * path: the first real check-in (2026-11-13) had members open the app, find
 * the event and tap Scan before pointing anything at the screen.
 *
 * A member already in the app can stay in it (Paul, 2026-11-13: "why not?"):
 * Scan code opens a camera viewport here (`components/check-in/check-in-scanner.tsx`),
 * and a code it reads is handed to this screen as the link's own parameters,
 * so both paths send the same check-in from one place. The event's Scan code
 * opens the screen with the viewport already up (`scan=1`). Opened without a
 * token otherwise (the chat card or Activity once a code is required), the
 * screen offers Scan code, the phone's camera, and the typed code, for a
 * phone whose camera or link handling is broken.
 *
 * ## Location is asked for here, in context
 *
 * Both of the first real scans were refused for carrying no location. So a
 * check-in asks for it the moment it needs it (`lib/events/check-in-location.ts`):
 * the OS prompt the first time, Android's own "turn on location" dialog when
 * location is off, and when the OS won't ask again, a button to Settings that
 * checks the member in when they come back. The check-in goes without a
 * location only when the phone has none to give, because an event nobody is
 * hosting a code for, with no zone, needs none; when the server answers that
 * it needed one, the screen says what to change rather than relaying the
 * refusal.
 *
 * ## The token lasts long enough
 *
 * A scanned token is good for 90 to 120 seconds (the API's
 * `TOKEN_PREVIOUS_WINDOWS`), which covers the banner, the app starting and a
 * location prompt. A trip to Settings can outlast it; then the screen says the
 * code changed and to point the camera at it again.
 */

/**
 * What the screen says about the event it is on. Whether a check-in is on its
 * way is not here: it is kept per event (`sending`), so it can be true of an
 * event the screen has left and comes back to.
 */
type Status =
  | { kind: "idle" }
  /**
   * `checkInSuccess`'s words, and the event they are about, both fixed when
   * the check-in was sent: the screen's event can change while a check-in is
   * in flight (a second link opened over this one).
   */
  | (ReturnType<typeof checkInSuccess> & {
      eventId: string;
      eventName: string | null;
    })
  /**
   * The check-in needed a location the phone didn't give. `blocker` decides
   * what the screen offers (`locationBlockerCopy`).
   */
  | { kind: "location"; blocker: LocationBlocker }
  /**
   * `attemptOnly` is `checkInFailure`'s: a line about this one attempt (the
   * code it sent, or a request that may go through if sent again), cleared
   * when the member turns to typing a code. `retryable` is a request that may
   * go through if sent again (`isTransientCheckInFailure`), which offers Try
   * again: a scanned link the member can't simply re-tap, because the camera
   * hands over the same link and it was sent once already.
   */
  | { kind: "error"; message: string; attemptOnly: boolean; retryable: boolean }
  /**
   * The subscription gate (#2297) or the module gate (#2393) refused the
   * write. Terminal until an officer acts, so it arms nothing.
   */
  | { kind: "blocked"; message: string };

/** What a check-in in flight is doing, for the one muted status line. */
type Phase = "locating" | "sending";

/** The words for a scanned token the server no longer accepts. */
export const CODE_CHANGED_COPY = CHECK_IN_CODE_CHANGED_COPY;

/** What Scan code says about a code that isn't an event's check-in code. */
export const NOT_A_CHECK_IN_CODE =
  "That isn't a Frapp check-in code. Point at the code on the officer's screen.";

/**
 * Which state a failed check-in lands in.
 *
 * A 409 means the member already has a row. PRESENT or LATE is on the list,
 * which is what they came for, so it lands on the success panel in its own
 * words and with no points (#3703). An officer's absent or excused mark is
 * said as one, so "you're in" never contradicts the record; an unread row
 * keeps the plain line, which claims nothing about it.
 *
 * A refusal for a missing location becomes the location state when the phone
 * gave none (`blocker`), and a scanned token refused as stale becomes
 * {@link CODE_CHANGED_COPY}: the shared copy's "ask the host for the current
 * one" is for a typed code.
 */
function failureStatus(
  error: unknown,
  eventId: string,
  eventName: string | null,
  ownRow: ReturnType<typeof selectMyAttendance> | undefined,
  context: { blocker: LocationBlocker | null; scanned: boolean },
): Status {
  if (context.blocker && needsLocationRefusal(error)) {
    return { kind: "location", blocker: context.blocker };
  }
  if (
    context.scanned &&
    statusOf(error) === 403 &&
    serverMessageOf(error) === CHECK_IN_CODE_REFUSED_MESSAGE
  ) {
    return {
      kind: "error",
      message: CODE_CHANGED_COPY,
      attemptOnly: true,
      retryable: false,
    };
  }
  const failure = checkInFailure(error);
  if (failure.kind === "error") {
    return { ...failure, retryable: isTransientCheckInFailure(error) };
  }
  if (failure.kind !== "already") return failure;
  if (ownRow && (ownRow.status === "PRESENT" || ownRow.status === "LATE")) {
    return {
      kind: "success",
      message: failure.message,
      title: ALREADY_CHECKED_IN_TITLE,
      pointsLabel: null,
      eventId,
      eventName,
    };
  }
  return {
    kind: "error",
    message: ownRow
      ? `An officer marked you ${statusLabel("attendance", ownRow.status).toLowerCase()} for this event.`
      : failure.message,
    attemptOnly: false,
    retryable: false,
  };
}

/** The success mark: a circle big enough to read from arm's length. */
const SUCCESS_MARK_SIZE = 72;
/** The glyph above the camera and location states. */
const STATE_GLYPH_SIZE = 56;

export default function CheckInScreen() {
  const { tokens } = useFrappTheme();
  const { accent, accentPrimary, accentOnPrimary } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const router = useRouter();
  const below = useScreenBelow();

  /**
   * The link names the event `event` and the token `t`; the app's own
   * buttons push `eventId`. A link with no token (hand-typed, or cut short)
   * is the plain screen.
   */
  const params = useLocalSearchParams<{
    eventId?: string | string[];
    event?: string | string[];
    t?: string | string[];
    scan?: string | string[];
  }>();
  const eventId = useMemo(() => {
    const raw = params.event ?? params.eventId;
    return (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  }, [params.event, params.eventId]);
  const linkToken = useMemo(
    () => checkInTargetFrom(eventId, params.t)?.token ?? null,
    [eventId, params.t],
  );

  const eventQuery = useEvent(eventId);
  const event = useMemo(
    () => selectEventDetail(eventQuery.data),
    [eventQuery.data],
  );
  /**
   * Nothing is sent until the event has loaded: whether it has a drawn zone
   * decides whether a check-in may go without a location, and the success
   * panel names the event and its points as they were when it was sent.
   */
  const eventLoaded = event !== null;
  const needsLocation = event?.hasCheckInZone ?? false;

  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const focused = useIsFocused();
  /** Scan code's viewport is up. The event's own Scan code opens with it up. */
  const [scannerOpen, setScannerOpen] = useState(() => {
    const raw = Array.isArray(params.scan) ? params.scan[0] : params.scan;
    return raw === "1";
  });
  // A GPS fix kept ready while the screen is up, when location is already
  // allowed, so a check-in doesn't wait on one.
  const warmFix = useWarmCheckInFix(focused);
  const [manualCode, setManualCode] = useState("");

  /**
   * The check-in on its way for each event, keyed by event, holding its
   * request's number and what it is doing. A second link opened over this
   * screen hands it a new event in place, so a check-in for the first can
   * still be on its way; it clears only its own mark when it settles.
   */
  const [sending, setSending] = useState<
    ReadonlyMap<string, { request: number; phase: Phase }>
  >(() => new Map());
  const lastRequestRef = useRef(0);
  // A ref, not state: a latch change must never cause a render.
  const latchesRef = useRef(new Map<string, ScanLatch>());
  const latchFor = useCallback((id: string) => {
    let latch = latchesRef.current.get(id);
    if (!latch) {
      latch = createScanLatch();
      latchesRef.current.set(id, latch);
    }
    return latch;
  }, []);
  const sendingHere = sending.get(eventId) ?? null;

  /**
   * What the screen says belongs to one event: a new event handed over in
   * place resets the status and the typed code during the render that
   * changes it, before anything of the old one is drawn.
   */
  const [shownEventId, setShownEventId] = useState(eventId);
  if (shownEventId !== eventId) {
    setShownEventId(eventId);
    setStatus({ kind: "idle" });
    setManualCode("");
  }

  const sheetRef = useRef<BottomSheetModal>(null);
  const sheet = useSheetVisit(sheetRef);
  const [manualOpen, setManualOpen] = useState(false);
  const { dismiss: dismissSheet } = sheet;

  // Leaving the screen closes the manual sheet, which is portalled above the
  // navigator and would otherwise float over wherever the member went.
  useFocusEffect(
    useCallback(() => {
      return () => {
        dismissSheet();
      };
    }, [dismissSheet]),
  );

  const { mutateAsync: sendCheckIn } = useCheckIn();
  // Read only on a 409, to tell a check-in from an officer's mark.
  const { refetch: refetchOwnRow } = useMyAttendance(eventId, {
    enabled: false,
  });

  /**
   * The event this screen is showing now, for a check-in sent for another:
   * `submit` closes over the event it started with.
   */
  const eventIdRef = useRef(eventId);
  useLayoutEffect(() => {
    eventIdRef.current = eventId;
  }, [eventId]);

  /**
   * Check-in has no outbox: a check-in sent with no network is lost, and a
   * member at the door would believe they were in. So it waits for the
   * connection (`spec/ui/resilience/connection-state.md`, #501), and says so.
   */
  const { writeBlockedReason } = useConnection();

  /** The last check-in tried, so a trip to Settings can send it again. */
  const lastAttemptRef = useRef<{
    eventId: string;
    payload: { token?: string; manualCode?: string };
  } | null>(null);

  /**
   * The one path a check-in takes, from a link or a typed code. It claims the
   * event's latch first (synchronously, so a double tap or a link opened twice
   * sends once), finds the location, sends, and draws the answer if the screen
   * is still on that event.
   */
  const submit = useCallback(
    async (payload: { token?: string; manualCode?: string }, claim: string) => {
      const submittedFor = eventId;
      const latch = latchFor(submittedFor);
      if (!latch.accept(claim)) return;
      const request = ++lastRequestRef.current;
      const eventName = event?.name ?? null;
      const outcome = checkInSuccess(event?.point_value);
      lastAttemptRef.current = { eventId: submittedFor, payload };
      const mark = (phase: Phase) =>
        setSending((current) =>
          new Map(current).set(submittedFor, { request, phase }),
        );
      setStatus({ kind: "idle" });
      mark("locating");
      let blocker: LocationBlocker | null = null;
      try {
        const location = await getCheckInLocation(warmFix());
        if (location.kind === "none") {
          blocker = location.blocker;
          // A drawn zone refuses every check-in without a location, so there
          // is nothing to send yet.
          if (needsLocation) {
            if (eventIdRef.current === submittedFor) {
              setStatus({ kind: "location", blocker });
              // The fix is on the screen behind the typed code's sheet.
              setManualCode("");
              Keyboard.dismiss();
              dismissSheet();
            }
            return;
          }
        }
        mark("sending");
        await sendCheckIn({
          eventId: submittedFor,
          ...payload,
          ...(location.kind === "fix" ? location.fix : {}),
        });
        if (eventIdRef.current !== submittedFor) return;
        setStatus({ ...outcome, eventId: submittedFor, eventName });
        setManualCode("");
        Keyboard.dismiss();
        dismissSheet();
        successHaptic();
        // `accessibilityLiveRegion` is Android-only, and TalkBack reads the
        // panel out as it fills the region; VoiceOver has no live regions.
        if (Platform.OS === "ios") {
          AccessibilityInfo.announceForAccessibility(outcome.message);
        }
      } catch (error) {
        if (eventIdRef.current !== submittedFor) return;
        let ownRow: ReturnType<typeof selectMyAttendance> | undefined;
        if (checkInFailure(error).kind === "already") {
          const read = await refetchOwnRow();
          if (eventIdRef.current !== submittedFor) return;
          ownRow = read.isSuccess ? selectMyAttendance(read.data) : undefined;
        }
        const next = failureStatus(error, submittedFor, eventName, ownRow, {
          blocker,
          scanned: payload.token !== undefined,
        });
        setStatus(next);
        if (next.kind === "success" || next.kind === "location") {
          setManualCode("");
          Keyboard.dismiss();
          dismissSheet();
        }
        if (next.kind === "success" && Platform.OS === "ios") {
          AccessibilityInfo.announceForAccessibility(next.message);
        }
      } finally {
        setSending((current) => {
          if (current.get(submittedFor)?.request !== request) return current;
          const next = new Map(current);
          next.delete(submittedFor);
          return next;
        });
        // Released on every path, so a refused check-in can be tried again.
        latch.release();
      }
    },
    [
      dismissSheet,
      event,
      eventId,
      latchFor,
      needsLocation,
      refetchOwnRow,
      sendCheckIn,
      warmFix,
    ],
  );

  /**
   * A link's token is sent once, as soon as the event has loaded and the
   * phone is online. Remembered per token, so coming back to the screen, or
   * a re-render, never sends the same scan twice; a new scan is a new token.
   * A link that arrives while this event's check-in is still under way waits
   * for it, rather than being marked sent and dropped by the latch.
   */
  const sentTokensRef = useRef(new Set<string>());
  useEffect(() => {
    if (!linkToken || !eventLoaded || writeBlockedReason !== null) return;
    if (sendingHere) return;
    const key = `${eventId}:${linkToken}`;
    if (sentTokensRef.current.has(key)) return;
    sentTokensRef.current.add(key);
    void submit({ token: linkToken }, linkToken);
  }, [
    eventId,
    eventLoaded,
    linkToken,
    sendingHere,
    submit,
    writeBlockedReason,
  ]);

  /** Send the last check-in again (after Settings, or Try again). */
  const retry = useCallback(() => {
    const last = lastAttemptRef.current;
    if (!last || last.eventId !== eventIdRef.current) return;
    void submit(
      last.payload,
      last.payload.token ?? last.payload.manualCode ?? "",
    );
  }, [submit]);

  /**
   * A code Scan code read. One of ours becomes the link's own parameters, so
   * the effect above sends it exactly as if the phone's camera had opened it,
   * for whichever event it names; anything else (a poster, another app's
   * code, a build of the other environment) is said once and the viewport
   * keeps reading. The viewport reports a code in view on every frame, so
   * each text is acted on once.
   */
  const lastScanRef = useRef<string | null>(null);
  const handleScan = useCallback(
    (data: string) => {
      if (lastScanRef.current === data) return;
      lastScanRef.current = data;
      const target = parseCheckInLink(data, [webAppOrigin()]);
      if (!target) {
        setStatus({
          kind: "error",
          message: NOT_A_CHECK_IN_CODE,
          attemptOnly: true,
          retryable: false,
        });
        return;
      }
      setScannerOpen(false);
      // A valid read replaces whatever the last one said.
      setStatus({ kind: "idle" });
      if (target.eventId === eventId && target.token === linkToken) {
        // The same code the params already hold (read again after a refusal
        // the member can fix, such as standing too far away): the params
        // won't change, so the link effect won't send it again. Sent here.
        if (writeBlockedReason === null && sendingHere === null) {
          void submit({ token: target.token }, target.token);
        }
        return;
      }
      router.setParams({ event: target.eventId, t: target.token });
    },
    [eventId, linkToken, router, sendingHere, submit, writeBlockedReason],
  );

  const openScanner = () => {
    lastScanRef.current = null;
    // A line about the last attempt says nothing about the next code.
    setStatus((current) =>
      current.kind === "error" && current.attemptOnly
        ? { kind: "idle" }
        : current,
    );
    setScannerOpen(true);
  };

  /**
   * Back from Settings: try again on its own, so allowing location is the
   * member's last step rather than a tap on a button they have to find again.
   */
  const awaitingSettingsRef = useRef(false);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !awaitingSettingsRef.current) return;
      awaitingSettingsRef.current = false;
      retry();
    });
    return () => subscription.remove();
  }, [retry]);

  const runLocationAction = (blocker: LocationBlocker) => {
    const { action } = locationBlockerCopy(blocker);
    if (action === "settings") {
      awaitingSettingsRef.current = true;
      void Linking.openSettings();
      return;
    }
    if (action === "turn_on") {
      // Google's dialog again; accepted, the check-in goes.
      Location.enableNetworkProviderAsync().then(retry, () => undefined);
      return;
    }
    retry();
  };

  const manualSubmitDisabled =
    !eventLoaded ||
    !isPlausibleManualCode(manualCode) ||
    writeBlockedReason !== null ||
    sendingHere !== null ||
    status.kind === "blocked";

  const openManual = () => {
    // A line about the last attempt says nothing about a fresh code.
    setStatus((current) =>
      current.kind === "error" && current.attemptOnly
        ? { kind: "idle" }
        : current,
    );
    setManualOpen(true);
    sheetRef.current?.present();
  };

  const manualNotices = [
    ...(status.kind === "error" || status.kind === "blocked"
      ? [status.message]
      : []),
    ...(writeBlockedReason ? [writeBlockedReason] : []),
  ];

  /**
   * Where ✕ and "Back to event" go: the event's detail, popped to when it is
   * the screen underneath (`spec/ui/mobile/navigation.md` § Going back), else
   * put in this screen's place, so a link opened from the camera lands on the
   * event rather than back here.
   */
  const leaveTo = (toEventId: string) => {
    if (below?.name === "event-details") {
      below.goBack();
    } else if (toEventId) {
      router.dismissTo({
        pathname: "/event-details",
        params: { id: toEventId },
      });
    } else {
      router.dismissTo("/events");
    }
  };

  const zoneLine = needsLocation
    ? event?.check_in_zone_name
      ? `You must be inside the ${event.check_in_zone_name} zone.`
      : "You must be at the event location."
    : null;

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={["top", "left", "right", "bottom"]}
    >
      <View style={styles.header}>
        <GlassCloseButton
          accessibilityLabel="Close check-in"
          onPress={() => leaveTo(eventId)}
        />
        <Text accessibilityRole="header" style={styles.headerTitle}>
          Check in
        </Text>
        <GlassCloseSpacer />
      </View>

      {/*
        Mounted for the whole visit and filled when a check-in lands: TalkBack
        announces a change inside a live region it already knows, and a
        region that mounts with its content in it isn't reliably read out.
        `collapsable={false}` keeps it a real Android view. Empty, it draws
        nothing.
      */}
      <View
        accessibilityLiveRegion="polite"
        collapsable={false}
        style={status.kind === "success" ? styles.successBody : null}
      >
        {status.kind === "success" ? (
          <View
            accessible
            accessibilityLabel={
              status.eventName
                ? `${status.message} ${status.eventName}`
                : status.message
            }
            style={styles.successContent}
          >
            <View style={styles.successMark}>
              <Text style={styles.successGlyph}>✓</Text>
            </View>
            <Text style={styles.successTitle}>{status.title}</Text>
            {status.pointsLabel ? (
              <Text style={styles.successPoints}>{status.pointsLabel}</Text>
            ) : null}
            {status.eventName ? (
              <Text numberOfLines={2} style={styles.successEvent}>
                {status.eventName}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      {status.kind === "success" ? (
        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            onPress={() => leaveTo(status.eventId)}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: accentPrimary },
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={[styles.primaryText, { color: accentOnPrimary }]}>
              Back to event
            </Text>
          </Pressable>
        </View>
      ) : eventId && !eventLoaded && eventQuery.isError ? (
        <View style={styles.stateWrap}>
          <ErrorState
            title="Event didn't load"
            body="Check-in needs the event's details first."
            onRetry={() => void eventQuery.refetch()}
            isRetrying={eventQuery.isFetching}
          />
        </View>
      ) : status.kind === "location" ? (
        <LocationState
          blocker={status.blocker}
          zoneLine={zoneLine}
          busy={sendingHere !== null}
          onAction={() => runLocationAction(status.blocker)}
          onManual={openManual}
          styles={styles}
          glyphColor={tokens.color.text.mutedForeground}
          accentPrimary={accentPrimary}
          accentOnPrimary={accentOnPrimary}
        />
      ) : (
        <>
          <View style={styles.body}>
            {scannerOpen ? (
              <CheckInScanner
                active={focused && !manualOpen}
                onScan={handleScan}
              />
            ) : linkToken ? null : (
              <CameraGlyph color={tokens.color.text.mutedForeground} />
            )}
            <Text style={styles.title}>
              {scannerOpen
                ? "Point at the code on the officer's screen"
                : linkToken
                  ? (event?.name ?? "Check in")
                  : "Scan the check-in code"}
            </Text>
            {scannerOpen || linkToken ? null : (
              <Text style={styles.bodyText}>
                Tap Scan code, or point your phone&apos;s Camera at the code on
                the officer&apos;s screen and tap the Frapp link that appears.
              </Text>
            )}
            {zoneLine ? <Text style={styles.hint}>{zoneLine}</Text> : null}

            {/* One muted line, no spinner, nothing that moves the layout. */}
            {sendingHere ? (
              <Text style={styles.statusText}>
                {sendingHere.phase === "locating"
                  ? "Finding your location…"
                  : "Checking you in…"}
              </Text>
            ) : linkToken && !eventLoaded ? (
              <Text style={styles.statusText}>Checking you in…</Text>
            ) : status.kind === "error" || status.kind === "blocked" ? (
              <Text style={styles.error}>{status.message}</Text>
            ) : null}

            {/* A check-in that failed on the way (offline, a timeout, a 5xx)
                can be sent again while its code is still good; a code the
                server called stale can't, so it says to scan again. */}
            {status.kind === "error" && status.retryable && !sendingHere ? (
              <Pressable
                accessibilityRole="button"
                onPress={retry}
                hitSlop={tokens.spacing.sm}
                style={({ pressed }) => [
                  styles.manualLink,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Text style={styles.manualLinkText}>Try again</Text>
              </Pressable>
            ) : null}

            {/* Stated, not just implied by a greyed button
                (spec/ui/design-system/README.md §5, rule 2). */}
            {writeBlockedReason ? (
              <Text style={styles.error}>{writeBlockedReason}</Text>
            ) : null}
          </View>

          <View style={styles.footer}>
            {/* Gone while a check-in is on its way, and for a refusal only an
                officer can lift; back after any other answer, so a code that
                changed can be scanned again. */}
            {scannerOpen ||
            sendingHere ||
            (linkToken && !eventLoaded) ||
            status.kind === "blocked" ? null : (
              <Pressable
                accessibilityRole="button"
                onPress={openScanner}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: accentPrimary },
                  pressed ? styles.pressed : null,
                ]}
              >
                <Text style={[styles.primaryText, { color: accentOnPrimary }]}>
                  Scan code
                </Text>
              </Pressable>
            )}
            {/* A typed code is checked against an event, so it needs one. */}
            {eventId ? (
              <Pressable
                accessibilityRole="button"
                onPress={openManual}
                hitSlop={tokens.spacing.sm}
                style={({ pressed }) => [
                  styles.manualLink,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Text style={styles.manualLinkText}>Enter code instead</Text>
              </Pressable>
            ) : null}
          </View>
        </>
      )}

      {/* Mounted for the whole visit: a typed code's success swaps the body
          while the sheet is still closing, and a modal unmounted mid-dismiss
          leaves `useSheetVisit` believing it is still up. */}
      {eventId ? (
        <ManualCodeSheet
          ref={sheetRef}
          code={manualCode}
          onChangeCode={setManualCode}
          // A fast double tap can land a second press before the re-render
          // disables the control; `submit`'s latch claim drops it.
          onSubmit={() => void submit({ manualCode }, manualCode)}
          submitDisabled={manualSubmitDisabled}
          submitting={sendingHere !== null}
          notices={manualOpen ? manualNotices : []}
          accessibilityHint={writeBlockedReason ?? undefined}
          onAnimate={sheet.onAnimate}
          onDismiss={() => {
            sheet.markClosed();
            setManualOpen(false);
          }}
          onCancel={dismissSheet}
        />
      ) : null}
    </SafeAreaView>
  );
}

/**
 * What stands between the member and a located check-in, and the one thing
 * that fixes it: Android's turn-on dialog, Settings, or asking again.
 */
function LocationState({
  blocker,
  zoneLine,
  busy,
  onAction,
  onManual,
  styles,
  glyphColor,
  accentPrimary,
  accentOnPrimary,
}: {
  blocker: LocationBlocker;
  zoneLine: string | null;
  busy: boolean;
  onAction: () => void;
  onManual: () => void;
  styles: ReturnType<typeof createStyles>;
  glyphColor: string;
  accentPrimary: string;
  accentOnPrimary: string;
}) {
  const copy = locationBlockerCopy(blocker);
  return (
    <>
      <View style={styles.body}>
        <LocationGlyph color={glyphColor} />
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.bodyText}>{copy.body}</Text>
        {zoneLine ? <Text style={styles.hint}>{zoneLine}</Text> : null}
      </View>
      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          disabled={busy}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: accentPrimary },
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={[styles.primaryText, { color: accentOnPrimary }]}>
            {busy ? "Checking you in…" : copy.actionLabel}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onManual}
          style={({ pressed }) => [
            styles.manualLink,
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={styles.manualLinkText}>Enter code instead</Text>
        </Pressable>
      </View>
    </>
  );
}

/** A phone camera, in the app's line-glyph style (iconography.md §1). */
function CameraGlyph({ color }: { color: string }) {
  return (
    <Svg
      width={STATE_GLYPH_SIZE}
      height={STATE_GLYPH_SIZE}
      viewBox="0 0 24 24"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path
        d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.3-2h6l1.3 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
      <Circle
        cx={12}
        cy={13}
        r={3.2}
        fill="none"
        stroke={color}
        strokeWidth={1.4}
      />
    </Svg>
  );
}

/** A location pin, for the state that asks for location. */
function LocationGlyph({ color }: { color: string }) {
  return (
    <Svg
      width={STATE_GLYPH_SIZE}
      height={STATE_GLYPH_SIZE}
      viewBox="0 0 24 24"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path
        d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
      <Circle
        cx={12}
        cy={10}
        r={2.2}
        fill="none"
        stroke={color}
        strokeWidth={1.4}
      />
    </Svg>
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
      paddingHorizontal: tokens.spacing.sm,
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
    title: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.headline),
      textAlign: "center",
    },
    bodyText: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.body),
      textAlign: "center",
    },
    hint: {
      color: tokens.color.text.muted,
      ...typeRole(tokens.typography.role.caption),
      textAlign: "center",
    },
    statusText: {
      color: tokens.color.text.muted,
      ...typeRole(tokens.typography.role.body),
      textAlign: "center",
    },
    error: {
      color: tokens.color.semantic.destructive,
      ...typeRole(tokens.typography.role.body),
      textAlign: "center",
    },
    footer: {
      paddingHorizontal: tokens.spacing.xl,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.sm,
    },
    manualLink: {
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
      alignItems: "center",
    },
    manualLinkText: {
      color: accent,
      ...typeRole(tokens.typography.role.label),
    },
    successBody: {
      flex: 1,
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.xl,
    },
    successContent: {
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    successMark: {
      width: SUCCESS_MARK_SIZE,
      height: SUCCESS_MARK_SIZE,
      borderRadius: SUCCESS_MARK_SIZE / 2,
      backgroundColor: tint(tokens.color.semantic.success),
      alignItems: "center",
      justifyContent: "center",
      marginBottom: tokens.spacing.sm,
    },
    successGlyph: {
      color: tokens.color.semantic.success,
      ...typeRole(tokens.typography.role.display),
    },
    successTitle: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.headline),
      textAlign: "center",
    },
    // Points earned are a number: the foreground text, never the accent.
    successPoints: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.title),
    },
    successEvent: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.body),
      textAlign: "center",
    },
    primaryButton: {
      minHeight: tokens.touch.buttonLarge,
      borderRadius: tokens.radius.control,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryText: {
      ...typeRole(tokens.typography.role.label),
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
