"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Check, ChevronRight, Minus, Search, Users } from "lucide-react";
import {
  useCurrentUser,
  useGroups,
  useMemberDisplayNames,
  useMembers,
  useRoleTiers,
  useRoles,
} from "@repo/hooks";
import { TASK_AUDIENCE_COPY, type TaskWho } from "@repo/validation";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { SegmentedChoice } from "@/components/ui/segmented";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn, initials } from "@/lib/utils";
import {
  EVERYONE_IN_CHAPTER,
  GROUPS_HEADING,
  NOBODY_YET,
  WHO_PICKER_COPY,
  allRoles,
  allTierSets,
  buildWhoDirectory,
  initialOpenTiers,
  initialWhoTab,
  isGroupWho,
  pickerMode,
  setTick,
  tickChecked,
  tickedIds,
  tierKey,
  toggleChapter,
  togglePerson,
  toggleSet,
  whoHint,
  whoLabel,
  whoMatches,
  whoMode,
  whoSummary,
  withMode,
  type WhoDirectory,
  type WhoMode,
  type WhoPerson,
  type WhoSet,
} from "@repo/hooks/task-who-picker";

/**
 * The chapter as the Who picker reads it: its active members, roles under
 * their tiers, and groups. Shared so a row elsewhere on the page (Up for
 * grabs, a group task) names people and roles the way the picker does.
 */
export function useWhoDirectory(options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const members = useMembers({ enabled });
  const roles = useRoles({ enabled });
  const tiers = useRoleTiers();
  const groups = useGroups({ enabled });
  const viewer = useCurrentUser();
  const viewerId = (viewer.data as { id?: string } | undefined)?.id ?? null;
  const directory = useMemo(
    () =>
      buildWhoDirectory({
        members: members.data,
        roles: roles.data,
        tiers: tiers.data,
        groups: groups.data,
        viewerUserId: viewerId,
      }),
    [members.data, roles.data, tiers.data, groups.data, viewerId],
  );
  return {
    directory,
    loading: members.data === undefined && !members.isError,
    failed: members.isError && members.data === undefined,
    retry: () => void members.refetch(),
  };
}

/**
 * What the picker may hand back: `any` is every kind (the board's add line
 * and New task); `person` is one member (Assign on Up for grabs, a chat
 * card's task, which posts a card for one person); `personOrEveryone` is one
 * member or a copy each for the chapter (the task form's Everyone, #4295).
 */
export type WhoPickerAllow = "any" | "person" | "personOrEveryone";

export interface WhoPickerProps {
  value: TaskWho | null;
  onChange: (next: TaskWho | null) => void;
  allow?: WhoPickerAllow;
  /** The trigger's accessible name; its text is the pick. */
  label?: string;
  /** What the trigger says with nobody picked. */
  placeholder?: string;
  disabled?: boolean;
  /** Submitted with nobody picked: outlined, as a missing field is. */
  invalid?: boolean;
  id?: string;
  className?: string;
  align?: "start" | "end";
  /** A trigger of the caller's own (Up for grabs' Assign). */
  trigger?: ReactElement;
  "aria-describedby"?: string;
  /**
   * Offer a tier whole (#5473). Off for a suggested task, whose payload has
   * no tier field yet, so a tier pick there would send nobody.
   */
  tiers?: boolean;
}

/**
 * One picker everywhere a task's who is chosen (Paul, 2026-11-18): the add
 * line, the task panel, a suggested task and the task form. People are a
 * checkbox each, the way Microsoft Planner's and ClickUp's assignee menus
 * are; roles and groups sit on a second tab as the chapter's own tree, with
 * "Everyone in the chapter" at the top of both, and search finds people,
 * roles and groups together, as Slack's user groups sit beside people. Once
 * more than one person is in, the footer asks whether each of them does it
 * (a copy each, Google Classroom's "All students") or one of them claims it
 * (Up for grabs, an open shift in When I Work).
 */
