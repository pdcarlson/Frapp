"use client";

import { useMemo } from "react";
import { Layers, Plus, X } from "lucide-react";
import { normalizeChannelAccessList } from "@repo/validation";
import { cn } from "@/lib/utils";
import { SegmentedChoice } from "@/components/ui/segmented";
import { FOCUS_RING } from "@/components/ui/focus";
import { pausedRead } from "@/components/shared/async-states";
import { SearchablePicker } from "@/components/shared/searchable-picker";

import {
  channelAccessKindHeading,
  channelAccessReach,
  compareChannelAccessKinds,
  type ChannelAccessOption,
  type ChannelAccessQuestion,
} from "@repo/hooks/channel-access";

// The reading of a list lives in `@repo/hooks/channel-access`, shared with
// the phone's Edit channel sheet (#3702); re-exported for this page's callers.
export {
  describeChannelAccess,
  type ChannelAccessOption,
  type ChannelAccessQuestion,
} from "@repo/hooks/channel-access";

/** Whether a field's options have loaded, as `ChannelAccessField` reads it. */
export type ChannelAccessOptionsState = "ready" | "loading" | "error";

/**
 * The options read's state for `ChannelAccessField`, so the channel page and
 * the create sheet answer it the same way. A paused read is `"error"`, not
 * `"loading"`: nothing settles it until reconnect, so a spinner would hold
 * for the whole outage.
 */
export function channelAccessOptionsState(query: {
  data: unknown;
  isError: boolean;
  isPending: boolean;
  fetchStatus: string;
}): ChannelAccessOptionsState {
  return query.data !== undefined
    ? "ready"
    : query.isError || pausedRead(query)
      ? "error"
      : "loading";
}

const EVERYONE = "everyone";
const CHOSEN = "chosen";

const MODE_OPTIONS: Record<
  ChannelAccessQuestion,
  readonly { value: typeof EVERYONE | typeof CHOSEN; label: string }[]
> = {
  see: [
    { value: EVERYONE, label: "Everyone" },
    { value: CHOSEN, label: "Chosen roles" },
  ],
  post: [
    { value: EVERYONE, label: "Everyone who can see it" },
    { value: CHOSEN, label: "Chosen roles" },
  ],
};

const QUESTION_LABEL: Record<ChannelAccessQuestion, string> = {
  see: "Who can see",
  post: "Who can post",
};

function peopleCount(count: number): string {
  return `${count} ${count === 1 ? "person" : "people"}`;
}

/**
 * One of a channel's two questions (#3722): who can see it, or who can post.
 * Paul, 2026-11-10: each is "everyone" or a list of tiers and roles, nothing
 * more: no allow, deny and inherit per permission as Discord has it, and no
 * per-person overrides. So the field is a two-way switch and, for a list,
 * the chips it holds and an Add menu, the way Slack's channel posting
 * settings and this app's module "Who can" pages read.
 *
 * The Add menu is searchable and grouped by kind (tiers first, then roles),
 * each with the people it reaches, because an imported chapter can carry a
 * hundred roles. Under the chips, how many people the list reaches, each
 * counted once, so an officer setting a pledge-class channel sees "14 people"
 * rather than having to add it up.
 *
 * The President's `*` passes every list, so it is said, not listed.
 */
export function ChannelAccessField({
  id,
  question,
  value,
  onChange,
  options,
  optionsState,
  disabled = false,
  everyoneLabel,
  locked = [],
  alwaysLine,
  canChoose = true,
}: {
  id: string;
  question: ChannelAccessQuestion;
  /** `null` is everyone; a list names tiers and roles. */
  value: readonly string[] | null;
  onChange: (next: string[] | null) => void;
  options: readonly ChannelAccessOption[];
  /** Whether the options have loaded; the field still shows what it holds. */
  optionsState: ChannelAccessOptionsState;
  disabled?: boolean;
  /**
   * The open choice's name, when `null` means something other than
   * everyone: a document file's "Same as folder" (#3642 piece 1).
   */
  everyoneLabel?: string;
  /**
   * Entries every list this member writes keeps: a document list keeps the
   * setter's tier and those above. They start a new list and join a stored
   * one at its first edit, the way the API adds them on save, and are drawn
   * without a remove. A stored list is shown as it is until then, so an
   * officer looking at a list someone else set sees who it really reaches.
   */
  locked?: readonly string[];
  /** Who passes every list, said under the chips; the President by default. */
  alwaysLine?: string;
  /**
   * False when this member may not write a list at all (a document list
   * from outside every tier): the open choice stays on offer, so they can
   * still lift a list, but Chosen roles and its chips are read-only.
   */
  canChoose?: boolean;
}) {
  const mode = value === null ? EVERYONE : CHOSEN;
  const lockedSet = new Set(locked);
  const byEntry = useMemo(
    () => new Map(options.map((option) => [option.entry, option])),
    [options],
  );
  const chosen = value === null ? [] : [...value];
  const editable = !disabled && canChoose;
  const chosenSet = new Set(chosen);
  const remaining = options.filter(
    (option) => !chosenSet.has(option.entry) && !option.hidden,
  );
  const label = QUESTION_LABEL[question];
  const modeOptions = MODE_OPTIONS[question].map((option) =>
    option.value === EVERYONE && everyoneLabel
      ? { ...option, label: everyoneLabel }
      : option,
  );
  const always =
    alwaysLine ??
    `The President can always ${question === "see" ? "see it" : "post"}.`;

  function remove(entry: string) {
    onChange(
      normalizeChannelAccessList([
        ...locked,
        ...chosen.filter((held) => held !== entry),
      ]) ?? [],
    );
  }

  function add(entry: string) {
    onChange(normalizeChannelAccessList([...locked, ...chosen, entry]) ?? []);
  }

  return (
    <div className="grid gap-2" role="group" aria-labelledby={`${id}-label`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span id={`${id}-label`} className="text-sm font-medium">
          {label}
        </span>
        <SegmentedChoice
          label={label}
          options={
            canChoose
              ? modeOptions
              : modeOptions.map((option) =>
                  option.value === CHOSEN
                    ? { ...option, disabled: true }
                    : option,
                )
          }
          value={mode}
          disabled={disabled}
          onChange={(next) => onChange(next === EVERYONE ? null : [...locked])}
        />
      </div>
      {mode === CHOSEN ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {chosen.map((entry) => {
              const option = byEntry.get(entry);
              return (
                <AccessChip
                  key={entry}
                  option={option}
                  fallbackName={
                    optionsState === "ready"
                      ? "A removed role"
                      : optionsState === "loading"
                        ? "Loading"
                        : "Unavailable"
                  }
                  removeLabel={`Remove ${option?.name ?? "this entry"} from ${label.toLowerCase()}`}
                  onRemove={
                    !editable || lockedSet.has(entry)
                      ? undefined
                      : () => remove(entry)
                  }
                />
              );
            })}
            {!editable ? null : (
              <AddEntry
                label={label}
                options={remaining}
                optionsState={optionsState}
                onAdd={add}
              />
            )}
          </div>
          <p className="text-caption text-muted-foreground" aria-live="polite">
            {chosen.length === 0
              ? question === "see"
                ? "Add a tier, role or group. Until you do, only the President can see it."
                : "Add a tier, role or group. Until you do, only the President can post."
              : optionsState === "ready"
                ? `Reaches ${peopleCount(channelAccessReach(chosen, options))}. ${always}`
                : always}
          </p>
        </>
      ) : null}
    </div>
  );
}

