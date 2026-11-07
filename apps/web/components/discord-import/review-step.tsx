"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronRight, Hash, Lock } from "lucide-react";
import { useChannels } from "@repo/hooks";
import { localIsoDate, parseBareDateLocalMidnight } from "@repo/formatting";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FOCUS_RING } from "@/components/ui/focus";
import { asArray, cn } from "@/lib/utils";
import type { ChannelChoice } from "./channel-mapping-step";
import { isImportTarget, type ExistingChannel } from "./mapping-issues";
import type { StagedChannel, StagedExport, StagedRole } from "./upload-step";
import type { ImportSource } from "./source-step";
import type { RoleChoice, SameAsDiscordReaders } from "./role-matching";

/** How far back a bot import reads (#2858), as one-tap choices. */
export type CutoffPreset = "all" | "4y" | "2y" | "1y" | "date";

export const CUTOFF_PRESETS: {
  key: CutoffPreset;
  label: string;
  years?: number;
}[] = [
  { key: "all", label: "Everything" },
  { key: "4y", label: "Last 4 years", years: 4 },
  { key: "2y", label: "Last 2 years", years: 2 },
  { key: "1y", label: "Last year", years: 1 },
  { key: "date", label: "Pick a date" },
];

/**
 * The date a preset starts from, `YYYY-MM-DD` in the viewer's own zone, or
 * empty for everything. "Pick a date" keeps whatever date is already chosen.
 */
export function presetCutoff(
  preset: CutoffPreset,
  current: string,
  today: Date = new Date(),
): string {
  if (preset === "date") return current;
  const years = CUTOFF_PRESETS.find((option) => option.key === preset)?.years;
  if (!years) return "";
  const start = new Date(today);
  start.setFullYear(start.getFullYear() - years);
  return localIsoDate(start);
}

/**
 * When a Discord server was made, read from its id: a Discord id (a
 * snowflake) carries its own creation time in its top bits, counted in
 * milliseconds from 2015-01-01. Costs no read. Null for an id that isn't one.
 */
export function discordCreatedAt(id: string | null | undefined): Date | null {
  if (!id || !/^\d{17,20}$/.test(id)) return null;
  const ms = Number(BigInt(id) >> BigInt(22)) + 1_420_070_400_000;
  return new Date(ms);
}

