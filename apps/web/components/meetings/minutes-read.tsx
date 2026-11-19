"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronRight } from "lucide-react";
import type { MeetingActionItemTask, MeetingMinutes } from "@repo/hooks";
import { memberLabel } from "@repo/hooks/display-names";
import {
  MEETING_COPY,
  MEETING_LIST_COPY,
  MINUTES_PREVIEW,
  MINUTES_READ_COPY,
  meetingTabledFromLabel,
  minutesActionRows,
  minutesDateTile,
  minutesTopics,
  parseMinutesNotes,
  type MeetingActionItem,
  type MeetingDateItem,
  type MeetingDecision,
  type MeetingTabledItem,
  type MinutesJump,
  type MinutesNoteLine,
} from "@repo/validation";
import { InlineNote } from "@/components/shared/inline-note";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { SegmentedChoice } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import { meetingDueLabel, voteLine } from "@/components/meetings/meeting-copy";

/**
 * The minutes as members read them (#5562; Paul, 2026-11-19: "Scrolling
 * through the minutes, nothing stands out"). Each kind of thing has its own
 * shape, so a scroll says what it is before a word is read. The phone's
 * `minutes-body.tsx` draws the same blocks in the same order with the same
 * words, all from `@repo/validation`'s `minutes-read.ts`.
 */

/** "Show all 27" under a list cut to its first few, and "Show fewer" back. */
function ShowAll({
  open,
  total,
  onToggle,
  label,
}: {
  open: boolean;
  total: number;
  onToggle: () => void;
  label?: string;
}) {
  return (
    <Button
      variant="link"
      size="sm"
      className="h-auto p-0"
      aria-expanded={open}
      onClick={onToggle}
    >
      {open
        ? MINUTES_READ_COPY.showFewer
        : (label ?? MINUTES_READ_COPY.showAll(total))}
    </Button>
  );
}

/** The first `preview` of a list, all of it once asked. */
function usePreview<T>(items: readonly T[], preview: number) {
  const [open, setOpen] = useState(false);
  const cut = items.length > preview + 1;
  return {
    shown: cut && !open ? items.slice(0, preview) : items,
    cut,
    open,
    toggle: () => setOpen((value) => !value),
  };
}

/**
 * The jump bar under the title (#5562): one stop per section a member
 * scrolls for, with how many it holds, so 27 action items are one tap away.
 */
export function MinutesJumpBar({
  jumps,
  onJump,
}: {
  jumps: readonly MinutesJump[];
  onJump: (jump: MinutesJump) => void;
}) {
  if (jumps.length === 0) return null;
  return (
    <nav
      aria-label={MINUTES_READ_COPY.jumpLabel}
      className="-mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-0.5"
    >
      {jumps.map((jump) => (
        <button
          key={jump.key}
          type="button"
          onClick={() => onJump(jump)}
          className={cn(
            "inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-caption hover:bg-card-hover pointer-coarse:min-h-11",
            FOCUS_RING_OFFSET,
          )}
        >
          {jump.label}
          <span className="tabular-nums text-muted-foreground">
            {jump.count}
          </span>
        </button>
      ))}
    </nav>
  );
}

/**
 * The TL;DR as the page's lead, in a card of its own, with the long summary
 * folded under it: the gist is said once, and the rest is a tap away.
 */
export function TldrBlock({
  tldr,
  summary,
}: {
  tldr: string;
  summary: string;
}) {
  const [open, setOpen] = useState(false);
  const hasSummary = summary.trim().length > 0;
  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <LinesView text={tldr} outline={false} lead />
      {hasSummary && open ? (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
          {summary}
        </p>
      ) : null}
      {hasSummary ? (
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? MINUTES_READ_COPY.hideSummary : MINUTES_READ_COPY.readSummary}
        </Button>
      ) : null}
    </div>
  );
}

