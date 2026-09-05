"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import {
  useClaimPresidency,
  useCreateRole,
  useCurrentChapter,
  useDeleteRole,
  useMembers,
  usePermissionsCatalog,
  usePresidencyClaimStatus,
  useRoles,
  useTransferPresidency,
  useUpdateRole,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EmptyState,
  ErrorState,
  hasNoCachedData,
  LoadingState,
  OfflineState,
  PermissionsOfflineSurface,
} from "@/components/shared/async-states";
import { Can } from "@/components/shared/can";
import { RolesGlyph } from "@/components/layout/nav-glyphs";
import { useNetwork } from "@/lib/providers/network-provider";
import { useToast } from "@/hooks/use-toast";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { asArray, cn, getErrorMessage } from "@/lib/utils";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import {
  dashboardCheckboxHitAreaClassName,
  dashboardTableCheckboxClassName,
} from "@/components/shared/table-controls";
import { signetDarkTokens } from "@repo/theme/signet";

type Role = {
  id: string;
  chapter_id: string;
  name: string;
  permissions: string[];
  is_system: boolean;
  display_order: number;
  color: string | null;
  created_at: string;
};

type PermissionCatalogEntry = {
  key: string;
  permission: string;
};

type MemberSummary = {
  id?: string;
  user_id?: string;
  display_name?: string | null;
  role_ids?: string[];
};

/**
 * What the colour picker opens on when a role has none.
 *
 * The two pickers seeded themselves `#2563EB` and `#10B981` — one concept,
 * two arbitrary values, and both of them from the palette this cutover is
 * replacing. `#2563EB` is the royal blue the cutover skill bans by name
 * ("never brown-bronze, never royal blue"); `#10B981` is #916's conflicting
 * emerald, the raw Tailwind green that shipped beside `--success`.
 *
 * A literal hex rather than a `var(--…)`: `roles.color` is chapter data written
 * to the database and rendered as a raw swatch, so a token reference here
 * would be stored as the string `"var(--primary)"` and paint nothing. The
 * house seed is the system's own default, which opens the picker on the
 * product's colour instead of a stranger's blue.
 *
 * Read from `@repo/theme/signet` rather than `@repo/chapter-theme`, which also
 * exports it as `HOUSE_SEED`: that package's `index.ts` re-exports through a
 * `./signet.js` specifier Turbopack cannot resolve from source, so importing
 * it here type-checks and passes vitest and then fails `next build`. It is
 * fine in `tests/`, which is why the contrast guards use it.
 *
 * The column's server default is `null` and stays that way — this only decides
 * where the picker starts, never what an untouched role stores.
 */
const DEFAULT_ROLE_SWATCH = signetDarkTokens.color.gold.seed;

/**
 * "This chapter needs a new President" recovery prompt
 * (spec/behavior/rbac.md § Presidency Transfer "Edge case").
 *
 * Rendered ABOVE the `roles:manage` gate in {@link RolesAndPermissionsPage},
 * not inside it: the eligible claimant is by definition not the (now-vacant)
 * President, and the default role pack only grants `roles:manage` to
 * President — so a member who needs to see this is exactly the member the
 * gate would otherwise hide it from.
 */
