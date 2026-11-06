"use client";

import Link from "next/link";
import { formatDay, formatDayTime } from "@repo/formatting";
import { Button } from "@/components/ui/button";
import { EYEBROW } from "@/components/ui/typography";
import {
  meterFillClassName,
  meterTrackClassName,
} from "@/components/shared/meter";
import { cn } from "@/lib/utils";
import {
  importPercent,
  purgeProgress,
  type ImportRow,
} from "./import-progress";
import { groupWarnings, KEPT_WARNINGS } from "./import-warnings";
import {
  categoryTiles,
  importTotals,
  useBotImportProgress,
  type CategoryProgress,
  type CategoryTile,
} from "./category-progress";
import type { ImportProgress } from "./import-watch-panel";
import { purgeLine } from "./delete-import-copy";
import { SourceStep, type ImportSource } from "./source-step";
import {
  ArrivalCategories,
  ArrivalMark,
  ArrivalSweep,
  useArrival,
  useCountUp,
} from "./import-arrival";

function count(value: number): string {
  return value.toLocaleString("en-US");
}

/** "6 messages", "1 message". */
function counted(value: number, one: string, many: string): string {
  return `${count(value)} ${value === 1 ? one : many}`;
}

function Meter({ percent }: { percent: number }) {
  return (
    <div aria-hidden="true" className={meterTrackClassName}>
      <div className={meterFillClassName} style={{ width: `${percent}%` }} />
    </div>
  );
}

/** One figure in a row of them: the number large, its label under it. */
function Figure({
  value,
  label,
  shown,
}: {
  value: string;
  label: string;
  /** What the screen draws while a number counts up; a reader gets `value`. */
  shown?: string;
}) {
  return (
    // The term comes first for a screen reader; the number reads first on
    // screen.
    <div className="flex flex-col-reverse rounded-lg border border-border p-3">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-title tabular-nums">
        {shown === undefined || shown === value ? (
          value
        ) : (
          <>
            <span aria-hidden="true">{shown}</span>
            <span className="sr-only">{value}</span>
          </>
        )}
      </dd>
    </div>
  );
}

const COMES_OVER = [
  "Messages, threads and forum posts",
  "Files and images",
  "Reaction counts",
  "Categories, if you want them",
  "Private channels stay private",
];

/**
 * State 1: nothing imported yet. What an import brings, and the two ways in,
 * as the wizard's own first step: picking one opens the wizard past it.
 */
export function ImportLanding({
  botAvailable,
  onPick,
  lastDeleted,
  onDismissDeleted,
  unfinished,
  onDeleteUnfinished,
  deleting,
}: {
  botAvailable: boolean;
  onPick: (source: ImportSource) => void;
  /** The last import, deleted, until the admin dismisses the line. */
  lastDeleted: ImportRow | null;
  onDismissDeleted: () => void;
  /** An import set up part-way and left, which may hold an uploaded export. */
  unfinished: ImportRow | null;
  onDeleteUnfinished: () => void;
  deleting: boolean;
}) {
  return (
    <section
      aria-labelledby="discord-import-start"
      className="mx-auto max-w-2xl space-y-5"
    >
      <div className="space-y-1.5">
        <h2 id="discord-import-start" className="text-headline">
          Bring your chapter&apos;s Discord history into Frapp
        </h2>
        <p className="text-sm text-muted-foreground">
          Every message, file and thread lands in Frapp chat, searchable, with
          the same people able to read it. Members can link their Discord later
          to claim what they wrote.
        </p>
      </div>

      {unfinished ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
          <p className="text-muted-foreground">
            An import
            {unfinished.guild_name ? ` from ${unfinished.guild_name}` : ""} was
            set up and not started. Delete it to remove anything uploaded for
            it.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDeleteUnfinished}
            disabled={deleting}
          >
            Delete
          </Button>
        </div>
      ) : null}

      {lastDeleted ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
          <p className="text-muted-foreground">
            The import from {lastDeleted.guild_name ?? "your Discord server"}{" "}
            was deleted.
          </p>
          <Button variant="ghost" size="sm" onClick={onDismissDeleted}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <SourceStep
        value={null}
        onChange={onPick}
        botAvailable={botAvailable}
        intro={false}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <p className={cn(EYEBROW, "text-muted-foreground")}>Comes over</p>
          <ul className="space-y-1 text-sm">
            {COMES_OVER.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="space-y-1.5">
          <p className={cn(EYEBROW, "text-muted-foreground")}>Stays behind</p>
          <p className="text-sm">DMs, voice, and who holds which role</p>
        </div>
      </div>
    </section>
  );
}

/**
 * One Discord category on a running import: its name and how many of its
 * channels and threads are done. It turns green when the last one finishes.
 */