export const WhoPicker = forwardRef<HTMLButtonElement, WhoPickerProps>(
  function WhoPicker(
    {
      value,
      onChange,
      allow = "any",
      label = "Who",
      placeholder = "Who",
      disabled,
      invalid,
      id,
      className,
      align = "start",
      trigger,
      "aria-describedby": describedBy,
      tiers = true,
    },
    ref,
  ) {
    const [open, setOpen] = useState(false);
    const { directory, loading, failed, retry } = useWhoDirectory({
      enabled: open || value !== null,
    });
    const picked = whoLabel(value, directory);
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {trigger ?? (
            <Button
              ref={ref}
              id={id}
              type="button"
              size="toolbar"
              variant="secondary"
              disabled={disabled}
              aria-label={picked ? `${label}: ${picked}` : label}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              className={cn(
                "min-w-0 max-w-full justify-start gap-1.5 font-normal",
                invalid && "border-destructive text-destructive-text",
                !picked && "text-muted-foreground",
                className,
              )}
            >
              <Users className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{picked ?? placeholder}</span>
            </Button>
          )}
        </PopoverTrigger>
        <PopoverContent
          align={align}
          // Kept on screen in the Tasks column, whose right edge is the
          // viewport's when chat is closed: Radix shifts it in rather than
          // clip it. Beside chat (#5575) it may overlap chat's panel, as a
          // popover does.
          collisionPadding={12}
          className="w-[min(22rem,calc(100vw-1.5rem))] p-0"
          onOpenAutoFocus={(event) => {
            // The search field takes focus, not the first row.
            event.preventDefault();
            const field = (event.currentTarget as HTMLElement | null)?.querySelector(
              "input",
            );
            field?.focus();
          }}
        >
          <WhoPickerBody
            value={value}
            onChange={(next) => {
              onChange(next);
              if (allow !== "any") setOpen(false);
            }}
            allow={allow}
            tiers={tiers}
            directory={directory}
            loading={loading}
            failed={failed}
            onRetry={retry}
            onDone={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>
    );
  },
);

type Tab = "people" | "sets";

const TAB_OPTIONS = [
  { value: "people", label: WHO_PICKER_COPY.people },
  { value: "sets", label: WHO_PICKER_COPY.rolesAndGroups },
] as const;

const MODE_OPTIONS = [
  { value: "each", label: WHO_PICKER_COPY.each },
  { value: "someone", label: WHO_PICKER_COPY.someone },
] as const;

/** Groups fold like a tier, and start open. */
const GROUPS_KEY = "groups";

/** The sections a picker opens on: its tiers by the shared rule, and Groups. */
function opening(who: TaskWho | null, directory: WhoDirectory): Set<string> {
  return new Set([...initialOpenTiers(who, directory), GROUPS_KEY]);
}

