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
  ActivityIndicator,
  Keyboard,
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
import { CameraView, useCameraPermissions } from "expo-camera";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import Svg, { Path } from "react-native-svg";
import { useCheckIn, useEvent } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { ManualCodeSheet } from "@/components/check-in/manual-code-sheet";
import { useSheetVisit } from "@/components/sheet-scaffold";
import { EmptyState, ErrorState } from "@/components/state-block";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  isPlausibleManualCode,
  parseCheckInCode,
} from "@/lib/events/check-in-code";
import { createScanLatch } from "@/lib/events/scan-latch";
import {
  CHECK_IN_LOCATION_DENIED_COPY,
  checkInFailure,
  checkInSuccess,
} from "@/lib/events/check-in-outcome";
import { latLngOf, requireForegroundFix } from "@/lib/location";
import { selectEventDetail } from "@/lib/events/select";
import { useConnection } from "@/lib/connection/use-connection";
import { successHaptic } from "@/lib/haptics";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s18 — QR check-in scanner (`canvas-screens.dc.html:600`).
 *
 * Deliberately not on `ScreenShell`: the shell wraps children in a `ScrollView`,
 * and a full-bleed camera viewport inside a scroll container fights the scroll
 * gesture and cannot fill the screen. s05 opts out for the same class of reason
 * (`spec/ui/mobile/patterns.md`).
 *
 * The layout is the board's: a square viewport with accent corner brackets,
 * centred, with "Enter code manually" and the torch along the bottom. The
 * typed code goes in a sheet (`components/check-in/manual-code-sheet.tsx`),
 * which rises with the keyboard; it used to be a card at the foot of this
 * screen that the keyboard covered.
 *
 * ## What this screen claims, and what is actually enforced
 *
 * The reference draws "Geofence is the real check — screenshots don't work."
 * That sentence is only true for an event that *has* a zone, and zones are
 * opt-in per event. Rendering it unconditionally would be a security claim
 * about a check that is not running, so the line is bound to
 * `event.hasCheckInZone`. The server is the authority either way — it rejects
 * an out-of-zone or unlocated check-in regardless of what this screen says.
 *
 * The board's zone pill carries a green dot and reads "Inside the Great Hall
 * zone", which is a live claim that the member is inside it. Nothing here
 * knows that before the server answers, so the pill states the requirement
 * and draws no dot.
 *
 * ## The camera runs only while the screen is focused
 *
 * `check-in` is a `Tabs.Screen`, which stays mounted after the member leaves.
 * A `CameraView` left mounted keeps the camera session (and the torch) on
 * behind whatever screen the member went to, so it is drawn only while this
 * screen has focus.
 */

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  /**
   * `checkInSuccess`'s words, and the event they are about, both fixed when
   * the check-in was sent. The panel draws these rather than whatever event
   * the screen holds when it renders: the tab instance is reused, so the
   * screen's event can change while a check-in is in flight.
   */
  | (ReturnType<typeof checkInSuccess> & {
      eventId: string;
      eventName: string | null;
    })
  /**
   * `attemptOnly` is `checkInFailure`'s: the line is about this one attempt
   * (the code it sent, or a request that got no real answer), not about the
   * member, so it clears when they turn to typing a code (see `openManual`).
   * `foreign` marks the scanner's "different event" line, which is
   * attempt-only too, and which `handleBarcode` reports once per code.
   */
  | { kind: "error"; message: string; attemptOnly: boolean; foreign?: true }
  /**
   * The subscription gate (#2297) or the module gate (#2393) refused the
   * write. Terminal until an officer acts, so — unlike `error` — it re-arms neither the
   * scanner nor the manual field. A separate variant rather than a flag on
   * `error`, so "no retry" is structural and a future branch cannot forget it.
   */
  | { kind: "blocked"; message: string };