function Tile({ tile }: { tile: CategoryTile }) {
  return (
    <li
      className={cn(
        "flex min-w-0 flex-col gap-0.5 rounded-lg border p-2.5 motion-safe:transition-colors",
        tile.finished ? "border-success/40 bg-success-tint" : "border-border",
      )}
    >
      <span className="truncate text-xs text-muted-foreground">
        {tile.name}
      </span>
      <span
        className={cn(
          "text-sm font-semibold tabular-nums",
          tile.finished ? "text-success" : null,
        )}
      >
        {count(tile.done)}/{count(tile.total)}
        {tile.failed > 0 ? (
          <span className="font-normal text-destructive-text">
            {" "}
            · {count(tile.failed)} failed
          </span>
        ) : null}
      </span>
    </li>
  );
}

/** The tiles, one per Discord category, read off the progress poll. */
function CategoryTiles({ categories }: { categories: CategoryProgress[] }) {
  const tiles = categoryTiles(categories);
  if (tiles.length === 0) return null;
  return (
    <ul
      aria-label="Progress by Discord category"
      className="grid grid-cols-2 gap-2 sm:grid-cols-4"
    >
      {tiles.map((tile) => (
        <Tile key={tile.key} tile={tile} />
      ))}
    </ul>
  );
}

/** State 3: importing. A count that only climbs, and the way to stop. */
export function ImportRunning({
  row,
  onStop,
  stopping,
  channels,
}: {
  row: ImportRow;
  onStop: () => void;
  stopping: boolean;
  /** The channel panel, when the admin has opened it. */
  channels: React.ReactNode;
}) {
  const percent = importPercent(row);
  const hasChannelCounts =
    row.channels_total !== null && row.channels_total !== undefined;
  const progress = useBotImportProgress(row, true).data as
    ImportProgress | undefined;
  // The worker reads one channel or thread at a time.
  const now = row.status === "running" ? progress?.running[0] : undefined;
  return (
    <section
      aria-labelledby="discord-import-running"
      className="mx-auto max-w-2xl space-y-4"
    >
      <div className="space-y-1">
        <p className={cn(EYEBROW, "text-muted-foreground")}>
          {row.status === "ready" ? "Waiting to start" : "Importing"}
          {row.guild_name ? ` · ${row.guild_name}` : ""}
        </p>
        <h2 id="discord-import-running" className="text-headline tabular-nums">
          {counted(row.imported_messages, "message", "messages")} in so far
        </h2>
        <p className="text-sm text-muted-foreground">
          {hasChannelCounts
            ? `${count(row.channels_done ?? 0)} of ${count(row.channels_total as number)} channels and threads done. `
            : ""}
          You can close this tab. You&apos;ll get a notification when it
          finishes.
        </p>
      </div>
      {percent !== null ? (
        <div className="space-y-1">
          <Meter percent={percent} />
          {/* The bar is aria-hidden; this is the accessible signal. */}
          <p className="text-caption text-muted-foreground tabular-nums">
            {percent}%
          </p>
        </div>
      ) : null}
      {now ? (
        <p className="text-sm">
          Now importing{" "}
          <span className="font-semibold">#{now.discord_channel_name}</span>
          <span className="text-muted-foreground tabular-nums">
            {" "}
            · {counted(now.imported_count, "message", "messages")}
          </span>
        </p>
      ) : null}
      <CategoryTiles categories={progress?.categories ?? []} />
      {channels}
      <div className="flex justify-end">
        <Button variant="secondary" onClick={onStop} disabled={stopping}>
          Stop import
        </Button>
      </div>
    </section>
  );
}

/** A purge in progress: the messages counted down. */
export function ImportDeleting({ row }: { row: ImportRow }) {
  const progress = purgeProgress(row);
  return (
    <section
      aria-labelledby="discord-import-deleting"
      className="mx-auto max-w-2xl space-y-3"
    >
      <h2 id="discord-import-deleting" className="text-headline">
        Deleting the import
      </h2>
      <p className="text-sm text-muted-foreground">{purgeLine(row)}</p>
      {progress && progress.left > 0 ? (
        <div className="space-y-1">
          <Meter percent={progress.percent} />
          <p className="text-caption text-muted-foreground tabular-nums">
            {progress.percent}%
          </p>
        </div>
      ) : null}
    </section>
  );
}

const FINISHED_TITLE: Record<string, string> = {
  completed: "Your Discord history is in Frapp",
  failed: "The import stopped on an error",
  cancelled: "The import was stopped",
};

/**
 * State 4: done, or stopped part-way. What came over, what didn't and why,
 * and the way back: Resume for an import that failed, Delete for any.
 */
