"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { matchesWordStarts, normalizeWords } from "@repo/hooks/fuzzy-match";
import { cn } from "@/lib/utils";
import { ProfileSection } from "@/components/profile/profile-section";
import {
  InlineNote,
  inlineNoteActionClassName,
} from "@/components/shared/inline-note";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FOCUS_RING } from "@/components/ui/focus";
import { modulePermissions } from "@/components/settings/settings-modules";
import {
  useRolePermissionToggle,
  useTierPermissionToggle,
} from "@/components/roles/use-role-permission-toggle";
import { useRolesData } from "@/components/roles/use-roles-data";
import {
  byDisplayOrder,
  isWildcardRole,
  mayGrant,
  reachesRole,
  reachesTier,
  type TierRow,
  type TieredRole,
} from "@/lib/role-tiers";

/** A tier or a role, as a chip and as a choice under "Add". */
type Holder = {
  kind: "tier" | "role";
  id: string;
  name: string;
  color: string | null;
  permissions: readonly string[];
};

/**
 * A module page's "Who can" block (#4073): each of the module's permissions,
 * in the registry's words, with the tiers and roles that have it, edited
 * right here.
 *
 * An officer setting up Events asks "who can create events?" on the Events
 * page, so the answer and the change sit together. Since the tiers rebuild
 * (#3990) the answer is mostly tiers: a chapter with a hundred roles reads
 * "Exec board, Officers and chairs" rather than forty role chips. A role
 * shows on its own only where it differs from its tier, or sits outside the
 * tiers, which is the same rule the role's own page marks. A chip's × takes
 * the permission away and "Add" grants it, saved on click through the same
 * writers as the tier and role pages (`use-role-permission-toggle.ts`).
 * Discord's channel permissions and Slack's per-feature "who can" pickers
 * both edit in place for the same reason.
 *
 * Editing needs `roles:manage`, the guard on both writes; without it the
 * chips are read-only. The rank rules (#4071) disable what the API would
 * refuse: a tier or role at or above the caller's own, and granting a
 * permission the caller doesn't hold. The President's wildcard is said once
 * in the hint rather than drawn as a chip on every row.
 */