/**
 * Which terminal state a failed check-in lands in. The copy, gate refusals
 * included, is `checkInFailure`'s, shared with the chat event card. "Already
 * checked in" stays an `error` here, as it always was: it leaves the scanner
 * armed for the member's next event, where `blocked` would disarm it. It is
 * about the member, not the code, so a typed code would meet it too.
 */
function failureStatus(error: unknown): Status {
  const failure = checkInFailure(error);
  return failure.kind === "already"
    ? { kind: "error", message: failure.message, attemptOnly: false }
    : failure;
}

/** The drawn corner bracket: 36pt arms, a 3pt accent stroke. */
const BRACKET_SIZE = 36;
const BRACKET_STROKE = 3;
/** Where the viewport sits inside the brackets, as drawn (`inset: 22px`). */
const VIEWPORT_INSET = 22;
/** The board's torch glyph, at its drawn 19pt. */
const TORCH_GLYPH_SIZE = 19;
/**
 * iconography.md §1's neutral fill, "white at 6%", for the torch while it is
 * off. A literal, as `components/tab-glyphs.tsx` and
 * `components/more/more-glyphs.tsx` keep it: no token carries it.
 */
const TORCH_OFF_FILL = "rgba(255,255,255,0.06)";
/** The success mark: a circle big enough to read from arm's length. */
const SUCCESS_MARK_SIZE = 72;

