"use client";

import type { ReactNode } from "react";

import { useMemo, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { getArchetype } from "@repo/org-archetypes";
import type { ChapterCustomRole } from "@repo/validation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EmptyState,
  ErrorState,
  anyReadUncached,
  LoadingState,
  OfflineState,
} from "@/components/shared/async-states";
import { useToast } from "@/hooks/use-toast";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { useNetwork } from "@/lib/providers/network-provider";
import {
  dashboardCheckboxHitAreaClassName,
  dashboardTableCheckboxClassName,
} from "@/components/shared/table-controls";
import { asArray, getErrorMessage, parseGuardedInt } from "@/lib/utils";
import { normalizeRoleOptions } from "@/lib/roles";
import { can } from "@repo/validation";
import { RolesAndPermissionsPage } from "@/components/roles/roles-page";
import {
  RolesMatrix,
  type MatrixCatalogEntry,
  type MatrixRole,
} from "@/components/roles/roles-matrix";
import {
  useCustomRoles,
  useCreateCustomRole,
  useUpdateCustomRole,
  useDeleteCustomRole,
  useMembers,
  useMyPermissions,
  usePermissionsCatalog,
  useRoles,
} from "@repo/hooks";

type PermissionCatalogEntry = { key: string; permission: string };

type Props = {
  /** The chapter's active archetype key (drives the role pack). */
  archetypeKey: string;
  /** Whether the caller holds `chapter-config:manage`. */
  canManage: boolean;
  /** The system permission catalog (capability rows + custom-role multi-select). */
  catalog: PermissionCatalogEntry[];
  /** Persisted `chapters.default_invite_role_id` (#422); null = no default set. */
  defaultInviteRoleId: string | null;
  /** Persist the default invite role through the config PATCH mutation. */
  onSaveDefaultInviteRole: (roleId: string | null) => Promise<void> | void;
  /** Whether a config PATCH is in flight. */
  isSavingConfig?: boolean;
  /**
   * The chapter-config read failed or was refused. The matrix does not need it
   * — see the note on this tab's mount in `settings-page.tsx` — so only the
   * default-invite-role control hides.
   */
  configUnavailable?: boolean;
};

// The sub-tabs used to carry `data-[state=active]:bg-background` — a
// workaround for the filled-pill TabsList that the #920 primitives slice
// deleted. The §6 underline row needs no override, so the constant is gone
// rather than emptied: it would otherwise have painted a solid slab behind the
// active sub-tab, on top of its underline.

/**
 * Settings → Roles, board `4e`.
 *
 * **One tab, one matrix.** This used to be four sub-tabs behind a second tab
 * bar — Pack, Matrix, Custom, Live roles — and `?tab=roles` landed on Pack, a
 * read-only list of archetype role names. The RBAC editor a president came for
 * was two clicks past that. Board `4d` pin 1 makes the nav's Roles row a deep
 * link into this tab, so what it lands on has to be the thing.
 *
 * What each sub-view became:
 *
 * | Sub-tab | Now |
 * | ------- | --- |
 * | **Matrix** | Replaced by `RolesMatrix` (`4e`), which is live rather than read-only. The old one rendered `n/a` in every pack-role cell |
 * | **Live roles** | Still `RolesAndPermissionsPage`, but no longer a permissions editor — the matrix took that. It keeps role create, rename, recolour, reorder, delete and presidency transfer |
 * | **Pack** | Gone as a view. The pack name it existed to show is now the header's "Role pack" label, which is where `4e` draws it |
 * | **Custom** | Still here, as a section rather than a tab. See below |
 *
 * **Custom roles are a section, not matrix columns**, and the board does not
 * settle this. `4e`'s pin 1 says "Custom roles append as columns", but its
 * columns are the `roles` table and custom roles are `chapter_custom_roles` —
 * a different table, with capabilities rather than permissions, enforced
 * through the bridge model in `spec/behavior/rbac.md`. Appending them as
 * columns would draw two incompatible grants in one grid and imply a cell in
 * the wrong one is editable. They keep their own section until the two models
 * are actually one.
 */
