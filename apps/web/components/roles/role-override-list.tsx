"use client";

import { useMemo } from "react";
import { Check, Minus } from "lucide-react";
import { groupPermissionsByModule } from "@repo/validation";
import { useIsPermissionHidden, useUpdateRole } from "@repo/hooks";
import { SegmentedChoice } from "@/components/ui/segmented";
import { permissionRows } from "@repo/hooks/role-tiers";
import {
  useOverrideOverlay,
  type Override,
} from "@repo/hooks/permission-overlay";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";
import type { TieredRole, TierRow } from "@repo/hooks/role-tiers";

type Choice = "off" | "tier" | "on";

const toChoice = (value: Override): Choice =>
  value === null ? "tier" : value ? "on" : "off";
const fromChoice = (choice: Choice): Override =>
  choice === "tier" ? null : choice === "on";

/**
 * A role in a tier, edited the way Paul described it (#4072): "2 columns of
 * toggles... the first column... is what's set for the tier. And then next
 * to it... override for specific role... the override takes precedence over
 * the tier specific setting".
 *
 * The first column is the tier's switch, read-only here (it changes on the
 * tier's page). The second picks Off, Same as tier, or On for this role, the
 * three answers Discord gives a channel's per-role override (deny, inherit,
 * allow), in words rather than its ✕ / ⁄ / ✓. GitHub's repository roles are
 * the same shape: a base role, plus what one role adds or takes away.
 * "Same as tier" is a real answer, not just an empty cell: a role left on it
 * follows the tier when the tier changes, and one set On or Off keeps its
 * answer whatever the tier does later.
 *
 * Each pick saves on its own, as one key of `permission_overrides`
 * (`PATCH /v1/roles/:id`), so two quick picks on different rows never
 * overwrite each other the way two whole-list writes could.
 */
export function RoleOverrideList({
  role,
  tier,
  tierWord,
  lockedReason,
  mayGrant,
}: {
  role: TieredRole;
  tier: TierRow;
  /** The chapter's word for a tier, in running text ("tier"). */
  tierWord: string;
  /** Set when nothing on the page can change, saying why, once at the top. */
  lockedReason: string | null;
  /** Whether the caller may switch this permission on for someone else. */
  mayGrant: (permission: string) => boolean;
}) {
  const { overrideOf, set, pending } = useRoleOverrideToggle(role);
  const isHidden = useIsPermissionHidden();
  const groups = useMemo(
    () =>
      groupPermissionsByModule(
        permissionRows(
          [
            ...tier.permissions,
            ...role.permissions,
            ...Object.keys(role.permission_overrides),
          ],
          isHidden,
        ),
      ),
    [tier.permissions, role.permissions, role.permission_overrides, isHidden],
  );
  const sameAs = `Same as ${tierWord}`;

  return (
    <div className="space-y-8">
      {lockedReason ? (
        <p className="text-sm text-muted-foreground">{lockedReason}</p>
      ) : null}
      {groups.map((group) => {
        const groupId = `role-${role.id}-${group.label.replace(/\W+/g, "-").toLowerCase()}`;
        return (
          <section
            key={group.label}
            aria-labelledby={groupId}
            className="space-y-2"
          >
            <div className="flex items-end justify-between gap-6">
              <h3
                id={groupId}
                className="text-sm font-semibold text-foreground"
              >
                {group.label}
              </h3>
              {/* Column heads, from the width the columns sit beside the
                  label; below it each row names its own. */}
              <div
                aria-hidden
                className="hidden shrink-0 items-end gap-4 text-caption text-muted-foreground sm:flex"
              >
                <span className="w-24 truncate text-center" title={tier.name}>
                  {tier.name}
                </span>
                <span className="w-56 text-center">This role</span>
              </div>
            </div>
            <ul className="divide-y divide-border rounded-[14px] border border-border bg-card">
              {group.entries.map((row) => {
                const tierHas = tier.permissions.includes(row.permission);
                const override = overrideOf(row.permission);
                const holds = override ?? tierHas;
                const current = role.permission_overrides[row.permission];
                const canGive = mayGrant(row.permission);
                // What the API refuses (#4071): an override switched on, or
                // any pick that leaves the role holding something new, needs
                // the caller to hold it. Off is always allowed.
                const onRefused = !canGive && current !== true;
                const tierRefused = !canGive && tierHas && !holds;
                const rowReason =
                  !lockedReason && (onRefused || tierRefused)
                    ? "You can't give this, because your role doesn't have it."
                    : null;
                const note =
                  override === null
                    ? null
                    : override
                      ? tierHas
                        ? `Kept on for this role, even if ${tier.name} turns it off.`
                        : `On for this role only. ${tier.name} has it off.`
                      : tierHas
                        ? `Off for this role only. ${tier.name} has it on.`
                        : `Kept off for this role, even if ${tier.name} turns it on.`;
                return (
                  <li
                    key={row.permission}
                    className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {row.label}
                      </p>
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
                      {rowReason ? (
                        <p className="mt-0.5 text-caption text-muted-foreground">
                          {rowReason}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-4">
                      <span
                        className="flex w-24 items-center gap-1.5 text-sm sm:justify-center"
                        title={`${tier.name} has this ${tierHas ? "on" : "off"}. Change it on the ${tierWord}'s page.`}
                      >
                        {tierHas ? (
                          <Check aria-hidden className="h-4 w-4 text-success" />
                        ) : (
                          <Minus
                            aria-hidden
                            className="h-4 w-4 text-muted-foreground"
                          />
                        )}
                        <span
                          className={
                            tierHas
                              ? "text-foreground"
                              : "text-muted-foreground"
                          }
                        >
                          <span className="sm:sr-only">{tier.name}: </span>
                          {tierHas ? "On" : "Off"}
                        </span>
                      </span>
                      <div className="flex sm:w-56 sm:justify-center">
                        <SegmentedChoice<Choice>
                          label={`${row.label} for ${role.name}`}
                          value={toChoice(override)}
                          disabled={
                            Boolean(lockedReason) || pending === row.permission
                          }
                          onChange={(choice) =>
                            void set(row.permission, fromChoice(choice))
                          }
                          options={[
                            { value: "off", label: "Off" },
                            {
                              value: "tier",
                              label: sameAs,
                              disabled: tierRefused,
                              quiet: true,
                            },
                            { value: "on", label: "On", disabled: onRefused },
                          ]}
                        />
                      </div>
                    </div>
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

/** One role's overrides, through the overlay shared with the phone. */
function useRoleOverrideToggle(role: TieredRole) {
  const updateRole = useUpdateRole();
  const { toast } = useToast();
  return useOverrideOverlay(
    role,
    (permission, value) =>
      updateRole.mutateAsync({
        id: role.id,
        body: { permission_overrides: { [permission]: value } },
      }),
    (error) =>
      toast({
        title: `Couldn't update ${role.name}`,
        description: getErrorMessage(
          error,
          "The permission was not changed. Try again in a moment.",
        ),
        variant: "destructive",
      }),
  );
}
