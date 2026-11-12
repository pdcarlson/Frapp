"use client";

import { useMemo, useState } from "react";
import { Layers, Plus, X } from "lucide-react";
import { matchesWordStarts, normalizeWords } from "@repo/hooks/fuzzy-match";
import { normalizeChannelAccessList } from "@repo/validation";
import { cn } from "@/lib/utils";
import { SegmentedChoice } from "@/components/ui/segmented";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FOCUS_RING } from "@/components/ui/focus";

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
  channelAccessReach,
  describeChannelAccess,
  type ChannelAccessOption,
  type ChannelAccessQuestion,
} from "@repo/hooks/channel-access";

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
}: {
  id: string;
  question: ChannelAccessQuestion;
  /** `null` is everyone; a list names tiers and roles. */
  value: readonly string[] | null;
  onChange: (next: string[] | null) => void;
  options: readonly ChannelAccessOption[];
  /** Whether the options have loaded; the field still shows what it holds. */
  optionsState: "ready" | "loading" | "error";
  disabled?: boolean;
}) {
  const mode = value === null ? EVERYONE : CHOSEN;
  const byEntry = useMemo(
    () => new Map(options.map((option) => [option.entry, option])),
    [options],
  );
  const chosen = value ?? [];
  const chosenSet = new Set(chosen);
  const remaining = options.filter(
    (option) => !chosenSet.has(option.entry) && !option.hidden,
  );
  const label = QUESTION_LABEL[question];

  function remove(entry: string) {
    onChange(chosen.filter((held) => held !== entry));
  }

  function add(entry: string) {
    onChange(normalizeChannelAccessList([...chosen, entry]) ?? []);
  }

  return (
    <div className="grid gap-2" role="group" aria-labelledby={`${id}-label`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span id={`${id}-label`} className="text-sm font-medium">
          {label}
        </span>
        <SegmentedChoice
          label={label}
          options={MODE_OPTIONS[question]}
          value={mode}
          disabled={disabled}
          onChange={(next) => onChange(next === EVERYONE ? null : [])}
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
                  onRemove={disabled ? undefined : () => remove(entry)}
                />
              );
            })}
            {disabled ? null : (
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
                ? "Add a tier or role. Until you do, only the President can see it."
                : "Add a tier or role. Until you do, only the President can post."
              : optionsState === "ready"
                ? `Reaches ${peopleCount(channelAccessReach(chosen, options))}. The President can always ${question === "see" ? "see it" : "post"}.`
                : `The President can always ${question === "see" ? "see it" : "post"}.`}
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
  optionsState: "ready" | "loading" | "error";
  onAdd: (entry: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const shown =
    normalizeWords(query).length === 0
      ? options
      : options.filter((option) => matchesWordStarts(option.name, query));
  const kinds = [...new Set(shown.map((option) => option.kind))].sort(
    compareChannelAccessKinds,
  );
  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
    >
      <PopoverTrigger asChild>
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
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-max min-w-[16rem] max-w-[min(24rem,calc(100vw-2rem))] p-0"
        onEscapeKeyDown={(event) => {
          if (!query) return;
          event.preventDefault();
          setQuery("");
        }}
      >
        <Command
          tabIndex={-1}
          className="outline-none"
          shouldFilter={false}
          label={`Add to ${label.toLowerCase()}`}
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Find a tier or role"
            className="h-9 py-2 text-sm pointer-coarse:h-11 pointer-coarse:text-base"
          />
          <CommandList className="max-h-72 p-1">
            {optionsState === "loading" ? (
              <p role="status" className="px-2 py-3 text-sm text-muted">
                Loading tiers and roles
              </p>
            ) : optionsState === "error" ? (
              <p role="status" className="px-2 py-3 text-sm text-muted">
                Couldn&apos;t load your chapter&apos;s tiers and roles.
              </p>
            ) : shown.length === 0 ? (
              <p role="status" className="px-2 py-3 text-sm text-muted">
                {normalizeWords(query).length === 0
                  ? "Everything is already on the list."
                  : `Nothing matches “${query.trim()}”.`}
              </p>
            ) : (
              kinds.map((kind) => (
                <CommandGroup
                  key={kind}
                  heading={channelAccessKindHeading(kind)}
                >
                  {shown
                    .filter((option) => option.kind === kind)
                    .map((option) => (
                      <CommandItem
                        key={option.entry}
                        value={option.entry}
                        className="min-h-8 gap-2 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base"
                        onSelect={() => {
                          onAdd(option.entry);
                          close();
                        }}
                      >
                        <EntryMark option={option} />
                        <span className="min-w-0 flex-1 break-words">
                          {option.name}
                        </span>
                        <span className="shrink-0 text-caption text-muted-foreground">
                          {peopleCount(option.user_ids.length)}
                        </span>
                      </CommandItem>
                    ))}
                </CommandGroup>
              ))
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
