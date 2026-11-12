"use client";

import React, { useMemo, useState } from "react";
import {
  EVENT_ATTENDANCE_LABELS,
  EVENT_ATTENDANCE_STATUSES,
  attendanceOfRole,
  attendanceRows,
  describeAttendance,
  withEveryone,
  withRole,
  type EventAttendanceDraft,
} from "@repo/validation";
import { Input } from "@/components/ui/input";
import { SegmentedChoice } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import type { RoleOption } from "@/lib/roles";

/** Past this many roles the list gets a search field. */
const SEARCH_FROM = 8;

/**
 * Who's coming, by role (`spec/behavior/events.md` § Attendance by role): the
 * web editor's half of the mobile Who's coming sheet, on the same moves from
 * `@repo/validation`, so the two set a rule the same way (#3706).
 *
 * One line says the whole rule; then "Everyone else" and one row per role,
 * each with the same three answers. A role that only follows Everyone else
 * holds its answer in neutral ink, a role set apart is lit in the accent.
 * Comparable: Discord's channel permission overrides, a row per role with the
 * same three-way switch and @everyone first.
 *
 * At real scale (an imported chapter brings a hundred roles) the rows scroll
 * in a bounded list, a search narrows them past {@link SEARCH_FROM}, and the
 * roles set apart when the editor opened lead, in an order kept for the
 * visit so a row never jumps out from under the pointer.
 */
export function AttendanceEditor({
  value,
  onChange,
  roles,
  rolesState,
  disabled = false,
  allowRequired = true,
}: {
  value: EventAttendanceDraft;
  onChange: (next: EventAttendanceDraft) => void;
  roles: readonly RoleOption[];
  rolesState: "loading" | "error" | "ready";
  disabled?: boolean;
  /**
   * False drops Required from every row, Everyone else included, for a
   * member who may create events but not require attendance (#3709).
   */
  allowRequired?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [pinned] = useState(() => Object.keys(value.roles));
  const missingName = rolesState === "ready" ? "Removed role" : "Role";
  const nameOf = useMemo(() => {
    const byId = new Map(roles.map((role) => [role.id, role.name]));
    return (id: string) => byId.get(id);
  }, [roles]);
  const rows = useMemo(
    () => attendanceRows(roles, pinned, search, missingName),
    [roles, pinned, search, missingName],
  );
  const options = EVENT_ATTENDANCE_STATUSES.filter(
    (status) => allowRequired || status !== "required",
  ).map((status) => ({
    value: status,
    label: EVENT_ATTENDANCE_LABELS[status],
  }));

  return (
    <div className="grid gap-2">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {describeAttendance(value, nameOf)}
      </p>

      <div className="rounded-md border border-border">
        <AttendanceRow name="Everyone else" strong>
          <SegmentedChoice
            dense
            label="Attendance for everyone else"
            options={options}
            value={value.everyone}
            onChange={(everyone) => onChange(withEveryone(value, everyone))}
            disabled={disabled}
          />
        </AttendanceRow>

        {roles.length > SEARCH_FROM ? (
          <div className="border-t border-border px-3 py-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search roles"
              aria-label="Search roles"
            />
          </div>
        ) : null}

        <ul aria-label="Roles" className="max-h-80 overflow-y-auto">
          {rows.map((role) => {
            const setApart = role.id in value.roles;
            return (
              <li key={role.id} className="border-t border-border">
                <AttendanceRow name={role.name} muted={!setApart}>
                  <SegmentedChoice
                    dense
                    label={`Attendance for ${role.name}`}
                    options={options}
                    value={attendanceOfRole(value, role.id)}
                    onChange={(next) =>
                      onChange(withRole(value, role.id, next))
                    }
                    disabled={disabled}
                    quiet={!setApart}
                  />
                </AttendanceRow>
              </li>
            );
          })}
        </ul>
        {rows.length === 0 ? (
          <p className="border-t border-border px-3 py-3 text-caption text-muted-foreground">
            {rolesState === "loading"
              ? "Loading roles…"
              : rolesState === "error"
                ? "Couldn't load your chapter's roles."
                : roles.length === 0
                  ? "Your chapter has no roles yet."
                  : "No roles match that search."}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** A name and its answers; the answers wrap under the name in a narrow panel. */
function AttendanceRow({
  name,
  strong = false,
  muted = false,
  children,
}: {
  name: string;
  strong?: boolean;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
      <span
        className={cn(
          "min-w-[6rem] flex-1 truncate text-sm",
          strong && "font-semibold",
          muted ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {name}
      </span>
      {children}
    </div>
  );
}
