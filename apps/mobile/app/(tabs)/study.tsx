import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, StyleSheet, Text, View } from "react-native";
import type { AppStateStatus } from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  useCurrentChapter,
  useGeofences,
  usePauseStudySession,
  useResumeStudySession,
  useStartStudySession,
  useStopStudySession,
  useStudyHeartbeat,
  useStudySessions,
} from "@repo/hooks";
import { isModuleEnabled } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { SectionHeader } from "@/components/list-section";
import {
  EmptyState,
  ErrorState,
  SkeletonLines,
} from "@/components/state-block";
import { SessionCard } from "@/components/study/session-card";
import { SessionRow } from "@/components/study/session-row";
import { StartCard } from "@/components/study/start-card";
import { WeekSummary } from "@/components/study/week-summary";
import { ZonePickerSheet } from "@/components/study/zone-picker-sheet";
import { LocationPrimerSheet } from "@/components/study/location-primer-sheet";
import {
  readForegroundFix,
  readForegroundPermission,
  requestForegroundPermission,
} from "@/lib/location";
import { statusOf } from "@/lib/api-error";
import {
  clearStudyPausedNotification,
  notifyStudyPaused,
} from "@/lib/notifications/study-pause";
import {
  isActiveSessionConflict,
  sessionErrorCopy,
  startErrorCopy,
} from "@/lib/study/errors";
import { startOfWeek } from "@/lib/study/format";
import {
  creditedSeconds,
  isReportingStale,
  isPaused as sessionIsPaused,
  narrowSession,
  selectActiveSession,
  selectSessionHistory,
  settleIfEnded,
  type StudySessionModel,
} from "@/lib/study/session";
import {
  findZone,
  graceWindowCopy,
  selectActiveZones,
  type StudyZoneModel,
} from "@/lib/study/zones";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s10 — Study hours (`canvas-screens.dc.html`, `id="s10"`).
 *
 * Composition only; every rule lives in `lib/study/` where it is unit-tested.
 *
 * ## The three rules this screen exists to obey
 *
 * **1. The server owns the clock.** `spec/ui/mobile/patterns.md` § Study
 * sessions: "Credited time derives from server-recorded timestamps, never an
 * accumulated client-side timer." Nothing here counts. The one-second tick only
 * moves `now`; `creditedSeconds` re-derives the figure from the session's own
 * watermark each render, so a paused or closed session simply stops changing.
 *
 * **2. Backgrounding pauses, it never stops.** The web screen stops the session
 * on `pagehide` because closing a tab is final. On a phone it is not: leaving
 * the app to read a message is the *ordinary* case, and the grace window exists
 * precisely to make it non-terminal. `AppState` → `/pause` and `/resume`, and
 * the mirror rolls back on failure so a dropped pause is retried rather than
 * silently accruing background time.
 *
 * **3. A session ends by returning 200.** Expiry is lazy server-side, so pause,
 * resume, heartbeat and stop can each come back terminal. Every response goes
 * through `settleIfEnded`; nothing infers an ending from a thrown error.
 *
 * ## Why server state is adopted but never used to clear
 *
 * `useStudySessions` is a cached read with a 30-second stale window and no
 * focus refetch. If a stale empty page could clear the live session, the moment
 * right after `start` — before the invalidation lands — would wipe the session
 * the member just began. So the list seeds and adopts, and only a mutation
 * response (or a 404 from one) ends a session. That is also what
 * `patterns.md` means by "the client never needs cleanup logic of its own".
 */

/** `spec/behavior/study-sessions.md`: the client heartbeats every 5 minutes. */
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * How long to wait before re-sending a pause or resume the network dropped.
 *
 * Short, because the thing it is racing is the zone's grace window — five
 * minutes by default. A resume that retries once a minute would lose that race
 * more often than it won it.
 */
const MIRROR_RETRY_MS = 15 * 1000;

