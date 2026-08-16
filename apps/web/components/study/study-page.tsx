"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Eye,
  EyeOff,
  Loader2,
  MapPin,
  Pause,
  Play,
  Square,
} from "lucide-react";
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
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/async-states";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useToast } from "@/hooks/use-toast";
import { asArray, getErrorMessage } from "@/lib/utils";

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
    | "ACTIVE"
    | "COMPLETED"
    | "EXPIRED"
    | "PAUSED_EXPIRED"
    | "LOCATION_INVALID";
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

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes, matches mobile

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

function formatShortDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
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
            : `Ended as ${session.status}.`,
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
      const result = await apiRef.current.heartbeat({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      });
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

  // Mirror foreground state to the server. A hidden tab or a manual pause is
  // the web adaptation of the mobile background signal — the server owns the
  // grace window from there, so pausing locally without telling it is exactly
  // what let background time count as study time
  // (spec/behavior/study-sessions.md § Anti-Distraction).
  const lastForegroundRef = useRef(true);

  useEffect(() => {
    if (!activeSession) {
      lastForegroundRef.current = true;
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
              return apiRef.current.resume({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
              });
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
        description: "Ask an admin to create a study zone before starting a session.",
        variant: "destructive",
      });
      return;
    }
    try {
      const pos = await getCurrentPosition();
      const session = await startSession.mutateAsync({
        geofence_id: zoneId,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      });
      const normalized =
        session && typeof session === "object"
          ? (session as StudySession)
          : null;
      setActiveSession(normalized);
      setActiveGeofenceId(zoneId);
      setElapsedSeconds(0);
      setIsPaused(false);
      setGeolocationError(null);
      toast({
        title: "Study session started",
        description:
          "Heartbeats fire every five minutes. Don't close this tab — closing it ends the session.",
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
          "Points are awarded if you met the minimum session length. Check /points to see the ledger.",
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
      setActiveSession(null);
      setActiveGeofenceId(null);
      setElapsedSeconds(0);
      setIsPaused(false);
    }
  }

  if (geofencesQuery.isPending || sessionsQuery.isPending) {
    return <LoadingState message="Loading study zones..." />;
  }

  if (geofencesQuery.isError || sessionsQuery.isError) {
    return (
      <ErrorState
        title="Couldn't load study data"
        description="Confirm your chapter access and retry."
        onRetry={() => {
          void geofencesQuery.refetch();
          void sessionsQuery.refetch();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Study hours</h2>
        <p className="text-sm text-muted-foreground">
          Start a tracked study session inside a chapter study zone. Hiding the
          tab pauses the session on the server — time stops counting, and if you
          don&apos;t come back within the study zone&apos;s grace window the
          session expires with only the minutes you actually studied. Closing
          the tab ends it outright.
        </p>
      </header>

      {/*
        Disable, don't hide (§5 rule 4): session history is a read and stays
        visible, so the notice sits above both the live-session card and the
        starter to explain why its controls went dead.
      */}
      <SubscriptionNotice gate={gate} feature="study sessions" />

      {activeSession ? (
        <Card
          className={pageHidden ? "border-amber-500/40 bg-amber-500/5" : ""}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              {activeGeofence?.name ?? "Study session"}
            </CardTitle>
            <CardDescription>
              {activeGeofence
                ? `${activeGeofence.points_per_interval} pt every ${activeGeofence.minutes_per_point} min (min ${activeGeofence.min_session_minutes} min).`
                : "Live session in progress."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-4xl font-mono font-bold tabular-nums tracking-tight">
              {formatDuration(elapsedSeconds)}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {pageHidden ? (
                <Badge variant="outline" className="gap-1">
                  <EyeOff className="h-3 w-3" /> Paused (tab hidden)
                </Badge>
              ) : (
                <Badge variant="default" className="gap-1">
                  <Eye className="h-3 w-3" /> Tracking
                </Badge>
              )}
              {isPaused ? (
                <Badge variant="outline" className="gap-1">
                  <Pause className="h-3 w-3" /> Manually paused
                </Badge>
              ) : null}
              {isPaused || pageHidden ? (
                <Badge variant="secondary">
                  Return within {activeGeofence?.pause_grace_minutes ?? 5} min
                  or the session expires
                </Badge>
              ) : null}
              {geolocationError ? (
                <Badge variant="destructive">
                  Location error — the session may expire
                </Badge>
              ) : null}
            </div>
            {geolocationError ? (
              <p className="text-xs text-destructive">{geolocationError}</p>
            ) : null}
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2">
            {/*
              Toggling this fires POST /study-sessions/pause or /resume through
              the effect above, so it is a write like any other and gates with
              the rest (§5 "gate every write on the surface").
            */}
            <Button
              variant="outline"
              onClick={() => setIsPaused((prev) => !prev)}
              {...gate.controlProps()}
            >
              {isPaused ? (
                <Play className="h-4 w-4" />
              ) : (
                <Pause className="h-4 w-4" />
              )}
              {isPaused ? "Resume timer" : "Pause timer"}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleStop()}
              {...gate.controlProps(stopSession.isPending)}
            >
              {stopSession.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Square className="h-4 w-4" />
              )}
              Stop &amp; award points
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Start a session</CardTitle>
            <CardDescription>
              Pick an active study zone. Your browser will ask for location
              permission so we can confirm you&apos;re inside the polygon.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {geofences.length === 0 ? (
              <EmptyState
                title="No active study zones"
                description="Ask a chapter admin with geofences:manage to add one."
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="grid gap-1">
                  <label
                    htmlFor="study-geofence"
                    className="text-xs uppercase tracking-wide text-muted-foreground"
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
            )}
          </CardContent>
          <CardFooter className="text-xs text-muted-foreground">
            Closing this tab ends the session — that&apos;s a deliberate web
            adaptation of the mobile foreground rule. Use the mobile app for
            longer sessions or when you expect to switch tabs frequently.
          </CardFooter>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Session history</CardTitle>
          <CardDescription>Your recent tracked sessions.</CardDescription>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <EmptyState
              title="No sessions logged yet"
              description="Start a tracked session inside a study zone to start earning study points."
            />
          ) : (
            <ul className="divide-y divide-border/70">
              {sessions.map((session) => (
                <li
                  key={session.id}
                  className="flex flex-col gap-1 py-3 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {session.total_foreground_minutes} minute
                      {session.total_foreground_minutes === 1 ? "" : "s"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Started {formatShortDate(session.start_time)}
                      {session.end_time
                        ? ` · Ended ${formatShortDate(session.end_time)}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        session.status === "COMPLETED"
                          ? "default"
                          : session.status === "ACTIVE"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {session.status}
                    </Badge>
                    {session.points_awarded ? (
                      <Badge variant="outline">Points awarded</Badge>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