export function SettingsRolesTab({
  archetypeKey,
  canManage,
  catalog,
  configUnavailable,
  defaultInviteRoleId,
  onSaveDefaultInviteRole,
  isSavingConfig,
}: Props) {
  // `4e` draws the pack as a label in the header ("Role pack: Fraternity").
  // The archetype's own `label` is that string; `archetypeKey` is the slug.
  const packLabel = useMemo(
    () => getArchetype(archetypeKey).label,
    [archetypeKey],
  );

  return (
    <div className="space-y-8">
      {/*
        No `canManage` here. That prop is `chapter-config:manage`, which is what
        the config PATCH behind the default-invite-role control needs; the
        matrix PATCHes `/v1/roles/:id`, guarded by `roles:manage`
        (`rbac.controller.ts`). They are separately grantable, so the section
        reads its own.
      */}
      <RolesMatrixSection packLabel={packLabel} />

      {/*
        Role lifecycle: create, rename, recolour, reorder, delete, and the
        presidency transfer. Permissions are deliberately not here any more.
      */}
      <RolesAndPermissionsPage />

      <CustomView canManage={canManage} catalog={catalog} />

      {configUnavailable ? null : (
        <DefaultInviteRoleCard
          canManage={canManage}
          defaultInviteRoleId={defaultInviteRoleId}
          onSave={onSaveDefaultInviteRole}
          isSaving={isSavingConfig}
        />
      )}
    </div>
  );
}

/**
 * The `4e` header row and the matrix under it.
 *
 * Split out so the matrix owns its own reads: it needs `useRoles`,
 * `usePermissionsCatalog` and `useMembers`, none of which the settings page
 * fetches, and all three are exactly the reads that let this tab render when
 * the chapter-config call is refused.
 */
function RolesMatrixSection({ packLabel }: { packLabel: string | null }) {
  const { isOffline } = useNetwork();
  /*
   * **`roles:manage`, not the tab's `canManage`.** A cell PATCHes
   * `/v1/roles/:id`, which `rbac.controller.ts` guards with `ROLES_MANAGE`;
   * the tab's `canManage` is `chapter-config:manage`, which guards the config
   * blob. A chapter can mint a role holding either without the other, so
   * crossing them breaks both ways: a `roles:manage` holder would find the
   * product's only permission editor read-only, and a `chapter-config:manage`
   * holder would get live cells that 403 on every click.
   */
  const { data: permissionsPayload } = useMyPermissions();
  const canManage = can("roles:manage", permissionsPayload?.permissions);
  const rolesQuery = useRoles();
  const catalogQuery = usePermissionsCatalog();
  const membersQuery = useMembers();

  const roles = useMemo(
    () => normalizeMatrixRoles(rolesQuery.data),
    [rolesQuery.data],
  );
  const catalog = useMemo(
    () => normalizeCatalog(catalogQuery.data),
    [catalogQuery.data],
  );
  // `null` until the members read lands, so a column header shows no count
  // rather than "0 members" for a role that may well have some.
  const memberCounts = useMemo(() => {
    if (!membersQuery.isSuccess) return null;
    const counts = new Map<string, number>();
    for (const member of asArray<{ role_ids?: string[] }>(membersQuery.data)) {
      for (const roleId of member.role_ids ?? []) {
        counts.set(roleId, (counts.get(roleId) ?? 0) + 1);
      }
    }
    return counts;
  }, [membersQuery.data, membersQuery.isSuccess]);

  const header = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="min-w-0">
        <h2 className="text-2xl font-bold tracking-[-0.3px]">Roles</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {rolesQuery.isSuccess
            ? `${roles.length} ${roles.length === 1 ? "role" : "roles"}`
            : "Roles"}
          {packLabel ? ` · ${packLabel} role pack` : null}
        </p>
      </div>
    </div>
  );

  if (isOffline && anyReadUncached(rolesQuery, catalogQuery)) {
    return (
      <section className="space-y-4">
        {header}
        <OfflineState description="Reconnect to see and change who holds what." />
      </section>
    );
  }
  if (rolesQuery.isPending || catalogQuery.isPending) {
    return (
      <section className="space-y-4">
        {header}
        <LoadingState message="Loading roles..." />
      </section>
    );
  }
  if (rolesQuery.isError || catalogQuery.isError) {
    return (
      <section className="space-y-4">
        {header}
        <ErrorState
          title="Couldn't load roles"
          description="The role list or the permission catalog couldn't be fetched. Retry to try again."
          onRetry={() => {
            void rolesQuery.refetch();
            void catalogQuery.refetch();
          }}
        />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      {header}
      <RolesMatrix
        roles={roles}
        catalog={catalog}
        memberCounts={memberCounts}
        canManage={canManage}
      />
      <p className="text-[12.5px] text-muted-foreground">
        {canManage
          ? "A role holding every permission cannot be edited here; the presidency moves through Transfer presidency below."
          : "You can see who holds what. Changing it needs the roles:manage permission."}
      </p>
    </section>
  );
}