const MONTH_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
});
const DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function ReviewStep({
  staged,
  serverName = null,
  source,
  channelChoices,
  roles,
  roleChoices,
  readersOf,
  messagesSince = "",
  onMessagesSinceChange,
  messagesSinceProblem = null,
  cutoffPreset = "all",
  onCutoffPresetChange,
  serverCreatedAt = null,
  sidebarGroups = [],
}: {
  staged: StagedExport;
  /** The Discord server's name, when known. */
  serverName?: string | null;
  source: ImportSource;
  channelChoices: Record<string, ChannelChoice>;
  roles: StagedRole[];
  roleChoices: Record<string, RoleChoice>;
  readersOf: (channel: StagedChannel) => SameAsDiscordReaders | null;
  /**
   * Bot path: the date cutoff (#2858) as the date input holds it,
   * `YYYY-MM-DD` or empty for all history.
   */
  messagesSince?: string;
  onMessagesSinceChange?: (value: string) => void;
  /** Why the chosen date can't be used, or null. */
  messagesSinceProblem?: string | null;
  /** Which of the cutoff's choices is picked. */
  cutoffPreset?: CutoffPreset;
  onCutoffPresetChange?: (preset: CutoffPreset) => void;
  /** When the connected Discord server was made, for the cutoff's hint. */
  serverCreatedAt?: Date | null;
  /** The channel groups the import puts new channels into, if any. */
  sidebarGroups?: string[];
}) {
  // Null while the date box holds a part-typed date; the problem line covers it.
  const cutoffDay = messagesSince
    ? parseBareDateLocalMidnight(messagesSince)
    : null;
  const importing = staged.channels.filter((channel) => {
    const action = channelChoices[channel.channelId]?.action;
    return action !== undefined && action !== "skip";
  });
  const skipped = staged.channels.filter(
    (channel) => !importing.includes(channel),
  );
  const unreadable = skipped.filter(
    (channel) => channel.readable === false,
  ).length;
  const existingChannels = useChannels();
  // Merge targets by id, to name them; a DM is never one (`isImportTarget`).
  const existingNames = useMemo(
    () =>
      new Map(
        asArray<ExistingChannel>(existingChannels.data)
          .filter(isImportTarget)
          .map((channel) => [channel.id, channel.name]),
      ),
    [existingChannels.data],
  );
  // What starting the import does to roles: which it creates, and which
  // Frapp roles are given read access to the channels imported "Same as
  // Discord". It never puts anyone into one.
  const created = [
    ...new Set(
      roles.flatMap((role) => {
        const choice = roleChoices[role.roleId];
        return choice?.action === "new" ? [choice.name.trim()] : [];
      }),
    ),
  ];
  const readers = [
    ...new Set(
      staged.channels.flatMap((channel) => {
        const choice = channelChoices[channel.channelId];
        if (
          choice?.action !== "create_new" ||
          choice.visibility !== "discord"
        ) {
          return [];
        }
        return readersOf(channel)?.roles ?? [];
      }),
    ),
  ];

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        {[
          source === "bot"
            ? serverName
              ? `${serverName}, read by the Frapp bot.`
              : "Read by the Frapp bot."
            : `${serverName ? `${serverName}: ` : ""}${staged.exportCount} export${staged.exportCount === 1 ? "" : "s"} and ${staged.mediaCount} media file${staged.mediaCount === 1 ? "" : "s"}.`,
          "It runs in the background, so you can leave this page: its progress is on the Discord import page, and you get a notification when it finishes.",
          source === "bot" ? "A large server takes a while." : null,
        ]
          .filter(Boolean)
          .join(" ")}
      </p>

      {/*
        First, because it decides how much the import reads at all (#2858),
        and an empty date box at the bottom of the step was easy to miss.
      */}
      {source === "bot" && onMessagesSinceChange && onCutoffPresetChange ? (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <p id="import-cutoff-label" className="font-semibold">
            How far back should we go?
          </p>
          <p className="text-xs text-muted-foreground">
            Older messages and their files are never read or stored. You
            can&apos;t change this once the import starts.
          </p>
          <div
            role="radiogroup"
            aria-labelledby="import-cutoff-label"
            className="flex flex-wrap gap-1.5"
          >
            {CUTOFF_PRESETS.map((option) => {
              const active = cutoffPreset === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onCutoffPresetChange(option.key)}
                  className={cn(
                    "h-9 rounded-md border px-3 text-sm font-semibold transition pointer-coarse:h-11",
                    FOCUS_RING,
                    active
                      ? "border-accent-border bg-accent-subtle-hover text-accent-text"
                      : "border-border text-muted-foreground hover:bg-card-hover",
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          {cutoffPreset === "date" ? (
            <div className="grid gap-1 pt-1">
              <Label htmlFor="import-messages-since">
                Import messages from
              </Label>
              <Input
                id="import-messages-since"
                type="date"
                className="max-w-48"
                value={messagesSince}
                // Today in the viewer's own zone.
                max={localIsoDate(new Date())}
                aria-describedby="import-messages-since-hint"
                aria-invalid={messagesSinceProblem ? true : undefined}
                onChange={(event) => onMessagesSinceChange(event.target.value)}
              />
            </div>
          ) : null}
          <p
            id="import-messages-since-hint"
            className={
              messagesSinceProblem
                ? "text-xs text-destructive-text"
                : "text-xs text-muted-foreground"
            }
          >
            {messagesSinceProblem ??
              [
                serverCreatedAt
                  ? `Your server was made in ${MONTH_YEAR.format(serverCreatedAt)}.`
                  : null,
                cutoffDay
                  ? `Messages before ${DAY.format(cutoffDay)} are left out.`
                  : "The server's whole history comes over.",
              ]
                .filter(Boolean)
                .join(" ")}
          </p>
        </div>
      ) : null}

      <SummarySection
        title={`Importing ${importing.length} channel${importing.length === 1 ? "" : "s"}`}
        meta={importingMeta(importing, channelChoices)}
        defaultOpen
      >
        <ShowMore
          items={importing}
          limit={12}
          noun="channels"
          list={(shown) => (
            <ul className="space-y-1">
              {shown.map((channel) => (
                <ImportingRow
                  key={channel.channelId}
                  channel={channel}
                  choice={channelChoices[channel.channelId]}
                  existingNames={existingNames}
                />
              ))}
            </ul>
          )}
        />
      </SummarySection>

      {skipped.length > 0 ? (
        <SummarySection
          title={`Skipping ${skipped.length}`}
          meta={
            unreadable > 0 ? `${unreadable} Frapp can\u2019t read` : undefined
          }
        >
          <ChipList
            names={skipped.map((channel) => `#${channel.channelName}`)}
          />
        </SummarySection>
      ) : null}

      {sidebarGroups.length > 0 ? (
        <SummarySection
          title={`${sidebarGroups.length} sidebar categor${sidebarGroups.length === 1 ? "y" : "ies"}`}
          meta="Same-name ones are reused; deleting the import removes new ones once empty"
        >
          <ChipList names={sidebarGroups} />
        </SummarySection>
      ) : null}

      {created.length > 0 ? (
        <SummarySection
          title={`Creating ${created.length} role${created.length === 1 ? "" : "s"}`}
          meta="Deleting the import keeps them"
        >
          <ChipList names={created} />
        </SummarySection>
      ) : null}

      {readers.length > 0 ? (
        <SummarySection
          title={`${readers.length} role${readers.length === 1 ? "" : "s"} can read private channels`}
          meta="The channels imported same as Discord"
        >
          <ChipList names={readers} />
        </SummarySection>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Nobody is added to a role: do that in Settings → Roles afterwards.
        Imported messages are read-only, never notify anyone, and never count as
        unread. You can delete the whole import later.
      </p>
    </div>
  );
}

/** "12 private · 3 merged": only what differs from plain. */
function importingMeta(
  channels: StagedChannel[],
  choices: Record<string, ChannelChoice>,
): string | undefined {
  let locked = 0;
  let merged = 0;
  for (const channel of channels) {
    const choice = choices[channel.channelId];
    if (choice?.action === "use_existing") merged += 1;
    else if (choice?.visibility && choice.visibility !== "chapter") locked += 1;
  }
  const parts = [
    locked > 0 ? `${locked} private` : null,
    merged > 0 ? `${merged} merged` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * One imported channel: its Frapp name with a lock when not everyone can read
 * it, and a note only where it differs from what the step started with.
 */
function ImportingRow({
  channel,
  choice,
  existingNames,
}: {
  channel: StagedChannel;
  choice: ChannelChoice | undefined;
  existingNames: ReadonlyMap<string, string>;
}) {
  const merged = choice?.action === "use_existing";
  const name = merged
    ? channel.channelName
    : choice?.newName?.trim() || channel.channelName;
  const locked =
    !merged && !!choice?.visibility && choice.visibility !== "chapter";
  let note: string | null = null;
  if (merged) {
    const target = choice?.targetChannelId
      ? existingNames.get(choice.targetChannelId)
      : undefined;
    note = target ? `into #${target}` : "merged";
  } else if (choice?.visibility === "restricted") {
    note = "restricted";
  } else if (
    choice?.visibility === "chapter" &&
    channel.privateInDiscord === true
  ) {
    note = "whole chapter";
  } else if (name !== channel.channelName) {
    note = `from #${channel.channelName}`;
  }
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-1.5">
        {locked ? (
          <Lock
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-label="Private"
          />
        ) : (
          <Hash
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
        )}
        <span className="truncate">{name}</span>
      </span>
      {note ? (
        <span className="shrink-0 text-xs text-muted-foreground">{note}</span>
      ) : null}
    </li>
  );
}

/** A titled, foldable block of the summary: a count first, the list on tap. */
function SummarySection({
  title,
  meta,
  defaultOpen = false,
  children,
}: {
  title: string;
  meta?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={cn(
          "flex w-full flex-wrap items-baseline gap-x-2 p-3 text-left",
          FOCUS_RING,
        )}
      >
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 self-center text-muted-foreground transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
          aria-hidden
        />
        <span className="font-semibold">{title}</span>
        {meta ? (
          <span className="text-xs text-muted-foreground">{meta}</span>
        ) : null}
      </button>
      {open ? (
        <div className="border-t border-border p-3">{children}</div>
      ) : null}
    </section>
  );
}

/** The first `limit` items, and a button for the rest. */
function ShowMore<T>({
  items,
  limit,
  noun,
  list,
}: {
  items: T[];
  limit: number;
  /** Said after "Show all N", if anything. */
  noun?: string;
  list: (shown: T[]) => ReactNode;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, limit);
  return (
    <div className="space-y-2">
      {list(shown)}
      {items.length > limit ? (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className={cn(
            "text-sm text-accent-text underline-offset-2 hover:underline",
            FOCUS_RING,
          )}
        >
          {all
            ? "Show fewer"
            : `Show all ${items.length}${noun ? ` ${noun}` : ""}`}
        </button>
      ) : null}
    </div>
  );
}

function ChipList({ names }: { names: string[] }) {
  return (
    <ShowMore
      items={names}
      limit={24}
      list={(shown) => (
        <ul className="flex flex-wrap gap-1.5">
          {shown.map((name, index) => (
            // Discord allows one name in two categories (#general twice).
            <li key={`${index}:${name}`}>
              <Badge variant="outline">{name}</Badge>
            </li>
          ))}
        </ul>
      )}
    />
  );
}
