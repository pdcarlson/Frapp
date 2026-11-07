"use client";

/**
 * The live product half of the signed-out frame (`auth-frame.tsx`).
 *
 * A short #general scene plays inside a drawn Frapp window: a meeting starts
 * and the check-in count climbs, an officer hands a task to a member who
 * finishes it, and a poll fills in. Paul picked this direction on 2026-11-05
 * over a faked Ask answer and a drifting card stream: everything it draws is a
 * feature members can use in the beta.
 *
 * **What it may draw is bounded by `spec/behavior/`, like the landing frames**
 * (`spec/ui/landing/README.md`, "What the frames may draw"). The event card
 * carries Check in and a checked-in count and nothing else, because RSVP intent
 * is not modelled; no dues card appears, because that renderer is a stub; and
 * there is no Ask surface, because Ask is not built. The cards reuse the chat
 * renderers' own parts (`Card`, `MESSAGE_CARD`, `EYEBROW`, `Badge`, the meter
 * classes and the nav glyphs) so the picture cannot drift far from the app.
 * The renderers themselves are not mounted: each one reads a real message and
 * mutates through the API. The words follow the app's too: the task badge
 * reads `@repo/hooks`' labels, and the typing line names nobody, sitting above
 * the composer as `chat-shell.tsx` puts it.
 *
 * **It is an officer's view of a meeting in progress.** The checked-in count
 * is shown only to members who can read attendance (`event-card.tsx`), and
 * Check in is offered only inside the event window (`spec/behavior/events.md`),
 * so every post lands after the meeting's 8:00 start.
 *
 * **It is a picture, so it is hidden from assistive tech.** The panel is
 * `aria-hidden`, holds nothing focusable (every "button" is a `span` drawn
 * with `buttonVariants`), and the page's one `<h1>` stays the form's.
 *
 * **Motion.** The scene is one clock, `t` in milliseconds, and everything on
 * screen is a pure function of it, so the finished frame is just `t = FINAL`.
 * The server renders that frame, which keeps the first paint complete; with
 * motion allowed it holds for a moment, fades, and the scene plays from the
 * top and loops. Under `prefers-reduced-motion` it never leaves the finished
 * frame, and below `lg`, where the frame hides the panel, the clock never
 * starts. Entrances use the theme's `fade-up` and `count-up` utilities (the
 * `@repo/theme` motion scale) behind `motion-safe:`. A looping showcase is not
 * one of #3493's once-per-flow signature moments; `spec/ui/web-dashboard`
 * records the distinction.
 */

import { useEffect, useState } from "react";
import { Check, CheckCircle2 } from "lucide-react";
import { taskStatusLabel } from "@repo/hooks";
import type { TaskStatus } from "@repo/hooks";
import {
  EventsGlyph,
  LocationGlyph,
  TasksGlyph,
} from "@/components/chat/chat-glyphs";
import { EYEBROW, MESSAGE_CARD } from "@/components/chat/chip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { STATUS_BADGE } from "@/components/chat/renderers/task-card";
import {
  meterFillClassName,
  meterTrackDenseClassName,
} from "@/components/shared/meter";
import { cn } from "@/lib/utils";

/* ── The clock ─────────────────────────────────────────────────────────── */

const AT = {
  meetingPost: 400,
  eventCard: 1300,
  checkInFrom: 2000,
  checkInTo: 3500,
  typing: 4300,
  taskPost: 5400,
  taskCard: 6200,
  taskStarted: 7200,
  taskDone: 8400,
  taskConfirmed: 9200,
  pollPost: 9900,
  votesFrom: 10500,
  votesTo: 12500,
} as const;

/** The finished frame: every row posted, every count landed. */
export const SHOWCASE_FINAL = 12900;
const HOLD_UNTIL = SHOWCASE_FINAL + 3400;
const FADE_MS = 500;
const LOOP_AT = HOLD_UNTIL + FADE_MS;

const CHECKED_IN = { from: 12, to: 31 } as const;
const VOTES = { casino: 21, masquerade: 15 } as const;

function progress(t: number, from: number, to: number): number {
  if (t <= from) return 0;
  if (t >= to) return 1;
  return (t - from) / (to - from);
}

/** Every time something on screen changes, sorted, so the clock can sleep between them. */
const BEATS: number[] = (() => {
  const beats = new Set<number>([
    0,
    ...Object.values(AT),
    SHOWCASE_FINAL,
    HOLD_UNTIL,
    LOOP_AT,
  ]);
  for (let at = AT.checkInFrom; at <= AT.checkInTo; at += 80) beats.add(at);
  for (let at = AT.votesFrom; at <= AT.votesTo; at += 100) beats.add(at);
  return [...beats].sort((a, b) => a - b);
})();

