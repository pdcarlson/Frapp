"use client";

import React, { useMemo, useState } from "react";
import {
  ALUMNI_FOLLOWING_NOTE,
  ATTENDANCE_SEARCH_FROM,
  EVENT_ATTENDANCE_LABELS,
  alumniRoleIdOf,
  attendanceChoices,
  attendanceOfRole,
  attendanceRows,
  describeAttendance,
  withEveryone,
  withRole,
  type EventAttendanceDraft,
  type EventAttendanceStatus,
} from "@repo/validation";
import { useRoles } from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedChoice } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import type { RoleOption } from "@/lib/roles";

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
 * At real scale (an imported chapter brings a hundred roles) the rows flow
 * with the panel's body (nothing scrolls inside a panel, `components.md`
 * § Surface size): the roles set apart lead, then the first few others, with
 * "Show all" for the rest and a search past {@link ATTENDANCE_SEARCH_FROM}.
 * The order is taken when the editor opens, or when the form loads another
 * event's rule, so a row never jumps out from under the pointer.
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
   * False drops Required from the answers, for a member who may make events
   * but not require attendance; a row already Required keeps it so its answer
   * stays visible (`attendanceChoices`).
   */
  allowRequired?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [pinned, setPinned] = useState(() => Object.keys(value.roles));
  // A draft this editor didn't produce (the form loading another event, a
  // type picked) is a new rule: its roles lead. Its own edits keep the order.
  const [seen, setSeen] = useState(value);
  const [emitted, setEmitted] = useState<EventAttendanceDraft | null>(null);
  if (value !== seen) {
    setSeen(value);
    if (value !== emitted) setPinned(Object.keys(value.roles));
  }
  const emit = (next: EventAttendanceDraft) => {
    setEmitted(next);
    onChange(next);
  };

  const alumniId = alumniRoleIdOf(useRoles().data);
  const missingName = rolesState === "ready" ? "Removed role" : "Role";
  const nameOf = useMemo(() => {
    const byId = new Map(roles.map((role) => [role.id, role.name]));
    return (id: string) => byId.get(id) ?? missingName;
  }, [roles, missingName]);
  const rows = useMemo(
    () => attendanceRows(roles, pinned, search, missingName),
    [roles, pinned, search, missingName],
  );
  const searching = search.trim() !== "";
  const collapsedCount = Math.max(ATTENDANCE_SEARCH_FROM, pinned.length);
  const shown = showAll || searching ? rows : rows.slice(0, collapsedCount);
  const options = (current: EventAttendanceStatus) =>
    attendanceChoices(current, allowRequired).map((status) => ({
      value: status,
      label: EVENT_ATTENDANCE_LABELS[status],
    }));

  return (
    <div className="grid gap-2">
      {/* Two lines held, so a longer rule never pushes the rows down. */}
      <p
        className="line-clamp-2 min-h-[2lh] text-sm text-muted-foreground"
        aria-live="polite"
      >
        {describeAttendance(value, nameOf)}
      </p>
      {rolesState === "error" ? (
        <p className="text-caption text-warning">
          Couldn&apos;t load your chapter&apos;s roles, so role names may be
          missing.
        </p>
      ) : null}

      <div className="rounded-md border border-border">
        <AttendanceRow name="Everyone else" strong>
          <SegmentedChoice
            dense
            label="Attendance for everyone else"
            options={options(value.everyone)}
            value={value.everyone}
            onChange={(everyone) => emit(withEveryone(value, everyone))}
            disabled={disabled}
          />
        </AttendanceRow>

        {roles.length > ATTENDANCE_SEARCH_FROM ? (
          <div className="border-t border-border px-3 py-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search roles"
              aria-label="Search roles"
            />
          </div>
        ) : null}

        <ul aria-label="Roles">
          {shown.map((role) => {
            const setApart = role.id in value.roles;
            const current = attendanceOfRole(value, role.id);
            return (
              <li key={role.id} className="border-t border-border">
                <AttendanceRow
                  name={role.name}
                  muted={!setApart}
                  note={
                    role.id === alumniId &&
                    !setApart &&
                    value.everyone !== "not_invited"
                      ? ALUMNI_FOLLOWING_NOTE
                      : undefined
                  }
                >
                  <SegmentedChoice
                    dense
                    label={`Attendance for ${role.name}`}
                    options={options(current)}
                    value={current}
                    onChange={(next) => emit(withRole(value, role.id, next))}
                    disabled={disabled}
                    quiet={!setApart}
                  />
                </AttendanceRow>
              </li>
            );
          })}
        </ul>
        {shown.length < rows.length ? (
          <div className="border-t border-border px-3 py-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAll(true)}
            >
              Show all {rows.length} roles
            </Button>
          </div>
        ) : null}
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
  note,
  strong = false,
  muted = false,
  children,
}: {
  name: string;
  /** One short line under the name, for a fact the answer can't show. */
  note?: string;
  strong?: boolean;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
      <span className="grid min-w-[6rem] flex-1">
        <span
          className={cn(
            "truncate text-sm",
            strong && "font-semibold",
            muted ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {name}
        </span>
        {note ? (
          <span className="text-caption text-muted-foreground">
            {note}
          </span>
        ) : null}
      </span>
      {children}
    </div>
  );
}
