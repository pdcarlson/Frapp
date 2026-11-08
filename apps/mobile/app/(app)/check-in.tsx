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
import { useScreenBelow } from "@/lib/back-target";
import { CameraView, useCameraPermissions } from "expo-camera";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import Svg, { Path } from "react-native-svg";
import { useCheckIn, useEvent } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { ManualCodeSheet } from "@/components/check-in/manual-code-sheet";
import { useSheetVisit } from "@/components/sheet-scaffold";
import { ErrorState } from "@/components/state-block";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  isPlausibleManualCode,
  parseCheckInCode,
} from "@/lib/events/check-in-code";
import { createScanLatch, type ScanLatch } from "@/lib/events/scan-latch";
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
import { InlineNote } from "@/components/inline-note";

/**
 * s18 — QR check-in scanner (`canvas-screens.dc.html:600`).
 *
 * Deliberately not on `ScreenShell`: the shell wraps children in a `ScrollView`,
 * and a full-bleed camera viewport inside a scroll container fights the scroll
 * gesture and cannot fill the screen. s05 opts out for the same class of reason
 * (`spec/ui/mobile/patterns.md`).
 *
 * The layout is the board's: a square viewport with corner brackets, centred,
 * in the foreground text rather than the board's accent (a decorative frame is
 * neutral: foundations.md §6, "Where the accent goes", 2026-11-05), with
 * "Enter code manually" and the torch along the bottom. The typed code goes in
 * a sheet (`components/check-in/manual-code-sheet.tsx`),
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
 * The screen stays mounted under anything pushed over it, and while the app
 * is in the background. A `CameraView` left mounted keeps the camera session
 * (and the torch) on behind whatever the member went to, so it is drawn only
 * while this screen has focus.
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
   * (the code it sent, or a request that may go through if sent again), not
   * about the member, so it clears when they turn to typing a code (see
   * `openManual`).
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

/** The drawn corner bracket: 36pt arms, a 3pt stroke in the foreground text. */
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
  const below = useScreenBelow();

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

  /**
   * The check-in on its way for each event, keyed by event, holding its
   * request's number.
   *
   * The tab instance is reused, so a check-in sent for one event can still be
   * on its way when the screen is on another, and the member can come back to
   * the first before it answers. So whether a check-in is on its way is kept
   * per event, and so is the latch that lets one through at a time
   * (`latchFor`): event A's check-in in flight never switches B's scanner or
   * manual Check in off, and when it settles it clears only its own mark and
   * releases only A's latch, never a hold that B's own check-in has. Coming
   * back to A while it is still on its way shows it as sending, and its answer
   * lands; once it has settled, wherever the screen was, nothing is left
   * sending.
   *
   * Slots in this one screen rather than a screen remounted per event
   * (`key={eventId}`): a remount would restart the camera session on a
   * `frapp://` move and pull the manual sheet's modal out from under
   * `useSheetVisit` mid-presentation, and the record of what is on its way
   * would still have to live above it, for the event the member comes back
   * to. Everything else the screen holds is only ever the current event's: a
   * result for an event the screen has left is dropped, so the status, the
   * typed code and the foreign-code memory are simply reset on a move (below).
   */
  const [sending, setSending] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  const lastRequestRef = useRef(0);
  // `useRef` rather than state: a latch change must never trigger a render, or
  // the camera remounts mid-scan.
  const latchesRef = useRef(new Map<string, ScanLatch>());
  const latchFor = useCallback((id: string) => {
    let latch = latchesRef.current.get(id);
    if (!latch) {
      latch = createScanLatch();
      latchesRef.current.set(id, latch);
    }
    return latch;
  }, []);
  const sendingHere = sending.has(eventId);

  /**
   * What the screen says belongs to one event.
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
   * the old one is drawn. A check-in on its way for the event the screen is
   * now on needs nothing here: `sending` is per event, so it shows.
   */
  const [shownEventId, setShownEventId] = useState(eventId);
  if (shownEventId !== eventId) {
    setShownEventId(eventId);
    setStatus({ kind: "idle" });
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
   * `check-in` is pushed with an `eventId` param, and an instance can be handed
   * new params in place (a `frapp://` link opened over it) rather than
   * remounted, so state from one event can meet the next. It used to be a tab
   * that stayed mounted for the whole session, which is where the bug below
   * came from; the reset stays for the in-place case. Unlike `error`, `blocked` disarms both the
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

  // One mutation, used only to send. Its `isPending` follows its latest call,
  // whichever event that was for, so nothing here reads it: `sending` and the
  // latches are per event.
  const { mutateAsync: sendCheckIn } = useCheckIn();

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
   * It claims the event's latch before anything else, with the code it sends
   * (`claim`), and returns if a check-in for this event already holds it. That
   * is synchronous, so it holds where a render would come too late: the camera
   * hands over a code many times a second, and a double tap on the sheet's
   * button lands its second press before the re-render that disables it.
   *
   * A result that lands after the screen has moved to another event is
   * dropped, success or failure: it is about an event the member is no longer
   * looking at, and drawing it would confirm (or refuse) the wrong one. A
   * dropped result touches nothing of the event on screen: the move already
   * reset the screen to it (see `shownEventId`), and a status, or a code typed
   * since, belongs to that event. It clears only its own event's `sending`
   * mark and latch.
   */
  const submit = useCallback(
    async (payload: { token?: string; manualCode?: string }, claim: string) => {
      const submittedFor = eventId;
      const latch = latchFor(submittedFor);
      if (!latch.accept(claim)) return;
      const request = ++lastRequestRef.current;
      const eventName = event?.name ?? null;
      const outcome = checkInSuccess(event?.point_value);
      setStatus({ kind: "idle" });
      setSending((current) => new Map(current).set(submittedFor, request));
      try {
        const fix = await resolveLocation();
        await sendCheckIn({ eventId: submittedFor, ...payload, ...fix });
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
        setSending((current) => {
          if (current.get(submittedFor) !== request) return current;
          const next = new Map(current);
          next.delete(submittedFor);
          return next;
        });
        // Released on both paths so a failed scan can be retried. A latch that
        // stayed closed after an error would strand the member on a dead screen.
        latch.release();
      }
    },
    [dismissSheet, event, eventId, latchFor, resolveLocation, sendCheckIn],
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

      // The manual field is gated a few lines below; the scan has to be too.
      // A scan submits immediately, so without this a member at the door with
      // no signal gets a spinner that never resolves and a decoder that has
      // already been switched off. Checked before `submit` claims the latch:
      // a claim with no request behind it would never be released, and the
      // scanner would drop every code after the member reconnected.
      if (writeBlockedReasonRef.current !== null) return;
      void submit({ token: parsed.token }, raw);
    },
    [eventId, submit],
  );

  useEffect(() => {
    if (!cameraPermission || cameraPermission.granted) return;
    if (!cameraPermission.canAskAgain) return;
    void requestCameraPermission();
  }, [cameraPermission, requestCameraPermission]);

  // Gated on this event's own state only: a check-in on its way for another
  // event leaves both armed (see `sending`).
  const scanning =
    eventLoaded &&
    !manualOpen &&
    !sendingHere &&
    status.kind !== "success" &&
    status.kind !== "blocked";

  const manualSubmitDisabled =
    !eventLoaded ||
    !isPlausibleManualCode(manualCode) ||
    writeBlockedReason !== null ||
    sendingHere ||
    status.kind === "blocked";

  const openManual = () => {
    // The sheet shows only lines that stay true of the code the member is
    // about to type. A line about the last attempt (`attemptOnly`: the
    // scanned code was refused as stale, malformed or another event's, or
    // the request may go through if sent again) says nothing about a fresh
    // code, so it clears. A line about the member or the environment stays:
    // where they are (the zone, their location), that they're already
    // checked in here, that check-in codes aren't set up here, or a refusal
    // that is why the sheet's button is off. The screen already dropped
    // whatever belonged to an earlier event (`shownEventId`).
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
   * event. When that detail is the screen under this one, they pop to it, as
   * the edge swipe and Android's back do (`spec/ui/mobile/navigation.md`
   * § Going back). Anything else under it (a `frapp://` link opened over the
   * tabs) gets the fixed destination, so "Back to event" still lands on the
   * event: popped down to (`dismissTo`), which takes this screen's place
   * rather than going on top of it, so the swipe from there doesn't come back
   * here.
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
        hears the success only through this. `collapsable={false}` keeps it a
        real Android view: a View that only lays out is flattened away by the
        renderer, and its live region with it. Empty, it draws nothing and
        takes no space.
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
          <InlineNote>Open an event, then tap Scan QR to check in.</InlineNote>
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

            {sendingHere ? (
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
          // A fast double tap can land a second press before the re-render
          // disables the control; `submit`'s latch claim drops it.
          onSubmit={() => void submit({ manualCode }, manualCode)}
          submitDisabled={manualSubmitDisabled}
          submitting={sendingHere}
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
  const bracketEdge = {
    borderColor: tokens.color.text.foreground,
    width: BRACKET_SIZE,
  } as const;
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