function nextBeat(t: number): number | undefined {
  return BEATS.find((beat) => beat > t);
}

/**
 * The scene's clock. Starts on the finished frame (what the server renders),
 * then runs only when motion is allowed, the panel is on screen (`lg` and up,
 * matching `auth-frame.tsx`) and the tab is visible.
 */
function useSceneClock(): number {
  const [t, setT] = useState<number>(SHOWCASE_FINAL);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const shown = window.matchMedia("(min-width: 1024px)");
    const sync = () => {
      setRunning(
        !reduce.matches &&
          shown.matches &&
          document.visibilityState === "visible",
      );
      if (reduce.matches || !shown.matches) setT(SHOWCASE_FINAL);
    };
    sync();
    reduce.addEventListener("change", sync);
    shown.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      reduce.removeEventListener("change", sync);
      shown.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    const next = nextBeat(t);
    const target = next === undefined || next >= LOOP_AT ? 0 : next;
    const wait = (next ?? LOOP_AT) - t;
    const id = window.setTimeout(() => setT(target), Math.max(wait, 0));
    return () => window.clearTimeout(id);
  }, [t, running]);

  return t;
}

/* ── The drawing ───────────────────────────────────────────────────────── */

const ENTER = "motion-safe:animate-fade-up";

/** The house gold, never the accent slot: these routes have no chapter. */
const PANEL_STYLE: React.CSSProperties = {
  backgroundImage: [
    "radial-gradient(70% 60% at 90% -5%, color-mix(in srgb, var(--gold-house) 16%, transparent), transparent 70%)",
    "radial-gradient(50% 45% at 0% 105%, color-mix(in srgb, var(--gold-house) 7%, transparent), transparent 70%)",
  ].join(", "),
};

