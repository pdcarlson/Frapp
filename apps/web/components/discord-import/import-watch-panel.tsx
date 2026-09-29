"use client";

import Link from "next/link";
import { useDiscordImportProgress } from "@repo/hooks";
import { NestedError, NestedLoading } from "@/components/shared/nested-states";
import { FOCUS_RING } from "@/components/ui/focus";
import { EYEBROW } from "@/components/ui/typography";
import { chatDeepLink } from "@/lib/chat/chat-links";
import { cn } from "@/lib/utils";

/** One channel or thread, as `GET :id/progress` names it. */
export interface WatchedChannel {
  discord_channel_id: string;
  discord_channel_name: string;
  imported_count: number;
  error: string | null;
  target_channel_id: string | null;
}

export interface ImportProgress {
  counts: Record<
    "pending" | "running" | "completed" | "failed" | "skipped",
    number
  >;
  running: WatchedChannel[];
  recent: WatchedChannel[];
  failed: WatchedChannel[];
}

/** "3 done · 1 importing · 12 waiting", leaving out what is zero. */
export function progressSummary(counts: ImportProgress["counts"]): string {
  return [
    `${counts.completed} done`,
    counts.running > 0 ? `${counts.running} importing` : null,
    counts.pending > 0 ? `${counts.pending} waiting` : null,
    counts.failed > 0 ? `${counts.failed} failed` : null,
    counts.skipped > 0 ? `${counts.skipped} gone from Discord` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

function messages(count: number): string {
  return `${count.toLocaleString()} message${count === 1 ? "" : "s"}`;
}

/**
 * What Watch opens on an import's row (#2857): the import channel by channel.
 *
 * The channel importing now, the ones finished last, and the failures, each
 * linking to the Frapp channel it lands in once there is one. The counts come
 * from the server, so the panel stays small on a server of a thousand
 * channels; it polls only while the import is moving.
 *
 * Imported messages never arrive live in an open chat (Realtime leaves out
 * `kind = 'imported'` on purpose), so the panel says that opening a channel
 * shows what has landed so far.
 */
export function ImportWatchPanel({
  importId,
  active,
}: {
  importId: string;
  /** Still moving (queued or running): poll, and speak in the present. */
  active: boolean;
}) {
  const progress = useDiscordImportProgress(importId, { active });

  if (progress.isPending) {
    return <NestedLoading message="Loading the import’s channels…" lines={2} />;
  }
  if (progress.isError || !progress.data) {
    return (
      <NestedError
        title="Couldn’t load the import’s channels"
        description="The import itself is unaffected and keeps running. Try again in a moment."
        onRetry={() => void progress.refetch()}
      />
    );
  }

  const data = progress.data as ImportProgress;
  const nothingYet =
    data.running.length === 0 &&
    data.recent.length === 0 &&
    data.failed.length === 0;

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">
        Channels and threads: {progressSummary(data.counts)}
      </p>

      {data.running.length > 0 ? (
        <Section title="Importing now">
          {data.running.map((row) => (
            <ChannelLine
              key={row.discord_channel_id}
              row={row}
              detail={`${messages(row.imported_count)} so far`}
            />
          ))}
        </Section>
      ) : null}

      {data.recent.length > 0 ? (
        <Section title={active ? "Finished last" : "Finished"}>
          {data.recent.map((row) => (
            <ChannelLine
              key={row.discord_channel_id}
              row={row}
              detail={messages(row.imported_count)}
            />
          ))}
        </Section>
      ) : null}

      {data.failed.length > 0 ? (
        <Section title="Failed">
          {data.failed.map((row) => (
            <ChannelLine
              key={row.discord_channel_id}
              row={row}
              detail={row.error ?? "No reason was recorded."}
              failed
            />
          ))}
        </Section>
      ) : null}

      {nothingYet ? (
        <p className="text-xs text-muted-foreground">
          {active
            ? "Waiting for the first channel to start."
            : "No channel was imported."}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Imported messages don’t appear live in chat. Open a channel to see
          what has landed so far.
        </p>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className={cn(EYEBROW, "text-muted-foreground")}>{title}</p>
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}

function ChannelLine({
  row,
  detail,
  failed = false,
}: {
  row: WatchedChannel;
  detail: string;
  failed?: boolean;
}) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
      <span className="min-w-0">
        <span className="font-semibold">#{row.discord_channel_name}</span>{" "}
        <span
          className={failed ? "text-destructive-text" : "text-muted-foreground"}
        >
          {detail}
        </span>
      </span>
      {row.target_channel_id ? (
        <Link
          href={chatDeepLink({ channelId: row.target_channel_id })}
          className={cn(
            "shrink-0 rounded-sm text-accent-text underline-offset-2 hover:underline",
            FOCUS_RING,
          )}
        >
          Open in chat
          <span className="sr-only"> (#{row.discord_channel_name})</span>
        </Link>
      ) : null}
    </li>
  );
}
