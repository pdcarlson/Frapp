"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import {
  useAccessibleChapters,
  useCurrentChapter,
  useLegalAcceptance,
  usePickableRoles,
  useUpdateOnboarding,
  useViewerUserId,
} from "@repo/hooks";
import { signetDarkTokens } from "@repo/theme/signet";
import { isCheckoutLandingPath } from "@/components/billing/billing-paths";
import {
  TOUR_BACK_LABEL,
  TOUR_DONE_LABEL,
  TOUR_REPLAY_EVENT,
  TOUR_NEXT_LABEL,
  TOUR_SKIPPED_TOAST,
  TOUR_SKIP_LABEL,
  clearTourStop,
  coachPosition,
  locateStop,
  nextPresentIndex,
  readTourStop,
  resumeIndex,
  scrimPath,
  tourOrder,
  tourProgressLabel,
  tourStopText,
  tourStops,
  tourStorageKey,
  writeTourStop,
  type Rect,
  type TourStop,
  type TourStopKey,
} from "@/components/onboarding/tour";
import { REDUCED_MOTION } from "@/components/chat/message-gif";
import { ChatDensityControl } from "@/components/profile/chat-density-control";
import { PickRolesList } from "@/components/roles/pick-roles-section";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/hooks/use-toast";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { useMediaQuery } from "@/lib/use-media-query";

type ChapterMembership = {
  chapter_id: string;
  has_completed_onboarding: boolean;
  chapter?: { name?: string | null };
};

/** The route the tour runs on: the Chat screen a member lands on. */
const TOUR_ROUTE = "/chat";

/**
 * How long the tour waits for the channel list before starting anyway on the
 * stops that are on screen (a chapter whose list failed to load).
 */
const START_WAIT_MS = 4000;

/** While it waits to start, the tour looks for its controls this often. */
const WAIT_POLL_MS = 150;

/**
 * The first-run tour over the real Chat screen (#5080; the stops and their
 * rules are in `tour.ts`). Mounted in `dashboard-shell.tsx`, and shown while
 * the active membership's `has_completed_onboarding` is false.
 *
 * Only Skip tour and Done end it, both PATCHing `/v1/members/me/onboarding`,
 * which also mirrors the phone's flag. Everything else pauses it: Escape, a
 * click on the dim, leaving Chat, a closed tab. A paused tour stays down for
 * the rest of this visit and picks up at its stop on the next one. Replay
 * tour (`replayTour`) lifts an end or a pause at once and starts it over.
 *
 * It never opens over the Terms prompt (#2302, #5083), and never on the
 * checkout landings (`isCheckoutLandingPath`, #2297), whose "Complete
 * checkout" it would cover. Running only on Chat already keeps it off those,
 * and the check stays so a change to the route rule can't undo that.
 *
 * WHO SEES IT: an invited member on their first visit, or anyone who chose
 * Replay tour in Settings → Account (`account-section.tsx` sets the flag
 * back to false). `ChapterService` writes a founder's own membership with the
 * flag already true, so the wizard's founder never sees it.
 */
