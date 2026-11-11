"use client";

import { useMemo } from "react";
import { ProfileSection } from "@/components/profile/profile-section";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ErrorState,
  anyReadUncached,
  OfflineState,
} from "@/components/shared/async-states";
import { useNetwork } from "@/lib/providers/network-provider";
import { asArray } from "@/lib/utils";
import { normalizeRoleOptions } from "@/lib/roles";
import { can } from "@repo/validation";
import { RolesAndPermissionsPage } from "@/components/roles/roles-page";
import {
  RolesMatrix,
  type MatrixCatalogEntry,
  type MatrixRole,
} from "@/components/roles/roles-matrix";
import {
  useMembers,
  useMyPermissions,
  usePermissionsCatalog,
  useRoles,
} from "@repo/hooks";
import { SettingsListCardSkeleton } from "@/components/settings/settings-skeleton";

type Props = {
  /** Whether the caller holds `chapter-config:manage`. */
  canManage: boolean;
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
 * was two clicks past that. Board `4d` pin 1 made the nav's Roles row a deep
 * link into this tab, so what it lands on has to be the thing. That row folded
 * into the nav's Settings row in #2946; `/roles` still redirects here.
 *
 * What each sub-view became:
 *
 * | Sub-tab | Now |
 * | ------- | --- |
 * | **Matrix** | Replaced by `RolesMatrix` (`4e`), which is live rather than read-only. The old one rendered `n/a` in every pack-role cell |
 * | **Live roles** | Still `RolesAndPermissionsPage`, but no longer a permissions editor — the matrix took that. It keeps role create, rename, recolour, reorder, delete and presidency transfer |
 * | **Pack** | Gone as a view, and its header label went too (2026-11-06): which pack seeded the roles is a setup detail |
 * | **Custom** | Gone (#4075, 2026-11-11): custom roles were folded into ordinary roles, so they are columns of the matrix like any other role |
 */
export function SettingsRolesTab({
  canManage,
  configUnavailable,
  defaultInviteRoleId,
  onSaveDefaultInviteRole,
  isSavingConfig,
}: Props) {
  return (
    <div className="space-y-10">
      {/*
        No `canManage` here. That prop is `chapter-config:manage`, which is what
        the config PATCH behind the default-invite-role control needs; the
        matrix PATCHes `/v1/roles/:id`, guarded by `roles:manage`
        (`rbac.controller.ts`). They are separately grantable, so the section
        reads its own.
      */}
      <RolesMatrixSection />

      {/*
        Role lifecycle: create, rename, recolour, reorder, delete, and the
        presidency transfer. Permissions are deliberately not here any more.
      */}
      <RolesAndPermissionsPage />

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
function RolesMatrixSection() {
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
    for (const member of membersQuery.data ?? []) {
      for (const roleId of member.role_ids) {
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
        <SettingsListCardSkeleton label="Loading roles" rows={4} />
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
      <p className="text-caption text-muted-foreground">
        {canManage
          ? "A role holding every permission cannot be edited here; the presidency moves through Transfer presidency below."
          : "You can see who holds what, but your role can't change it."}
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
 * The picker's "no default" choice. Radix `Select` reads an empty-string value
 * as "nothing picked, show the placeholder", so an item cannot carry it: the
 * choice carries this sentinel and `onValueChange` turns it back into the
 * `null` the API clears the setting with.
 */
const NO_DEFAULT_INVITE_ROLE = "__no-default__";
const NO_DEFAULT_INVITE_ROLE_LABEL = "No default (falls back to Member)";

/**
 * Settings → Roles → Default invite role (#422).
 *
 * Its own card rather than part of the matrix: it is a chapter-level setting
 * about roles, not a view of the roles.
 *
 * The picker carries an explicit "No default" option because clearing is a
 * real operation: it writes `null` and returns invites to the seeded Member
 * fallback.
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

  // A configured role with no matching item (roles still loading, failed to
  // load, or the role is gone) gets the empty value, so the trigger shows the
  // placeholder. Handing Radix an id it has no item for draws an empty box.
  const hasConfiguredItem =
    defaultInviteRoleId !== null &&
    roleOptions.some((role) => role.id === defaultInviteRoleId);
  const pickerValue =
    defaultInviteRoleId === null
      ? NO_DEFAULT_INVITE_ROLE
      : hasConfiguredItem
        ? defaultInviteRoleId
        : "";
  const pickerPlaceholder = rolesQuery.isPending
    ? "Loading roles…"
    : rolesQuery.isError
      ? "Roles could not load"
      : "Pick a role";

  return (
    <ProfileSection
      id="settings-default-invite-role"
      title="Default invite role"
      hint="Used when an invite doesn't pick a role. Changes are written to the chapter audit log."
    >
      <div className="space-y-2">
        <Label htmlFor="default-invite-role">Role</Label>
        <Select
          value={pickerValue}
          disabled={
            !canManage || isSaving || rolesQuery.isPending || rolesQuery.isError
          }
          onValueChange={(next) => {
            void onSave(next === NO_DEFAULT_INVITE_ROLE ? null : next);
          }}
        >
          <SelectTrigger id="default-invite-role" className="max-w-sm">
            <SelectValue placeholder={pickerPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_DEFAULT_INVITE_ROLE}>
              {NO_DEFAULT_INVITE_ROLE_LABEL}
            </SelectItem>
            {roleOptions.map((role) => (
              <SelectItem key={role.id} value={role.id}>
                {role.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isDangling ? (
          <p className="text-caption text-warning">
            The configured default role no longer exists. Pick another, or leave
            it. New invites fall back to the Member role.
          </p>
        ) : null}
        {rolesQuery.isError ? (
          <p className="text-caption text-destructive">
            Roles could not load, so the default cannot be changed right now.
          </p>
        ) : null}
      </div>
    </ProfileSection>
  );
}