export function ImportFinished({
  row,
  onDelete,
  deleting,
  onResume,
  resuming,
  channels,
}: {
  row: ImportRow;
  onDelete: () => void;
  deleting: boolean;
  onResume: () => void;
  resuming: boolean;
  channels: React.ReactNode;
}) {
  const done = row.status === "completed";
  // A deletion that failed part-way leaves the import `failed` too (#2944):
  // the import itself came over, so it must not read as an import that broke.
  const purged = row.purged_messages ?? 0;
  const deletionFailed = row.status === "failed" && purged > 0;
  // An import that failed picks up where it stopped when started again; one
  // the admin stopped, or whose deletion failed, does not.
  const resumable = row.status === "failed" && !deletionFailed;
  const title = deletionFailed
    ? "The deletion stopped on an error"
    : (FINISHED_TITLE[row.status] ?? "The import stopped");
  const groups = groupWarnings(row.warnings ?? []);
  const warned = row.warnings?.length ?? 0;
  const since = formatDay(row.messages_after);
  const finishedAt = row.completed_at ? formatDayTime(row.completed_at) : null;
  // A completed bot import counts its channels and threads apart; until that
  // read lands, or on an upload, the row's combined count stands in. One
  // stopped part-way counts only what it got through, which the categories
  // don't split, so nothing is read for it.
  const categories = (
    useBotImportProgress(row, false, done).data as ImportProgress | undefined
  )?.categories;
  const totals = done && categories?.length ? importTotals(categories) : null;
  // The landing (#3493): once, on a completed import this browser hasn't
  // landed yet. Every other time this is the frame it lands on.
  const playing = useArrival(row);
  const messages = useCountUp(row.imported_messages, playing);
  const tiles = done && categories ? categoryTiles(categories) : [];
  return (
    <section
      aria-labelledby="discord-import-finished"
      className="mx-auto max-w-2xl space-y-5"
    >
      <div className="space-y-1">
        <div className="flex items-center gap-2.5">
          {done ? <ArrivalMark playing={playing} /> : null}
          <h2 id="discord-import-finished" className="text-headline">
            {title}
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {[
            row.guild_name,
            since ? `messages since ${since}` : null,
            done && finishedAt ? `finished ${finishedAt}` : null,
            // A deletion that failed part-way (#2944).
            purged > 0 ? `${count(purged)} already deleted` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {row.error ? (
          <p className="text-sm text-destructive-text">{row.error}</p>
        ) : null}
      </div>

      <div className="relative overflow-hidden rounded-lg">
        <ArrivalSweep playing={playing} />
        <dl
          className={cn(
            "grid grid-cols-2 gap-3",
            totals ? "sm:grid-cols-4" : "sm:grid-cols-3",
          )}
        >
          <Figure
            value={count(row.imported_messages)}
            shown={count(messages)}
            label="messages"
          />
          <Figure value={count(row.attachments_imported)} label="files" />
          {/* Done, every channel it read; stopped part-way, the ones it got
            through, since the rest never came over. */}
          {totals ? (
            <>
              <Figure
                value={count(totals.channels)}
                label={totals.channels === 1 ? "channel" : "channels"}
              />
              <Figure
                value={count(totals.threads)}
                label={totals.threads === 1 ? "thread" : "threads"}
              />
            </>
          ) : done && typeof row.channels_total === "number" ? (
            <Figure
              value={count(row.channels_total)}
              label="channels and threads"
            />
          ) : !done && typeof row.channels_done === "number" ? (
            <Figure
              value={count(row.channels_done)}
              label="channels and threads done"
            />
          ) : null}
        </dl>
      </div>

      <ArrivalCategories tiles={tiles} playing={playing} />

      {done ? (
        <div>
          <Button asChild>
            <Link href="/chat">Open chat</Link>
          </Button>
        </div>
      ) : resumable ? (
        <div className="space-y-1.5">
          <Button onClick={onResume} disabled={resuming}>
            Resume import
          </Button>
          <p className="text-xs text-muted-foreground">
            It picks up where it stopped. Nothing already imported comes in
            twice.
          </p>
        </div>
      ) : null}

      {groups.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold">
            {counted(warned, "thing", "things")} didn&apos;t come over
          </p>
          <ul className="space-y-1.5">
            {groups.map((group) => (
              <li key={group.key}>
                <details className="rounded-lg border border-border px-3 py-2 text-sm">
                  <summary className="flex cursor-pointer justify-between gap-3">
                    <span>{group.title}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {count(group.items.length)}
                    </span>
                  </summary>
                  <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                    {group.items.map((item, index) => (
                      <li key={`${group.key}-${index}`}>{item}</li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
          {warned >= KEPT_WARNINGS ? (
            <p className="text-xs text-muted-foreground">
              Only the last {KEPT_WARNINGS} are kept.
            </p>
          ) : null}
        </div>
      ) : null}

      {channels}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="max-w-md text-sm text-muted-foreground">
          Deleting the import removes the messages and files it brought in. The
          roles and read permissions it made stay.
        </p>
        <Button variant="destructive" onClick={onDelete} disabled={deleting}>
          Delete import
        </Button>
      </div>
    </section>
  );
}
