"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Loader2, Pause, Play, Square } from "lucide-react";
import { StudyZonesGlyph } from "@/components/events/chapter-ops-glyphs";
import {
  useGeofences,
  usePauseStudySession,
  useResumeStudySession,
  useStartStudySession,
  useStopStudySession,
  useStudyHeartbeat,
  useStudySessions,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  studySessionStatusKind,
  studySessionStatusLabel,
} from "@/components/study/study-status";
import { NestedEmpty } from "@/components/shared/nested-states";
import { SectionLabel } from "@/components/shared/section-label";
import { denseListClassName } from "@/components/shared/table-controls";
import {
  ErrorState,
  anyReadUncached,
  LoadingState,
  OfflineState,
} from "@/components/shared/async-states";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useToast } from "@/lib/hooks/use-toast";
import { useNetwork } from "@/lib/providers/network-provider";
import {
  formatDayTimeRange,
  formatMinutesRounded,
  formatPaddedStopwatch as formatDuration,
} from "@repo/formatting";
import { asArray, getErrorMessage } from "@/lib/utils";
import {
  creditedSeconds,
  selectActiveSession,
} from "@/components/study/credited-time";

type Geofence = {
  id: string;
  name: string;
  coordinates: { lat: number; lng: number }[] | null;
  is_active: boolean;
  minutes_per_point: number;
  points_per_interval: number;
  min_session_minutes: number;
  pause_grace_minutes: number;
};

type StudySession = {
  id: string;
  chapter_id: string;
  user_id: string;
  geofence_id: string;
  status:
    "ACTIVE" | "COMPLETED" | "EXPIRED" | "PAUSED_EXPIRED" | "LOCATION_INVALID";
  start_time: string;
  end_time: string | null;
  last_heartbeat_at: string | null;
  paused_at: string | null;
  total_foreground_minutes: number;
  points_awarded: boolean;
  created_at: string;
};

/** Statuses that mean the session is over — nothing further will accrue. */
const TERMINAL_STATUSES: StudySession["status"][] = [
  "COMPLETED",
  "EXPIRED",
  "PAUSED_EXPIRED",
  "LOCATION_INVALID",
];

/** 5 minutes, matches mobile. Exported so specs can fire this interval without faking timers. */
export const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Usable GPS accuracy in meters, or `undefined` when the browser did not
 * report one.
 *
 * `GeolocationCoordinates.accuracy` is a required W3C attribute (meters,
 * non-negative). Incomplete mocks, and the occasional `0`, still show up;
 * sending `0` would look like a perfect fix and skip the optional-field
 * semantics the server documents: omit → skip the 100m floor; a number →
 * enforce it (`spec/behavior/study-sessions.md` § Edge Cases). Same predicate
 * as mobile `accuracyMetersOf` — copied, not imported, because web must not
 * depend on `apps/mobile`.
 */
export function accuracyMetersOf(
  accuracy: number | null | undefined,
): number | undefined {
  if (
    typeof accuracy !== "number" ||
    !Number.isFinite(accuracy) ||
    accuracy <= 0
  ) {
    return undefined;
  }
  return accuracy;
}

/**
 * Coordinates only — for POSTs whose DTO does not declare `accuracy_meters`.
 *
 * Spreading a heartbeat body into start/resume 400s once the browser reports
 * accuracy (`forbidNonWhitelisted`).
 */
function latLngOf(coords: { latitude: number; longitude: number }): {
  lat: number;
  lng: number;
} {
  return { lat: coords.latitude, lng: coords.longitude };
}

/** Heartbeat body: lat/lng plus `accuracy_meters` only when the reading is usable. */
export function studyHeartbeatBody(coords: {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}): { lat: number; lng: number; accuracy_meters?: number } {
  const accuracy_meters = accuracyMetersOf(coords.accuracy);
  return accuracy_meters === undefined
    ? latLngOf(coords)
    : { ...latLngOf(coords), accuracy_meters };
}

function getCurrentPosition(): Promise<GeolocationPosition> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.reject(
      new Error(
        "Geolocation is not available in this browser. Use the mobile app for study sessions on the go.",
      ),
    );
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 0,
    });
  });
}