export default function CheckInScreen() {
  const { tokens } = useFrappTheme();
  const { accent, accentPrimary, accentOnPrimary } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const router = useRouter();

  const params = useLocalSearchParams<{ eventId?: string | string[] }>();
  const eventId = Array.isArray(params.eventId)
    ? params.eventId[0]
    : (params.eventId ?? "");

  const eventQuery = useEvent(eventId);
  const event = useMemo(
    () => selectEventDetail(eventQuery.data),
    [eventQuery.data],
  );
  /**
   * Nothing is sent until the event has loaded. A check-in reads it twice:
   * whether the event has a zone decides whether a location goes with it (a
   * zoned event refuses a check-in without one, even from a member standing
   * in the zone), and the success panel names the event and its points as
   * they were when the check-in was sent. The camera still shows while it
   * loads; it just doesn't decode, and the manual Check in stays off.
   */
  const eventLoaded = event !== null;
  const needsLocation = event?.hasCheckInZone ?? false;

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // True on a focused screen's first render, so the camera mounts without
  // waiting a commit for an effect to say so.
  const focused = useIsFocused();
  const [torchOn, setTorchOn] = useState(false);
  const [manualCode, setManualCode] = useState("");
  // The event a check-in is on its way for, if any; see the reset below.
  const [inFlightFor, setInFlightFor] = useState<string | null>(null);

  /**
   * What the screen holds belongs to one event.
   *
   * The tab instance is reused, so `eventId` can change under it: a member
   * leaves one event's scanner and opens the next (where the focus reset
   * below also runs), or a `frapp://` link moves the focused screen to
   * another event (where it doesn't). Either way, the last event's refusal,
   * its confirmation, and a code typed for it are not about this one: a
   * "You're already checked in" or a zone refusal from the last event would
   * otherwise greet the member here, in the scanner and in the manual sheet,
   * and the last event's code would sit in the field ready to send. So they
   * are reset during the render that changes the event, before anything of
   * the old one is drawn. The one thing kept is a check-in still on its way
   * for the event the screen is now on (it left this event and came back
   * before it answered): that one shows as sending, and its answer lands.
   */
  const [shownEventId, setShownEventId] = useState(eventId);
  if (shownEventId !== eventId) {
    setShownEventId(eventId);
    setStatus(
      inFlightFor === eventId ? { kind: "submitting" } : { kind: "idle" },
    );
    setManualCode("");
  }

  const sheetRef = useRef<BottomSheetModal>(null);
  const sheet = useSheetVisit(sheetRef);
  // State, not the visit hook's ref, because the decoder reads it: while the
  // sheet is up the member is typing a code, and a scan landing behind the
  // scrim would submit a second check-in under them.
  const [manualOpen, setManualOpen] = useState(false);
  const { dismiss: dismissSheet } = sheet;

  /**
   * A refusal must not outlive the visit that produced it.
   *
   * `check-in` is a `Tabs.Screen` with `href: null`, pushed with an `eventId`
   * param — so it stays mounted after the member leaves and the same instance is
   * reused for the next event. Unlike `error`, `blocked` disarms both the
   * camera decoder and the manual field, so without this reset a member
   * refused at one event would find the scanner silently dead at the next one,
   * weeks later, under copy naming a chapter state that has since been fixed.
   * Only killing the app would clear it.
   *
   * `success` is reset for the same reason: the success panel replaces the
   * camera, so a member who checked in at one event would otherwise re-enter
   * at the next one to "You're checked in" for the *previous* event, with no
   * scanner at all. Ordinary failures and the 409 "already checked in" keep
   * behaving exactly as they did, because those leave the scanner armed.
   *
   * Leaving the screen also turns the torch off and closes the manual sheet,
   * which is portalled above the navigator and would otherwise float over
   * the event the member went back to.
   */
  useFocusEffect(
    useCallback(() => {
      setStatus((current) =>
        current.kind === "blocked" || current.kind === "success"
          ? { kind: "idle" }
          : current,
      );
      return () => {
        setTorchOn(false);
        dismissSheet();
      };
    }, [dismissSheet]),
  );

  const checkIn = useCheckIn();

  // One latch for the life of the screen. `useRef` rather than state: a latch
  // change must never trigger a render, or the camera remounts mid-scan.
  const latchRef = useRef(createScanLatch());
  // Last foreign-event code already reported — see `handleBarcode`.
  const reportedForeignRef = useRef<string | null>(null);
  // Forgotten as soon as its line leaves the screen, by whatever path (the
  // sheet opening, a check-in starting, the screen moving to another event),
  // so the same wrong code held up again is reported again rather than
  // dropped in silence.
  useEffect(() => {
    if (status.kind !== "error" || !status.foreign) {
      reportedForeignRef.current = null;
    }
  }, [status]);

  /**
   * The event this screen is showing now, for a check-in that was sent for
   * another one. `submit` closes over the event it started with; reading this
   * after the request lands tells it whether the screen has moved on.
   */
  const eventIdRef = useRef(eventId);
  useLayoutEffect(() => {
    eventIdRef.current = eventId;
  }, [eventId]);

  /**
   * Check-in has **no outbox** — a submit with no network is lost, and a member
   * standing at the door would believe they had checked in. That is why
   * `spec/ui/resilience/connection-state.md`'s "Disabled with tooltip: 'Reconnect to make
   * changes'" applies here (#501) while the chat composer does the opposite:
   * chat has a queue, this does not.
   *
   * Read through a ref as well, because `handleBarcode` is a `useCallback` the
   * camera holds for the life of the screen — reading the value directly there
   * would close over whatever it was when the callback was built.
   */
  const { writeBlockedReason } = useConnection();
  const writeBlockedReasonRef = useRef(writeBlockedReason);
  useLayoutEffect(() => {
    writeBlockedReasonRef.current = writeBlockedReason;
  }, [writeBlockedReason]);

  /**
   * Read the member's position, but only when the event actually has a zone.
   * Asking for location on an unzoned event would be a permission prompt with
   * no purpose.
   *
   * The permission-and-accuracy rules moved to `lib/location.ts` when s10 grew
   * a second caller for them — the "no background location" ban binds every
   * surface, and one module asking is easier to keep honest than two.
   */
  const resolveLocation = useCallback(async () => {
    if (!needsLocation) return {};

    const fix = await requireForegroundFix(CHECK_IN_LOCATION_DENIED_COPY);
    // Check-in DTO is lat/lng only — spreading accuracy_meters 400s.
    return latLngOf(fix);
  }, [needsLocation]);

  /**
   * The one path a check-in takes, scanned or typed, so its confirmation is
   * made in one place: the success branch below is where the screen marks the
   * moment, for the member who sees it, feels it, and hears it.
   *
   * A result that lands after the screen has moved to another event is
   * dropped, success or failure: it is about an event the member is no longer
   * looking at, and drawing it would confirm (or refuse) the wrong one. A
   * dropped result touches nothing: the move already reset the screen to the
   * event it is on now (see `shownEventId`), and a status, or a code typed
   * since, belongs to that event.
   */
  const submit = useCallback(
    async (payload: { token?: string; manualCode?: string }) => {
      const submittedFor = eventId;
      const eventName = event?.name ?? null;
      const outcome = checkInSuccess(event?.point_value);
      setStatus({ kind: "submitting" });
      setInFlightFor(submittedFor);
      try {
        const fix = await resolveLocation();
        await checkIn.mutateAsync({ eventId: submittedFor, ...payload, ...fix });
        if (eventIdRef.current !== submittedFor) return;
        setStatus({ ...outcome, eventId: submittedFor, eventName });
        setManualCode("");
        // A typed code succeeds with the sheet up; the panel replaces the
        // scanner underneath it, so the sheet goes too, and the keyboard with
        // it (Android can leave it up when its focused field unmounts).
        Keyboard.dismiss();
        dismissSheet();
        // Once per check-in, here rather than on the panel's render
        // (spec/ui/mobile/README.md, Native-feel rules).
        successHaptic();
        // `accessibilityLiveRegion` is Android-only, and TalkBack reads the
        // panel out as it fills the region (see the render); announcing there
        // as well would say it twice. VoiceOver has no live regions.
        if (Platform.OS === "ios") {
          AccessibilityInfo.announceForAccessibility(outcome.message);
        }
      } catch (error) {
        if (eventIdRef.current !== submittedFor) return;
        setStatus(failureStatus(error));
      } finally {
        setInFlightFor(null);
        // Released on both paths so a failed scan can be retried. A latch that
        // stayed closed after an error would strand the member on a dead screen.
        latchRef.current.release();
      }
    },
    [checkIn, dismissSheet, event, eventId, resolveLocation],
  );

  const handleBarcode = useCallback(
    (result: { data?: string }) => {
      const raw = result?.data ?? "";
      const parsed = parseCheckInCode(raw);
      // Not one of our codes: drop it without latching, so the camera stays
      // live for the real one. A poster in frame must not block the scan.
      if (!parsed) return;

      if (parsed.eventId !== eventId) {
        // Report a foreign code once, not once per frame. `onBarcodeScanned`
        // fires continuously while a code is held in view, so an unconditional
        // `setStatus` here re-renders at camera frame rate for as long as the
        // wrong code is on screen. Remembering the last one reported collapses
        // that to a single message while still reacting to a *different* wrong
        // code. Deliberately not the scan latch: that one gates in-flight
        // submissions, and borrowing it here would block the real code.
        if (reportedForeignRef.current !== raw) {
          reportedForeignRef.current = raw;
          setStatus({
            kind: "error",
            message: "That code is for a different event.",
            attemptOnly: true,
            foreign: true,
          });
        }
        return;
      }

      if (!latchRef.current.accept(raw)) return;
      // The manual field is gated a few lines below; the scan has to be too.
      // A scan submits immediately rather than latching, so without this a
      // member at the door with no signal gets a spinner that never resolves
      // and a decoder that has already been switched off.
      if (writeBlockedReasonRef.current !== null) return;
      void submit({ token: parsed.token });
    },
    [eventId, submit],
  );

  useEffect(() => {
    if (!cameraPermission || cameraPermission.granted) return;
    if (!cameraPermission.canAskAgain) return;
    void requestCameraPermission();
  }, [cameraPermission, requestCameraPermission]);

  const scanning =
    eventLoaded &&
    !manualOpen &&
    status.kind !== "submitting" &&
    status.kind !== "success" &&
    status.kind !== "blocked";

  const manualSubmitDisabled =
    !eventLoaded ||
    !isPlausibleManualCode(manualCode) ||
    writeBlockedReason !== null ||
    status.kind === "submitting" ||
    status.kind === "blocked" ||
    checkIn.isPending;

  const openManual = () => {
    // The sheet shows only lines that stay true of the code the member is
    // about to type. A line about the last attempt (`attemptOnly`: the
    // scanned code was refused as stale or another event's, or the request
    // got no real answer) says nothing about a fresh code, so it clears. A
    // line about the member stays: where they are (the zone, their
    // location), that they're already checked in here, or a refusal that is
    // why the sheet's button is off. The screen already dropped whatever
    // belonged to an earlier event (`shownEventId`).
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

  const cameraGranted = cameraPermission?.granted ?? false;

  /**
   * Where ✕ and "Back to event" go: the event's detail, whose Scan QR button
   * is the one way into this screen in the app, or Events when there is no
   * event. A fixed destination rather than `router.back()`, by the rule
   * `components/back-row.tsx` states: this is a hidden tab, so `back()` follows
   * the tab navigator's default `backBehavior` ("firstRoute") to Chat home,
   * and a `frapp://` link can open it with nothing behind it. Android's back
   * button keeps the history behaviour.
   */
  const leaveTo = (toEventId: string) => {
    if (toEventId) {
      router.navigate({
        pathname: "/event-details",
        params: { id: toEventId },
      });
    } else {
      router.navigate("/events");
    }
  };

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={["top", "left", "right", "bottom"]}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close check-in"
          onPress={() => leaveTo(eventId)}
          style={({ pressed }) => [
            styles.close,
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
        <Text accessibilityRole="header" style={styles.headerTitle}>
          Check in
        </Text>
        <View style={styles.close} />
      </View>

      {/*
        The success panel's live region is mounted for the whole visit, empty
        until a check-in lands, and the panel fills it. TalkBack announces a
        change inside a live region it already knows; a region that mounts
        with its content already in it isn't reliably read out, and Android
        hears the success only through this.
      */}
      <View
        accessibilityLiveRegion="polite"
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
        <View style={styles.successFooter}>
          <Pressable
            accessibilityRole="button"
            onPress={() => leaveTo(status.eventId)}
            style={({ pressed }) => [
              styles.doneButton,
              { backgroundColor: accentPrimary },
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={[styles.doneText, { color: accentOnPrimary }]}>
              Back to event
            </Text>
          </Pressable>
        </View>
      ) : !eventId ? (
        <View style={styles.stateWrap}>
          <EmptyState
            glyph="◎"
            title="No event selected"
            body="Open an event, then tap Scan QR to check in."
          />
        </View>
      ) : !eventLoaded && eventQuery.isError ? (
        // Nothing can be sent without the event (see `eventLoaded`), so a
        // scanner here would be dead with nothing saying why.
        <View style={styles.stateWrap}>
          <ErrorState
            title="Event didn't load"
            body="Check-in needs the event's details first."
            onRetry={() => void eventQuery.refetch()}
            isRetrying={eventQuery.isFetching}
          />
        </View>
      ) : (
        <>
          <View style={styles.body}>
            <Text style={styles.prompt}>Point at the code up front</Text>

            <View style={styles.frame}>
              <View style={styles.viewport}>
                {!cameraGranted ? (
                  <View style={styles.cameraFallback}>
                    <Text style={styles.fallbackTitle}>Camera unavailable</Text>
                    <Text style={styles.fallbackBody}>
                      {cameraPermission && !cameraPermission.canAskAgain
                        ? "Allow camera access in Settings, or enter the code manually."
                        : "Allow camera access, or enter the code manually."}
                    </Text>
                  </View>
                ) : focused ? (
                  <CameraView
                    style={styles.camera}
                    facing="back"
                    enableTorch={torchOn}
                    // Only QR: narrowing the symbologies keeps the decoder off
                    // every barcode in the room.
                    barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                    onBarcodeScanned={scanning ? handleBarcode : undefined}
                  />
                ) : null}
              </View>
              <View style={[styles.bracket, styles.bracketTopLeft]} />
              <View style={[styles.bracket, styles.bracketTopRight]} />
              <View style={[styles.bracket, styles.bracketBottomLeft]} />
              <View style={[styles.bracket, styles.bracketBottomRight]} />
            </View>

            {/*
              The zone, and only when there is one. `check_in_zone_name` is what
              makes the drawn "Great Hall" possible.
            */}
            {needsLocation ? (
              <View style={styles.zonePill}>
                <Text style={styles.zoneText}>
                  {event?.check_in_zone_name
                    ? `You must be inside the ${event.check_in_zone_name} zone.`
                    : "You must be at the event location."}
                </Text>
              </View>
            ) : null}

            <Text style={styles.hint}>
              {needsLocation
                ? "Code rotates every 30s. Your location is the real check — screenshots don't work."
                : "Code rotates every 30s, so a screenshot goes stale quickly."}
            </Text>

            {status.kind === "submitting" ? (
              <View style={styles.statusRow}>
                <ActivityIndicator color={tokens.color.text.muted} />
                <Text style={styles.statusText}>Checking you in…</Text>
              </View>
            ) : status.kind === "error" || status.kind === "blocked" ? (
              <Text style={styles.error}>{status.message}</Text>
            ) : null}

            {/* Stated, not just implied by a greyed button
                (spec/ui/design-system/README.md §5, rule 2). */}
            {writeBlockedReason ? (
              <Text style={styles.error}>{writeBlockedReason}</Text>
            ) : null}
          </View>

          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              onPress={openManual}
              hitSlop={tokens.spacing.sm}
              style={({ pressed }) => [
                styles.manualLink,
                pressed ? styles.pressed : null,
              ]}
            >
              <Text style={styles.manualLinkText}>Enter code manually</Text>
            </Pressable>
            {cameraGranted ? (
              <Pressable
                accessibilityRole="switch"
                accessibilityLabel="Flashlight"
                accessibilityState={{ checked: torchOn }}
                onPress={() => setTorchOn((on) => !on)}
                style={({ pressed }) => [
                  styles.torch,
                  torchOn ? styles.torchOn : null,
                  pressed ? styles.pressed : null,
                ]}
              >
                {/* One shape in both states: the state recolours it
                    (iconography.md §1), it never swaps to a filled variant.
                    Off is the neutral row (white at 6% under the muted
                    stroke), on is the accent at 16%. */}
                <Svg
                  width={TORCH_GLYPH_SIZE}
                  height={TORCH_GLYPH_SIZE}
                  viewBox="0 0 24 24"
                >
                  <Path
                    d="M13 3L5 13h5l-1 8 8-10h-5z"
                    fill={torchOn ? tint(accent, 0.16) : TORCH_OFF_FILL}
                    stroke={torchOn ? accent : tokens.color.text.mutedForeground}
                    strokeWidth={1.6}
                    strokeLinejoin="round"
                  />
                </Svg>
              </Pressable>
            ) : null}
          </View>
        </>
      )}

      {/* Mounted for the whole visit, not inside the scanner branch: a typed
          code's success swaps the scanner for the panel while the sheet is
          still closing, and a modal unmounted mid-dismiss leaves
          `useSheetVisit` believing it is still up. */}
      {eventId ? (
        <ManualCodeSheet
          ref={sheetRef}
          code={manualCode}
          onChangeCode={setManualCode}
          onSubmit={() => void submit({ manualCode })}
          // `checkIn.isPending` as well as the local status: `setStatus` is
          // asynchronous, so a fast double-tap can land a second press before
          // the re-render disables the control. The mutation's own pending
          // flag closes that window.
          submitDisabled={manualSubmitDisabled}
          submitting={status.kind === "submitting"}
          notices={manualNotices}
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

function createStyles(tokens: SignetTokens, accent: string) {
  const bracketEdge = { borderColor: accent, width: BRACKET_SIZE } as const;
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
    close: {
      minWidth: tokens.touch.minimum,
      minHeight: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    closeText: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.title),
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
    prompt: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.body),
      textAlign: "center",
    },
    // A square as wide as the screen allows, up to a size that still leaves
    // the hint and the footer on a short phone. The board's 240 sits inside
    // this range on its 402pt frame.
    frame: {
      width: "100%",
      maxWidth: 280,
      aspectRatio: 1,
      marginTop: tokens.spacing.sm,
    },
    viewport: {
      position: "absolute",
      top: VIEWPORT_INSET,
      right: VIEWPORT_INSET,
      bottom: VIEWPORT_INSET,
      left: VIEWPORT_INSET,
      borderRadius: tokens.radius.control,
      backgroundColor: tokens.color.surface.surface1,
      overflow: "hidden",
    },
    camera: {
      flex: 1,
    },
    cameraFallback: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: tokens.spacing.md,
      gap: tokens.spacing.xs,
    },
    fallbackTitle: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.label),
      textAlign: "center",
    },
    fallbackBody: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.caption),
      textAlign: "center",
    },
    bracket: {
      position: "absolute",
      height: BRACKET_SIZE,
    },
    bracketTopLeft: {
      ...bracketEdge,
      top: 0,
      left: 0,
      borderTopWidth: BRACKET_STROKE,
      borderLeftWidth: BRACKET_STROKE,
      borderTopLeftRadius: tokens.radius.chipLarge,
    },
    bracketTopRight: {
      ...bracketEdge,
      top: 0,
      right: 0,
      borderTopWidth: BRACKET_STROKE,
      borderRightWidth: BRACKET_STROKE,
      borderTopRightRadius: tokens.radius.chipLarge,
    },
    bracketBottomLeft: {
      ...bracketEdge,
      bottom: 0,
      left: 0,
      borderBottomWidth: BRACKET_STROKE,
      borderLeftWidth: BRACKET_STROKE,
      borderBottomLeftRadius: tokens.radius.chipLarge,
    },
    bracketBottomRight: {
      ...bracketEdge,
      bottom: 0,
      right: 0,
      borderBottomWidth: BRACKET_STROKE,
      borderRightWidth: BRACKET_STROKE,
      borderBottomRightRadius: tokens.radius.chipLarge,
    },
    zonePill: {
      marginTop: tokens.spacing.sm,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
    },
    zoneText: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.label),
      textAlign: "center",
    },
    hint: {
      color: tokens.color.text.muted,
      ...typeRole(tokens.typography.role.caption),
      textAlign: "center",
    },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: tokens.spacing.sm,
    },
    statusText: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.body),
    },
    error: {
      color: tokens.color.semantic.destructive,
      ...typeRole(tokens.typography.role.body),
      textAlign: "center",
    },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: tokens.spacing["2xl"],
      paddingBottom: tokens.spacing.xl,
      minHeight: tokens.touch.minimum,
    },
    manualLink: {
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
    },
    manualLinkText: {
      color: accent,
      ...typeRole(tokens.typography.role.label),
    },
    torch: {
      width: tokens.touch.minimum,
      height: tokens.touch.minimum,
      borderRadius: tokens.touch.minimum / 2,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.card,
      alignItems: "center",
      justifyContent: "center",
    },
    torchOn: {
      borderColor: tint(accent, 0.3),
      backgroundColor: tint(accent),
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
    successFooter: {
      paddingHorizontal: tokens.spacing.xl,
      paddingBottom: tokens.spacing.xl,
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
    successPoints: {
      color: accent,
      ...typeRole(tokens.typography.role.title),
    },
    successEvent: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.body),
      textAlign: "center",
    },
    doneButton: {
      minHeight: tokens.touch.buttonLarge,
      borderRadius: tokens.radius.control,
      alignItems: "center",
      justifyContent: "center",
    },
    doneText: {
      ...typeRole(tokens.typography.role.label),
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