/** The popover's inside, exported for specs and for a caller with its own shell. */
export function WhoPickerBody({
  value,
  onChange,
  allow,
  tiers = true,
  directory,
  loading,
  failed,
  onRetry,
  onDone,
}: {
  value: TaskWho | null;
  onChange: (next: TaskWho | null) => void;
  allow: WhoPickerAllow;
  /** Offer a tier whole (#5473); see {@link WhoPickerProps.tiers}. */
  tiers?: boolean;
  directory: WhoDirectory;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  onDone: () => void;
}) {
  const ids = useId();
  const { avatarTintFor } = useMemberDisplayNames();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>(() => initialWhoTab(value));
  // Tiers, groups and sets opened: every tier in a small chapter, only the
  // one holding the pick past a dozen roles (where all open would bury it).
  const [opened, setOpened] = useState<Set<string>>(() =>
    opening(value, directory),
  );
  // Roles and groups can land after the picker opens: seed the open
  // sections once from the first directory that has any.
  const seeded = useRef(directory.sets.size > 0);
  useEffect(() => {
    if (seeded.current || directory.sets.size === 0) return;
    seeded.current = true;
    setOpened(opening(value, directory));
  }, [directory, value]);
  // The mode a group takes, held while one person is picked, so ticking a
  // second person comes back to the last answer.
  const [heldMode, setHeldMode] = useState<WhoMode>(() =>
    pickerMode(value, "each"),
  );
  const mode = pickerMode(value, heldMode);
  // The role or group a pick was narrowed from, for "5 of Recruitment".
  const [narrowedFrom, setNarrowedFrom] = useState<WhoSet | null>(null);
  const many = allow === "any";
  const included = useMemo(
    () => new Set(tickedIds(value, directory)),
    [value, directory],
  );
  const chapterPicked =
    value !== null && value.kind !== "person" && value.target.kind === "chapter";

  function pick(next: TaskWho | null, from: WhoSet | null = null) {
    setNarrowedFrom(from);
    if (isGroupWho(next)) setHeldMode(whoMode(next));
    onChange(next);
  }

  function toggleOpen(key: string) {
    setOpened((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const searching = query.trim() !== "";
  const people = directory.people.filter((person) =>
    whoMatches(person.name, query),
  );
  const allSets = [
    ...(tiers ? allTierSets(directory) : []),
    ...allRoles(directory),
    ...directory.groups,
  ];
  const sets = many ? allSets.filter((set) => whoMatches(set.name, query)) : [];

  const personRow = (person: WhoPerson, from: WhoSet | null = null) => (
    <PickRow
      key={`${from?.id ?? "p"}:${person.userId}`}
      indent={from !== null}
      tick={
        many
          ? included.has(person.userId)
          : value?.kind === "person" && value.userId === person.userId
      }
      kind={many ? "checkbox" : "radio"}
      onClick={() =>
        pick(
          many
            ? togglePerson(value, person.userId, mode, directory)
            : { kind: "person", userId: person.userId },
          // A member unticked inside a role or group: "5 of Recruitment".
          many ? from : null,
        )
      }
      leading={
        <PersonFace person={person} tint={avatarTintFor(person.userId)} />
      }
      name={person.name}
      trailing={
        person.isViewer ? (
          <span className="text-caption text-muted-foreground">you</span>
        ) : null
      }
    />
  );

  const setRow = (set: WhoSet) => {
    const empty = set.memberIds.length === 0;
    const key = `set:${set.id}`;
    const expanded = opened.has(key) && !empty;
    return (
      <li key={set.id}>
        <PickRow
          tick={tickChecked(setTick(value, set, directory))}
          kind="checkbox"
          disabled={empty}
          onClick={() => pick(toggleSet(value, set, mode, directory))}
          name={set.name}
          trailing={
            <span className="text-caption text-muted-foreground">
              {empty ? NOBODY_YET : set.memberIds.length}
            </span>
          }
          after={
            empty ? null : (
              <button
                type="button"
                aria-expanded={expanded}
                aria-label={`${expanded ? "Hide" : "Show"} who's in ${set.name}`}
                onClick={() => toggleOpen(key)}
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-card-hover hover:text-foreground",
                  FOCUS_RING,
                )}
              >
                <ChevronRight
                  className={cn(
                    "h-4 w-4 transition-transform",
                    expanded && "rotate-90",
                  )}
                  aria-hidden="true"
                />
              </button>
            )
          }
        />
        {expanded ? (
          <ul aria-label={`Who's in ${set.name}`}>
            {set.memberIds.map((userId) => {
              const person = directory.byId.get(userId);
              return person ? personRow(person, set) : null;
            })}
          </ul>
        ) : null}
      </li>
    );
  };

  const chapterRow =
    allow === "person" ? null : (
      <PickRow
        tick={chapterPicked}
        kind={many ? "checkbox" : "radio"}
        onClick={() =>
          pick(
            many
              ? toggleChapter(value, mode, directory)
              : { kind: "each", target: { kind: "chapter" } },
          )
        }
        leading={
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-1">
            <Users className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          </span>
        }
        name={EVERYONE_IN_CHAPTER}
        trailing={
          <span className="text-caption text-muted-foreground">
            {directory.people.length}
          </span>
        }
      />
    );

  const count = included.size;
  const summary = whoSummary(value, directory, narrowedFrom);
  const hint = whoHint(value, directory);

  let list: ReactNode;
  if (loading) {
    list = <p className="px-3 py-4 text-sm text-muted-foreground">Loading members…</p>;
  } else if (failed) {
    list = (
      <div className="grid gap-2 px-3 py-4 text-sm text-muted-foreground">
        <p>Couldn&apos;t load the chapter&apos;s members.</p>
        <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  } else if (directory.people.length === 0) {
    list = (
      <p className="px-3 py-4 text-sm text-muted-foreground">
        Nobody to give it to yet. Invite members from the Directory.
      </p>
    );
  } else if (searching) {
    list =
      people.length === 0 && sets.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">
          Nothing matches &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : (
        <ul aria-label="Matches">
          {people.map((person) => (
            <li key={person.userId}>{personRow(person)}</li>
          ))}
          {sets.map(setRow)}
        </ul>
      );
  } else if (tab === "people" || !many) {
    list = (
      <ul aria-label="People">
        {chapterRow ? <li>{chapterRow}</li> : null}
        {directory.people.map((person) => (
          <li key={person.userId}>{personRow(person)}</li>
        ))}
      </ul>
    );
  } else {
    const section = (
      key: string,
      title: string,
      rows: WhoSet[],
      whole: WhoSet | null = null,
    ) => {
      if (rows.length === 0) return null;
      const isOpen = opened.has(key);
      return (
        <li key={key}>
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={() => toggleOpen(key)}
            className={cn(
              "flex w-full items-center gap-1.5 px-3 pb-1 pt-3 text-left text-caption font-semibold text-muted-foreground hover:text-foreground",
              FOCUS_RING,
            )}
          >
            <ChevronRight
              className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-90")}
              aria-hidden="true"
            />
            {title}
            <span className="ml-auto font-normal">{rows.length}</span>
          </button>
          {isOpen ? (
            <ul aria-label={title}>
              {/* The tier as a whole first (#5473): everyone holding a role
                  in it, as Slack's user groups sit above their members. */}
              {whole
                ? setRow({
                    ...whole,
                    name: TASK_AUDIENCE_COPY.everyoneIn(whole.name),
                  })
                : null}
              {rows.map(setRow)}
            </ul>
          ) : null}
        </li>
      );
    };
    list = (
      <ul aria-label="Roles and groups">
        {chapterRow ? <li>{chapterRow}</li> : null}
        {directory.tiers.map((tier) =>
          section(
            tierKey(tier),
            tier.name,
            tier.roles,
            // A tier of one role is that role: no second row for it.
            tiers && tier.roles.length > 1 ? tier.set : null,
          ),
        )}
        {section(GROUPS_KEY, GROUPS_HEADING, directory.groups)}
      </ul>
    );
  }

  return (
    <div className="grid">
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          id={`${ids}-search`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              event.stopPropagation();
              setQuery("");
            }
          }}
          aria-label={many ? WHO_PICKER_COPY.search : WHO_PICKER_COPY.searchPeople}
          placeholder={many ? WHO_PICKER_COPY.search : WHO_PICKER_COPY.searchPeople}
          className="h-11 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      {many && !searching ? (
        <div className="px-3 pt-3">
          <SegmentedChoice
            label="Show"
            options={TAB_OPTIONS}
            value={tab}
            onChange={setTab}
            fill
            dense
          />
        </div>
      ) : null}
      <div className="max-h-[min(22rem,50vh)] overflow-y-auto py-1">{list}</div>
      {many && count > 1 ? (
        <div className="grid gap-2 border-t border-border px-3 py-3">
          <p className="truncate text-sm font-semibold text-foreground">{summary}</p>
          <SegmentedChoice
            label="How it's given"
            options={MODE_OPTIONS}
            value={mode}
            onChange={(next: WhoMode) => {
              setHeldMode(next);
              pick(withMode(value, next), narrowedFrom);
            }}
            fill
            dense
          />
          {hint ? <p className="text-caption text-muted-foreground">{hint}</p> : null}
          <Button type="button" size="sm" className="justify-self-end" onClick={onDone}>
            Done
          </Button>
        </div>
      ) : many && count === 1 ? (
        <div className="flex items-center justify-end border-t border-border px-3 py-2">
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Done
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** One row: a tick box (or a radio dot), a face, a name, a count. */
function PickRow({
  tick,
  kind,
  onClick,
  leading,
  name,
  trailing,
  after,
  disabled = false,
  indent = false,
}: {
  tick: boolean | "mixed";
  kind: "checkbox" | "radio";
  onClick: () => void;
  leading?: ReactNode;
  name: string;
  trailing?: ReactNode;
  after?: ReactNode;
  disabled?: boolean;
  indent?: boolean;
}) {
  return (
    <div className={cn("flex items-center pr-1", indent && "pl-6")}>
      <button
        type="button"
        role={kind}
        aria-checked={tick}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "flex min-h-9 min-w-0 flex-1 items-center gap-2.5 rounded-md px-3 py-1 text-left text-sm text-foreground hover:bg-card-hover pointer-coarse:min-h-11",
          "disabled:cursor-not-allowed disabled:text-disabled disabled:hover:bg-transparent",
          FOCUS_RING,
        )}
      >
        <TickBox tick={tick} kind={kind} disabled={disabled} />
        {leading}
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {trailing}
      </button>
      {after}
    </div>
  );
}

function TickBox({
  tick,
  kind,
  disabled,
}: {
  tick: boolean | "mixed";
  kind: "checkbox" | "radio";
  disabled: boolean;
}) {
  const on = tick !== false;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center border",
        kind === "radio" ? "rounded-full" : "rounded",
        on
          ? "border-primary bg-primary text-primary-foreground"
          : "border-control-edge",
        disabled && "border-border",
      )}
    >
      {tick === "mixed" ? (
        <Minus className="h-3 w-3" />
      ) : tick ? (
        <Check className="h-3 w-3" />
      ) : null}
    </span>
  );
}

function PersonFace({
  person,
  tint,
}: {
  person: WhoPerson;
  tint: ReturnType<ReturnType<typeof useMemberDisplayNames>["avatarTintFor"]>;
}) {
  return (
    <Avatar className="h-6 w-6">
      {person.avatarUrl ? <AvatarImage src={person.avatarUrl} alt="" /> : null}
      <AvatarFallback tint={tint} className="text-caption">
        {initials(person.name)}
      </AvatarFallback>
    </Avatar>
  );
}

