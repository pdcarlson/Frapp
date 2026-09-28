"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useChannels, usePermissionsCatalog } from "@repo/hooks";
import { asArray, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FOCUS_RING } from "@/components/ui/focus";
import { EYEBROW } from "@/components/ui/typography";
import { dashboardFormSelectClassName } from "@/components/shared/table-controls";
import {
  PermissionCheckboxGrid,
  type PermissionCatalogEntry,
} from "@/components/shared/permission-checkbox-grid";
import { useGateCatalog } from "@/components/shared/use-gate-catalog";
import type { StagedChannel } from "./upload-step";
import {
  asNewChannel,
  privacyReason,
  type ChannelChoice,
  type MappingIssue,
  type PrivacyReason,
} from "./mapping-issues";
import type { SameAsDiscordReaders } from "./role-matching";

type Visibility = NonNullable<ChannelChoice["visibility"]>;
type ReadersOf = (channel: StagedChannel) => SameAsDiscordReaders | null;

export type { ChannelChoice } from "./mapping-issues";

const ACTIONS: { key: ChannelChoice["action"]; label: string }[] = [
  { key: "create_new", label: "New channel" },
  { key: "use_existing", label: "Merge" },
  { key: "skip", label: "Skip" },
];

const NO_CATEGORY = "No category";

interface Group {
  name: string;
  channels: StagedChannel[];
}

/** Discord categories, in the order discovery returned their channels. */
function groupByCategory(channels: StagedChannel[]): Group[] {
  const groups = new Map<string, StagedChannel[]>();
  for (const channel of channels) {
    const name = channel.category ?? NO_CATEGORY;
    groups.set(name, [...(groups.get(name) ?? []), channel]);
  }
  return [...groups].map(([name, members]) => ({ name, channels: members }));
}

function rowId(channelId: string): string {
  return `discord-channel-${channelId}`;
}

/**
 * Where each Discord channel lands.
 *
 * Every readable channel starts as a new Frapp channel with its Discord name
 * (`defaultChoice`), so a server with no clashes needs no per-row clicks.
 * What still needs a decision is listed in Needs attention, which is the same
 * list that keeps Continue disabled: a name clash, a merge with no target, or
 * a channel that was (or may have been) private in Discord with no
 * visibility chosen yet. A private channel starts "Same as Discord" (#2818)
 * when the scan named the roles that could read it, and reads through the
 * role step's answers, so it needs attention only when none of them is
 * mapped.
 *
 * Merging is never inferred. `chat_channels` has no unique (chapter_id, name),
 * so a same-name Frapp channel is listed as a clash to resolve, not treated as
 * the answer.
 */