function normalizeMatrixRoles(data: unknown): MatrixRole[] {
  return asArray<Record<string, unknown>>(data).map((role) => ({
    id: String(role.id ?? ""),
    name: String(role.name ?? ""),
    permissions: Array.isArray(role.permissions)
      ? role.permissions.map(String)
      : [],
    is_system: Boolean(role.is_system),
    display_order: Number(role.display_order ?? 0),
    color: typeof role.color === "string" ? role.color : null,
  }));
}

function normalizeCatalog(data: unknown): MatrixCatalogEntry[] {
  return asArray<Record<string, unknown>>(data).map((entry) => ({
    key: String(entry.key ?? ""),
    permission: String(entry.permission ?? ""),
  }));
}

/**
 * Settings → Roles → Default invite role (#422).
 *
 * Sits above the sub-tabs rather than inside one: it is a chapter-level
 * setting about roles, not a view of the role pack, the matrix, or the custom
 * catalog.
 *
 * The select carries an explicit "No default" option because clearing is a
 * real operation — it writes `null` and returns invites to the seeded Member
 * fallback — and an empty `<option value="">` is the only way to express that
 * in a native select without a second control.
 *
 * Saves on change rather than behind a Save button, matching the Privacy
 * tab's switch: it is one scalar, the write is audit-logged, and there is no
 * draft state worth protecting.
 */