function AccessChip({
  option,
  fallbackName,
  removeLabel,
  onRemove,
}: {
  option: ChannelAccessOption | undefined;
  fallbackName: string;
  removeLabel: string;
  onRemove?: () => void;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border border-border pl-2 text-caption text-foreground",
        onRemove ? "pr-0.5" : "pr-2",
      )}
    >
      <EntryMark option={option} />
      {option?.name ?? fallbackName}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className={cn(
            "grid h-5 w-5 place-items-center rounded-full text-muted-foreground hover:bg-card-hover hover:text-foreground",
            FOCUS_RING,
          )}
        >
          <X className="h-3 w-3" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

/** A tier draws as a stack (it holds roles); a role as its color dot. */
function EntryMark({ option }: { option: ChannelAccessOption | undefined }) {
  if (option?.kind === "tier") {
    return (
      <Layers className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
    );
  }
  return (
    <span
      aria-hidden
      className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground"
      style={option?.color ? { backgroundColor: option.color } : undefined}
    />
  );
}

function AddEntry({
  label,
  options,
  optionsState,
  onAdd,
}: {
  label: string;
  options: readonly ChannelAccessOption[];
  optionsState: ChannelAccessOptionsState;
  onAdd: (entry: string) => void;
}) {
  // "Find a tier, role or group", naming only what this picker offers: the
  // module Who can lists hold tiers and roles, never groups (#4076).
  const findLabel = `Find a ${orList(
    [...new Set(options.map((option) => option.kind))]
      .sort(compareChannelAccessKinds)
      .map((kind) => kind.toLowerCase()),
  )}`;

  return (
    <SearchablePicker
      trigger={
        <button
          type="button"
          aria-label={`Add to ${label.toLowerCase()}`}
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-border px-2 text-caption font-semibold text-muted-foreground hover:border-input hover:text-foreground",
            FOCUS_RING,
          )}
        >
          <Plus className="h-3 w-3" aria-hidden />
          Add
        </button>
      }
      align="start"
      widthClassName="min-w-[16rem] max-w-[min(24rem,calc(100vw-2rem))]"
      label={`Add to ${label.toLowerCase()}`}
      placeholder={findLabel}
      items={options}
      nameOf={(option) => option.name}
      keyOf={(option) => option.entry}
      groupsOf={(shown) =>
        [...new Set(shown.map((option) => option.kind))]
          .sort(compareChannelAccessKinds)
          .map((kind) => ({
            heading: channelAccessKindHeading(kind),
            items: shown.filter((option) => option.kind === kind),
          }))
      }
      status={
        optionsState === "loading"
          ? "Loading who you can add"
          : optionsState === "error"
            ? "Couldn't load your chapter's tiers and roles."
            : undefined
      }
      emptyText="Everything is already on the list."
      itemClassName="min-h-8 gap-2 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base"
      renderItem={(option) => (
        <>
          <EntryMark option={option} />
          <span className="min-w-0 flex-1 break-words">{option.name}</span>
          <span className="shrink-0 text-caption text-muted-foreground">
            {peopleCount(option.user_ids.length)}
          </span>
        </>
      )}
      onPick={(option) => onAdd(option.entry)}
    />
  );
}

/** "tier, role or group": a list read as alternatives. */
function orList(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "tier or role";
  return `${words.slice(0, -1).join(", ")} or ${words.at(-1)}`;
}
