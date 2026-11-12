"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ChevronRight, Plus, Search } from "lucide-react";
import { describeLoadFailure } from "@repo/hooks/error-copy";
import {
  useCreateRole,
  useCreateRoleTier,
  useDeleteRole,
  useDeleteRoleTier,
  useReorderRoleTiers,
  useUpdateRole,
  useUpdateRoleTier,
} from "@repo/hooks";
import { matchesWordStarts, normalizeWords } from "@repo/hooks/fuzzy-match";
import { isEveryoneRole, roleColorOrNull } from "@repo/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FOCUS_RING } from "@/components/ui/focus";
import {
  ErrorState,
  OfflineState,
  anyReadUncached,
} from "@/components/shared/async-states";
import { RowMenu, type RowMenuEntry } from "@/components/shared/row-menu";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { SettingsListCardSkeleton } from "@/components/settings/settings-skeleton";
import { useNetwork } from "@/lib/providers/network-provider";
import { useToast } from "@/lib/hooks/use-toast";
import { cn, getErrorMessage } from "@/lib/utils";
import {
  byDisplayOrder,
  isWildcardRole,
  reachesOutside,
  reachesRole,
  reachesTier,
  type TierRow,
  type TieredRole,
} from "@repo/hooks/role-tiers";
import { useRolesData } from "@/components/roles/use-roles-data";

/** Where a role is created or moved to: a tier's id, or outside the tiers. */
type Placement = string | null;

/**
 * Chapter settings → Roles (#3990): the chapter's tiers in order, each with
 * its roles, and the roles outside the tiers after them.
 *
 * Paul's shape: "under roles you would have tiers, and then within each tier
 * you would have all the different roles". A tier's "Edit permissions" opens
 * its own page of switches; a role opens its own page. Discord's Roles
 * settings is the comparison an officer arrives with: one ordered list, a
 * member count per role, a search box for servers with a hundred roles, and
 * a click into a role for everything else. Tiers add the one level Discord
 * lacks, so a chapter with 100+ roles sets permissions for four or five tiers
 * instead of a hundred roles.
 *
 * Every control the rank rules would refuse is disabled before it is tried
 * (`@repo/hooks/role-tiers`); the API stays the authority, and a refusal it sends
 * anyway lands as a toast naming what was missing.
 */
export function RolesOverview({
  onOpenTier,
  onOpenRole,
}: {
  onOpenTier: (tierId: string) => void;
  onOpenRole: (roleId: string) => void;
}) {
  const { isOffline } = useNetwork();
  const data = useRolesData();
  const { rolesQuery, tiersQuery, roles, tiers, words } = data;
  const [query, setQuery] = useState("");

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-2xl font-bold tracking-[-0.3px]">Roles</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {rolesQuery.isSuccess && tiersQuery.isSuccess
            ? `${roles.length} ${roles.length === 1 ? "role" : "roles"} in ${tiers.length} ${tiers.length === 1 ? words.singular : words.plural}`
            : "Roles"}
        </p>
      </div>
      {roles.length > 8 ? (
        <label className="relative block w-full max-w-xs">
          <span className="sr-only">Find a role</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
            }}
            placeholder="Find a role"
            className="pl-9"
          />
        </label>
      ) : null}
    </div>
  );

  if (isOffline && anyReadUncached(rolesQuery, tiersQuery)) {
    return (
      <section className="space-y-4">
        {header}
        <OfflineState description="Reconnect to see and change who holds what." />
      </section>
    );
  }
  if (rolesQuery.isPending || tiersQuery.isPending) {
    return (
      <section className="space-y-4">
        {header}
        <SettingsListCardSkeleton label="Loading roles" rows={4} />
      </section>
    );
  }
  if (rolesQuery.isError || tiersQuery.isError) {
    return (
      <section className="space-y-4">
        {header}
        <ErrorState
          title="Couldn't load roles"
          description={describeLoadFailure(
            rolesQuery.error ?? tiersQuery.error,
          )}
          onRetry={() => {
            void rolesQuery.refetch();
            void tiersQuery.refetch();
          }}
        />
      </section>
    );
  }

  return (
    <section className="space-y-6">
      {header}
      <TierList
        data={data}
        query={query}
        onOpenTier={onOpenTier}
        onOpenRole={onOpenRole}
      />
    </section>
  );
}