/** Coming up: each day the meeting named as a calendar tile. */
export function DatesView({ dates }: { dates: readonly MeetingDateItem[] }) {
  return (
    <ul role="list" className="grid gap-2 sm:grid-cols-2">
      {dates.map((item, index) => {
        const tile = minutesDateTile(item.date);
        return (
          <li
            key={`${item.date}-${index}`}
            className="flex items-center gap-3 rounded-lg border border-border p-2.5"
          >
            <span
              aria-hidden="true"
              className="flex w-12 shrink-0 flex-col items-center rounded-md bg-accent-subtle py-1 leading-none text-accent-text"
            >
              <span className="text-[0.6875rem] font-semibold tracking-wide">
                {tile.month}
              </span>
              <span className="text-lg font-bold tabular-nums">{tile.day}</span>
            </span>
            <span className="min-w-0">
              <span className="block break-words text-sm font-medium">
                {item.text}
              </span>
              <span className="block text-caption text-muted-foreground">
                {tile.weekday ? `${tile.weekday}, ` : ""}
                {meetingDueLabel(item.date)}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** "22–5", with abstentions only when there were some: "22–5–1". */
function voteTally(vote: NonNullable<MeetingDecision["vote"]>): string {
  const counts = [vote.for, vote.against];
  if (vote.abstain > 0) counts.push(vote.abstain);
  return counts.join("–");
}

/**
 * Decisions lead with their headline in bold, the detail grey under it, so
 * a scroll reads the outcomes without reading the motions.
 */
export function DecisionsView({
  decisions,
}: {
  decisions: readonly MeetingDecision[];
}) {
  const list = usePreview(decisions, MINUTES_PREVIEW.decisions);
  return (
    <div className="space-y-2">
      <ul role="list" className="space-y-3 text-sm">
        {list.shown.map((decision, index) => (
          <li key={index} className="border-l-2 border-primary py-0.5 pl-3">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <p
                className={cn(
                  "min-w-0 whitespace-pre-wrap break-words",
                  decision.headline && "font-semibold",
                )}
              >
                {decision.headline || decision.text}
              </p>
              {decision.vote ? (
                <Badge
                  variant="outline"
                  title={voteLine(decision.vote)}
                  aria-label={voteLine(decision.vote)}
                  className="tabular-nums"
                >
                  {voteTally(decision.vote)}
                </Badge>
              ) : null}
            </div>
            {decision.headline ? (
              <p className="whitespace-pre-wrap break-words text-muted-foreground">
                {decision.text}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {list.cut ? (
        <ShowAll
          open={list.open}
          total={decisions.length}
          onToggle={list.toggle}
        />
      ) : null}
    </div>
  );
}

/**
 * The action items as a checklist, ticked as each item's task is done
 * (Paul, 2026-11-18). The reader's own come first, then the ones with a due
 * day; Mine narrows to the reader's own, so a chair finds theirs among 27.
 * The boxes only show: an item is checked off by doing its task.
 */
export function ActionChecklist({
  items,
  nameFor,
  viewerId,
  tasks,
}: {
  items: readonly MeetingActionItem[];
  nameFor: (userId: string) => string | null;
  viewerId: string | null;
  /** The tasks the items became, by their place in the stored list. */
  tasks: ReadonlyMap<number, MeetingActionItemTask>;
}) {
  const rows = minutesActionRows(items, viewerId);
  const mineCount = rows.filter((row) => row.mine).length;
  const [filter, setFilter] = useState<"mine" | "all">(
    mineCount > 0 ? "mine" : "all",
  );
  const filtered =
    filter === "mine" && mineCount > 0 ? rows.filter((row) => row.mine) : rows;
  const list = usePreview(filtered, MINUTES_PREVIEW.action_items);
  const done = [...tasks.values()].filter((task) => task.done).length;
  return (
    <div className="space-y-3">
      {mineCount > 0 || done > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {mineCount > 0 ? (
            <SegmentedChoice
              label={MINUTES_READ_COPY.mine}
              value={filter}
              onChange={setFilter}
              options={[
                { value: "mine", label: MINUTES_READ_COPY.mine },
                { value: "all", label: MINUTES_READ_COPY.all(rows.length) },
              ]}
            />
          ) : (
            <span />
          )}
          {done > 0 ? (
            <span className="text-caption tabular-nums text-muted-foreground">
              {MINUTES_READ_COPY.done(done)}
            </span>
          ) : null}
        </div>
      ) : null}
      <ul role="list" className="space-y-3 text-sm">
        {list.shown.map(({ item, index, mine }) => {
          const task = tasks.get(index);
          const isDone = task?.done ?? false;
          const meta = [
            item.owner_user_id
              ? memberLabel(nameFor(item.owner_user_id), item.owner_user_id)
              : MINUTES_READ_COPY.nobodyNamed,
            item.due_date
              ? MINUTES_READ_COPY.due(meetingDueLabel(item.due_date))
              : null,
            task?.group && !isDone
              ? `${task.group.done} of ${task.group.total} done`
              : null,
          ].filter(Boolean);
          return (
            <li key={index} className="flex gap-3">
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border",
                  isDone
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border",
                )}
              >
                {isDone ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <p
                    className={cn(
                      "min-w-0 whitespace-pre-wrap break-words",
                      isDone && "text-muted-foreground",
                    )}
                  >
                    <span className="sr-only">
                      {isDone ? "Done: " : task ? "Not done yet: " : ""}
                    </span>
                    {item.text}
                  </p>
                  {mine ? <Badge>{MINUTES_READ_COPY.yours}</Badge> : null}
                </div>
                <p className="text-caption text-muted-foreground">
                  {meta.join(" · ")}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {list.cut ? (
        <ShowAll
          open={list.open}
          total={filtered.length}
          onToggle={list.toggle}
        />
      ) : null}
    </div>
  );
}

/**
 * What the meeting tabled (#5522): each matter, with where it was first
 * tabled when an earlier meeting did.
 */
export function TabledView({ items }: { items: readonly MeetingTabledItem[] }) {
  return (
    <ul role="list" className="space-y-1.5 text-sm leading-relaxed">
      {items.map((item, index) => {
        const from = meetingTabledFromLabel(item);
        return (
          <li key={index} className="flex gap-2 break-words">
            <span aria-hidden className="select-none text-muted-foreground">
              •
            </span>
            <span className="min-w-0">
              {item.text}
              {from ? (
                <span className="block text-caption text-muted-foreground">
                  {from}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Outline lines, the way the notes draw them. */
function NoteLines({
  lines,
  lead = false,
}: {
  lines: readonly MinutesNoteLine[];
  lead?: boolean;
}) {
  return (
    <ul
      role="list"
      className={`space-y-1.5 leading-relaxed ${lead ? "text-base" : "text-sm"}`}
    >
      {lines.map((line, index) => {
        if (line.kind === "topic") {
          return (
            <li
              key={index}
              className="break-words pt-4 text-base font-semibold first:pt-0"
            >
              {line.text}
            </li>
          );
        }
        if (line.kind === "point") {
          return (
            <li
              key={index}
              className={`flex gap-2 break-words ${line.depth ? "pl-5" : ""}`}
            >
              <span aria-hidden className="select-none text-muted-foreground">
                {line.depth ? "◦" : "•"}
              </span>
              <span className="min-w-0">{line.text}</span>
            </li>
          );
        }
        return (
          <li key={index} className="break-words">
            {line.head ? (
              <>
                <span className="font-semibold">{line.head}</span>
                {": "}
                {line.text}
              </>
            ) : (
              line.text
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A section written one item per line (reports, announcements, business).
 * A plain line that opens with its topic ("Treasurer: ...") shows the topic
 * in bold, so it can be skimmed. With `preview`, a long one shows its first
 * few lines and "Show all".
 */
export function LinesView({
  text,
  outline,
  lead = false,
  preview,
}: {
  text: string;
  outline: boolean;
  lead?: boolean;
  preview?: number;
}) {
  const lines = parseMinutesNotes(text, { outline });
  const list = usePreview(lines, preview ?? lines.length);
  return (
    <div className="space-y-2">
      <NoteLines lines={list.shown} lead={lead} />
      {list.cut ? (
        <ShowAll open={list.open} total={lines.length} onToggle={list.toggle} />
      ) : null}
    </div>
  );
}

/**
 * The notes as topics that open in place (#5562), like a FAQ or Granola's
 * outline: 17 topics read as 17 lines, and a member opens the one they want.
 */
export function TopicsView({ text }: { text: string }) {
  const topics = minutesTopics(text);
  const list = usePreview(topics, MINUTES_PREVIEW.topics);
  // Notes typed with no topics read as they were written.
  if (topics.length === 1 && topics[0] && topics[0].title === null) {
    return <NoteLines lines={topics[0].lines} />;
  }
  return (
    <div className="space-y-2">
      <ul role="list" className="divide-y divide-border rounded-lg border">
        {list.shown.map((topic, index) => (
          <li key={`${topic.title ?? ""}-${index}`}>
            {topic.title === null ? (
              <div className="p-3">
                <NoteLines lines={topic.lines} />
              </div>
            ) : (
              <details className="group">
                <summary
                  className={cn(
                    "flex cursor-pointer list-none items-center gap-2 p-3 text-sm hover:bg-card-hover [&::-webkit-details-marker]:hidden",
                    FOCUS_RING_OFFSET,
                  )}
                >
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 break-words font-semibold">
                    {topic.title}
                  </span>
                  {topic.lines.length > 0 ? (
                    <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                      {MINUTES_READ_COPY.points(topic.lines.length)}
                    </span>
                  ) : null}
                </summary>
                {topic.lines.length > 0 ? (
                  <div className="px-3 pb-3 pl-9">
                    <NoteLines lines={topic.lines} />
                  </div>
                ) : null}
              </details>
            )}
          </li>
        ))}
      </ul>
      {list.cut ? (
        <ShowAll
          open={list.open}
          total={topics.length}
          onToggle={list.toggle}
          label={MINUTES_READ_COPY.allTopics(topics.length)}
        />
      ) : null}
    </div>
  );
}

export function hasAttendees(meeting: MeetingMinutes): boolean {
  const a = meeting.attendees;
  return !!a && a.present.length + a.late.length + a.excused.length > 0;
}

/** Who came, by how they were marked. */
export function Attendees({
  meeting,
  nameFor,
}: {
  meeting: MeetingMinutes;
  nameFor: (userId: string) => string | null;
}) {
  const attendees = meeting.attendees;
  if (!attendees) {
    return <InlineNote>{MEETING_COPY.attendeesGone}</InlineNote>;
  }
  if (!hasAttendees(meeting)) {
    return <InlineNote>{MEETING_COPY.attendeesNone}</InlineNote>;
  }
  const groups = [
    { label: MEETING_LIST_COPY.present, ids: attendees.present },
    { label: MEETING_LIST_COPY.late, ids: attendees.late },
    { label: MEETING_LIST_COPY.excused, ids: attendees.excused },
  ].filter((group) => group.ids.length > 0);
  return (
    <dl className="space-y-2 text-sm">
      {groups.map((group) => (
        <div key={group.label}>
          <dt className="text-caption text-muted-foreground">
            {group.label}, {group.ids.length}
          </dt>
          <dd>
            {group.ids
              .map((userId) => memberLabel(nameFor(userId), userId))
              .sort((a, b) => a.localeCompare(b))
              .join(", ")}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A row under the minutes that opens in place: Attendance, with its count
 * on the row, so a long list of names never sits between the minutes and
 * the transcript.
 */
export function MinutesRow({
  label,
  detail,
  children,
}: {
  label: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-lg border">
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-2 p-3 text-sm hover:bg-card-hover [&::-webkit-details-marker]:hidden",
          FOCUS_RING_OFFSET,
        )}
      >
        <ChevronRight
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        <span className="flex-1 font-semibold">{label}</span>
        <span className="text-caption tabular-nums text-muted-foreground">
          {detail}
        </span>
      </summary>
      <div className="px-3 pb-3 pl-9">{children}</div>
    </details>
  );
}

/** "12 attended", or "Not taken" when nobody was marked. */
export function attendanceDetail(meeting: MeetingMinutes): string {
  const a = meeting.attendees;
  if (!a || !hasAttendees(meeting)) return MINUTES_READ_COPY.attendanceNone;
  return MINUTES_READ_COPY.attended(a.present.length + a.late.length);
}
