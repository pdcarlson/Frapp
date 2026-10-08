import { RevealOnView } from "../reveal-on-view";
import { type StaggerStyle } from "./styles";

/*
 * ── The two product frames ───────────────────────────────────────────────────
 *
 * Static JSX, never a screenshot and never a `next/image` call: the hero's LCP
 * element is the H1 and nothing on this page may become an image request
 * (`spec/ui/landing/README.md` § Performance). Each frame is one `role="img"`
 * with an `aria-label` that says what it shows, so a screen reader gets the
 * picture in a sentence instead of walking a tree of decorative divs, and each
 * carries a caption naming its contents as demo data.
 *
 * Type, spacing and radii INSIDE a frame are transcribed from the product
 * boards (`web-framework.dc.html` option 1b and `canvas-screens.dc.html` s06 /
 * s07) and are deliberately off the marketing scale and off the radius map.
 * Landing chrome is on the grid; frame internals are not. Do not "correct" them.
 * The chat thread's rows are the exception: `web-framework.dc.html` draws them
 * as the bubbles chat retired on 2026-09-29, so they follow `components.md`
 * § Chat messages instead (#2893). See the note above `RunStart`.
 *
 * What they may show is bounded by `spec/behavior/`, not by the boards. The
 * landing README's section inventory lists what that rules out
 * (`spec/ui/landing/README.md`, "What the frames may draw"); the rows below
 * note it where it bites.
 */

const threadRows = [
  { key: "open", kind: "them" as const },
  { key: "event", kind: "event" as const },
  { key: "reply", kind: "self" as const },
  { key: "mention", kind: "mention" as const },
];

/*
 * Chat's compact, bubble-free layout, as web and mobile have drawn it since
 * 2026-09-29 (`components.md` § Chat messages, #2873). Values are transcribed
 * from that section, not imported from `apps/web`.
 *
 * Every row here starts a run, for the reasons §11's grouping gives: the first
 * row always does; the event card is a card, which starts one even straight
 * after its author's own message; and the last two each change author. So
 * every row is a `RunStart`. A follow-on (same author within five minutes, no
 * card either side) would draw neither the avatar nor the author line.
 *
 * The body has no fill, border or padding; rows are told apart by the author
 * line and the 16px gap a run start takes.
 */
const AVATAR =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-popover text-[12.5px] font-bold text-muted-foreground";
const BODY = "text-[16px] leading-[25px] text-foreground";

/**
 * A run's first row: the 32px avatar, then an author line of name and time
 * (time only, never a date) over the body. The viewer's own run sits on the
 * left like everyone else's and reads "You" in `--accent-text`, which is how a
 * member spots it now that no accent fill marks it.
 */
function RunStart({
  initials,
  author,
  self = false,
  time,
  children,
}: {
  initials: string;
  author: string;
  self?: boolean;
  time: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 px-5 pb-0.5 pt-4">
      <span className={AVATAR}>{initials}</span>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="flex items-baseline gap-2 leading-5">
          <span
            className={`text-[14px] font-semibold ${
              self ? "text-accent-text" : "text-foreground"
            }`}
          >
            {author}
          </span>
          <span className="text-[12.5px] text-muted-foreground">{time}</span>
        </p>
        {children}
      </div>
    </div>
  );
}