export function ChannelMappingStep({
  channels,
  choices,
  onChange,
  issues,
  knowsPrivacy,
  readersOf = () => null,
  onRescan,
  rescanning = false,
}: {
  channels: StagedChannel[];
  choices: Record<string, ChannelChoice>;
  onChange: (next: Record<string, ChannelChoice>) => void;
  issues: MappingIssue[];
  /** False on the upload path: an export does not say what was private. */
  knowsPrivacy: boolean;
  /** Who "Same as Discord" resolves to; null where it is not on offer. */
  readersOf?: ReadersOf;
  /** Bot path: scan the server again, after the bot has been given access. */
  onRescan?: () => void;
  rescanning?: boolean;
}) {
  const existingChannels = useChannels();
  const catalogQuery = usePermissionsCatalog();

  const readable = useMemo(
    () => channels.filter((channel) => channel.readable !== false),
    [channels],
  );
  const unreadable = useMemo(
    () => channels.filter((channel) => channel.readable === false),
    [channels],
  );
  const groups = useMemo(() => groupByCategory(readable), [readable]);

  const { catalog, holders } = useGateCatalog(
    useMemo(
      () => asArray<PermissionCatalogEntry>(catalogQuery.data),
      [catalogQuery.data],
    ),
  );

  const issuesByChannel = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const issue of issues) {
      if (!issue.channelId) continue;
      map.set(issue.channelId, [
        ...(map.get(issue.channelId) ?? []),
        issue.message,
      ]);
    }
    return map;
  }, [issues]);

  // A group opens itself when it has something to fix; otherwise the admin
  // decides. With eighty channels, closed-and-summarised is what makes the
  // step scannable. Once open it stays open until the admin closes it:
  // closing on the keystroke that clears its last issue would unmount the
  // very input being typed in.
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const flagged = groups
    .filter((group) =>
      group.channels.some((channel) => issuesByChannel.has(channel.channelId)),
    )
    .map((group) => group.name);
  const [autoOpened, setAutoOpened] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  if (flagged.some((name) => !autoOpened.has(name))) {
    // Recorded during render, React's pattern for state derived from props:
    // it re-renders before committing, so nothing flickers closed.
    setAutoOpened(new Set([...autoOpened, ...flagged]));
  }
  function isOpen(group: Group): boolean {
    return (
      opened[group.name] ??
      (autoOpened.has(group.name) || flagged.includes(group.name))
    );
  }

  function update(
    targets: StagedChannel[],
    patch: (current: ChannelChoice, channel: StagedChannel) => ChannelChoice,
  ) {
    const next = { ...choices };
    for (const channel of targets) {
      if (channel.readable === false) continue;
      next[channel.channelId] = patch(
        next[channel.channelId] ?? { action: "skip" },
        channel,
      );
    }
    onChange(next);
  }

  // A bulk answer settles the groups it covers: they go back to opening only
  // for what is still unresolved. Without this, an export (where every row
  // starts with something to answer) stays fully expanded after one
  // "whole chapter" click answers all of it.
  function bulk(
    targets: StagedChannel[],
    patch: (current: ChannelChoice, channel: StagedChannel) => ChannelChoice,
  ) {
    update(targets, patch);
    const settled = new Set(
      targets.map((channel) => channel.category ?? NO_CATEGORY),
    );
    setAutoOpened(
      (previous) => new Set([...previous].filter((name) => !settled.has(name))),
    );
  }

  const asNew = asNewChannel;
  const asSkip = (current: ChannelChoice) => ({
    ...current,
    action: "skip" as const,
  });

  function jump(channelId: string) {
    const group = groups.find((candidate) =>
      candidate.channels.some((channel) => channel.channelId === channelId),
    );
    if (group) setOpened((prev) => ({ ...prev, [group.name]: true }));
    // A click is a discrete event, so React has committed the opened group by
    // the next frame; the row exists to scroll to by then.
    requestAnimationFrame(() => {
      const row = document.getElementById(rowId(channelId));
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
      row
        ?.querySelector<HTMLElement>("input, select, button")
        ?.focus({ preventScroll: true });
    });
  }

  const serverVisibility = useBulkVisibility(
    readable,
    choices,
    (visibility, permissions) =>
      bulk(readable, withVisibility(visibility, permissions, readersOf)),
  );
  const offersDiscord = readable.some((channel) => readersOf(channel));

  if (channels.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No channels were found. If you uploaded an export, check that it was
        exported in JSON format.
      </p>
    );
  }

  const importing = readable.filter(
    (channel) => (choices[channel.channelId]?.action ?? "skip") !== "skip",
  ).length;
  const existingNames = asArray<{ id: string; name: string }>(
    existingChannels.data,
  );
  const permissionProps = {
    catalog,
    holders,
    catalogLoading: catalogQuery.isPending,
    catalogUnavailable: catalogQuery.isError,
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Every channel starts as a new Frapp channel with its Discord name.
        Change only what you need to. Anything that still needs a decision is
        listed under Needs attention.
      </p>
      {knowsPrivacy ? null : (
        <p className="text-sm text-muted-foreground">
          An export does not say which channels were private in Discord, so
          choose who can read each new channel. &ldquo;Set who can
          read&hellip;&rdquo; answers every channel, or a whole category, at
          once.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
        <p className="text-sm">
          <span className="font-semibold">{importing}</span> to import
          <span className="text-muted-foreground">
            {" "}
            · {readable.length - importing} skipped
            {unreadable.length > 0
              ? ` · ${unreadable.length} Frapp can't read`
              : ""}
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => bulk(readable, asNew)}
          >
            Import all as new
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => bulk(readable, asSkip)}
          >
            Skip all
          </Button>
          <BulkVisibilitySelect
            label="Who can read every new channel"
            bulk={serverVisibility}
            offersDiscord={offersDiscord}
          />
        </div>
        <BulkRestrictPanel
          scope="every new channel"
          bulk={serverVisibility}
          {...permissionProps}
        />
      </div>

      <NeedsAttention issues={issues} onJump={jump} />

      <div className="space-y-3">
        {groups.map((group) => (
          <CategoryGroup
            key={group.name}
            group={group}
            open={isOpen(group)}
            onToggle={() =>
              setOpened((prev) => ({ ...prev, [group.name]: !isOpen(group) }))
            }
            choices={choices}
            issuesByChannel={issuesByChannel}
            onBulk={(patch) => bulk(group.channels, patch)}
            asNew={asNew}
            asSkip={asSkip}
            onRow={(channel, patch) =>
              update([channel], (current) => ({ ...current, ...patch }))
            }
            existingNames={existingNames}
            readersOf={readersOf}
            {...permissionProps}
          />
        ))}
      </div>

      {unreadable.length > 0 ? (
        <UnreadableGroup
          channels={unreadable}
          onRescan={onRescan}
          rescanning={rescanning}
        />
      ) : null}
    </div>
  );
}