function DefaultInviteRoleCard({
  canManage,
  defaultInviteRoleId,
  onSave,
  isSaving,
}: {
  canManage: boolean;
  defaultInviteRoleId: string | null;
  onSave: (roleId: string | null) => Promise<void> | void;
  isSaving?: boolean;
}) {
  const rolesQuery = useRoles();

  const roleOptions = useMemo(
    () =>
      normalizeRoleOptions(rolesQuery.data).sort((first, second) =>
        first.name.localeCompare(second.name),
      ),
    [rolesQuery.data],
  );

  // A configured role that is no longer in the catalog would render as "No
  // default" and silently rewrite the setting on the next save. The API's
  // `on delete set null` makes this rare, but a role renamed away between the
  // two queries is enough — say so rather than paper over it.
  const isDangling =
    defaultInviteRoleId !== null &&
    roleOptions.length > 0 &&
    !roleOptions.some((role) => role.id === defaultInviteRoleId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Default invite role</CardTitle>
        <CardDescription>
          The role new invites use when the sender doesn&apos;t pick one.
          Senders can still override it per invite. Changes here are written to
          the chapter audit log.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label htmlFor="default-invite-role">Role</Label>
        <select
          id="default-invite-role"
          className="flex h-9 w-full max-w-sm rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          value={defaultInviteRoleId ?? ""}
          disabled={!canManage || isSaving || rolesQuery.isPending}
          onChange={(event) => {
            const next = event.target.value;
            void onSave(next === "" ? null : next);
          }}
        >
          <option value="">No default (falls back to Member)</option>
          {roleOptions.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
        {isDangling ? (
          <p className="text-[12.5px] text-warning">
            The configured default role no longer exists. Pick another, or
            leave it — new invites fall back to the Member role.
          </p>
        ) : null}
        {rolesQuery.isError ? (
          <p className="text-[12.5px] text-destructive">
            Roles could not load, so the default cannot be changed right now.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}


const EMPTY_DRAFT = {
  key: "",
  label: "",
  rank: 99,
  capabilities: [] as string[],
};

function CustomView({
  canManage,
  catalog,
}: {
  canManage: boolean;
  catalog: PermissionCatalogEntry[];
}) {
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const { isOffline } = useNetwork();
  const customRolesQuery = useCustomRoles();
  const createRole = useCreateCustomRole();
  const updateRole = useUpdateCustomRole();
  const deleteRole = useDeleteCustomRole();

  const roles = customRolesQuery.data ?? [];
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  // The wildcard is reserved for the live President role — the API rejects it
  // on custom roles (400), so don't offer the checkbox at all.
  const assignableCatalog = useMemo(
    () => catalog.filter((entry) => entry.permission !== "*"),
    [catalog],
  );

  function setRank(raw: string) {
    const parsed = parseGuardedInt(raw, 0);
    if (parsed === undefined) return;
    setDraft((prev) => ({ ...prev, rank: parsed }));
  }

  function toggleDraftCapability(permission: string) {
    setDraft((prev) => ({
      ...prev,
      capabilities: prev.capabilities.includes(permission)
        ? prev.capabilities.filter((p) => p !== permission)
        : [...prev.capabilities, permission],
    }));
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.key.trim() || !draft.label.trim()) return;
    try {
      await createRole.mutateAsync({
        key: draft.key.trim(),
        label: draft.label.trim(),
        rank: draft.rank,
        capabilities: draft.capabilities,
      });
      toast({
        title: "Custom role created",
        description: "An entry was written to the chapter audit log.",
      });
      setDraft(EMPTY_DRAFT);
    } catch (error) {
      toast({
        title: "Couldn't create custom role",
        description: getErrorMessage(
          error,
          "The key may already be in use. Retry with a different key.",
        ),
        variant: "destructive",
      });
    }
  }

  async function handleDelete(role: ChapterCustomRole) {
    const confirmed = await confirm({
      title: `Delete the custom role "${role.label}"?`,
      description:
        "Members holding it lose its capabilities on their next request. This cannot be undone.",
      confirmLabel: "Delete custom role",
    });
    if (!confirmed) return;
    try {
      await deleteRole.mutateAsync(role.id);
      toast({ title: "Custom role deleted" });
    } catch (error) {
      toast({
        title: "Couldn't delete custom role",
        description: getErrorMessage(error, "Core roles cannot be deleted."),
        variant: "destructive",
      });
    }
  }

  async function handleToggleCapability(
    role: ChapterCustomRole,
    permission: string,
  ) {
    // Strip any legacy wildcard before building the payload: the API rejects
    // `*` on custom roles, and the chip no longer renders, so echoing a
    // pre-bridge `*` back would make the role permanently uneditable. The
    // first toggle on such a role also cleans the stored row.
    const current = role.capabilities.filter((p) => p !== "*");
    const next = current.includes(permission)
      ? current.filter((p) => p !== permission)
      : [...current, permission];
    try {
      await updateRole.mutateAsync({
        id: role.id,
        body: { capabilities: next },
      });
    } catch (error) {
      toast({
        title: "Couldn't update custom role",
        description: getErrorMessage(error, "Retry in a moment."),
        variant: "destructive",
      });
    }
  }

  /*
    §4's flags, and the two things this tab was missing.

    `isPending` alone was the spinner gate, but `useCustomRoles` is
    `enabled: !!chapterId`, so it is true for a query that is not running —
    and a query paused offline shares it. And there was no offline state at
    all, so a member with a dropped connection sat on the skeleton until the
    retry budget ran out. Gated on "no cached data", not on `isOffline`: a blip
    must not replace a rendered list with "unavailable offline".

    The states render *below* `{confirmDialog}` rather than above it, so a
    background refetch failure cannot unmount an open confirmation and settle
    its promise `null` behind the member's back.
  */
  const paused =
    customRolesQuery.isPending && customRolesQuery.fetchStatus === "paused";

  let body: ReactNode;
  if (isOffline && anyReadUncached(customRolesQuery)) {
    body = (
      <OfflineState
        title="Custom roles unavailable offline"
        description="Reconnect to load this chapter's custom roles and edit their capabilities."
        onRetry={() => void customRolesQuery.refetch()}
      />
    );
  } else if (customRolesQuery.isLoading || paused) {
    body = <LoadingState message="Loading custom roles..." />;
  } else if (customRolesQuery.isError) {
    body = (
      <ErrorState
        title="Couldn't load custom roles"
        description="Retry to fetch this chapter's custom roles."
        onRetry={() => void customRolesQuery.refetch()}
      />
    );
  } else {
    body = (
      <>
      <Card>
        <CardHeader>
          <CardTitle>Custom roles</CardTitle>
          <CardDescription>
            Chapter-defined roles with a label, rank, and capabilities.
            Capabilities are enforced: assign these roles in the member
            directory and they apply on the member&apos;s next request. Core
            roles are protected from deletion. Saving writes an entry to the
            chapter audit log.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {roles.length === 0 ? (
            <EmptyState
              title="No custom roles yet"
              description="Create one below to extend the permission matrix."
            />
          ) : (
            <ul className="space-y-3">
              {roles.map((role) => (
                <li
                  key={role.id}
                  className="rounded-md border border-border p-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <span className="text-sm font-medium">{role.label}</span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {role.key} · rank {role.rank}
                        {role.core ? " · core" : ""}
                      </span>
                    </div>
                    {!role.core ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!canManage || deleteRole.isPending}
                        onClick={() => void handleDelete(role)}
                        aria-label={`Delete ${role.label}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {assignableCatalog.map((entry) => {
                      const held = role.capabilities.includes(entry.permission);
                      return (
                        <label
                          key={entry.permission}
                          className="flex items-center gap-1.5 text-xs"
                        >
                          <span className={dashboardCheckboxHitAreaClassName}>
                            <input
                              type="checkbox"
                              className={dashboardTableCheckboxClassName}
                              checked={held}
                              disabled={!canManage || updateRole.isPending}
                              onChange={() =>
                                void handleToggleCapability(
                                  role,
                                  entry.permission,
                                )
                              }
                              aria-label={`${role.label} ${entry.permission}`}
                            />
                          </span>
                          <span className="font-mono">{entry.permission}</span>
                        </label>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Create a custom role</CardTitle>
          <CardDescription>
            The key is a lowercase slug (letters, numbers, underscores), unique
            per chapter.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleCreate}>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="custom-role-key">Key</Label>
                <Input
                  id="custom-role-key"
                  value={draft.key}
                  disabled={!canManage}
                  placeholder="pledge_educator"
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, key: event.target.value }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="custom-role-label">Label</Label>
                <Input
                  id="custom-role-label"
                  value={draft.label}
                  disabled={!canManage}
                  placeholder="Pledge Educator"
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, label: event.target.value }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="custom-role-rank">Rank</Label>
                <Input
                  id="custom-role-rank"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  aria-label="Rank"
                  value={draft.rank}
                  disabled={!canManage}
                  onChange={(event) => setRank(event.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Capabilities</span>
              <div className="flex flex-wrap gap-2">
                {assignableCatalog.map((entry) => (
                  <label
                    key={entry.permission}
                    className="flex items-center gap-1.5 text-xs"
                  >
                    <span className={dashboardCheckboxHitAreaClassName}>
                      <input
                        type="checkbox"
                        className={dashboardTableCheckboxClassName}
                        checked={draft.capabilities.includes(entry.permission)}
                        disabled={!canManage}
                        onChange={() => toggleDraftCapability(entry.permission)}
                        aria-label={`new role ${entry.permission}`}
                      />
                    </span>
                    <span className="font-mono">{entry.permission}</span>
                  </label>
                ))}
              </div>
            </div>
          </CardContent>
          <CardContent className="flex justify-end pt-0">
            <Button
              type="submit"
              disabled={
                !canManage ||
                createRole.isPending ||
                !draft.key.trim() ||
                !draft.label.trim()
              }
            >
              {createRole.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Create role
            </Button>
          </CardContent>
        </form>
      </Card>
      </>
    );
  }

  return (
    <div className="space-y-6">
      {/* Above the branch, so no state change unmounts an open confirmation. */}
      {confirmDialog}
      {body}
    </div>
  );
}