function PresidencyClaimBanner() {
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const chapterQuery = useCurrentChapter();
  const needsPresident = chapterQuery.data?.needs_president ?? false;
  const statusQuery = usePresidencyClaimStatus({ enabled: needsPresident });
  const claimPresidency = useClaimPresidency();

  if (!needsPresident) return null;

  async function handleClaim() {
    const confirmed = await confirm({
      title: "Claim the presidency?",
      description:
        "You will immediately hold every permission the President role carries. Only a future presidency transfer can move it again.",
      confirmLabel: "Claim presidency",
    });
    if (!confirmed) return;
    try {
      await claimPresidency.mutateAsync();
      toast({
        title: "Presidency claimed",
        description: "You are now the President of this chapter.",
      });
    } catch (error) {
      toast({
        title: "Couldn't claim presidency",
        description: getErrorMessage(
          error,
          "You may not be eligible, or someone else already claimed it.",
        ),
        variant: "destructive",
      });
    }
  }

  const eligible = statusQuery.data?.eligible ?? false;
  const nextRoleName = statusQuery.data?.next_role_name ?? null;

  let description: string;
  if (statusQuery.isLoading) {
    description = "Checking who can claim it...";
  } else if (statusQuery.isError) {
    // Distinct from "no eligible role was found" below — an error here means
    // eligibility genuinely could not be determined, not that it was checked
    // and came back empty. Conflating the two told an actually-eligible
    // officer to contact support over a transient network blip.
    description = "Couldn't check who can claim it. Retry in a moment.";
  } else if (eligible) {
    description = nextRoleName
      ? `As the highest-ranked remaining officer (${nextRoleName}), you can claim the presidency now.`
      : "You can claim the presidency now.";
  } else if (nextRoleName) {
    description = `Only a member holding the ${nextRoleName} role can claim it right now.`;
  } else {
    description =
      "No eligible officer role was found. Contact Frapp support to resolve this.";
  }

  return (
    <>
      {confirmDialog}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <RolesGlyph className="h-4 w-4 text-muted-foreground" />
            This chapter needs a new President
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {eligible ? (
          <CardFooter className="flex justify-end">
            <Button onClick={() => void handleClaim()} disabled={claimPresidency.isPending}>
              {claimPresidency.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Claim presidency
            </Button>
          </CardFooter>
        ) : null}
      </Card>
    </>
  );
}

export function RolesAndPermissionsPage() {
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const { isOffline } = useNetwork();
  const rolesQuery = useRoles();
  const catalogQuery = usePermissionsCatalog();
  const membersQuery = useMembers();
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();
  const deleteRole = useDeleteRole();
  const transferPresidency = useTransferPresidency();

  const roles = useMemo(() => asArray<Role>(rolesQuery.data), [rolesQuery.data]);
  const catalog = useMemo(
    () => asArray<PermissionCatalogEntry>(catalogQuery.data),
    [catalogQuery.data],
  );
  const members = useMemo(
    () => asArray<MemberSummary>(membersQuery.data),
    [membersQuery.data],
  );

  const [activeRoleId, setActiveRoleId] = useState<string | null>(null);
  const activeRole = useMemo(
    () => roles.find((role) => role.id === activeRoleId) ?? null,
    [roles, activeRoleId],
  );

  // Draft state for editing the active role.
  const [nameDraft, setNameDraft] = useState("");
  const [colorDraft, setColorDraft] = useState("");
  const [displayOrderDraft, setDisplayOrderDraft] = useState("");
  const [permissionsDraft, setPermissionsDraft] = useState<Set<string>>(
    new Set(),
  );

  // Draft state for creating a new role.
  const [createName, setCreateName] = useState("");
  const [createColor, setCreateColor] = useState("");
  const [createPermissions, setCreatePermissions] = useState<Set<string>>(
    new Set(),
  );

  // Presidency transfer draft.
  const [transferTargetMemberId, setTransferTargetMemberId] =
    useState<string>("");

  function selectRole(role: Role) {
    setActiveRoleId(role.id);
    setNameDraft(role.name);
    setColorDraft(role.color ?? "");
    setDisplayOrderDraft(String(role.display_order ?? 0));
    setPermissionsDraft(new Set(role.permissions ?? []));
  }

  function toggleDraftPermission(permission: string) {
    setPermissionsDraft((prev) => {
      const next = new Set(prev);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  }

  function toggleCreatePermission(permission: string) {
    setCreatePermissions((prev) => {
      const next = new Set(prev);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  }

  async function handleSaveRole() {
    if (!activeRole) return;
    try {
      await updateRole.mutateAsync({
        id: activeRole.id,
        body: {
          name: nameDraft || undefined,
          color: colorDraft || undefined,
          display_order: displayOrderDraft
            ? Number(displayOrderDraft)
            : undefined,
          permissions: Array.from(permissionsDraft),
        },
      });
      toast({
        title: "Role saved",
        description: `${nameDraft || activeRole.name} is up to date.`,
      });
    } catch (error) {
      toast({
        title: "Couldn't save role",
        description: getErrorMessage(
          error,
          "Retry in a moment. The API rejected the update.",
        ),
        variant: "destructive",
      });
    }
  }

  async function handleCreateRole(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createName.trim()) return;
    try {
      await createRole.mutateAsync({
        name: createName.trim(),
        color: createColor || undefined,
        permissions: Array.from(createPermissions),
      });
      toast({
        title: "Role created",
        description: `${createName} is ready to assign.`,
      });
      setCreateName("");
      setCreateColor("");
      setCreatePermissions(new Set());
    } catch (error) {
      toast({
        title: "Couldn't create role",
        description: getErrorMessage(error, "Check the name for duplicates."),
        variant: "destructive",
      });
    }
  }

  async function handleDeleteRole(role: Role) {
    if (role.is_system) return;
    const confirmed = await confirm({
      title: `Delete ${role.name}?`,
      description:
        "Members assigned this role lose its permissions immediately. This cannot be undone.",
      confirmLabel: "Delete role",
    });
    if (!confirmed) return;
    try {
      await deleteRole.mutateAsync(role.id);
      toast({
        title: "Role deleted",
        description: `${role.name} was removed.`,
      });
      if (activeRoleId === role.id) {
        setActiveRoleId(null);
      }
    } catch (error) {
      toast({
        title: "Couldn't delete role",
        description: getErrorMessage(
          error,
          "System roles can't be deleted. Remove members from the role first.",
        ),
        variant: "destructive",
      });
    }
  }

  async function handleTransferPresidency() {
    if (!transferTargetMemberId) return;
    const confirmed = await confirm({
      title: "Transfer presidency?",
      description:
        "The President role moves to the selected member immediately and is removed from you. Only the current president can undo it.",
      confirmLabel: "Transfer presidency",
    });
    if (!confirmed) return;
    try {
      await transferPresidency.mutateAsync({
        target_member_id: transferTargetMemberId,
      });
      toast({
        title: "Presidency transferred",
        description: "The President role moved successfully.",
      });
      setTransferTargetMemberId("");
    } catch (error) {
      toast({
        title: "Couldn't transfer presidency",
        description: getErrorMessage(
          error,
          "Only the current president can initiate a transfer.",
        ),
        variant: "destructive",
      });
    }
  }

  function retryQueries() {
    void rolesQuery.refetch();
    void catalogQuery.refetch();
  }

  /*
    §4's four flags, and the three defects this replaces.

    **The states used to render above the gate.** `isPending` and `isError`
    early-returned before `<Can>` ran, so a member without `roles:manage` who
    reached this route by URL was told the roles were loading, and then that
    they had failed to load, for a surface they were never going to see. The
    order is permission, then network, then data — the one
    `geofences-admin-page.tsx` spells out and `/polls` follows.

    **`isPending` alone is not a spinner.** Both queries are
    `enabled: !!chapterId`, so `isPending` is true for a query that is not
    running and never will be. `isLoading` is the in-flight half, and a paused
    query is the other one §4 names.

    **There was no offline state at all**, so a member with a dropped
    connection sat on the skeleton until the retry budget ran out. Gated on
    "no cached data" rather than on `isOffline` alone: TanStack keeps `data`
    through a blip, and replacing a rendered roster with "unavailable offline"
    throws away an answer we hold.

    No entitlement branch: `isPending && fetchStatus === "idle"` needs a
    disabled query, and inside `<Can>` a chapter is always active, which is the
    only thing these two are gated on.
  */
  const paused =
    (rolesQuery.isPending && rolesQuery.fetchStatus === "paused") ||
    (catalogQuery.isPending && catalogQuery.fetchStatus === "paused");

  let body: ReactNode;
  if (isOffline && hasNoCachedData(rolesQuery, catalogQuery)) {
    body = (
      <OfflineState
        title="Roles unavailable offline"
        description="Reconnect to load the chapter's roles and edit their permissions."
        onRetry={retryQueries}
      />
    );
  } else if (rolesQuery.isLoading || catalogQuery.isLoading || paused) {
    body = <LoadingState message="Loading roles and permissions..." />;
  } else if (rolesQuery.isError || catalogQuery.isError) {
    body = (
      <ErrorState
        title="Couldn't load roles"
        description="Retry in a moment. This view requires the roles:manage permission."
        onRetry={retryQueries}
      />
    );
  } else {
    body = (
      <div className="space-y-6">
        <header>
          <h2 className="text-2xl font-semibold tracking-tight">
            Roles & Permissions
          </h2>
          <p className="text-sm text-muted-foreground">
            Build chapter-specific roles from the system permissions catalog.
            System roles cannot be deleted, but their permissions are editable.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Chapter roles</CardTitle>
                <CardDescription>
                  {roles.length} role{roles.length === 1 ? "" : "s"} defined
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {roles.length === 0 ? (
                <EmptyState
                  title="No roles yet"
                  description="Chapters always start with default system roles. Refresh to reload or create a new custom role."
                />
              ) : (
                <ul className="divide-y divide-border/70">
                  {[...roles]
                    .sort((a, b) => a.display_order - b.display_order)
                    .map((role) => (
                      <li
                        key={role.id}
                        className="flex items-center justify-between py-2"
                      >
                        <button
                          type="button"
                          /*
                            `--accent` aliases `--popover`; inside this
                            `CardContent` that is 1.085:1, i.e. no hover at
                            all. Same recipe as `/documents`' folder rail: the
                            tint for hover, `accent-4` plus `accent-11` for the
                            selected row, since a rail on a card needs two
                            states the ladder cannot give it.
                          */
                          className={cn(
                            "flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1 text-left transition-colors",
                            FOCUS_RING_OFFSET,
                            activeRoleId === role.id
                              ? "bg-accent-subtle-hover text-accent-text"
                              : "hover:bg-accent-subtle",
                          )}
                          aria-pressed={activeRoleId === role.id}
                          onClick={() => selectRole(role)}
                        >
                          <span
                            aria-hidden="true"
                            className="h-3 w-3 rounded-full border"
                            style={{
                              backgroundColor: role.color ?? "transparent",
                            }}
                          />
                          <span className="truncate text-sm font-medium">
                            {role.name}
                          </span>
                          {role.is_system ? (
                            <Badge variant="outline">System</Badge>
                          ) : null}
                          <span className="ml-auto text-xs text-muted-foreground">
                            {role.permissions.length} perm
                            {role.permissions.length === 1 ? "" : "s"}
                          </span>
                        </button>
                        {role.is_system ? null : (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete ${role.name}`}
                            onClick={() => void handleDeleteRole(role)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </li>
                    ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {activeRole ? `Edit ${activeRole.name}` : "Select a role to edit"}
              </CardTitle>
              <CardDescription>
                Toggle permissions from the system catalog. Changes take effect
                on the next request for every member holding this role.
              </CardDescription>
            </CardHeader>
            {activeRole ? (
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <Label htmlFor="role-name">Name</Label>
                    <Input
                      id="role-name"
                      value={nameDraft}
                      onChange={(event) => setNameDraft(event.target.value)}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="role-display-order">Display order</Label>
                    <Input
                      id="role-display-order"
                      type="number"
                      value={displayOrderDraft}
                      onChange={(event) =>
                        setDisplayOrderDraft(event.target.value)
                      }
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="role-color">Accent color</Label>
                    <Input
                      id="role-color"
                      type="color"
                      value={colorDraft || DEFAULT_ROLE_SWATCH}
                      onChange={(event) => setColorDraft(event.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Permissions ({permissionsDraft.size}/{catalog.length})
                  </Label>
                  <div className="mt-2 grid gap-2 rounded-md border border-border p-3 max-h-80 overflow-y-auto">
                    {catalog
                      // The wildcard renders only on a role that already
                      // carries it. On the system President role it is locked
                      // (the API rejects both introducing and stripping it —
                      // the transfer flow moves it); on a legacy non-system
                      // role it stays uncheckable-off so the API's cleanup
                      // path (stripping `*`) is reachable from the UI.
                      .filter(
                        (entry) =>
                          entry.permission !== "*" ||
                          (activeRole?.permissions ?? []).includes("*"),
                      )
                      .map((entry) => {
                        const lockedWildcard =
                          entry.permission === "*" &&
                          (activeRole?.is_system ?? true);
                        return (
                          <label
                            key={entry.permission}
                            className={
                              lockedWildcard
                                ? "flex items-center gap-2 text-sm opacity-70"
                                : "flex cursor-pointer items-center gap-2 text-sm"
                            }
                            title={
                              lockedWildcard
                                ? "The wildcard moves only through the presidency-transfer flow"
                                : undefined
                            }
                          >
                            <span className={dashboardCheckboxHitAreaClassName}>
                              <input
                                type="checkbox"
                                className={dashboardTableCheckboxClassName}
                                checked={permissionsDraft.has(entry.permission)}
                                disabled={lockedWildcard}
                                onChange={() =>
                                  toggleDraftPermission(entry.permission)
                                }
                              />
                            </span>
                            <code className="text-xs">{entry.permission}</code>
                            <span className="text-xs text-muted-foreground">
                              {entry.key}
                            </span>
                          </label>
                        );
                      })}
                  </div>
                </div>
              </CardContent>
            ) : (
              <CardContent className="text-sm text-muted-foreground">
                Pick a role on the left to see its permissions and edit the
                details here.
              </CardContent>
            )}
            {activeRole ? (
              <CardFooter className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => selectRole(activeRole)}
                  disabled={updateRole.isPending}
                >
                  Revert changes
                </Button>
                <Button
                  onClick={handleSaveRole}
                  disabled={updateRole.isPending}
                >
                  {updateRole.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Save role
                </Button>
              </CardFooter>
            ) : null}
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Create a custom role</CardTitle>
            <CardDescription>
              Custom roles can be deleted later. Permissions are additive — the
              member also keeps every permission from their other roles.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleCreateRole}>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1 sm:col-span-2">
                  <Label htmlFor="create-role-name">Role name</Label>
                  <Input
                    id="create-role-name"
                    value={createName}
                    onChange={(event) => setCreateName(event.target.value)}
                    placeholder="Philanthropy Chair"
                    required
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="create-role-color">Accent color</Label>
                  <Input
                    id="create-role-color"
                    type="color"
                    value={createColor || DEFAULT_ROLE_SWATCH}
                    onChange={(event) => setCreateColor(event.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Permissions ({createPermissions.size}/{catalog.length})
                </Label>
                <div className="mt-2 grid gap-2 rounded-md border border-border p-3 max-h-60 overflow-y-auto">
                  {catalog
                    // New roles can never carry the wildcard (the API rejects
                    // it), so don't offer the checkbox at all.
                    .filter((entry) => entry.permission !== "*")
                    .map((entry) => (
                    <label
                      key={entry.permission}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <span className={dashboardCheckboxHitAreaClassName}>
                        <input
                          type="checkbox"
                          className={dashboardTableCheckboxClassName}
                          checked={createPermissions.has(entry.permission)}
                          onChange={() =>
                            toggleCreatePermission(entry.permission)
                          }
                        />
                      </span>
                      <code className="text-xs">{entry.permission}</code>
                      <span className="text-xs text-muted-foreground">
                        {entry.key}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex justify-end">
              <Button
                type="submit"
                disabled={createRole.isPending || !createName.trim()}
              >
                {createRole.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Create role
              </Button>
            </CardFooter>
          </form>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              {/*
                Lucide's `ShieldCheck` marked the one card on this screen that
                is *about* a role rather than about editing one, and
                `iconography.md` §6.2 reserves Lucide for control furniture —
                verbs on buttons and spinners. The roles intent is already
                drawn as a Signet duotone in `nav-glyphs.tsx`; a second
                spelling of it would be the drift §1 rule 1 bans, and a
                re-export module holding nothing but that alias would be the
                parallel path the cutover rule bans. So this imports the one
                that exists.
              */}
              <RolesGlyph className="h-4 w-4 text-muted-foreground" />
              Transfer presidency
            </CardTitle>
            <CardDescription>
              Move the President role to another member. Only the current
              president can initiate this — the API rejects anyone else.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-[2fr_auto]">
              <Select
                value={transferTargetMemberId}
                onValueChange={setTransferTargetMemberId}
              >
                <SelectTrigger aria-label="Select the new president">
                  <SelectValue placeholder="Select a member" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((member) => (
                    <SelectItem
                      key={member.id ?? member.user_id ?? "unknown"}
                      value={String(member.id ?? member.user_id ?? "")}
                    >
                      {member.display_name ?? "Unnamed member"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="destructive"
                onClick={handleTransferPresidency}
                disabled={
                  !transferTargetMemberId || transferPresidency.isPending
                }
              >
                {transferPresidency.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Transfer presidency
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/*
        Deliberately outside `<Can permission="roles:manage">` below — see
        `PresidencyClaimBanner`'s own doc comment for why.
      */}
      <PresidencyClaimBanner />
      <Can
        permission="roles:manage"
        offlineFallback={(retry) => (
          <PermissionsOfflineSurface
            description="Reconnect to check whether you can manage roles."
            onRetry={retry}
          />
        )}
        deniedFallback={
          <Card>
            <CardHeader>
              <CardTitle>Roles &amp; Permissions</CardTitle>
              <CardDescription>
                Managing roles requires the <code>roles:manage</code>{" "}
                permission. Ask your chapter president to grant access.
              </CardDescription>
            </CardHeader>
          </Card>
        }
      >
        {/*
          Above the state branch, not inside it. `ConfirmDialogHost` settles a
          pending promise on unmount, so a screen whose states sit over its own
          dialog cancels a confirmation the moment a background refetch fails —
          the shape §10 names from the other side and the Chapter Ops slice hit
          with this same primitive. It stays inside the gate: a member who loses
          the permission mid-flight should lose the confirmation with it.
        */}
        {confirmDialog}
        {body}
      </Can>
    </div>
  );
}