function NeedsAttention({
  issues,
  onJump,
}: {
  issues: MappingIssue[];
  onJump: (channelId: string) => void;
}) {
  if (issues.length === 0) {
    return (
      <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
        Nothing needs attention. Continue when the list below looks right.
      </p>
    );
  }
  return (
    <div
      role="region"
      aria-label="Needs attention"
      className="rounded-lg border border-warning/40 bg-warning-tint p-3"
    >
      <p className="text-sm font-semibold">Needs attention ({issues.length})</p>
      <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
        {issues.map((issue, index) => (
          <li key={`${issue.channelId ?? "all"}-${index}`}>
            {issue.channelId ? (
              <button
                type="button"
                onClick={() => onJump(issue.channelId as string)}
                className={cn(
                  "text-left text-sm text-accent-text underline-offset-2 hover:underline",
                  FOCUS_RING,
                )}
              >
                {issue.message}
              </button>
            ) : (
              <span className="text-sm">
                {issue.message}
                {issue.retry ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      onClick={issue.retry}
                      className={cn(
                        "text-accent-text underline-offset-2 hover:underline",
                        FOCUS_RING,
                      )}
                    >
                      Try again
                    </button>
                  </>
                ) : null}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CategoryGroup({
  group,
  open,
  onToggle,
  choices,
  issuesByChannel,
  onBulk,
  asNew,
  asSkip,
  onRow,
  existingNames,
  readersOf,
  catalog,
  holders,
  catalogLoading,
  catalogUnavailable,
}: {
  group: Group;
  open: boolean;
  onToggle: () => void;
  choices: Record<string, ChannelChoice>;
  issuesByChannel: ReadonlyMap<string, string[]>;
  onBulk: (
    patch: (current: ChannelChoice, channel: StagedChannel) => ChannelChoice,
  ) => void;
  asNew: (current: ChannelChoice, channel: StagedChannel) => ChannelChoice;
  asSkip: (current: ChannelChoice) => ChannelChoice;
  onRow: (channel: StagedChannel, patch: Partial<ChannelChoice>) => void;
  existingNames: { id: string; name: string }[];
  readersOf: ReadersOf;
  catalog: PermissionCatalogEntry[];
  holders: ReadonlyMap<string, readonly string[]>;
  catalogLoading: boolean;
  catalogUnavailable: boolean;
}) {
  const groupVisibility = useBulkVisibility(
    group.channels,
    choices,
    (visibility, permissions) =>
      onBulk(withVisibility(visibility, permissions, readersOf)),
  );
  const permissionProps = {
    catalog,
    holders,
    catalogLoading,
    catalogUnavailable,
  };

  const importing = group.channels.filter(
    (channel) => (choices[channel.channelId]?.action ?? "skip") !== "skip",
  ).length;
  const flagged = group.channels.filter((channel) =>
    issuesByChannel.has(channel.channelId),
  ).length;
  const privateCount = group.channels.filter(
    (channel) => channel.privateInDiscord === true,
  ).length;

  return (
    <section className="rounded-lg border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className={cn(
            "flex min-w-0 items-center gap-2 text-left",
            FOCUS_RING,
          )}
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
          )}
          <span className="min-w-0">
            <span className={cn(EYEBROW, "block text-muted-foreground")}>
              {group.name}
            </span>
            <span className="text-sm">
              {group.channels.length} channel
              {group.channels.length === 1 ? "" : "s"} · {importing} to import
              {privateCount > 0 ? ` · ${privateCount} private in Discord` : ""}
              {flagged > 0 ? (
                <span className="text-warning">
                  {" "}
                  · {flagged} need attention
                </span>
              ) : null}
            </span>
          </span>
        </button>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => onBulk(asNew)}>
            All new
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onBulk(asSkip)}>
            Skip all
          </Button>
          <BulkVisibilitySelect
            label={`Who can read the new channels in ${group.name}`}
            bulk={groupVisibility}
            offersDiscord={group.channels.some((channel) => readersOf(channel))}
          />
        </div>
        <BulkRestrictPanel
          scope={`every new channel in ${group.name}`}
          bulk={groupVisibility}
          {...permissionProps}
        />
      </div>

      {open ? (
        <div className="space-y-2 border-t border-border p-3">
          {group.channels.map((channel) => (
            <ChannelRow
              key={channel.channelId}
              channel={channel}
              choice={choices[channel.channelId]}
              problems={issuesByChannel.get(channel.channelId) ?? []}
              onPatch={(patch) => onRow(channel, patch)}
              existingNames={existingNames}
              readers={readersOf(channel)}
              {...permissionProps}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

// An export's rows carry no badge: every one would say the same thing, and
// the step says it once.
const PRIVACY_BADGES: Record<PrivacyReason, string | null> = {
  private: "Private in Discord",
  "private-threads": "Has private threads",
  unknown: "Privacy unknown",
  export: null,
};

function PrivacyBadge({ channel }: { channel: StagedChannel }) {
  const reason = privacyReason(channel);
  const label = reason ? PRIVACY_BADGES[reason] : null;
  return label ? <Badge variant="outline">{label}</Badge> : null;
}

/**
 * A bulk patch setting who can read every new channel it reaches. "Same as
 * Discord" reaches only the channels it is on offer for, and leaves the rest
 * as they were.
 */
function withVisibility(
  visibility: Visibility,
  permissions: ReadonlySet<string>,
  readersOf: ReadersOf,
) {
  return (current: ChannelChoice, channel: StagedChannel): ChannelChoice => {
    if (current.action !== "create_new") return current;
    if (visibility === "discord" && !readersOf(channel)) return current;
    return {
      ...current,
      visibility,
      requiredPermissions:
        visibility === "restricted" ? [...permissions] : undefined,
    };
  };
}

interface BulkVisibility {
  restricting: boolean;
  permissions: ReadonlySet<string>;
  choose: (value: string) => void;
  toggle: (permission: string) => void;
}

/**
 * One "Set who can read…" control: the whole chapter applies at once;
 * restricted opens a permission grid that applies on every tick.
 *
 * The ticks are read off the choices, never kept beside them: a permission
 * shows ticked only while every new channel in scope is restricted to it. So
 * the grid cannot show a restriction the channels do not hold, whether a
 * whole-chapter choice came from this control, another level's, or a row.
 */
function useBulkVisibility(
  targets: readonly StagedChannel[],
  choices: Record<string, ChannelChoice>,
  apply: (visibility: Visibility, permissions: ReadonlySet<string>) => void,
): BulkVisibility {
  const [restricting, setRestricting] = useState(false);
  const permissions = sharedRestriction(targets, choices);
  return {
    restricting,
    permissions,
    choose(value) {
      if (value === "chapter" || value === "discord") {
        setRestricting(false);
        apply(value, new Set());
      } else if (value === "restricted") {
        setRestricting(true);
      }
    },
    toggle(permission) {
      const next = new Set(permissions);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      apply("restricted", next);
    },
  };
}

/** The permissions every new channel in scope is restricted to, if all are. */
function sharedRestriction(
  targets: readonly StagedChannel[],
  choices: Record<string, ChannelChoice>,
): ReadonlySet<string> {
  const creating = targets
    .map((channel) => choices[channel.channelId])
    .filter((choice) => choice?.action === "create_new");
  if (
    creating.length === 0 ||
    creating.some((choice) => choice?.visibility !== "restricted")
  ) {
    return new Set();
  }
  let shared = new Set(creating[0]?.requiredPermissions ?? []);
  for (const choice of creating.slice(1)) {
    const held = new Set(choice?.requiredPermissions ?? []);
    shared = new Set([...shared].filter((permission) => held.has(permission)));
  }
  return shared;
}

function BulkVisibilitySelect({
  label,
  bulk,
  offersDiscord,
}: {
  label: string;
  bulk: BulkVisibility;
  /** Some channel in scope was private in Discord with its readers known. */
  offersDiscord: boolean;
}) {
  return (
    <select
      aria-label={label}
      className={cn(dashboardFormSelectClassName, "h-11 w-auto")}
      value=""
      onChange={(event) => bulk.choose(event.target.value)}
    >
      <option value="">Set who can read…</option>
      {offersDiscord ? (
        <option value="discord">Private ones: same as Discord</option>
      ) : null}
      <option value="chapter">All: whole chapter</option>
      <option value="restricted">All: restricted…</option>
    </select>
  );
}

function BulkRestrictPanel({
  scope,
  bulk,
  catalog,
  holders,
  catalogLoading,
  catalogUnavailable,
}: {
  scope: string;
  bulk: BulkVisibility;
  catalog: PermissionCatalogEntry[];
  holders: ReadonlyMap<string, readonly string[]>;
  catalogLoading: boolean;
  catalogUnavailable: boolean;
}) {
  if (!bulk.restricting) return null;
  return (
    <div className="basis-full border-t border-border pt-3">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        Restrict {scope}
      </Label>
      <p className="mt-1 text-xs text-muted-foreground">
        A member needs at least one of these permissions to read them.
      </p>
      <PermissionCheckboxGrid
        catalog={catalog}
        catalogLoading={catalogLoading}
        catalogUnavailable={catalogUnavailable}
        selected={new Set(bulk.permissions)}
        holders={holders}
        onToggle={bulk.toggle}
      />
    </div>
  );
}

function ChannelRow({
  channel,
  choice,
  problems,
  onPatch,
  existingNames,
  readers,
  catalog,
  holders,
  catalogLoading,
  catalogUnavailable,
}: {
  channel: StagedChannel;
  choice: ChannelChoice | undefined;
  problems: string[];
  onPatch: (patch: Partial<ChannelChoice>) => void;
  existingNames: { id: string; name: string }[];
  /** Who "Same as Discord" resolves to; null where it is not on offer. */
  readers: SameAsDiscordReaders | null;
  catalog: PermissionCatalogEntry[];
  holders: ReadonlyMap<string, readonly string[]>;
  catalogLoading: boolean;
  catalogUnavailable: boolean;
}) {
  const action = choice?.action ?? "skip";
  const selected = new Set(choice?.requiredPermissions ?? []);
  // "Same as Discord" with none of its roles mapped gates on nothing, so it
  // shows as not yet chosen, which is what Needs attention says too.
  const discordReaders =
    choice?.visibility === "discord" && readers && readers.roles.length > 0
      ? readers
      : null;
  const shownVisibility =
    choice?.visibility === "discord" && !discordReaders
      ? undefined
      : choice?.visibility;

  return (
    <div
      id={rowId(channel.channelId)}
      className={cn(
        "space-y-2 rounded-md border p-3",
        problems.length > 0 ? "border-warning/60" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <span className="truncate">#{channel.channelName}</span>
          <PrivacyBadge channel={channel} />
        </p>
        <div
          role="radiogroup"
          aria-label={`Where #${channel.channelName} should go`}
          className="flex gap-1"
        >
          {ACTIONS.map((option) => {
            const active = action === option.key;
            return (
              <button
                key={option.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() =>
                  onPatch(
                    option.key === "create_new"
                      ? asNewChannel(choice ?? { action: "skip" }, channel)
                      : { action: option.key },
                  )
                }
                className={cn(
                  "rounded-md border px-2.5 py-1.5 text-xs font-semibold transition",
                  FOCUS_RING,
                  active
                    ? "border-accent-border bg-accent-subtle-hover text-accent-text"
                    : "border-border text-muted-foreground hover:bg-accent-subtle",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {action === "create_new" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label
              htmlFor={`new-name-${channel.channelId}`}
              className="text-xs"
            >
              New channel name
            </Label>
            <Input
              id={`new-name-${channel.channelId}`}
              value={choice?.newName ?? ""}
              onChange={(event) => onPatch({ newName: event.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <Label
              htmlFor={`visibility-${channel.channelId}`}
              className="text-xs"
            >
              Who can read it
            </Label>
            <select
              id={`visibility-${channel.channelId}`}
              className={dashboardFormSelectClassName}
              value={shownVisibility ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                onPatch({
                  visibility:
                    value === "chapter" ||
                    value === "restricted" ||
                    value === "discord"
                      ? value
                      : undefined,
                  requiredPermissions:
                    value === "restricted"
                      ? (choice?.requiredPermissions ?? [])
                      : undefined,
                });
              }}
            >
              {shownVisibility === undefined ? (
                <option value="">Choose…</option>
              ) : null}
              {readers ? (
                <option value="discord" disabled={readers.roles.length === 0}>
                  Same as Discord
                </option>
              ) : null}
              <option value="chapter">Whole chapter</option>
              <option value="restricted">Restricted</option>
            </select>
          </div>
        </div>
      ) : null}

      {action === "create_new" && discordReaders ? (
        <p className="text-xs text-muted-foreground">
          Readable by {discordReaders.roles.join(", ")}.
          {discordReaders.ignored.length > 0
            ? ` Left out, because they are set to Ignore: ${discordReaders.ignored.join(", ")}.`
            : ""}
        </p>
      ) : null}

      {action === "create_new" && choice?.visibility === "restricted" ? (
        <div>
          <p className="text-xs text-muted-foreground">
            A member needs at least one of these permissions to read it.
          </p>
          <PermissionCheckboxGrid
            catalog={catalog}
            catalogLoading={catalogLoading}
            catalogUnavailable={catalogUnavailable}
            selected={selected}
            holders={holders}
            onToggle={(permission) => {
              const next = new Set(selected);
              if (next.has(permission)) next.delete(permission);
              else next.add(permission);
              onPatch({ requiredPermissions: [...next] });
            }}
          />
        </div>
      ) : null}

      {action === "use_existing" ? (
        <div className="grid gap-1">
          <Label htmlFor={`target-${channel.channelId}`} className="text-xs">
            Merge into
          </Label>
          <select
            id={`target-${channel.channelId}`}
            className={dashboardFormSelectClassName}
            value={choice?.targetChannelId ?? ""}
            onChange={(event) =>
              onPatch({ targetChannelId: event.target.value || undefined })
            }
          >
            <option value="">Pick a channel…</option>
            {existingNames.map((existing) => (
              <option key={existing.id} value={existing.id}>
                #{existing.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {problems.length > 0 ? (
        <ul className="space-y-0.5">
          {problems.map((problem) => (
            <li key={problem} className="text-xs text-warning">
              {problem}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function UnreadableGroup({
  channels,
  onRescan,
  rescanning,
}: {
  channels: StagedChannel[];
  onRescan?: () => void;
  rescanning: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-lg border border-border">
      <div className="flex flex-wrap items-start justify-between gap-3 p-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold">
            Frapp can&apos;t read these ({channels.length})
          </p>
          <p className="text-sm text-muted-foreground">
            Discord hides them from the Frapp bot, so they will be skipped. To
            import them, either allow the bot&apos;s own Frapp role View Channel
            and Read Message History on each channel (Edit Channel →
            Permissions; a category allow reaches only the channels still synced
            to it), which keeps it read-only, or give the Frapp bot a role that
            can see them (Server Settings → Members → Frapp), which is quicker
            but lends it everything that role can do. Then scan again.
          </p>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className={cn(
              "text-sm text-accent-text underline-offset-2 hover:underline",
              FOCUS_RING,
            )}
          >
            {open ? "Hide the list" : "Show which channels"}
          </button>
        </div>
        {onRescan ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={onRescan}
            disabled={rescanning}
          >
            {rescanning ? "Scanning…" : "Scan again"}
          </Button>
        ) : null}
      </div>
      {open ? (
        <ul className="flex flex-wrap gap-1.5 border-t border-border p-3">
          {channels.map((channel) => (
            <li key={channel.channelId}>
              <Badge variant="outline">#{channel.channelName}</Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