export function ModuleWhoCan({
  moduleKey,
  moduleLabel,
  canEdit,
}: {
  moduleKey: string;
  moduleLabel: string;
  /** Whether the viewer holds `roles:manage`. */
  canEdit: boolean;
}) {
  const { rolesQuery, tiersQuery, roles, tiers, reach, words } =
    useRolesData();
  const tierToggle = useTierPermissionToggle(tiers);
  const editableRoles = useMemo(
    () => roles.filter((role) => !isWildcardRole(role)).sort(byDisplayOrder),
    [roles],
  );
  const roleToggle = useRolePermissionToggle(editableRoles);
  const permissions = modulePermissions(moduleKey);
  if (permissions.length === 0) return null;

  const tierHas = (tier: TierRow, permission: string) =>
    tierToggle.permissionsOf(tier).includes(permission);
  const roleHas = (role: TieredRole, permission: string) =>
    roleToggle.permissionsOf(role).includes(permission);

  const tierHolder = (tier: TierRow): Holder => ({
    kind: "tier",
    id: tier.id,
    name: tier.name,
    color: null,
    permissions: tier.permissions,
  });
  const roleHolder = (role: TieredRole): Holder => ({
    kind: "role",
    id: role.id,
    name: role.name,
    color: role.color,
    permissions: role.permissions,
  });

  const mayEdit = (holder: Holder) => {
    if (!canEdit) return false;
    if (holder.kind === "tier") {
      const tier = tiers.find((candidate) => candidate.id === holder.id);
      return !!tier && reachesTier(reach, tier);
    }
    const role = roles.find((candidate) => candidate.id === holder.id);
    return !!role && reachesRole(reach, role, tiers);
  };

  const flip = (holder: Holder, permission: string, held: boolean) => {
    if (holder.kind === "tier") {
      const tier = tiers.find((candidate) => candidate.id === holder.id);
      if (tier) void tierToggle.toggle(tier, permission, held);
      return;
    }
    const role = editableRoles.find((candidate) => candidate.id === holder.id);
    if (role) void roleToggle.toggle(role, permission, held);
  };

  const isSaving = (holder: Holder, permission: string) => {
    const pending =
      holder.kind === "tier" ? tierToggle.pending : roleToggle.pending;
    return pending?.id === holder.id && pending.permission === permission;
  };

  const rolesLink = (
    <Link href="/settings?tab=roles" className={inlineNoteActionClassName}>
      {canEdit ? "See everything in Roles" : "Change in Roles"}
    </Link>
  );
  const loading = rolesQuery.isPending || tiersQuery.isPending;

  return (
    <ProfileSection
      id={`settings-module-${moduleKey}-who`}
      title="Who can"
      hint={
        <>
          {canEdit
            ? `Which ${words.plural} and roles can do each thing in ${moduleLabel}. Changes save as you make them. The President can do everything.`
            : `What each ${words.singular} and role can do in ${moduleLabel}. The President can do everything.`}{" "}
          {rolesLink}
        </>
      }
    >
      {rolesQuery.isError || tiersQuery.isError ? (
        <InlineNote>
          Couldn&apos;t load your chapter&apos;s roles. {rolesLink} shows them.
        </InlineNote>
      ) : (
        <ul className="divide-y divide-border rounded-[14px] border border-border">
          {permissions.map((entry) => {
            const holdingTiers = tiers.filter((tier) =>
              tierHas(tier, entry.permission),
            );
            // A role is its own chip only where its tier doesn't already
            // answer for it: outside the tiers, or set apart from its tier.
            const roleTier = (role: TieredRole) =>
              tiers.find((tier) => tier.id === role.tier_id) ?? null;
            const holdingRoles = editableRoles.filter((role) => {
              const tier = roleTier(role);
              return (
                roleHas(role, entry.permission) &&
                (!tier || !tierHas(tier, entry.permission))
              );
            });
            const holders = [
              ...holdingTiers.map(tierHolder),
              ...holdingRoles.map(roleHolder),
            ];
            const canGrant = mayGrant(reach, entry.permission);
            const addable = canGrant
              ? [
                  ...tiers
                    .filter((tier) => !tierHas(tier, entry.permission))
                    .map(tierHolder),
                  ...editableRoles
                    .filter((role) => !roleHas(role, entry.permission))
                    .map(roleHolder),
                ].filter(mayEdit)
              : [];
            return (
              <li
                key={entry.permission}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
              >
                <div className="min-w-0 sm:max-w-[50%]">
                  <p className="text-sm font-medium text-foreground">
                    {entry.label}
                  </p>
                  <p className="mt-0.5 text-caption text-muted-foreground">
                    {entry.description}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                  {loading ? (
                    <span className="text-caption text-muted">Loading</span>
                  ) : (
                    <>
                      {holders.length === 0 ? (
                        <span className="text-caption text-muted-foreground">
                          Only the President
                        </span>
                      ) : (
                        holders.map((holder) => (
                          <HolderChip
                            key={`${holder.kind}-${holder.id}`}
                            holder={holder}
                            saving={isSaving(holder, entry.permission)}
                            onRemove={
                              mayEdit(holder)
                                ? () => flip(holder, entry.permission, true)
                                : undefined
                            }
                            permissionLabel={entry.label}
                          />
                        ))
                      )}
                      {canEdit && addable.length > 0 ? (
                        <AddHolder
                          permissionLabel={entry.label}
                          holders={addable}
                          tierHeading={words.Plural}
                          tierWord={words.singular}
                          onAdd={(holder) =>
                            flip(holder, entry.permission, false)
                          }
                        />
                      ) : null}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ProfileSection>
  );
}

function RoleDot({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden
      className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground"
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

/**
 * A tier or role holding the permission. A tier chip is drawn square-ish and
 * without a dot, so "Exec board" never reads as a role of that name. With
 * `onRemove`, a × takes it away. A chip whose write is in flight goes muted
 * rather than growing a spinner, so the row never shifts.
 */
function HolderChip({
  holder,
  saving,
  onRemove,
  permissionLabel,
}: {
  holder: Holder;
  saving: boolean;
  onRemove?: () => void;
  permissionLabel: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 border border-border pl-2 text-caption",
        holder.kind === "tier"
          ? "rounded-md bg-card font-semibold"
          : "rounded-full",
        onRemove ? "pr-0.5" : "pr-2",
        saving ? "text-muted-foreground" : "text-foreground",
      )}
    >
      {holder.kind === "role" ? <RoleDot color={holder.color} /> : null}
      {holder.name}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          disabled={saving}
          aria-label={`Remove ${holder.name} from ${permissionLabel}`}
          className={cn(
            "grid h-5 w-5 place-items-center rounded-full text-muted-foreground hover:bg-card-hover hover:text-foreground disabled:pointer-events-none",
            FOCUS_RING,
          )}
        >
          <X className="h-3 w-3" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

/**
 * "Add": a filterable list of the tiers, then the roles, that don't have the
 * permission. Filterable because a chapter imported from Discord can carry a
 * hundred roles, the same reason the toolbar filter chips are.
 */
function AddHolder({
  permissionLabel,
  holders,
  tierHeading,
  tierWord,
  onAdd,
}: {
  permissionLabel: string;
  holders: readonly Holder[];
  tierHeading: string;
  tierWord: string;
  onAdd: (holder: Holder) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const commandRef = useRef<HTMLDivElement>(null);
  const shown =
    normalizeWords(query).length === 0
      ? holders
      : holders.filter((holder) => matchesWordStarts(holder.name, query));
  const groups = [
    { heading: tierHeading, items: shown.filter((h) => h.kind === "tier") },
    { heading: "Roles", items: shown.filter((h) => h.kind === "role") },
  ].filter((group) => group.items.length > 0);
  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Add to ${permissionLabel}`}
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-border px-2 text-caption font-semibold text-muted-foreground hover:border-input hover:text-foreground",
            FOCUS_RING,
          )}
        >
          <Plus className="h-3 w-3" aria-hidden />
          Add
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-max min-w-[14rem] max-w-[min(22rem,calc(100vw-2rem))] p-0"
        onEscapeKeyDown={(event) => {
          if (!query) return;
          event.preventDefault();
          setQuery("");
        }}
      >
        <Command
          ref={commandRef}
          tabIndex={-1}
          className="outline-none"
          shouldFilter={false}
          label={`Who to add to ${permissionLabel}`}
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={`Find a ${tierWord} or role`}
            className="h-9 py-2 text-sm pointer-coarse:h-11 pointer-coarse:text-base"
          />
          <CommandList className="max-h-72 p-1">
            {shown.length === 0 ? (
              <p role="status" className="px-2 py-3 text-sm text-muted">
                Nothing matches “{query.trim()}”.
              </p>
            ) : (
              groups.map((group) => (
                <CommandGroup key={group.heading} heading={group.heading}>
                  {group.items.map((holder) => (
                    <CommandItem
                      key={`${holder.kind}-${holder.id}`}
                      value={`${holder.kind}-${holder.id}`}
                      className="min-h-8 gap-2 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base"
                      onSelect={() => {
                        onAdd(holder);
                        close();
                      }}
                    >
                      {holder.kind === "role" ? (
                        <RoleDot color={holder.color} />
                      ) : null}
                      <span className="min-w-0 flex-1 break-words">
                        {holder.name}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
