"use client";

import { useId, useMemo, useState } from "react";
import { Check, Loader2, Plus, X } from "lucide-react";
import {
  ASSIGN_COPY,
  memberAssignmentSections,
  memberGroupChips,
  memberRoleChips,
  useGroups,
  useMyPermissions,
  useSetGroupMembership,
  useUpdateMemberRoles,
  type AssignmentChip,
  type AssignmentRow,
} from "@repo/hooks";
import {
  can,
  memberAccessRoleIds,
  removesMemberAccess,
  rolesAfterSave,
} from "@repo/validation";
import { useRolesData } from "@/components/roles/use-roles-data";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { Input } from "@/components/ui/input";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/lib/hooks/use-toast";
import { cn, getErrorMessage } from "@/lib/utils";

/**
 * A member's roles and groups, set from the person (Paul, 2026-11-19: roles
 * and groups are managed in one place, and from the profile, without an Edit
 * mode). Two rows of chips, Roles then Groups; a viewer who may change them
 * gets an x on each chip they can take away and one "+ Add" that opens a
 * single searchable list of the roles under their tiers and the chapter's
 * groups (`memberAssignmentSections`, shared with the phone). Every tick and
 * every x saves at once, as Slack's and Discord's role pickers do.
 *
 * Roles follow the rank rules: a role the viewer can't give is listed,
 * disabled, with why. Taking away the last role that lets someone open the
 * app still asks first (#3670). Groups grant nothing, so they need only
 * `groups:manage`, plus `channels:manage` for one a channel's access list
 * names, which the API answers.
 *
 * Used by the profile card that opens from a Directory row or a name in chat
 * (`MemberPopout`, `compact`) and by the full profile.
 */