export function OnboardingTour() {
  const pathname = usePathname();
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const chaptersQuery = useAccessibleChapters();
  const currentChapter = useCurrentChapter({
    chapterId: activeChapterId,
    enabled: Boolean(activeChapterId),
  });
  const legalAcceptance = useLegalAcceptance();
  const userId = useViewerUserId();
  const updateOnboarding = useUpdateOnboarding();
  const { toast } = useToast();

  // Ended here, ahead of the server round trip, so the tour doesn't sit on
  // screen until `GET /v1/chapters` refetches.
  const [ended, setEnded] = useState(false);
  const [paused, setPaused] = useState(false);
  // The route the tour was open on. Leaving it pauses the tour, read in
  // render so the pause lands with the navigation, not a frame after it.
  const [shownOn, setShownOn] = useState<string | null>(null);
  if (shownOn !== null && pathname !== shownOn && !paused) setPaused(true);

  // Replay tour, from Settings in this same visit: this component stays
  // mounted across dashboard routes, so its end and pause are lifted here
  // rather than waiting for a reload (the saved stop is already cleared).
  useEffect(() => {
    const onReplay = () => {
      setEnded(false);
      setPaused(false);
      setShownOn(null);
    };
    window.addEventListener(TOUR_REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(TOUR_REPLAY_EVENT, onReplay);
  }, []);

  const activeMembership = useMemo(() => {
    const memberships = Array.isArray(chaptersQuery.data)
      ? (chaptersQuery.data as ChapterMembership[])
      : [];
    if (!activeChapterId) return null;
    return (
      memberships.find((m) => m.chapter_id === activeChapterId) ??
      memberships[0] ??
      null
    );
  }, [activeChapterId, chaptersQuery.data]);

  const chapterName =
    (currentChapter.data as { name?: string | null } | undefined)?.name ??
    activeMembership?.chapter?.name ??
    null;

  const storageKey =
    userId && activeMembership
      ? tourStorageKey(userId, activeMembership.chapter_id)
      : null;

  const shouldShow =
    storageKey !== null &&
    activeMembership?.has_completed_onboarding === false &&
    !ended &&
    !paused &&
    pathname === TOUR_ROUTE &&
    !isCheckoutLandingPath(pathname) &&
    legalAcceptance.data?.required !== true;

  const onShown = useCallback(() => {
    setShownOn((current) => current ?? TOUR_ROUTE);
  }, []);
  const onPause = useCallback(() => setPaused(true), []);

  async function finish(skipped: boolean) {
    setEnded(true);
    if (storageKey) clearTourStop(storageKey);
    // Skip says how to come back (#5079), so a Skip pressed by accident isn't
    // the end of the tour.
    if (skipped) toast(TOUR_SKIPPED_TOAST);
    try {
      await updateOnboarding.mutateAsync({ has_completed_onboarding: true });
    } catch {
      // Non-fatal: the tour is already down for this visit, and the next one
      // re-reads the flag and offers it again if this never landed.
    }
  }

  if (!shouldShow || !storageKey) return null;

  return (
    <SpotlightTour
      key={storageKey}
      storageKey={storageKey}
      chapterName={chapterName}
      onShown={onShown}
      onPause={onPause}
      onFinish={(skipped) => void finish(skipped)}
    />
  );
}

type Layout = {
  key: TourStopKey;
  spot: Rect;
  text: string;
  /** The coach mark's corner; null until it has been measured. */
  card: { left: number; top: number } | null;
  /** The stops whose control is on screen. */
  present: readonly TourStopKey[];
  viewport: { width: number; height: number };
};

function sameLayout(a: Layout | null, b: Layout | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function SpotlightTour({
  storageKey,
  chapterName,
  onShown,
  onPause,
  onFinish,
}: {
  storageKey: string;
  chapterName: string | null;
  onShown: () => void;
  onPause: () => void;
  onFinish: (skipped: boolean) => void;
}) {
  const reducedMotion = useMediaQuery(REDUCED_MOTION);
  const { roles, isLoading: rolesLoading } = usePickableRoles();
  const [saved] = useState<TourStopKey | null>(() => readTourStop(storageKey));
  // Whether `Pick your roles` is in, settled as the member moves past the
  // display stop (the slideshow's rule, #4958): until then the stop lands
  // ahead of them, so a slow roles read still gets it in; after, the count
  // never grows behind them. A tour resumed past the display stop has settled
  // it; one resumed on the roles stop asks the roles read again, so roles
  // that stopped being joinable leave it out.
  const [offerRoles, setOfferRoles] = useState<boolean | null>(() =>
    saved && saved !== "roles" && tourOrder(saved) > tourOrder("display")
      ? false
      : null,
  );
  const withRoles = offerRoles ?? roles.some((role) => role.joinable);
  const stops = tourStops(withRoles);
  // The stop is held by name, not position: the list gains or loses the roles
  // stop as the read settles, and a name keeps the member where they are.
  const [stopKey, setStopKey] = useState<TourStopKey>(saved ?? "channels");
  const [layout, setLayout] = useState<Layout | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // The frame loop reads these rather than restarting on every change.
  const live = useRef({ stops, stopKey, rolesLoading });
  useEffect(() => {
    live.current = { stops, stopKey, rolesLoading };
  });

  // Follow the controls: measure every stop's control each frame, move past a
  // stop whose control has gone, and keep the spot and the coach mark on it
  // through scrolls, resizes and a list that loads in under it.
  useEffect(() => {
    const startedAt = performance.now();
    let started = false;
    let frame = 0;
    let timer = 0;
    let last: Layout | null = null;
    const schedule = () => {
      // Before it starts the tour only polls; once up it follows each frame.
      if (started) frame = requestAnimationFrame(tick);
      else timer = window.setTimeout(tick, WAIT_POLL_MS);
    };
    const tick = () => {
      schedule();
      const { stops: list, stopKey: at, rolesLoading: loading } = live.current;
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const located = list.map((stop) => locateStop(stop, document, viewport));
      const isPresent = (stop: TourStop) =>
        located[list.indexOf(stop)] !== null;
      if (!started) {
        // Wait for the roles read, so a tour resumed on its stop knows
        // whether it is still in, and for the channel list, so the first spot
        // lands on rows rather than the skeleton, unless it never comes.
        const waited = performance.now() - startedAt >= START_WAIT_MS;
        if (loading && !waited) return;
        if (located[0] === null && !waited) return;
        if (!list.some(isPresent)) return;
        started = true;
      }
      const from = resumeIndex(list, at);
      const showing =
        nextPresentIndex(list, from, 1, isPresent) ??
        nextPresentIndex(list, from, -1, isPresent);
      if (showing === null) {
        if (last !== null) setLayout((last = null));
        return;
      }
      const stop = list[showing]!;
      if (stop.key !== at) {
        live.current.stopKey = stop.key;
        setStopKey(stop.key);
      }
      const found = located[showing]!;
      const card = cardRef.current;
      const next: Layout = {
        key: stop.key,
        spot: found.spot,
        text: found.text,
        card:
          card && card.offsetWidth > 0
            ? coachPosition(
                found.spot,
                { width: card.offsetWidth, height: card.offsetHeight },
                viewport,
              )
            : null,
        present: list.filter(isPresent).map((s) => s.key),
        viewport,
      };
      if (!sameLayout(last, next)) setLayout((last = next));
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, []);

  const shownStop = layout
    ? stops.find((stop) => stop.key === layout.key)
    : undefined;
  const shown = Boolean(layout && shownStop);
  const shownKey = shownStop?.key;
  const measured = Boolean(layout?.card);

  // Kept as it moves, so a pause picks up here on the next visit.
  useEffect(() => {
    if (shownKey) writeTourStop(storageKey, shownKey);
  }, [shownKey, storageKey]);

  useEffect(() => {
    if (shown) onShown();
  }, [shown, onShown]);

  // Each stop takes focus once its card is placed (a hidden card can't take
  // focus), so a keyboard member reads it and tabs its buttons.
  useEffect(() => {
    if (shownKey && measured) cardRef.current?.focus({ preventScroll: true });
  }, [shownKey, measured]);

  useEffect(() => {
    if (!shown) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // A menu opened through the spot closes on Escape (Radix marks it
      // handled); that Escape is the menu's, not a pause.
      if (event.key === "Escape" && !event.defaultPrevented) onPause();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shown, onPause]);

  if (!layout || !shownStop || typeof document === "undefined") return null;

  const isPresent = (stop: TourStop) => layout.present.includes(stop.key);
  const index = stops.indexOf(shownStop);
  const nextIndex = nextPresentIndex(stops, index + 1, 1, isPresent);
  const backIndex = nextPresentIndex(stops, index - 1, -1, isPresent);
  const shownPresent = stops.filter(isPresent);
  const count = shownPresent.length;
  const position = shownPresent.indexOf(shownStop);

  const goNext = () => {
    if (nextIndex === null) return;
    const next = stops[nextIndex]!;
    // Moving past the display stop, or past where roles would sit (the
    // display stop skipped), settles whether roles is in.
    if (
      tourOrder(shownStop.key) >= tourOrder("display") ||
      tourOrder(next.key) > tourOrder("roles")
    ) {
      setOfferRoles((latched) => latched ?? withRoles);
    }
    setStopKey(next.key);
  };

  const move = reducedMotion
    ? undefined
    : `${signetDarkTokens.motion.duration.standard}ms ${signetDarkTokens.motion.easing.standard}`;
  const { spot } = layout;
  const titleId = `tour-title-${shownStop.key}`;
  const textId = `tour-text-${shownStop.key}`;

  return createPortal(
    <div data-onboarding-tour="" className="pointer-events-none fixed inset-0 z-50">
      {/*
        The dim's hit area: the window with the spot cut out (even-odd), so a
        click on the dim pauses the tour and a click in the spot reaches the
        real control under it. It paints nothing; the spot's shadow does.
      */}
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
        width={layout.viewport.width}
        height={layout.viewport.height}
      >
        <path
          data-tour-scrim=""
          d={scrimPath(spot, layout.viewport)}
          fill="none"
          fillRule="evenodd"
          style={{ pointerEvents: "fill" }}
          onClick={onPause}
        />
      </svg>
      {/*
        The lit spot. Its shadow is the dim: 55% black, no blur, so the rest
        of the screen stays legible. The edge is 2px of the chapter accent,
        2px out, radius 10.
      */}
      <div
        aria-hidden="true"
        data-tour-spot=""
        className="absolute rounded-[10px]"
        style={{
          left: spot.x,
          top: spot.y,
          width: spot.width,
          height: spot.height,
          boxShadow: "0 0 0 200vmax rgb(0 0 0 / 0.55)",
          outline: "2px solid var(--primary)",
          outlineOffset: 2,
          transition: move
            ? `left ${move}, top ${move}, width ${move}, height ${move}`
            : undefined,
        }}
      />
      {/*
        The coach mark: `--popover` with a hairline, radius 16, padding 16 and
        no shadow (the dim already lifts it). Not modal: the spot stays
        usable, and Escape pauses rather than ends.
      */}
      <div
        ref={cardRef}
        role="dialog"
        aria-labelledby={shownStop.title ? titleId : undefined}
        aria-label={shownStop.title ? undefined : "Tour"}
        aria-describedby={textId}
        tabIndex={-1}
        className="pointer-events-auto absolute grid w-[320px] max-w-[calc(100vw-16px)] gap-3 rounded-xl border border-border bg-popover p-4 text-foreground outline-none"
        style={{
          left: layout.card?.left ?? 0,
          top: layout.card?.top ?? 0,
          visibility: layout.card ? undefined : "hidden",
          transition: move ? `left ${move}, top ${move}` : undefined,
        }}
      >
        <p className="text-caption font-semibold text-muted-foreground">
          {tourProgressLabel(position, count)}
        </p>
        <div className="grid gap-1">
          {shownStop.title ? (
            <h2 id={titleId} className="text-sm font-semibold">
              {shownStop.title}
            </h2>
          ) : null}
          <p id={textId} className="text-sm text-muted-foreground">
            {tourStopText(layout.text, chapterName)}
          </p>
        </div>
        {shownStop.key === "display" ? <ChatDensityControl compact /> : null}
        {shownStop.key === "roles" ? (
          <div className="max-h-56 overflow-y-auto">
            <PickRolesList roles={roles} />
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => onFinish(true)}>
            {TOUR_SKIP_LABEL}
          </Button>
          <div className="flex gap-2">
            {backIndex !== null ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setStopKey(stops[backIndex]!.key)}
              >
                {TOUR_BACK_LABEL}
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={() => (nextIndex === null ? onFinish(false) : goNext())}
            >
              {nextIndex === null ? TOUR_DONE_LABEL : TOUR_NEXT_LABEL}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