function ChatThread({ animate }: { animate: boolean }) {
  const rows = threadRows.map((row, index) => (
    <div
      key={row.key}
      className="reveal-item"
      style={{ "--i": index } as StaggerStyle}
    >
      {row.kind === "them" && (
        <RunStart initials="JE" author="Jordan Ellis" time="4:02 PM">
          <p className={BODY}>
            Chapter is 6:30 tonight. Dues forms in by then if yours is not.
          </p>
        </RunStart>
      )}

      {row.kind === "event" && (
        <RunStart initials="JE" author="Jordan Ellis" time="4:03 PM">
          {/*
            A card is a thing posted into the channel, so it keeps its frame
            (`--card`, hairline, radius 14) where a message has none.
          */}
          <div className="mt-1 w-fit max-w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <p className="text-[12.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Event
            </p>
            <p className="mt-1 text-[16px] font-bold text-foreground">
              Chapter meeting
            </p>
            <p className="text-[14px] text-muted-foreground">
              Tonight · 6:30 PM · Chapter room · 10 pts
            </p>
            {/*
              Check in, and only Check in. `spec/behavior/events.md` records
              pre-event RSVP intent as not modelled, so there is no Going or
              Can't-make-it control to draw. The live count is drawn because
              the viewer is an officer, which the caption states: it shows
              only to `events:update` holders.
            */}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="inline-flex h-[34px] items-center rounded-sm bg-primary px-3.5 text-[14px] font-bold text-primary-foreground">
                Check in
              </span>
              <span className="text-[12.5px] text-muted-foreground">
                closes 6:45
              </span>
              <span className="text-[12.5px] text-muted-foreground">
                31 checked in
              </span>
            </div>
          </div>
        </RunStart>
      )}

      {row.kind === "self" && (
        /*
          The time and nothing else: read receipts are a channel cursor that
          feeds unread counts (`spec/behavior/chat/README.md` § Read
          Receipts), so no message is ever marked "read".
        */
        <RunStart initials="AK" author="You" self time="4:05 PM">
          <p className={BODY}>On it. Roster is pulled, 42 for food.</p>
        </RunStart>
      )}

      {row.kind === "mention" && (
        <RunStart initials="MC" author="Maya Chen" time="4:06 PM">
          <p className={BODY}>
            {/*
              The in-body mention chip, on the handle alone: the row around
              it is never retinted, because a message that mentions you is
              still the sender's. It is not the mention red, which is a badge
              fill and has no lifted tone to render as text (`foundations.md`
              §5); this opaque amber pair is what §5 carves out to.
            */}
            <span className="rounded-[5px] bg-mention-chip px-1 font-semibold text-mention-chip-text">
              @Jordan
            </span>{" "}
            can you pin the parking map before people leave?
          </p>
        </RunStart>
      )}
    </div>
  ));

  /*
   * Bottom-aligned, like the product's timeline, which opens at its newest
   * row with the composer pinned under it. The thread never shrinks below its
   * rows: each frame's height is a minimum, so wherever the thread column is
   * too narrow for them to fit (phone widths, and the railed frame wherever
   * the rail squeezes it) the frame grows rather than slicing a row or
   * running one under the composer.
   */
  const thread = "flex flex-1 flex-col justify-end pb-2";

  if (!animate) {
    return <div className={thread}>{rows}</div>;
  }

  return (
    <RevealOnView className={`reveal-thread ${thread}`}>{rows}</RevealOnView>
  );
}

function Composer() {
  return (
    <div className="px-4 pb-3 pt-2">
      <div className="flex flex-col gap-1 rounded-md border border-input bg-surface-1 p-2 pb-1.5">
        <p className="px-1.5 py-0.5 text-[16px] leading-6 text-muted-foreground">
          Message #general
        </p>
        <div className="flex items-center justify-between">
          <span className="pl-1.5 text-[12.5px] text-muted-foreground">
            Enter to send
          </span>
          <span className="inline-flex h-8 items-center rounded-sm border border-border bg-card px-3.5 text-[14px] font-bold text-disabled">
            Send
          </span>
        </div>
      </div>
    </div>
  );
}

function ChannelRow({
  name,
  state,
  badge,
}: {
  name: string;
  state: "active" | "unread" | "rest";
  badge?: { count: string; tone: "neutral" | "mention" };
}) {
  const tone =
    state === "active"
      ? "bg-accent-subtle text-accent-text font-semibold"
      : state === "unread"
        ? "text-foreground font-semibold"
        : "text-muted-foreground";
  return (
    <div className={`flex h-8 items-center gap-2 rounded-sm px-2 ${tone}`}>
      <span className="w-4 font-bold">#</span>
      <span className="min-w-0 flex-1 truncate text-[14px]">{name}</span>
      {badge ? (
        <span
          className={`inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] px-1.5 text-[11.5px] font-bold ${
            badge.tone === "mention"
              ? "bg-mention text-mention-foreground"
              : "bg-input text-foreground"
          }`}
        >
          {badge.count}
        </span>
      ) : null}
    </div>
  );
}

function DirectMessageRow({
  initials,
  name,
  unread,
}: {
  initials: string;
  name: string;
  unread?: boolean;
}) {
  return (
    <div
      className={`flex h-8 items-center gap-2 rounded-sm px-2 ${
        unread ? "font-semibold text-foreground" : "text-muted-foreground"
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-popover text-[7.5px] text-foreground">
        {initials}
      </span>
      <span className="min-w-0 flex-1 truncate text-[14px]">{name}</span>
      {unread ? (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] bg-mention px-1.5 text-[11.5px] font-bold text-mention-foreground">
          1
        </span>
      ) : null}
    </div>
  );
}

export function ChatFrame({
  variant,
  label,
}: {
  variant: "fold" | "full";
  label: string;
}) {
  const isFold = variant === "fold";

  return (
    <div
      role="img"
      aria-label={label}
      className={
        isFold
          ? "flex min-h-[536px] w-full flex-col overflow-hidden rounded-xl border border-input bg-background lg:w-[720px] lg:max-w-none lg:rounded-r-none lg:border-r-0"
          : "flex min-h-[600px] w-full overflow-hidden rounded-xl border border-border bg-background"
      }
    >
      {!isFold && (
        <div className="hidden w-[220px] shrink-0 flex-col gap-0.5 border-r border-border bg-surface-1 p-2 sm:flex">
          <div className="flex h-10 items-center gap-2.5 px-1.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-xs border border-accent-border bg-accent-subtle text-[11px] font-bold text-accent-text">
              ΔΡ
            </span>
            <span className="text-[14px] font-bold text-foreground">
              Delta Rho
            </span>
          </div>
          <div className="mt-1.5 flex h-8 items-center justify-between px-2">
            <span className="text-[13px] font-bold text-foreground">
              Channels
            </span>
            <span className="text-[16px] font-bold text-muted-foreground">
              +
            </span>
          </div>
          <ChannelRow
            name="announcements"
            state="unread"
            badge={{ count: "2", tone: "neutral" }}
          />
          <ChannelRow name="general" state="active" />
          <ChannelRow name="treasury" state="rest" />
          <ChannelRow name="house" state="rest" />
          <p className="px-2 pb-1 pt-3.5 text-[12.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Direct messages
          </p>
          <DirectMessageRow initials="MC" name="Maya Chen" unread />
          <DirectMessageRow initials="JE" name="Jordan Ellis" />
          <p className="px-2 pb-1 pt-3.5 text-[12.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            System
          </p>
          <div className="flex h-8 items-center gap-2 rounded-sm px-2 text-muted-foreground">
            <ShieldGlyph />
            <span className="min-w-0 flex-1 truncate text-[14px]">
              chapter-audit
            </span>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border bg-surface-1 px-4">
          {isFold && (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xs border border-accent-border bg-accent-subtle text-[11px] font-bold text-accent-text">
              ΔΡ
            </span>
          )}
          <span className="text-[16px] font-bold text-foreground">
            <span className="text-muted-foreground">#</span>general
          </span>
          <span className="truncate text-[13px] text-muted-foreground">
            {isFold ? "Delta Rho · 42 members" : "42 members"}
          </span>
          <span className="ml-auto text-[18px] font-bold tracking-[0.5px] text-muted-foreground">
            ⋯
          </span>
        </div>

        {/*
          The fold's frame is static: it is first paint, where README §7 prefers
          a static layout. Only the below-fold frame plays its thread in.
        */}
        <ChatThread animate={!isFold} />
        <div className="shrink-0">
          <Composer />
        </div>
      </div>
    </div>
  );
}

/* 1.6px stroke on a 24 grid, rounded caps and joins (iconography.md §1). */
function ShieldGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 3 19 6v5.5c0 4.2-2.9 7.6-7 9.5-4.1-1.9-7-5.3-7-9.5V6l7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
