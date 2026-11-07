"use client";

import React, { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import {
  EVENT_ATTENDANCE_LABELS,
  EVENT_ATTENDANCE_STATUSES,
  roleChoicesFor,
  rolesToAdd,
  statusForAddedRole,
  withEveryone,
  withRole,
  type EventAttendanceDraft,
  type EventAttendanceStatus,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/components/ui/focus";
import type { RoleOption } from "@/lib/roles";

/**
 * Who's coming, by role (`spec/behavior/events.md` § Attendance by role): the
 * web editor's half of the mobile Who's coming sheet, built on the same moves
 * from `@repo/validation`, so the two set a rule the same way.
 *
 * A default for everyone, the roles that differ from it, and a search to add
 * one. A chapter with a hundred roles sees a short block: only roles the
 * officer has set are rows; the rest wait in the search.
 */
export function AttendanceEditor({
  value,
  onChange,
  roles,
  rolesState,
  disabled = false,
}: {
  value: EventAttendanceDraft;
  onChange: (next: EventAttendanceDraft) => void;
  roles: readonly RoleOption[];
  rolesState: "loading" | "error" | "ready";
  disabled?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const nameOf = useMemo(() => {
    const byId = new Map(roles.map((role) => [role.id, role.name]));
    return (id: string) =>
      byId.get(id) ?? (rolesState === "ready" ? "Removed role" : "Role");
  }, [roles, rolesState]);
  const addable = rolesToAdd(roles, value, search);
  const differing = Object.entries(value.roles);
  const added = statusForAddedRole(value.everyone);

  return (
    <div className="grid gap-2">
      <SegmentedChoice
        label="Attendance for everyone"
        options={EVENT_ATTENDANCE_STATUSES}
        value={value.everyone}
        onChange={(everyone) => onChange(withEveryone(value, everyone))}
        disabled={disabled}
      />
      <p className="text-caption text-muted-foreground">
        {value.everyone === "required"
          ? "Anyone who doesn't check in is marked absent. Alumni are left out unless you add their role."
          : value.everyone === "optional"
            ? "Everyone can see it and check in for points. Nobody is marked absent."
            : differing.length > 0
              ? "Only the roles below can see it."
              : "Add the roles this event is for."}
      </p>

      {differing.length > 0 ? (
        <ul
          aria-label="Roles that differ"
          className="divide-y divide-border rounded-md border border-border"
        >
          {differing.map(([roleId, status]) => (
            <li key={roleId} className="flex items-center gap-3 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {nameOf(roleId)}
              </span>
              <SegmentedChoice
                label={`Attendance for ${nameOf(roleId)}`}
                options={roleChoicesFor(value.everyone)}
                value={status}
                onChange={(next) => onChange(withRole(value, roleId, next))}
                disabled={disabled}
                compact
              />
              <IconButton
                label={`Remove ${nameOf(roleId)}`}
                disabled={disabled}
                onClick={() => onChange(withRole(value, roleId, null))}
              >
                <X className="h-4 w-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : null}

      <Popover
        open={adding}
        onOpenChange={(open) => {
          setAdding(open);
          if (!open) setSearch("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            className="justify-self-start"
            disabled={disabled || rolesState !== "ready" || roles.length === 0}
          >
            <Plus className="h-4 w-4" />
            Set a role differently
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-0">
          <Command shouldFilter={false}>
            <CommandInput
              value={search}
              onValueChange={setSearch}
              placeholder="Search roles"
              aria-label="Search roles"
            />
            <CommandList className="max-h-72">
              {addable.length === 0 ? (
                <p className="px-3 py-4 text-caption text-muted-foreground">
                  {search.trim()
                    ? "No roles match that search."
                    : "Every role is set already."}
                </p>
              ) : (
                addable.map((role) => (
                  <CommandItem
                    key={role.id}
                    value={role.id}
                    onSelect={() => {
                      onChange(withRole(value, role.id, added));
                      setAdding(false);
                      setSearch("");
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{role.name}</span>
                    <span className="text-caption text-muted-foreground">
                      {EVENT_ATTENDANCE_LABELS[added]}
                    </span>
                  </CommandItem>
                ))
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {rolesState === "error" ? (
        <p className="text-caption text-warning">
          Couldn&apos;t load your chapter&apos;s roles, so a role can&apos;t be
          added right now.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Two or three answers side by side, the held one lit: every answer in view,
 * so the current one never hides behind a menu.
 */
function SegmentedChoice({
  label,
  options,
  value,
  onChange,
  disabled,
  compact = false,
}: {
  label: string;
  options: readonly EventAttendanceStatus[];
  value: EventAttendanceStatus;
  onChange: (next: EventAttendanceStatus) => void;
  disabled: boolean;
  compact?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex rounded-md border border-input bg-surface-1 p-0.5",
        compact ? "shrink-0" : "w-full",
      )}
    >
      {options.map((option) => {
        const held = option === value;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={held}
            disabled={disabled}
            onClick={() => {
              if (!held) onChange(option);
            }}
            className={cn(
              "flex min-h-8 flex-1 items-center justify-center whitespace-nowrap rounded-sm px-3 text-sm font-semibold transition-colors pointer-coarse:min-h-11",
              // The held answer as chat search's filter radios draw theirs.
              held
                ? "bg-accent-subtle text-accent-text"
                : "text-muted-foreground hover:bg-card-hover hover:text-foreground",
              disabled && "pointer-events-none text-disabled",
              FOCUS_RING,
            )}
          >
            {EVENT_ATTENDANCE_LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}