export function StudyPage() {
  const { toast } = useToast();
  const { isOffline } = useNetwork();
  // `StudySessionController` carries no `@FreeTier`, so every one of its five
  // writes is paid-ops and the member-facing controls have to mirror the guard
  // (#841). The heartbeat is the exception below — see `sendHeartbeat`.
  const gate = useSubscriptionGate();
  const geofencesQuery = useGeofences();
  const sessionsQuery = useStudySessions();
  const startSession = useStartStudySession();
  const heartbeat = useStudyHeartbeat();
  const pauseSession = usePauseStudySession();
  const resumeSession = useResumeStudySession();
  const stopSession = useStopStudySession();

  const geofences = useMemo(
    () => asArray<Geofence>(geofencesQuery.data).filter((g) => g.is_active),
    [geofencesQuery.data],
  );
  const sessions = useMemo(
    () =>
      asArray<StudySession>(sessionsQuery.data).sort((a, b) =>
        a.start_time < b.start_time ? 1 : -1,
      ),
    [sessionsQuery.data],
  );

  // Active session state (client-authoritative for the running timer; the
  // server already knows via /v1/study-sessions/start).
  const [activeGeofenceId, setActiveGeofenceId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<StudySession | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);
  const [geolocationError, setGeolocationError] = useState<string | null>(null);
  const [selectedGeofenceId, setSelectedGeofenceId] = useState<string>("");

  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // A session this tab just ended must not be re-adopted from a stale list
  // row while the stop invalidation is in flight.
  const dismissedSessionIdRef = useRef<string | null>(null);
  // Mirror of the last foreground bit reported to the server (or seeded on
  // restore so a remount does not immediately POST pause/resume).
  const lastForegroundRef = useRef(true);

  const activeGeofence = useMemo(
    () => geofences.find((g) => g.id === activeGeofenceId) ?? null,
    [geofences, activeGeofenceId],
  );

  // Track Page Visibility — web's adaptation of the mobile "foreground
  // enforcement" rule. See spec/behavior/study-sessions.md.
  useEffect(() => {
    function handleVisibility() {
      setPageHidden(document.visibilityState === "hidden");
    }
    handleVisibility();
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // Identity of the session currently on screen. Responses are matched against
  // this rather than against a lifecycle flag: a request must still be able to
  // settle a session after the component re-renders (that is the whole point of
  // handling PAUSED_EXPIRED), but it must never settle a *different* session
  // than the one it was issued for.
  const activeSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeSessionIdRef.current = activeSession?.id ?? null;
  }, [activeSession]);

  // Clear local session state when the server reports the session is over —
  // notably PAUSED_EXPIRED, which arrives as the *response* to a pause or
  // resume rather than as an error.
  const settleIfEnded = useCallback(
    (result: unknown): boolean => {
      const session =
        result && typeof result === "object" ? (result as StudySession) : null;
      if (!session || !TERMINAL_STATUSES.includes(session.status)) return false;
      // A slow pause/resume can land after the member stopped and started a
      // fresh session; settling then would wipe the new session's timer and
      // leave it running server-side until the stale rule kills it.
      if (session.id !== activeSessionIdRef.current) return false;

      dismissedSessionIdRef.current = session.id;
      lastForegroundRef.current = true;
      setActiveSession(null);
      setActiveGeofenceId(null);
      setElapsedSeconds(0);
      setIsPaused(false);
      toast({
        title:
          session.status === "PAUSED_EXPIRED"
            ? "Session expired while paused"
            : "Study session ended",
        description:
          session.status === "PAUSED_EXPIRED"
            ? `You didn't return in time. ${session.total_foreground_minutes} foreground minute${session.total_foreground_minutes === 1 ? "" : "s"} were counted.`
            : `Ended as ${studySessionStatusLabel(session.status).toLowerCase()}.`,
        variant: session.status === "COMPLETED" ? "default" : "destructive",
      });
      return true;
    },
    [toast],
  );

  // `useMutation` hands back a fresh object on every render, so none of these
  // are safe to name as effect dependencies — an effect that depends on one
  // tears down and re-runs on every render, and `mutateAsync` itself triggers a
  // render by flipping `isPending`. Holding the callables in a ref keeps the
  // effects below keyed on real state transitions instead.
  const apiRef = useRef({
    heartbeat: heartbeat.mutateAsync,
    pause: pauseSession.mutateAsync,
    resume: resumeSession.mutateAsync,
    settle: settleIfEnded,
  });
  useEffect(() => {
    apiRef.current = {
      heartbeat: heartbeat.mutateAsync,
      pause: pauseSession.mutateAsync,
      resume: resumeSession.mutateAsync,
      settle: settleIfEnded,
    };
  });

  // Not subscription-gated: the heartbeat is a background timer with no
  // affordance, so there is nothing to disable and no effort to protect. If the
  // subscription lapses mid-session the server rejects it and the session
  // expires on staleness, which is the same outcome as the tab being closed.
  const sendHeartbeat = useCallback(async () => {
    try {
      const pos = await getCurrentPosition();
      const result = await apiRef.current.heartbeat(
        studyHeartbeatBody(pos.coords),
      );
      setGeolocationError(null);
      // A heartbeat can come back terminal (stale, outside the polygon, or a
      // grace window that lapsed) — surface that instead of ticking on.
      apiRef.current.settle(result);
    } catch (error) {
      setGeolocationError(
        getErrorMessage(
          error,
          "Couldn't reach your device location. The session will expire if heartbeats keep failing.",
        ),
      );
    }
  }, []);

  // Recover the caller's live session after a remount. Mobile already does
  // this from the same list (`selectActiveSession`); web used to set the
  // timer only from `handleStart`, so a reload lost Stop and the offline
  // carve-out (#1747). Pause is a sub-state of ACTIVE (`paused_at`), not a
  // status. A missing zone still restores — the card already falls back to
  // "Study session" and Stop stays reachable.
  useEffect(() => {
    if (activeSession) return;
    const live = selectActiveSession(sessions);
    if (!live) return;
    if (dismissedSessionIdRef.current === live.id) return;

    lastForegroundRef.current = live.paused_at == null;
    setActiveSession(live);
    setActiveGeofenceId(live.geofence_id);
    setIsPaused(live.paused_at != null);
    setElapsedSeconds(creditedSeconds(live, new Date()));
  }, [sessions, activeSession]);

  // Mirror foreground state to the server. A hidden tab or a manual pause is
  // the web adaptation of the mobile background signal — the server owns the
  // grace window from there, so pausing locally without telling it is exactly
  // what let background time count as study time
  // (spec/behavior/study-sessions.md § Anti-Distraction).
  useEffect(() => {
    if (!activeSession) {
      // Do not reset lastForegroundRef here. Restore seeds it on the same
      // first paint, before setState has flushed; clobbering that seed made a
      // restored pause look like a fresh background and POST /pause (#1747).
      return;
    }

    const foreground = !isPaused && !pageHidden;
    // Idempotent on re-render: only an actual transition reaches the server.
    if (foreground === lastForegroundRef.current) return;
    lastForegroundRef.current = foreground;

    // Deliberately no cancellation flag: the response is the only way
    // PAUSED_EXPIRED reaches this page, so it must still be handled after a
    // re-render. Staleness is judged by session identity instead, which a
    // re-render does not change.
    const issuedFor = activeSession.id;
    void (async () => {
      try {
        const result = foreground
          ? await (async () => {
              const pos = await getCurrentPosition();
              // Resume DTO is lat/lng only — accuracy_meters is heartbeat-only
              // (`forbidNonWhitelisted` 400s an undeclared key).
              return apiRef.current.resume(latLngOf(pos.coords));
            })()
          : await apiRef.current.pause();
        if (activeSessionIdRef.current !== issuedFor) return;
        setGeolocationError(null);
        apiRef.current.settle(result);
      } catch (error) {
        if (activeSessionIdRef.current !== issuedFor) return;
        // Roll the ref back so the next transition retries instead of believing
        // the server agrees with us. A pause that silently failed would let
        // background time accrue again — the whole hole being closed here.
        lastForegroundRef.current = !foreground;
        setGeolocationError(
          getErrorMessage(
            error,
            foreground
              ? "Couldn't resume the session. It will expire if you don't return soon."
              : "Couldn't reach the server to pause. Your session may expire.",
          ),
        );
      }
    })();
  }, [activeSession, isPaused, pageHidden]);

  // Start / stop the 1-second elapsed timer and the 5-minute heartbeat
  // interval based on visibility + pause state. The server also expires
  // sessions after 10 stale minutes, so the client aligns with that.
  useEffect(() => {
    if (!activeSession) return undefined;
    const shouldRun = !isPaused && !pageHidden;

    if (shouldRun) {
      elapsedTimerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
      heartbeatTimerRef.current = setInterval(() => {
        void sendHeartbeat();
      }, HEARTBEAT_INTERVAL_MS);
    }
    return () => {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
    };
  }, [activeSession, isPaused, pageHidden, sendHeartbeat]);

  // Stop the session automatically when the tab unloads. This matches the
  // documented web behavior: closing the tab ends the session (there's no
  // background heartbeat to keep it alive).
  useEffect(() => {
    if (!activeSession) return undefined;
    function handleUnload() {
      // Best-effort, and ungated for the same reason as the heartbeat: closing
      // a tab is not an affordance this page can disable.
      // sendBeacon would be better but the API auth flow expects a bearer token
      // on a real fetch; using the mutation here works for most browsers that
      // keep pending fetches during pagehide.
      void stopSession.mutateAsync().catch(() => undefined);
    }
    window.addEventListener("pagehide", handleUnload);
    return () => window.removeEventListener("pagehide", handleUnload);
  }, [activeSession, stopSession]);

  async function handleStart() {
    const zoneId = selectedGeofenceId || geofences[0]?.id || "";
    if (!zoneId) {
      toast({
        title: "No study zones available",
        description:
          "Ask an admin to create a study zone before starting a session.",
        variant: "destructive",
      });
      return;
    }
    try {
      const pos = await getCurrentPosition();
      const session = await startSession.mutateAsync({
        geofence_id: zoneId,
        ...latLngOf(pos.coords),
      });
      const normalized =
        session && typeof session === "object"
          ? (session as StudySession)
          : null;
      dismissedSessionIdRef.current = null;
      lastForegroundRef.current = true;
      setActiveSession(normalized);
      setActiveGeofenceId(zoneId);
      setElapsedSeconds(0);
      setIsPaused(false);
      setGeolocationError(null);
      toast({
        title: "Study session started",
        description:
          "Heartbeats fire every five minutes. Keep this tab open. Closing it ends the session.",
      });
    } catch (error) {
      toast({
        title: "Couldn't start study session",
        description: getErrorMessage(
          error,
          "Allow location access and try again.",
        ),
        variant: "destructive",
      });
    }
  }

  async function handleStop() {
    if (!activeSession) return;
    try {
      await stopSession.mutateAsync();
      toast({
        title: "Study session ended",
        description:
          "Points are awarded if you met the minimum session length. Check Points to see the ledger.",
      });
    } catch (error) {
      toast({
        title: "Couldn't stop session",
        description: getErrorMessage(
          error,
          "Retry in a moment. The server may have already expired the session.",
        ),
        variant: "destructive",
      });
    } finally {
      dismissedSessionIdRef.current = activeSession.id;
      lastForegroundRef.current = true;
      setActiveSession(null);
      setActiveGeofenceId(null);
      setElapsedSeconds(0);
      setIsPaused(false);
    }
  }

  /*
   * README §4 item 4: a network-dependent async view ships an offline state.
   * This screen had none, so a disconnected member sat on the loading
   * skeleton until the query gave up. Copy is writing.md §7's row.
   *
   * **Not while a session is running.** This screen's own invariant, stated
   * on the Pause/Stop controls below, is that a member is never pinned to a
   * live timer they cannot end — which is exactly why those two writes are
   * deliberately ungated. Replacing the whole page with an offline card would
   * enforce the same trap by unmounting instead of disabling, and losing
   * network mid-session (a dead zone, a lift, weak house wifi) is the likeliest
   * way to reach it. A running session keeps its card, its badges and its Stop
   * button; `stopSession`'s `finally` clears the session locally even when the
   * server refuses, so ending it offline works.
   */
  /*
   * `!activeSession` reads like a cache test and is not one — `activeSession`
   * is local `useState` (see its declaration above), so on its own this
   * branch blanked the screen for every offline member without a running
   * timer, cached zones or not. The cache test is `anyReadUncached`; the
   * running-session carve-out documented above is unchanged.
   */
  if (
    isOffline &&
    !activeSession &&
    anyReadUncached(geofencesQuery, sessionsQuery)
  ) {
    return (
      <>
        <OfflineState
          title="Study hours unavailable offline"
          description="Reconnect to start a session. Tracking needs a live location check."
          onRetry={() => {
            void geofencesQuery.refetch();
            void sessionsQuery.refetch();
          }}
        />
      </>
    );
  }

  if (geofencesQuery.isPending || sessionsQuery.isPending) {
    return (
      <>
        <LoadingState message="Loading study zones..." />
      </>
    );
  }

  if (geofencesQuery.isError || sessionsQuery.isError) {
    return (
      <>
        <ErrorState
          title="Couldn't load study data"
          description="Confirm your chapter access and retry."
          onRetry={() => {
            void geofencesQuery.refetch();
            void sessionsQuery.refetch();
          }}
        />
      </>
    );
  }

  return (
    <div className="space-y-6">
      {/*
        Disable, don't hide (§5 rule 4): session history is a read and stays
        visible, so the notice sits above both the live session and the starter
        to explain why its controls went dead.
      */}
      <SubscriptionNotice gate={gate} feature="study sessions" />

      {/*
        Flush, not carded (README § Page grammar). The page opened on a
        paragraph restating the visibility rules, and each of its three
        `<Card>`s carried a description or footer narrating itself. What a
        member needs before starting is one consequence, kept as the caption
        beside Start; the grace window is reported live once it applies.

        The running timer is the one framed block: it is the page's focal
        element, so it takes the hairline frame on `--surface-1` that billing's
        plan panel uses, never a `--card` Card.
      */}
      {activeSession ? (
        <section
          aria-labelledby="study-live-label"
          className={`space-y-4 rounded-[14px] border bg-surface-1 p-5 ${
            pageHidden ? "border-warning/45" : "border-border"
          }`}
        >
          <div className="space-y-1">
            <h2
              id="study-live-label"
              className="flex items-center gap-2 text-base font-semibold"
            >
              <StudyZonesGlyph className="h-4 w-4 text-muted-foreground" />
              {activeGeofence?.name ?? "Study session"}
            </h2>
            <p className="text-caption text-muted-foreground">
              {activeGeofence
                ? `${activeGeofence.points_per_interval} pt every ${activeGeofence.minutes_per_point} min (min ${activeGeofence.min_session_minutes} min).`
                : "Live session in progress."}
            </p>
          </div>
          {/*
            foundations §7's `display` role. No mono: §7's own callout retired
            it for this numeral, and the Canvas reference (s10) draws the
            running timer in Figtree 700 with tabular-nums in `accent-text`.
          */}
          <div className="text-display font-bold tabular-nums tracking-tight text-accent-text">
            {formatDuration(elapsedSeconds)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {pageHidden ? (
              <Badge variant="warning" className="gap-1">
                <EyeOff className="h-3 w-3" /> Paused (tab hidden)
              </Badge>
            ) : (
              <Badge variant="success" className="gap-1">
                <Eye className="h-3 w-3" /> Tracking
              </Badge>
            )}
            {isPaused ? (
              <Badge variant="warning" className="gap-1">
                <Pause className="h-3 w-3" /> Manually paused
              </Badge>
            ) : null}
            {geolocationError ? (
              <Badge variant="destructive">
                Location error: the session may expire
              </Badge>
            ) : null}
          </div>
          {isPaused || pageHidden ? (
            <p className="text-caption text-muted-foreground">
              Return within {activeGeofence?.pause_grace_minutes ?? 5} min or
              the session expires.
            </p>
          ) : null}
          {geolocationError ? (
            <p className="text-caption text-destructive">{geolocationError}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {/*
              Pause/Resume and Stop are deliberately NOT gated, unlike Start.
              They act on a session that is already running, and Stop is the
              only thing that clears `activeSession` locally — its `finally`
              block runs even when the server rejects. Disabling them on a
              mid-session lapse would pin the member to a live timer they cannot
              end from the UI, while the ungated 5-minute heartbeat keeps
              firing; the only way out would be closing the tab, which fires the
              very same stop write from the `pagehide` handler. Every dialog on
              this surface leaves Cancel ungated for the same reason: never gate
              the way out.
            */}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setIsPaused((prev) => !prev)}
            >
              {isPaused ? (
                <Play className="h-4 w-4" />
              ) : (
                <Pause className="h-4 w-4" />
              )}
              {isPaused ? "Resume timer" : "Pause timer"}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => void handleStop()}
              disabled={stopSession.isPending}
            >
              {stopSession.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Square className="h-4 w-4" />
              )}
              Stop &amp; award points
            </Button>
          </div>
        </section>
      ) : (
        <section aria-labelledby="study-start-label" className="space-y-3">
          <SectionLabel id="study-start-label">Start a session</SectionLabel>
          {geofences.length === 0 ? (
            <NestedEmpty
              title="No active study zones"
              description="Ask an officer who manages study zones to add one."
            />
          ) : (
            <div className="space-y-2">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,20rem)_auto] sm:items-end sm:justify-start">
                <div className="grid gap-1">
                  <label
                    htmlFor="study-geofence"
                    className="text-caption text-muted-foreground"
                  >
                    Study zone
                  </label>
                  {/*
                    Left live: picking a zone is local state, not a write, and
                    the Start button next to it is what the gate stops.
                  */}
                  <Select
                    value={selectedGeofenceId || geofences[0]?.id || ""}
                    onValueChange={setSelectedGeofenceId}
                  >
                    <SelectTrigger id="study-geofence">
                      <SelectValue placeholder="Pick a study zone" />
                    </SelectTrigger>
                    <SelectContent>
                      {geofences.map((zone) => (
                        <SelectItem key={zone.id} value={zone.id}>
                          {zone.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={() => void handleStart()}
                  {...gate.controlProps(startSession.isPending)}
                >
                  {startSession.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  Start session
                </Button>
              </div>
              <p className="text-caption text-muted-foreground">
                Hiding this tab pauses the session. Closing it ends the session.
              </p>
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="study-history-label" className="space-y-3">
        <SectionLabel
          id="study-history-label"
          count={
            sessions.length > 0
              ? `${sessions.length} session${sessions.length === 1 ? "" : "s"}`
              : null
          }
        >
          Session history
        </SectionLabel>
        {sessions.length === 0 ? (
          <NestedEmpty
            title="No sessions logged yet"
            description="Start a tracked session inside a study zone to start earning study points."
          />
        ) : (
          <ul className={denseListClassName}>
            {sessions.map((session) => {
              // The house range shape: "Tue, Nov 3 · 12:30 – 2:10 AM". A
              // session still running has no end, and reads as its start.
              const when = formatDayTimeRange(
                session.start_time,
                session.end_time,
              );
              return (
                <li
                  key={session.id}
                  className="flex min-h-11 flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold tabular-nums">
                      {formatMinutesRounded(session.total_foreground_minutes)}
                    </p>
                    {when ? (
                      <p className="text-caption text-muted-foreground">
                        {when}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={studySessionStatusKind(session.status)}>
                      {studySessionStatusLabel(session.status)}
                    </Badge>
                    {session.points_awarded ? (
                      <Badge variant="outline">Points awarded</Badge>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
