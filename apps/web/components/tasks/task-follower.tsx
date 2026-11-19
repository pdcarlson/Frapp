"use client";

import { useMemo } from "react";
import { Eye } from "lucide-react";
import { useGroups } from "@repo/hooks";
import { allRoles } from "@repo/hooks/task-who-picker";
import {
  TASK_FOLLOWER_COPY,
  taskFollowerEntry,
  type TaskFollowerKind,
} from "@repo/validation";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWhoDirectory } from "@/components/tasks/who-picker";
import { cn } from "@/lib/utils";

/** One tier, role or group a task can be from (#5473). */
export interface FollowerChoice {
  entry: string;
  kind: TaskFollowerKind;
  name: string;
  /** How many active members it reaches now. */
  count: number;
}

const HEADINGS: Record<TaskFollowerKind, string> = {
  tier: "Tiers",
  role: "Roles",
  group: "Groups",
};

/** The Select's value for "Just you": a Select item can't hold "". */
const JUST_YOU = "none";

/**
 * The tiers, roles and groups the viewer is in, which a task they make or
 * edit can be from (#5473): the API takes only one its sender is in, so "From
 * Exec board" is true. Not a class year, which opens nothing either.
 */
export function useFollowerChoices(): FollowerChoice[] {
  const { directory } = useWhoDirectory();
  const groups = useGroups();
  return useMemo(() => {
    const viewer = directory.people.find((person) => person.isViewer)?.userId;
    if (!viewer) return [];
    const classYears = new Set(
      (groups.data ?? [])
        .filter((group) => group.kind === "class_year")
        .map((group) => group.id),
    );
    const choices: FollowerChoice[] = [];
    const add = (
      kind: TaskFollowerKind,
      id: string,
      name: string,
      ids: string[],
    ) => {
      if (!ids.includes(viewer)) return;
      choices.push({
        entry: taskFollowerEntry(kind, id),
        kind,
        name,
        count: ids.length,
      });
    };
    for (const tier of directory.tiers) {
      if (tier.set) add("tier", tier.set.id, tier.set.name, tier.set.memberIds);
    }
    for (const role of allRoles(directory)) {
      add("role", role.id, role.name, role.memberIds);
    }
    for (const group of directory.groups) {
      if (!classYears.has(group.id)) {
        add("group", group.id, group.name, group.memberIds);
      }
    }
    return choices;
  }, [directory, groups.data]);
}

/**
 * From (#5473): "Just you", or a tier, role or group the viewer is in, each
 * kind under its own heading (components.md § select). A task already from
 * one the viewer isn't in keeps it listed, by the name its read carries.
 */
export function FollowerSelect({
  id,
  value,
  currentName,
  choices,
  onChange,
  disabled,
  className,
}: {
  id?: string;
  value: string | null;
  /** The read's name for `value`, when the viewer isn't in it. */
  currentName?: string | null;
  choices: FollowerChoice[];
  onChange: (entry: string | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  const listed =
    value && !choices.some((choice) => choice.entry === value)
      ? [
          ...choices,
          {
            entry: value,
            kind: value.split(":")[0] as TaskFollowerKind,
            name: currentName?.trim() || TASK_FOLLOWER_COPY.deleted,
            count: 0,
          },
        ]
      : choices;
  const kinds = (["tier", "role", "group"] as const).filter((kind) =>
    listed.some((choice) => choice.kind === kind),
  );
  return (
    <Select
      value={value ?? JUST_YOU}
      onValueChange={(next) => onChange(next === JUST_YOU ? null : next)}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        aria-label={TASK_FOLLOWER_COPY.field}
        className={className}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={JUST_YOU}>{TASK_FOLLOWER_COPY.justYou}</SelectItem>
        {kinds.map((kind) => (
          <SelectGroup key={kind}>
            <SelectSeparator />
            <SelectLabel>{HEADINGS[kind]}</SelectLabel>
            {listed
              .filter((choice) => choice.kind === kind)
              .map((choice) => (
                <SelectItem key={choice.entry} value={choice.entry}>
                  {choice.count > 0
                    ? `${choice.name} · ${choice.count}`
                    : choice.name}
                </SelectItem>
              ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

/** "From Exec board" on a task's row, tile or review (#5473). */
export function FollowerChip({
  name,
  className,
}: {
  name: string | null | undefined;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1 text-caption text-muted-foreground",
        className,
      )}
    >
      <Eye className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{TASK_FOLLOWER_COPY.chip(name)}</span>
    </span>
  );
}
