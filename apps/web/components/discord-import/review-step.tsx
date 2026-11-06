"use client";

import { localIsoDate, parseBareDateLocalMidnight } from "@repo/formatting";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";
import type { ChannelChoice } from "./channel-mapping-step";
import type { StagedChannel, StagedExport, StagedRole } from "./upload-step";
import type { ImportSource } from "./source-step";
import type { RoleChoice, SameAsDiscordReaders } from "./role-matching";

const ACTION_LABEL: Record<ChannelChoice["action"], string> = {
  create_new: "New channel",
  use_existing: "Merged",
  skip: "Skipped",
};

const VISIBILITY_LABEL: Record<
  NonNullable<ChannelChoice["visibility"]>,
  string | null
> = {
  chapter: null,
  restricted: "restricted",
  discord: "same as Discord",
};

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
  const importing = staged.channels.filter(
    (channel) => channelChoices[channel.channelId]?.action !== "skip",
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
        The import runs in the background. You can leave this page. Its progress
        is on the Discord import page when you come back, and you get a
        notification when it finishes.
        {source === "bot"
          ? " Attachments are copied out of Discord as it goes, so a large server takes a while."
          : ""}
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

      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs text-muted-foreground">Server</dt>
          <dd className="font-semibold">{staged.guildName ?? "Discord"}</dd>
        </div>
        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs text-muted-foreground">
            {source === "bot" ? "How" : "Files uploaded"}
          </dt>
          <dd className="font-semibold">
            {/* A bot import uploads nothing, so a file count there would read
                as "zero files" rather than "not applicable". */}
            {source === "bot"
              ? "Read from Discord"
              : `${staged.exportCount} export · ${staged.mediaCount} media`}
          </dd>
        </div>
      </dl>

      <div className="rounded-lg border border-border p-3">
        <p className="font-semibold">
          {importing.length} of {staged.channels.length} channels
        </p>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {staged.channels.map((channel) => {
            const choice = channelChoices[channel.channelId];
            const visibility =
              choice?.action === "create_new" && choice.visibility
                ? VISIBILITY_LABEL[choice.visibility]
                : null;
            return (
              <li
                key={channel.channelId}
                className="flex justify-between gap-3"
              >
                <span>#{channel.channelName}</span>
                <span>
                  {choice ? ACTION_LABEL[choice.action] : "Skipped"}
                  {choice?.action === "create_new" && choice.newName
                    ? ` · #${choice.newName}`
                    : ""}
                  {visibility ? ` · ${visibility}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {sidebarGroups.length > 0 ? (
        <div className="rounded-lg border border-border p-3">
          <p>
            <span className="font-semibold">Categories:</span>{" "}
            {sidebarGroups.join(", ")}. Where your chapter already has a
            category by that name, the channels go there. Deleting the import
            removes the categories it made once they&rsquo;re empty.
          </p>
        </div>
      ) : null}

      {created.length > 0 || readers.length > 0 ? (
        <div className="space-y-1 rounded-lg border border-border p-3">
          {created.length > 0 ? (
            <p>
              <span className="font-semibold">New roles:</span>{" "}
              {created.join(", ")}. Deleting the import later keeps them.
            </p>
          ) : null}
          {readers.length > 0 ? (
            <p>
              <span className="font-semibold">
                Can read the channels imported same as Discord:
              </span>{" "}
              {readers.join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Nobody is put into a role by the import. Add people to roles in Settings
        → Roles once it finishes. Imported messages are read-only, never notify
        anyone, and never count as unread. You can delete the whole import
        later.
      </p>
    </div>
  );
}