export function MemberAssignments({
  memberId,
  userId,
  roleIds,
  displayName,
  compact = false,
  editable = true,
}: {
  /** The membership id `PATCH /v1/members/:id/roles` takes. */
  memberId: string | null;
  /** The member's `users.id`, which groups are keyed by. */
  userId: string;
  roleIds: readonly string[];
  displayName: string;
  /** The card: smaller headings, and the empty rows left out. */
  compact?: boolean;
  /** False while the profile read that `roleIds` came from is not in yet. */
  editable?: boolean;
}) {
  const data = useRolesData();
  const groupsQuery = useGroups();
  const permissions = useMyPermissions().data?.permissions;
  const canManageGroups = can("groups:manage", permissions);
  const canManageRoles = data.canManage && editable && !!memberId;
  const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data]);

  // What this card last saved, kept until the profile read catches up. A
  // save resolves before its re-read lands, so a second tick built from the
  // `roleIds` prop alone would send the old list and undo the first.
  const roleIdsKey = roleIds.join(",");
  const [saved, setSaved] = useState<{ from: string; ids: string[] } | null>(
    null,
  );
  const heldRoleIds = saved && saved.from === roleIdsKey ? saved.ids : roleIds;

  const roleChips = useMemo(
    () =>
      memberRoleChips({
        roles: data.roles,
        tiers: data.tiers,
        heldRoleIds,
        reach: data.reach,
        canManageRoles,
      }),
    [data.roles, data.tiers, heldRoleIds, data.reach, canManageRoles],
  );
  const groupChips = useMemo(
    () => memberGroupChips(groups, userId, canManageGroups && editable),
    [groups, userId, canManageGroups, editable],
  );

  const updateRoles = useUpdateMemberRoles();
  const setMembership = useSetGroupMembership();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  // The row or chip saving now, so only it shows the pending state.
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  async function setRole(roleId: string, give: boolean) {
    if (!memberId) return;
    const current = heldRoleIds;
    const requested = give
      ? [...new Set([...current, roleId])]
      : current.filter((id) => id !== roleId);
    if (
      !give &&
      removesMemberAccess(
        [...current],
        rolesAfterSave(requested, current, data.roles),
        memberAccessRoleIds(data.roles),
      )
    ) {
      const roleName =
        data.roles.find((role) => role.id === roleId)?.name ?? "this role";
      const confirmed = await confirm({
        title: ASSIGN_COPY.accessTitle(displayName),
        description: ASSIGN_COPY.accessBody(displayName),
        confirmLabel: ASSIGN_COPY.accessConfirm(roleName),
        tone: "destructive",
      });
      if (!confirmed) return;
    }
    setPendingKey(`role:${roleId}`);
    try {
      await updateRoles.mutateAsync({ id: memberId, role_ids: requested });
      setSaved({ from: roleIdsKey, ids: requested });
    } catch (error) {
      toast({
        title: ASSIGN_COPY.rolesFailed,
        description: getErrorMessage(
          error,
          "Something went wrong. Please retry.",
        ),
        variant: "destructive",
      });
    } finally {
      setPendingKey(null);
    }
  }

  async function setGroup(groupId: string, add: boolean) {
    setPendingKey(`group:${groupId}`);
    try {
      await setMembership.mutateAsync({ groupId, userId, in: add });
    } catch (error) {
      toast({
        title: add ? ASSIGN_COPY.groupAddFailed : ASSIGN_COPY.groupRemoveFailed,
        description: getErrorMessage(
          error,
          "Something went wrong. Please retry.",
        ),
        variant: "destructive",
      });
    } finally {
      setPendingKey(null);
    }
  }

  function toggle(row: Pick<AssignmentRow, "kind" | "id">, on: boolean) {
    return row.kind === "role" ? setRole(row.id, on) : setGroup(row.id, on);
  }

  const canAddAnything = canManageRoles || (canManageGroups && editable);

  return (
    <div className={cn("space-y-4", !compact && "mt-6")}>
      <ChipRow
        title="Roles"
        chips={roleChips}
        // A read still out, or one that failed, is not a member with no roles.
        empty={
          data.rolesQuery.data !== undefined
            ? "No roles"
            : data.rolesQuery.isError
              ? "Couldn't load roles"
              : "Loading roles"
        }
        compact={compact}
        pendingKey={pendingKey}
        onRemove={(chip) => void toggle(chip, false)}
        add={
          canAddAnything ? (
            <AddPicker
              label="Add role"
              displayName={displayName}
              focus="roles"
              sections={(query) =>
                memberAssignmentSections({
                  roles: data.roles,
                  tiers: data.tiers,
                  groups,
                  reach: data.reach,
                  canManageRoles,
                  canManageGroups: canManageGroups && editable,
                  heldRoleIds,
                  userId,
                  query,
                })
              }
              pendingKey={pendingKey}
              onToggle={(row, on) => void toggle(row, on)}
            />
          ) : null
        }
      />
      {/* Nothing until the groups list is in: an empty row before then
          would claim the member is in none. */}
      {groupsQuery.data !== undefined ? (
        <ChipRow
          title="Groups"
          chips={groupChips}
          empty="No groups"
          compact={compact}
          pendingKey={pendingKey}
          onRemove={(chip) => void toggle(chip, false)}
          add={
            canAddAnything ? (
              <AddPicker
                label="Add to group"
                displayName={displayName}
                focus="groups"
                sections={(query) =>
                  memberAssignmentSections({
                    roles: data.roles,
                    tiers: data.tiers,
                    groups,
                    reach: data.reach,
                    canManageRoles,
                    canManageGroups: canManageGroups && editable,
                    heldRoleIds,
                    userId,
                    query,
                  })
                }
                pendingKey={pendingKey}
                onToggle={(row, on) => void toggle(row, on)}
              />
            ) : null
          }
        />
      ) : null}
      {confirmDialog}
    </div>
  );
}