function Row({
  initials,
  author,
  time,
  children,
}: {
  initials: string;
  author: string;
  time: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex gap-3", ENTER)}>
      <Avatar className="h-8 w-8">
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-baseline gap-2 leading-5">
          <span className="truncate text-sm font-semibold text-foreground">
            {author}
          </span>
          <span className="shrink-0 text-caption leading-5 text-muted-foreground">
            {time}
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return <p className="mt-0.5 text-base text-foreground">{children}</p>;
}

function EventCard({ t }: { t: number }) {
  const checkedIn = Math.round(
    CHECKED_IN.from +
      (CHECKED_IN.to - CHECKED_IN.from) * progress(t, AT.checkInFrom, AT.checkInTo),
  );
  return (
    <Card className={cn(MESSAGE_CARD, ENTER)}>
      <div className={cn(EYEBROW, "flex items-center gap-1.5 text-accent-text")}>
        <EventsGlyph className="h-4 w-4" /> Event
      </div>
      <p className="mt-2 text-base font-bold">Chapter meeting</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
        <span>Today, 8:00 – 9:00 PM</span>
        <span aria-hidden="true">·</span>
        <span className="inline-flex items-center gap-1">
          <LocationGlyph className="h-4 w-4" />
          Upstairs lounge
        </span>
        <Badge variant="outline">+10 pts</Badge>
      </div>
      <p className="mt-2 text-caption tabular-nums text-muted-foreground">
        {checkedIn} checked in
      </p>
      <div className="mt-3 flex">
        <span className={buttonVariants({ size: "sm" })}>
          <Check className="h-4 w-4" />
          Check in
        </span>
      </div>
    </Card>
  );
}

function TaskCard({ t }: { t: number }) {
  const status: TaskStatus =
    t >= AT.taskDone ? "COMPLETED" : t >= AT.taskStarted ? "IN_PROGRESS" : "TODO";
  const confirmed = t >= AT.taskConfirmed;
  const label = taskStatusLabel({ status, points_awarded: confirmed });
  return (
    <Card className={cn(MESSAGE_CARD, ENTER)}>
      <div className="flex items-center justify-between gap-6">
        <div className={cn(EYEBROW, "flex items-center gap-1.5 text-accent-text")}>
          <TasksGlyph className="h-4 w-4" /> Task
        </div>
        {/* Keyed on the status so each change re-enters, which is the scene's one flourish. */}
        <Badge
          key={label}
          variant={STATUS_BADGE[status]}
          className="motion-safe:animate-count-up gap-1"
        >
          {confirmed ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
          {label}
        </Badge>
      </div>
      <p className="mt-2 text-base font-bold">Grab the projector from the library</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
        <span>Sam Okafor → Eli Park</span>
        <span aria-hidden="true">·</span>
        <span>Due today</span>
        <Badge variant="outline">+5 pts</Badge>
      </div>
    </Card>
  );
}

function PollCard({ t }: { t: number }) {
  const p = progress(t, AT.votesFrom, AT.votesTo);
  const options = [
    { label: "Casino night", count: Math.round(VOTES.casino * p) },
    { label: "Masquerade", count: Math.round(VOTES.masquerade * p) },
  ];
  const total = options.reduce((sum, option) => sum + option.count, 0);
  return (
    <Card className={cn(MESSAGE_CARD, "w-72", ENTER)}>
      <p className={cn(EYEBROW, "text-muted-foreground")}>Poll</p>
      <div className="mt-2 text-base font-bold">Formal theme?</div>
      <ul className="mt-3 space-y-2">
        {options.map((option) => {
          const pct = total > 0 ? Math.round((option.count / total) * 100) : 0;
          return (
            <li key={option.label}>
              <span
                className={cn(
                  buttonVariants({ variant: "secondary", size: "sm" }),
                  "w-full justify-between gap-2",
                )}
              >
                <span className="truncate">{option.label}</span>
                <span className="tabular-nums">
                  {option.count} · {pct}%
                </span>
              </span>
              <div className={cn("mt-1", meterTrackDenseClassName)}>
                <div
                  className={cn(meterFillClassName, "transition-[width] duration-200")}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-caption tabular-nums text-muted-foreground">
        {total === 0 ? "No votes yet." : `${total} votes`}
      </p>
    </Card>
  );
}

/** `chat-shell.tsx`'s line, word for word: typing names nobody. */
function Typing() {
  return (
    <p className="shrink-0 px-5 pb-1 text-caption text-muted-foreground motion-safe:animate-fade-in">
      Someone is typing…
    </p>
  );
}

const CHANNELS = ["general", "announcements", "social", "philanthropy"] as const;

/**
 * The scene's frame: a chapter rail from `xl` up (below it the thread column
 * would be too narrow for a card), the channel header, the bottom-aligned
 * thread, and a composer.
 */
export function ChapterShowcase({ className }: { className?: string }) {
  const t = useSceneClock();
  const fading = t >= HOLD_UNTIL;

  return (
    <aside aria-hidden="true" className={className}>
      <div
        className="relative flex h-full flex-col gap-8 overflow-hidden rounded-xl border border-border bg-surface-1 p-10"
        style={PANEL_STYLE}
      >
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-background">
          <div className="hidden w-44 shrink-0 flex-col gap-0.5 border-r border-border p-3 text-sm xl:flex">
            <div className="flex items-center gap-2 px-2 pb-3 font-bold text-foreground">
              <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-accent-subtle text-caption font-bold text-accent-text">
                N
              </span>
              Northfield
            </div>
            {CHANNELS.map((channel) => (
              <div
                key={channel}
                className={cn(
                  "truncate rounded-sm px-2 py-1.5",
                  channel === "general"
                    ? "bg-card font-semibold text-foreground"
                    : "text-muted-foreground",
                )}
              >
                # {channel}
              </div>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-5">
              <span className="font-bold text-foreground"># general</span>
              <span className="text-caption text-muted-foreground">48 members</span>
            </div>
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col justify-end gap-4 overflow-hidden px-5 py-4 transition-opacity duration-500",
                fading && "opacity-0",
              )}
              style={{
                maskImage: "linear-gradient(to bottom, transparent, black 18%)",
              }}
            >
              {t >= AT.meetingPost ? (
                <Row initials="JR" author="Jordan Reyes" time="8:01 PM">
                  <Body>Starting now. Check in so you get your points.</Body>
                  {t >= AT.eventCard ? <EventCard t={t} /> : null}
                </Row>
              ) : null}
              {t >= AT.taskPost ? (
                <Row initials="SO" author="Sam Okafor" time="8:03 PM">
                  <Body>Eli, can you grab the projector from the library?</Body>
                  {t >= AT.taskCard ? <TaskCard t={t} /> : null}
                </Row>
              ) : null}
              {t >= AT.pollPost ? (
                <Row initials="MK" author="Maya Kim" time="8:06 PM">
                  <Body>Formal theme. Vote before Friday.</Body>
                  <PollCard t={t} />
                </Row>
              ) : null}
            </div>
            {t >= AT.typing && t < AT.taskPost ? <Typing /> : null}
            <div className="mx-5 mb-4 flex h-11 shrink-0 items-center rounded-md border border-border px-4 text-sm text-muted-foreground">
              Message #general
            </div>
          </div>
        </div>
        <div className="shrink-0">
          <p className="text-headline font-bold tracking-tight text-foreground">
            Your whole chapter runs in chat.
          </p>
          <p className="mt-2 max-w-md text-base text-muted-foreground">
            Events, tasks and polls show up right in the conversation, so nobody
            has to go looking.
          </p>
        </div>
      </div>
    </aside>
  );
}
