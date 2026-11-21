"use client";

import { useMemo, type ReactNode } from "react";
import { groupPermissionsByModule } from "@repo/validation";
import { permissionRows } from "@repo/hooks/role-tiers";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useIsPermissionHidden } from "@repo/hooks";

/**
 * The page of switches a tier or a role is edited on (#3990): one group per
 * module, in the registry's order and words, one switch per permission,
 * saved on click.
 *
 * Paul asked for "a list of things under each kind of module... and then you
 * have all these toggles", with room to breathe, in place of the roles ×
 * permissions matrix. Discord's role permissions page is the same shape: a
 * long single column of labelled switches, each with one line saying what it
 * opens, grouped under headings.
 */
export function PermissionSwitchList({
  idPrefix,
  holderName,
  isOn,
  onToggle,
  extraPermissions = [],
  lockedReason,
  rowNote,
  rowLockedReason,
  pendingPermission,
}: {
  /** Prefix for element ids, unique on the page. */
  idPrefix: string;
  /** Names the holder in each switch's accessible name. */
  holderName: string;
  isOn: (permission: string) => boolean;
  onToggle: (permission: string, currentlyOn: boolean) => void;
  /** Strings the holder carries that the registry does not list. */
  extraPermissions?: readonly string[];
  /** Set when nothing on the page can change, saying why, once at the top. */
  lockedReason?: string | null;
  /** A short note under one row's label (e.g. "Changed for this role"). */
  rowNote?: (permission: string) => ReactNode;
  /** Why one row can't change, or null when it can. */
  rowLockedReason?: (permission: string, currentlyOn: boolean) => string | null;
  /** The permission whose write is in flight, if any. */
  pendingPermission?: string | null;
}) {
  const isHidden = useIsPermissionHidden();
  const groups = useMemo(
    () => groupPermissionsByModule(permissionRows(extraPermissions, isHidden)),
    [extraPermissions, isHidden],
  );

  return (
    <div className="space-y-8">
      {lockedReason ? (
        <p className="text-sm text-muted-foreground">{lockedReason}</p>
      ) : null}
      {groups.map((group) => {
        const groupId = `${idPrefix}-${group.label.replace(/\W+/g, "-").toLowerCase()}`;
        return (
          <section
            key={group.label}
            aria-labelledby={groupId}
            className="space-y-2"
          >
            <h3 id={groupId} className="text-sm font-semibold text-foreground">
              {group.label}
            </h3>
            <ul className="divide-y divide-border rounded-[14px] border border-border bg-card">
              {group.entries.map((row) => {
                const on = isOn(row.permission);
                const rowReason = rowLockedReason?.(row.permission, on) ?? null;
                const disabled =
                  Boolean(lockedReason) ||
                  rowReason !== null ||
                  pendingPermission === row.permission;
                const switchId = `${idPrefix}-${row.permission.replace(/\W+/g, "-")}`;
                const note = rowNote?.(row.permission);
                return (
                  <li
                    key={row.permission}
                    className="flex items-start justify-between gap-6 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <label
                        htmlFor={switchId}
                        className={cn(
                          "text-sm font-medium",
                          disabled && !lockedReason
                            ? "text-muted-foreground"
                            : "text-foreground",
                        )}
                      >
                        {row.label}
                      </label>
                      {row.description ? (
                        <p className="mt-0.5 text-caption text-muted-foreground">
                          {row.description}
                        </p>
                      ) : null}
                      {note ? (
                        <p className="mt-0.5 text-caption text-accent-text">
                          {note}
                        </p>
                      ) : null}
                      {rowReason && !lockedReason ? (
                        <p className="mt-0.5 text-caption text-muted-foreground">
                          {rowReason}
                        </p>
                      ) : null}
                    </div>
                    <Switch
                      id={switchId}
                      checked={on}
                      disabled={disabled}
                      aria-label={`${row.label} for ${holderName}`}
                      onCheckedChange={() => onToggle(row.permission, on)}
                      className="mt-0.5 shrink-0"
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
