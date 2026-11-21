"use client";

import { useMemo } from "react";
import { Eye } from "lucide-react";
import { useGroups, useRoles } from "@repo/hooks";
import {
  FOLLOWER_HEADINGS,
  followerChoices,
  listedFollowers,
  type FollowerChoice,
} from "@repo/hooks/task-follower-choices";
import { TASK_FOLLOWER_COPY } from "@repo/validation";
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

export type { FollowerChoice };

/** The Select's value for "Just you": a Select item can't hold "". */
const JUST_YOU = "none";

/**
 * The tiers, roles and groups the viewer is in, which a task they make or
 * edit can be from (#5473): the API takes only one its sender is in, so "From
 * Exec board" is true. The phone's From sheet lists the same, from the same
 * `followerChoices` (`@repo/hooks/task-follower-choices`): not the tier
 * holding the Everyone role, nor a class year or a major, which open nothing.
 */
export function useFollowerChoices(
  options: { enabled?: boolean } = {},
): FollowerChoice[] {
  // Read only where From can be changed: a read-only task panel needs none.
  const enabled = options.enabled ?? true;
  const { directory } = useWhoDirectory({ enabled });
  // The same reads the directory was built from, so these are cache hits.
  const roles = useRoles({ enabled });
  const groups = useGroups({ enabled });
  return useMemo(
    () =>
      followerChoices(directory, {
        roles: roles.data,
        groups: groups.data ?? null,
      }),
    [directory, roles.data, groups.data],
  );
}

/**
 * From (#5473): "Just you", or a tier, role or group the viewer is in, each
 * kind under its own heading (components.md § 2. Shared rules, the select rule). A task already from
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
  const listed = listedFollowers(choices, value, currentName ?? null);
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
            <SelectLabel>{FOLLOWER_HEADINGS[kind]}</SelectLabel>
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