function ChipRow({
  title,
  chips,
  empty,
  compact,
  pendingKey,
  onRemove,
  add,
}: {
  title: string;
  chips: AssignmentChip[];
  empty: string;
  compact: boolean;
  pendingKey: string | null;
  onRemove: (chip: AssignmentChip) => void;
  add: React.ReactNode;
}) {
  const headingId = useId();
  if (compact && chips.length === 0 && !add) return null;
  return (
    <section className="space-y-2" aria-labelledby={headingId}>
      <h3
        id={headingId}
        className="text-label font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {title}
      </h3>
      <ul className="flex flex-wrap items-center gap-1.5">
        {chips.map((chip) => {
          const pending = pendingKey === `${chip.kind}:${chip.id}`;
          return (
            <li
              key={chip.id}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-1 pl-2.5 text-caption text-foreground",
                chip.removable ? "pr-1" : "pr-2.5",
                pending && "opacity-60",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  !chip.color && "bg-muted-foreground",
                )}
                // Palette literal: chapter data rendered as a raw swatch.
                style={chip.color ? { backgroundColor: chip.color } : undefined}
              />
              {chip.name}
              {chip.removable ? (
                <button
                  type="button"
                  aria-label={`Remove ${chip.name}`}
                  disabled={pendingKey !== null}
                  onClick={() => onRemove(chip)}
                  className={cn(
                    "grid h-5 w-5 place-items-center rounded-full text-muted-foreground hover:bg-card-hover hover:text-foreground disabled:pointer-events-none",
                    FOCUS_RING_OFFSET,
                  )}
                >
                  {pending ? (
                    <Loader2
                      className="h-3 w-3 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <X className="h-3 w-3" aria-hidden="true" />
                  )}
                </button>
              ) : null}
            </li>
          );
        })}
        {add ? <li>{add}</li> : null}
        {chips.length === 0 && !add ? (
          <li className="text-caption text-muted-foreground">{empty}</li>
        ) : null}
      </ul>
    </section>
  );
}

/**
 * "+ Add role" or "+ Add to group": the same one list either way, opened at
 * the part it was pressed for, since a role and a group are given from one
 * place.
 */
function AddPicker({
  label,
  displayName,
  focus,
  sections,
  pendingKey,
  onToggle,
}: {
  label: string;
  displayName: string;
  focus: "roles" | "groups";
  sections: (query: string) => ReturnType<typeof memberAssignmentSections>;
  pendingKey: string | null;
  onToggle: (row: AssignmentRow, on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchId = useId();
  const all = sections(query);
  // Opened from "Add to group", the groups come first.
  const ordered =
    focus === "groups"
      ? [
          ...all.filter((s) => s.key === "groups"),
          ...all.filter((s) => s.key !== "groups"),
        ]
      : all;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-caption text-muted-foreground hover:bg-card-hover hover:text-foreground",
            FOCUS_RING_OFFSET,
          )}
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex max-h-[min(420px,var(--radix-popover-content-available-height))] w-72 flex-col p-0"
        aria-label={`Roles and groups for ${displayName}`}
      >
        <div className="border-b border-border p-2">
          <label htmlFor={searchId} className="sr-only">
            Search roles and groups
          </label>
          <Input
            id={searchId}
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search roles and groups"
            className="h-8"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {ordered.length === 0 ? (
            <p className="px-3 py-2 text-caption text-muted-foreground">
              Nothing matches.
            </p>
          ) : (
            ordered.map((section) => (
              <div key={section.key} role="group" aria-label={section.title}>
                <p className="px-3 pb-1 pt-2 text-label font-semibold uppercase tracking-wide text-muted-foreground">
                  {section.title}
                </p>
                {section.rows.map((row) => {
                  const pending = pendingKey === `${row.kind}:${row.id}`;
                  const disabled =
                    row.disabledReason !== null || pendingKey !== null;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={row.held}
                      disabled={disabled}
                      onClick={() => onToggle(row, !row.held)}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm hover:bg-card-hover disabled:hover:bg-transparent",
                        row.disabledReason !== null && "cursor-default",
                        FOCUS_RING_OFFSET,
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "grid h-4 w-4 shrink-0 place-items-center rounded border",
                          row.held
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground",
                          row.disabledReason !== null && "opacity-40",
                        )}
                      >
                        {pending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : row.held ? (
                          <Check className="h-3 w-3" />
                        ) : null}
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          !row.color && "bg-muted-foreground",
                        )}
                        style={
                          row.color ? { backgroundColor: row.color } : undefined
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block truncate",
                            row.disabledReason !== null &&
                              "text-muted-foreground",
                          )}
                        >
                          {row.name}
                        </span>
                        {row.disabledReason ? (
                          <span className="block text-caption text-muted">
                            {row.disabledReason}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
