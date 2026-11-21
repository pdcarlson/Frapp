"use client";

import { useId, useMemo, useState } from "react";
import { useRoles } from "@repo/hooks";
import { toRoleOptions } from "@repo/hooks/chapter-roles";
import { FieldError } from "@/components/shared/short-form";
import { dashboardTableCheckboxClassName } from "@/components/shared/table-controls";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedChoice } from "@/components/ui/segmented";

/** Past this many roles the audience list gets a filter (a chapter can hold 100). */
const ROLE_FILTER_AT = 8;

export type MinutesAudience = "everyone" | "roles";

/**
 * Who reads minutes written for a meeting that wasn't on the calendar: the
 * event made for them invites everyone or only some roles, and that is who
 * reads the minutes (`spec/behavior/meetings.md` § Writing minutes by hand).
 * Link a meeting's Add it to the calendar (#4935) asks it here.
 */
export function MinutesAudienceField({
  audience,
  onAudienceChange,
  roleIds,
  onRoleIdsChange,
  error,
}: {
  audience: MinutesAudience;
  onAudienceChange: (next: MinutesAudience) => void;
  roleIds: string[];
  onRoleIdsChange: (next: string[]) => void;
  /** Shown under the role list, e.g. when no role is picked. */
  error?: string;
}) {
  const ids = useId();
  const rolesQuery = useRoles();
  const [roleFilter, setRoleFilter] = useState("");
  const roles = useMemo(
    () => toRoleOptions(rolesQuery.data),
    [rolesQuery.data],
  );
  const shownRoles = useMemo(() => {
    const term = roleFilter.trim().toLowerCase();
    return term
      ? roles.filter((role) => role.name.toLowerCase().includes(term))
      : roles;
  }, [roles, roleFilter]);

  return (
    <div className="grid gap-2">
      <Label id={`${ids}-audience`}>Who reads the minutes</Label>
      <SegmentedChoice
        label="Who reads the minutes"
        value={audience}
        onChange={onAudienceChange}
        options={[
          { value: "everyone", label: "Everyone" },
          { value: "roles", label: "Some roles" },
        ]}
      />
      {audience === "roles" ? (
        <div className="grid gap-2">
          {roles.length > ROLE_FILTER_AT ? (
            <Input
              aria-label="Find a role"
              placeholder="Find a role"
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
            />
          ) : null}
          <ul
            role="list"
            aria-labelledby={`${ids}-audience`}
            className="grid max-h-56 gap-0.5 overflow-y-auto"
          >
            {shownRoles.map((role) => {
              const checked = roleIds.includes(role.id);
              return (
                <li key={role.id}>
                  <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-card-hover pointer-coarse:min-h-11">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        onRoleIdsChange(
                          checked
                            ? roleIds.filter((id) => id !== role.id)
                            : [...roleIds, role.id],
                        )
                      }
                      className={dashboardTableCheckboxClassName}
                    />
                    <span className="truncate">{role.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          {error ? <FieldError>{error}</FieldError> : null}
        </div>
      ) : null}
      <p className="text-caption text-muted-foreground">
        It goes on the calendar with nobody required, no points, and no
        notification.
      </p>
    </div>
  );
}