const LOCATION_REQUIRED_COPY =
  "Frapp confirms you're in the study zone, so it needs location while you study. Turn it on in Settings → Frapp → Location.";

export default function StudyScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const zoneSheetRef = useRef<BottomSheetModal>(null);
  const primerSheetRef = useRef<BottomSheetModal>(null);

  const chapterQuery = useCurrentChapter();
  const zonesQuery = useGeofences();
  const sessionsQuery = useStudySessions();

  const startSession = useStartStudySession();
  const heartbeat = useStudyHeartbeat();
  const pauseSession = usePauseStudySession();
  const resumeSession = useResumeStudySession();
  const stopSession = useStopStudySession();

  const zones = useMemo(
    () => selectActiveZones(zonesQuery.data),
    [zonesQuery.data],
  );
  const serverActive = useMemo(
    () => selectActiveSession(sessionsQuery.data),
    [sessionsQuery.data],
  );
  const history = useMemo(
    () => selectSessionHistory(sessionsQuery.data),
    [sessionsQuery.data],
  );

  const [session, setSession] = useState<StudySessionModel | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [canAskForLocation, setCanAskForLocation] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [appState, setAppState] = useState<AppStateStatus>(
    () => AppState.currentState ?? "active",
  );

  /**
   * The session id the screen is holding, readable from callbacks that must not
   * re-create on every heartbeat. `settleIfEnded` compares against it so a
   * pause that lands after a *new* session started cannot wipe the new one.
   */
  const sessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    sessionIdRef.current = session?.id ?? null;
  }, [session]);

  /**
   * A monotonic ticket per outbound mutation, so responses can be applied in the
   * order they were *sent* rather than the order they arrive.
   *
   * Without it the state machine is last-write-wins: a `/pause` posted as the
   * app backgrounds can answer *after* the `/resume` that followed it three
   * seconds later, flipping a live session back to paused — which tears down
   * both timers with no AppState transition left to restart them.
   */
  const requestSeqRef = useRef(0);
  const appliedSeqRef = useRef(0);

  /** The live AppState, readable from inside an async continuation. */
  const appStateRef = useRef(appState);
  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  /**
   * `useMutation` hands back a fresh object every render, so an effect keying on
   * `mutateAsync` would tear down and rebuild the heartbeat interval constantly.
   * Holding the callables in a ref lets the effects key on real state instead —
   * the pattern `apps/web/components/study/study-page.tsx` records for the same
   * reason.
   */
  const apiRef = useRef({
    start: startSession.mutateAsync,
    heartbeat: heartbeat.mutateAsync,
    pause: pauseSession.mutateAsync,
    resume: resumeSession.mutateAsync,
    stop: stopSession.mutateAsync,
    refetchSessions: sessionsQuery.refetch,
  });
  useEffect(() => {
    apiRef.current = {
      start: startSession.mutateAsync,
      heartbeat: heartbeat.mutateAsync,
      pause: pauseSession.mutateAsync,
      resume: resumeSession.mutateAsync,
      stop: stopSession.mutateAsync,
      refetchSessions: sessionsQuery.refetch,
    };
  });

  /** Adopt the live session — on cold start, and after any invalidation. */
  useEffect(() => {
    if (!serverActive) return;
    setSession((current) =>
      current && current.id === serverActive.id ? current : serverActive,
    );
  }, [serverActive]);

  /** Default to the only zone; otherwise wait for a choice. */
  useEffect(() => {
    setSelectedZoneId((current) => {
      if (current && zones.some((zone) => zone.id === current)) return current;
      return zones.length === 1 ? (zones[0]?.id ?? null) : null;
    });
  }, [zones]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", setAppState);
    return () => subscription.remove();
  }, []);

  /**
   * Backgrounded means `"background"` — **not** "anything but active".
   *
   * iOS emits `inactive` for a Control Center pull, the app-switcher peek and an
   * incoming-call banner. None of those is the member leaving, and treating
   * them as a pause fires a `/resume` with a fresh fix seconds later — which the
   * server re-checks against the polygon, so an indoor GPS jitter closes the
   * session `LOCATION_INVALID` with no points, for someone who never moved.
   * Android never emits `inactive`, so this would not have shown up there.
   */
  const isForeground = appState !== "background";
  const paused = session !== null && sessionIsPaused(session);
  const running = session !== null && !paused;
  const reportingStale = session !== null && isReportingStale(session, now);

  const applyResponse = useCallback((response: unknown, seq: number) => {
    // Nothing held, nothing to apply. Without this an in-flight heartbeat that
    // answers `ACTIVE` moments after the member taps End would put the ended
    // session back on screen, ticking, under the notice saying it ended.
    if (sessionIdRef.current === null) return;
    // A response older than one already applied says nothing new and can only
    // undo it.
    if (seq < appliedSeqRef.current) return;

    const settled = settleIfEnded(response, sessionIdRef.current);
    if (settled.ended) {
      appliedSeqRef.current = seq;
      setSession(null);
      sessionIdRef.current = null;
      setNotice(settled.notice);
      // A session that ended while paused would otherwise leave its "return to
      // Frapp to resume" notice in the tray, inviting the member back to a
      // session that no longer exists (#1065).
      void clearStudyPausedNotification();
      // The closed session belongs in the history list below, which is served
      // by the same query.
      void apiRef.current.refetchSessions();
      return;
    }

    const next = narrowSession(response);
    if (!next) return;
    if (next.id !== sessionIdRef.current) return;
    appliedSeqRef.current = seq;
    setSession(next);
  }, []);

  /** Let go of a session the server says is gone, and say so. */
  const releaseSession = useCallback((notice: string) => {
    setSession(null);
    sessionIdRef.current = null;
    setNotice(notice);
    void clearStudyPausedNotification();
    void apiRef.current.refetchSessions();
  }, []);

  /** One tick per second, and only while there is something to tick. */
  useEffect(() => {
    if (!running || !isForeground) return undefined;
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, [running, isForeground]);

  const sendHeartbeat = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    try {
      const fix = await readForegroundFix();
      applyResponse(await apiRef.current.heartbeat(fix), seq);
    } catch (error) {
      // A 404 is not a missed beat — it is the server saying this session no
      // longer exists (stopped from the web dashboard, or superseded by one
      // started on another device). Swallowing it leaves a dead timer ticking
      // forever, which is exactly the failure this screen's rule 3 exists to
      // prevent.
      if (statusOf(error) === 404) {
        releaseSession(
          "That session has already been closed somewhere else. Your credited time is safe.",
        );
        return;
      }
      // Anything else is transient. The server's stale-heartbeat rule owns the
      // consequence and the next tick is five minutes away, so surfacing it
      // would cry wolf on every lift tunnel — but `isReportingStale` puts a
      // visible warning on the card once beats have actually stopped landing.
      if (__DEV__) console.warn("study heartbeat failed", error);
    }
  }, [applyResponse, releaseSession]);

  useEffect(() => {
    if (!running || !isForeground) return undefined;
    const interval = setInterval(
      () => void sendHeartbeat(),
      HEARTBEAT_INTERVAL_MS,
    );
    return () => clearInterval(interval);
  }, [running, isForeground, sendHeartbeat]);

  /**
   * The foreground state already reported to the server.
   *
   * Only real transitions are mirrored, and a failed call rolls the ref back so
   * the next one retries. Without the rollback a single dropped `/pause` would
   * leave the client believing the server knows it is backgrounded, and every
   * later background would be skipped — which is exactly the silent accrual the
   * pause exists to prevent.
   */
  const lastReportedForegroundRef = useRef(isForeground);
  const sessionId = session?.id ?? null;
  /**
   * Bumped when a mirror call fails, purely to re-run the effect below.
   *
   * The previous shape rolled the ref back "so the next one retries" — but the
   * effect keys on `isForeground` and `sessionId`, neither of which changes
   * after a failure, so nothing re-fired. A member whose `/resume` failed once
   * sat on a Paused card until the grace window closed the session, watching
   * copy that promised it would resume on its own.
   */
  const [mirrorRetry, setMirrorRetry] = useState(0);

  useEffect(() => {
    if (sessionId === null) {
      lastReportedForegroundRef.current = isForeground;
      return undefined;
    }
    if (lastReportedForegroundRef.current === isForeground) return undefined;

    const target = isForeground;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    void (async () => {
      const seq = ++requestSeqRef.current;
      try {
        let response: unknown;
        if (!target) {
          response = await apiRef.current.pause();
          // Only after the server has agreed. Posting the notice optimistically
          // would tell a member their session paused when the request is about
          // to fail and be retried (#1065, `spec/behavior/study-sessions.md`
          // § Anti-Distraction). Fire-and-forget: a notification that cannot be
          // posted must never fail the pause.
          if (!cancelled) void notifyStudyPaused();
        } else {
          // Coordinates are re-checked on resume: the member may have left the
          // zone while away, and the next heartbeat is up to five minutes out
          // (`spec/behavior/study-sessions.md`).
          const fix = await readForegroundFix();
          // A cold GPS fix routinely takes seconds, and the member can leave
          // again inside that window. Posting `/resume` from a backgrounded app
          // clears `paused_at` and resets the credit watermark, so the next
          // heartbeat banks the whole background gap as study time — the exact
          // accrual the pause exists to prevent.
          if (cancelled || appStateRef.current === "background") return;
          response = await apiRef.current.resume(fix);
          // Cleared on the way back in, so a member who returns inside the
          // grace window does not find a stale "paused" notice waiting.
          void clearStudyPausedNotification();
        }
        if (cancelled) return;
        // Marked only once the server has actually been told. The old code
        // flipped this before awaiting, which let two transitions interleave.
        lastReportedForegroundRef.current = target;
        applyResponse(response, seq);
      } catch (error) {
        if (cancelled) return;
        if (target) {
          setFailure(sessionErrorCopy(error));
          // A resume that keeps failing leaves the paused card on screen and
          // the retry loop running — but the tray notice invites the member
          // back to a session that may already be gone (an officer stopping it
          // from the dashboard 404s every retry). Withdraw it: the in-app card
          // is still there and is the honest surface for a failed resume.
          void clearStudyPausedNotification();
        }
        retryTimer = setTimeout(
          () => setMirrorRetry((count) => count + 1),
          MIRROR_RETRY_MS,
        );
      }
    })();

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
    };
  }, [applyResponse, isForeground, sessionId, mirrorRetry]);

  const selectedZone: StudyZoneModel | null = useMemo(
    () => findZone(zones, selectedZoneId),
    [zones, selectedZoneId],
  );
  const activeZone: StudyZoneModel | null = useMemo(
    () => findZone(zones, session?.geofenceId ?? null),
    [zones, session],
  );

  // Keyed on the week boundary, not on `now` — `now` ticks once a second while a
  // session runs, and this filter+reduce over the whole history has no reason to
  // re-run until the calendar week actually changes.
  const weekStart = startOfWeek(now).getTime();
  const weekTotals = useMemo(() => {
    const inWeek = history.filter(
      (row) => Date.parse(row.startTime) >= weekStart,
    );
    return {
      minutes: inWeek.reduce((sum, row) => sum + row.totalForegroundMinutes, 0),
      count: inWeek.length,
    };
  }, [history, weekStart]);

  const beginSession = useCallback(async () => {
    if (!selectedZoneId) return;
    setNotice(null);
    setFailure(null);
    setIsStarting(true);
    try {
      const fix = await readForegroundFix();
      requestSeqRef.current += 1;
      const response = await apiRef.current.start({
        geofence_id: selectedZoneId,
        ...fix,
      });
      const next = narrowSession(response);
      if (next) {
        sessionIdRef.current = next.id;
        setSession(next);
        // The session starts in the foreground by construction — the member
        // just tapped. Seeding the mirror here stops the first AppState change
        // from being read as a transition that never happened.
        lastReportedForegroundRef.current = true;
        setNow(new Date());
      }
    } catch (error) {
      if (isActiveSessionConflict(error)) {
        // The server settles a lapsed pause before it checks, so a 409 means a
        // genuinely live session — one this screen simply had not read yet.
        // Adopting it beats telling the member to go find it.
        const refetched = await apiRef.current.refetchSessions();
        const live = selectActiveSession(refetched.data);
        if (live) {
          sessionIdRef.current = live.id;
          setSession(live);
          lastReportedForegroundRef.current = true;
          setNotice(
            "You already had a session running, so this picked it back up.",
          );
        } else {
          setFailure(startErrorCopy(error));
        }
      } else {
        setFailure(startErrorCopy(error));
      }
    } finally {
      setIsStarting(false);
    }
  }, [selectedZoneId]);

  /**
   * The primer gate.
   *
   * Permission is *read* first, never requested — `patterns.md` requires the
   * primer to explain the zone check before the OS asks, and asking first would
   * make the explanation an apology.
   */
  /**
   * Both permission paths run inside their own try/catch and behind
   * `isStarting`.
   *
   * A bare `void (async () => …)()` swallows a rejection into an unhandled
   * promise — a dev-only warning under Hermes and silence in release — so a
   * failed permission call turned the tap into a no-op with nothing on screen.
   * The busy flag matters for the same reason: the primer's dismiss is
   * animated, so a double tap fires two concurrent
   * `requestForegroundPermissionsAsync` calls, the second of which rejects
   * because one is already in flight.
   */
  const handleStartPress = useCallback(() => {
    if (isStarting) return;
    void (async () => {
      setFailure(null);
      try {
        const permission = await readForegroundPermission();
        if (permission.granted) {
          await beginSession();
          return;
        }
        setCanAskForLocation(permission.canAskAgain);
        primerSheetRef.current?.present();
      } catch {
        setFailure(LOCATION_REQUIRED_COPY);
      }
    })();
  }, [beginSession, isStarting]);

  const handlePrimerAllow = useCallback(() => {
    if (isStarting) return;
    void (async () => {
      primerSheetRef.current?.dismiss();
      try {
        const permission = await requestForegroundPermission();
        if (!permission.granted) {
          setFailure(LOCATION_REQUIRED_COPY);
          return;
        }
        await beginSession();
      } catch {
        setFailure(LOCATION_REQUIRED_COPY);
      }
    })();
  }, [beginSession, isStarting]);

  const endSession = useCallback(async () => {
    setFailure(null);
    setIsEnding(true);
    const seq = ++requestSeqRef.current;
    try {
      applyResponse(await apiRef.current.stop(), seq);
    } catch (error) {
      // Only a 404 means the server has already closed it. **Every other error
      // leaves the session ACTIVE server-side**, so dropping it here would tear
      // down the heartbeat and let the stale rule close it as `EXPIRED` — which
      // awards nothing — while the copy promised the member their time was
      // safe. Keeping the card up leaves them an End button to try again with.
      if (statusOf(error) === 404) {
        releaseSession(sessionErrorCopy(error));
      } else {
        setFailure(sessionErrorCopy(error));
      }
    } finally {
      setIsEnding(false);
    }
  }, [applyResponse, releaseSession]);

  const confirmEnd = useCallback(() => {
    Alert.alert(
      "End this session?",
      "Your credited time is already banked. Points are awarded once you pass the zone's minimum session length.",
      [
        { text: "Keep studying", style: "cancel" },
        {
          text: "End session",
          style: "destructive",
          onPress: () => void endSession(),
        },
      ],
    );
  }, [endSession]);

  const enabledModules = (
    chapterQuery.data as
      { enabled_modules?: Record<string, boolean> } | undefined
  )?.enabled_modules;
  // Fails open, and deliberately: `useCurrentChapter` is `enabled: !!chapterId`
  // and no production token carries the claim while #805 is open, so a strict
  // read would hide the screen from everyone. The writes are gated server-side
  // regardless — this only avoids offering a surface a chapter switched off.
  const hoursEnabled = isModuleEnabled(enabledModules, "hours");

  function renderBody() {
    // No `NoChapterState` branch. `GET /v1/study-sessions` resolves a sole
    // membership server-side, so it works without an `active_chapter_id` claim —
    // and `chapterId` is null for *every* production member while #805 is open,
    // so any such branch would swallow every genuine fetch failure into
    // "No chapter selected", which carries no retry control.
    if (!hoursEnabled) {
      return (
        <EmptyState
          glyph="◷"
          title="Study hours are turned off"
          body="Your chapter isn't tracking study hours right now. An officer can turn the module back on."
        />
      );
    }

    if (sessionsQuery.isPending || zonesQuery.isPending) {
      return <SkeletonLines lines={4} showTile />;
    }

    if (sessionsQuery.isError) {
      return (
        <ErrorState
          title="Couldn't load study hours"
          body="Your sessions are still recorded — this was a problem fetching them."
          onRetry={() => void sessionsQuery.refetch()}
          isRetrying={sessionsQuery.isFetching}
        />
      );
    }

    if (zonesQuery.isError) {
      return (
        <ErrorState
          title="Couldn't load study zones"
          body="A session has to start inside a zone, so this has to load first."
          onRetry={() => void zonesQuery.refetch()}
          isRetrying={zonesQuery.isFetching}
        />
      );
    }

    if (!session && zones.length === 0) {
      return (
        <EmptyState
          glyph="◷"
          title="No study zones yet"
          body="Sessions are tracked inside a zone. An officer with geofences:manage can add one."
        />
      );
    }

    return (
      <>
        {session ? (
          <SessionCard
            seconds={creditedSeconds(session, now)}
            zoneName={activeZone?.name ?? "Study zone"}
            isPaused={paused}
            isReportingStale={reportingStale}
            graceCopy={graceWindowCopy(activeZone)}
            isEnding={isEnding}
            onEnd={confirmEnd}
          />
        ) : (
          <StartCard
            zone={selectedZone}
            canChooseZone={zones.length > 1}
            isStarting={isStarting}
            graceCopy={graceWindowCopy(selectedZone)}
            onChooseZone={() => zoneSheetRef.current?.present()}
            onStart={handleStartPress}
          />
        )}

        <WeekSummary
          minutes={weekTotals.minutes}
          sessionCount={weekTotals.count}
        />

        {history.length > 0 ? (
          <>
            <SectionHeader>RECENT SESSIONS</SectionHeader>
            <View style={styles.rows}>
              {history.slice(0, 10).map((row, index, all) => (
                <SessionRow
                  key={row.id}
                  session={row}
                  zoneName={findZone(zones, row.geofenceId)?.name ?? null}
                  isLast={index === all.length - 1}
                />
              ))}
            </View>
          </>
        ) : null}
      </>
    );
  }

  return (
    <ScreenShell
      title="Study hours"
      subtitle="Tracked sessions inside your chapter's study zones."
    >
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {failure ? <Text style={styles.failure}>{failure}</Text> : null}

      {renderBody()}

      <ZonePickerSheet
        ref={zoneSheetRef}
        zones={zones}
        selectedZoneId={selectedZoneId}
        onSelect={(zoneId) => {
          setSelectedZoneId(zoneId);
          zoneSheetRef.current?.dismiss();
        }}
      />

      <LocationPrimerSheet
        ref={primerSheetRef}
        canAskAgain={canAskForLocation}
        onAllow={handlePrimerAllow}
        onDismiss={() => primerSheetRef.current?.dismiss()}
      />
    </ScreenShell>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    rows: {
      marginTop: tokens.spacing.xs,
    },
    notice: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    failure: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
  });
}