function TierList({
  data,
  query,
  onOpenTier,
  onOpenRole,
}: {
  data: ReturnType<typeof useRolesData>;
  query: string;
  onOpenTier: (tierId: string) => void;
  onOpenRole: (roleId: string) => void;
}) {
  const { roles, tiers, memberCounts, reach, canManage, words } = data;
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const createTier = useCreateRoleTier();
  const updateTier = useUpdateRoleTier();
  const deleteTier = useDeleteRoleTier();
  const reorderTiers = useReorderRoleTiers();
  const updateRole = useUpdateRole();
  const deleteRole = useDeleteRole();

  const filtering = normalizeWords(query).length > 0;
  const rolesIn = useMemo(() => {
    const byTier = new Map<Placement, TieredRole[]>();
    const tierIds = new Set(tiers.map((tier) => tier.id));
    for (const role of [...roles].sort(byDisplayOrder)) {
      // A role naming a tier this list doesn't have reads as outside, which
      // is how the API ranks it too.
      const key =
        role.tier_id && tierIds.has(role.tier_id) ? role.tier_id : null;
      if (!byTier.has(key)) byTier.set(key, []);
      byTier.get(key)!.push(role);
    }
    return byTier;
  }, [roles, tiers]);

  const shown = (placement: Placement) => {
    const all = rolesIn.get(placement) ?? [];
    return filtering
      ? all.filter((role) => matchesWordStarts(role.name, query))
      : all;
  };

  async function run(
    action: () => Promise<unknown>,
    failTitle: string,
    fallback: string,
  ) {
    try {
      await action();
      return true;
    } catch (error) {
      toast({
        title: failTitle,
        description: getErrorMessage(error, fallback),
        variant: "destructive",
      });
      return false;
    }
  }

  function move(tier: TierRow, by: -1 | 1) {
    const index = tiers.findIndex((candidate) => candidate.id === tier.id);
    const target = index + by;
    if (index < 0 || target < 0 || target >= tiers.length) return;
    const ids = tiers.map((candidate) => candidate.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void run(
      () => reorderTiers.mutateAsync(ids),
      `Couldn't move ${tier.name}`,
      `Someone may have changed the ${words.plural} since you opened this page. Reload and try again.`,
    );
  }

  async function removeTier(tier: TierRow) {
    const ok = await confirm({
      title: `Delete ${tier.name}?`,
      description: `It has no roles left, so nobody loses anything. The other ${words.plural} keep their order.`,
      confirmLabel: `Delete ${words.singular}`,
      tone: "destructive",
    });
    if (!ok) return;
    await run(
      () => deleteTier.mutateAsync(tier.id),
      `Couldn't delete ${tier.name}`,
      `Move its roles to another ${words.singular} first.`,
    );
  }

  async function removeRole(role: TieredRole) {
    const ok = await confirm({
      title: `Delete ${role.name}?`,
      description:
        "Members holding this role lose what it gives them right away. This can't be undone.",
      confirmLabel: "Delete role",
      tone: "destructive",
    });
    if (!ok) return;
    await run(
      () => deleteRole.mutateAsync(role.id),
      `Couldn't delete ${role.name}`,
      "Remove the role from its members first, or try again in a moment.",
    );
  }

  function moveRole(role: TieredRole, placement: Placement) {
    void run(
      () =>
        updateRole.mutateAsync({ id: role.id, body: { tier_id: placement } }),
      `Couldn't move ${role.name}`,
      "The role stayed where it was. Try again in a moment.",
    );
  }

  const roleRow = (role: TieredRole) => {
    const editable = canManage && reachesRole(reach, role, tiers);
    const entries: RowMenuEntry[] = [
      { type: "label", key: "move-label", label: "Move to" },
      ...tiers
        .filter((tier) => tier.id !== role.tier_id)
        .map((tier): RowMenuEntry => ({
          type: "item",
          key: `move-${tier.id}`,
          label: tier.name,
          disabled: !editable || !reachesTier(reach, tier),
          onSelect: () => moveRole(role, tier.id),
        })),
      ...(role.tier_id === null
        ? []
        : [
            {
              type: "item",
              key: "move-outside",
              label: `Outside the ${words.plural}`,
              disabled: !editable || !reachesOutside(reach),
              onSelect: () => moveRole(role, null),
            } satisfies RowMenuEntry,
          ]),
      ...(role.is_system
        ? []
        : [
            { type: "separator", key: "sep" } satisfies RowMenuEntry,
            {
              type: "item",
              key: "delete",
              label: "Delete role",
              destructive: true,
              disabled: !editable,
              onSelect: () => void removeRole(role),
            } satisfies RowMenuEntry,
          ]),
    ];
    const count = memberCounts?.get(role.id);
    const row = (menu: ReactNode) => (
      <li className="group flex items-center gap-1 pr-2">
        <button
          type="button"
          onClick={() => onOpenRole(role.id)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left transition hover:bg-card-hover",
            "group-first:rounded-tl-[13px] group-last:rounded-bl-[13px]",
            FOCUS_RING,
          )}
        >
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-full border border-border"
            style={{
              backgroundColor: roleColorOrNull(role.color) ?? "transparent",
            }}
          />
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {role.name}
          </span>
          {isWildcardRole(role) ? (
            <span className="shrink-0 text-caption text-muted-foreground">
              Can do everything
            </span>
          ) : isEveryoneRole(role) ? (
            <span className="shrink-0 text-caption text-muted-foreground">
              Pinged as @everyone
            </span>
          ) : null}
          <span className="ml-auto shrink-0 text-caption tabular-nums text-muted-foreground">
            {count === undefined
              ? memberCounts === null
                ? ""
                : "No members"
              : `${count} ${count === 1 ? "member" : "members"}`}
          </span>
          <ChevronRight
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </button>
        {menu}
      </li>
    );
    // Everyone (#4191) neither moves nor goes: its page edits the rest.
    if (!canManage || isEveryoneRole(role)) {
      return <RowFragment key={role.id}>{row(null)}</RowFragment>;
    }
    return (
      <RowMenu key={role.id} entries={entries} label={`More for ${role.name}`}>
        {(menuButton) => row(menuButton)}
      </RowMenu>
    );
  };

  const outside = shown(null);
  const anyShown =
    outside.length > 0 || tiers.some((tier) => shown(tier.id).length > 0);

  return (
    <div className="space-y-8">
      {confirmDialog}
      {filtering && !anyShown ? (
        <p role="status" className="text-sm text-muted-foreground">
          No role matches &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : null}
      {tiers.map((tier, index) => {
        const tierRoles = shown(tier.id);
        if (filtering && tierRoles.length === 0) return null;
        const total = rolesIn.get(tier.id)?.length ?? 0;
        const editable = canManage && reachesTier(reach, tier);
        const above = tiers[index - 1];
        const below = tiers[index + 1];
        return (
          <TierBlock
            key={tier.id}
            tier={tier}
            words={words}
            roleCount={total}
            canManage={canManage}
            editable={editable}
            canMoveUp={editable && !!above && reachesTier(reach, above)}
            canMoveDown={editable && !!below && reachesTier(reach, below)}
            onEditPermissions={() => onOpenTier(tier.id)}
            onRename={(name) =>
              run(
                () => updateTier.mutateAsync({ id: tier.id, body: { name } }),
                `Couldn't rename ${tier.name}`,
                "The name was not changed. Try again in a moment.",
              )
            }
            onMoveUp={() => move(tier, -1)}
            onMoveDown={() => move(tier, 1)}
            onDelete={() => void removeTier(tier)}
          >
            <RoleList
              rows={tierRoles.map(roleRow)}
              empty={`No roles in this ${words.singular} yet.`}
              addRole={
                editable && !filtering ? (
                  <AddRoleRow placement={tier.id} />
                ) : null
              }
            />
          </TierBlock>
        );
      })}

      {!filtering || outside.length > 0 ? (
        <section className="space-y-2" aria-labelledby="roles-outside-tiers">
          <div>
            <h3
              id="roles-outside-tiers"
              className="text-base font-semibold text-foreground"
            >
              Outside the {words.plural}
            </h3>
            <p className="text-caption text-muted-foreground">
              Rank below every {words.singular}, like alumni or advisors. Each
              role&apos;s permissions are its own.
            </p>
          </div>
          <RoleList
            rows={outside.map(roleRow)}
            empty="No roles here."
            addRole={
              canManage && reachesOutside(reach) && !filtering ? (
                <AddRoleRow placement={null} />
              ) : null
            }
          />
        </section>
      ) : null}

      {canManage && !filtering ? (
        <AddTierForm
          words={words}
          onAdd={(name) =>
            run(
              () => createTier.mutateAsync({ name, permissions: [] }),
              `Couldn't add the ${words.singular}`,
              "Check the name isn't already used, then try again.",
            )
          }
        />
      ) : null}
    </div>
  );
}

function RowFragment({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function RoleList({
  rows,
  empty,
  addRole,
}: {
  rows: ReactNode[];
  empty: string;
  addRole: ReactNode;
}) {
  return (
    <ul className="divide-y divide-border rounded-[14px] border border-border bg-card">
      {rows.length === 0 ? (
        <li className="px-4 py-3 text-sm text-muted-foreground">{empty}</li>
      ) : (
        rows
      )}
      {addRole}
    </ul>
  );
}

function TierBlock({
  tier,
  words,
  roleCount,
  canManage,
  editable,
  canMoveUp,
  canMoveDown,
  onEditPermissions,
  onRename,
  onMoveUp,
  onMoveDown,
  onDelete,
  children,
}: {
  tier: TierRow;
  words: ReturnType<typeof useRolesData>["words"];
  roleCount: number;
  canManage: boolean;
  editable: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEditPermissions: () => void;
  onRename: (name: string) => Promise<boolean>;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  children: ReactNode;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(tier.name);
  const headingId = `roles-tier-${tier.id}`;
  const permissionCount = tier.permissions.filter((p) => p !== "*").length;

  async function submitRename(event: FormEvent) {
    event.preventDefault();
    const name = draft.trim();
    if (!name || name === tier.name) {
      setRenaming(false);
      return;
    }
    if (await onRename(name)) setRenaming(false);
  }

  const entries: RowMenuEntry[] = [
    {
      type: "item",
      key: "rename",
      label: "Rename",
      disabled: !editable,
      onSelect: () => {
        setDraft(tier.name);
        setRenaming(true);
      },
    },
    {
      type: "item",
      key: "up",
      label: "Move up",
      disabled: !canMoveUp,
      onSelect: onMoveUp,
    },
    {
      type: "item",
      key: "down",
      label: "Move down",
      disabled: !canMoveDown,
      onSelect: onMoveDown,
    },
    { type: "separator", key: "sep" },
    {
      type: "item",
      key: "delete",
      label: roleCount > 0 ? "Delete (move its roles out first)" : "Delete",
      destructive: true,
      disabled: !editable || roleCount > 0,
      onSelect: onDelete,
    },
  ];

  const header = (menuButton: ReactNode) => (
    <div className="group flex flex-wrap items-center gap-x-3 gap-y-2">
      {renaming ? (
        <form
          onSubmit={submitRename}
          className="flex min-w-0 flex-1 items-center gap-2"
        >
          <Input
            autoFocus
            aria-label={`${words.Singular} name`}
            value={draft}
            maxLength={60}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setRenaming(false);
            }}
            className="max-w-xs"
          />
          <Button type="submit" size="sm">
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setRenaming(false)}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <div className="min-w-0 flex-1">
          <h3
            id={headingId}
            className="truncate text-base font-semibold text-foreground"
          >
            {tier.name}
          </h3>
          <p className="text-caption text-muted-foreground">
            {roleCount} {roleCount === 1 ? "role" : "roles"} ·{" "}
            {permissionCount === 0
              ? "No permissions"
              : `${permissionCount} ${permissionCount === 1 ? "permission" : "permissions"}`}
          </p>
        </div>
      )}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={onEditPermissions}
      >
        {editable ? "Edit permissions" : "View permissions"}
      </Button>
      {menuButton}
    </div>
  );

  return (
    <section className="space-y-2" aria-label={tier.name}>
      {canManage ? (
        <RowMenu entries={entries} label={`More for ${tier.name}`}>
          {(menuButton) => header(menuButton)}
        </RowMenu>
      ) : (
        header(null)
      )}
      {children}
    </section>
  );
}

/**
 * "Add role" as the last row of a tier: the new role starts with the tier's
 * permissions, so naming it is the whole form. Color, the @mention switch and
 * any difference from the tier are set on the role's own page after.
 */
function AddRoleRow({ placement }: { placement: Placement }) {
  const { toast } = useToast();
  const createRole = useCreateRole();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      // `permissions: []` means "take the tier's" (`createAsMember`).
      await createRole.mutateAsync({
        name: trimmed,
        permissions: [],
        tier_id: placement,
      });
      setName("");
      setOpen(false);
    } catch (error) {
      toast({
        title: "Couldn't add the role",
        description: getErrorMessage(
          error,
          "Check the name isn't already used.",
        ),
        variant: "destructive",
      });
    }
  }

  if (!open) {
    return (
      <li>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-muted-foreground transition hover:bg-card-hover hover:text-foreground",
            "rounded-b-[13px]",
            FOCUS_RING,
          )}
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add role
        </button>
      </li>
    );
  }
  return (
    <li className="px-4 py-2">
      <form onSubmit={submit} className="flex items-center gap-2">
        <Input
          autoFocus
          aria-label="New role name"
          placeholder="Philanthropy chair"
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
          className="max-w-xs"
        />
        <Button
          type="submit"
          size="sm"
          disabled={!name.trim() || createRole.isPending}
        >
          Add role
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </form>
    </li>
  );
}

function AddTierForm({
  words,
  onAdd,
}: {
  words: ReturnType<typeof useRolesData>["words"];
  onAdd: (name: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (await onAdd(trimmed)) {
      setName("");
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        Add {words.singular}
      </Button>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <Input
        autoFocus
        aria-label={`New ${words.singular} name`}
        placeholder="Committee chairs"
        value={name}
        maxLength={60}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        className="max-w-xs"
      />
      <Button type="submit" size="sm" disabled={!name.trim()}>
        Add {words.singular}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setOpen(false)}
      >
        Cancel
      </Button>
      <p className="basis-full text-caption text-muted-foreground">
        A new {words.singular} goes at the bottom with no permissions. Move it
        up and switch on what it can do after.
      </p>
    </form>
  );
}
