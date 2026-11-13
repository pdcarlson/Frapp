"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ProfileSection } from "@/components/profile/profile-section";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseChapterRoles } from "@repo/hooks/chapter-roles";
import { useMyPermissions, useRoles } from "@repo/hooks";
import {
  PresidencyClaimBanner,
  TransferPresidencySection,
} from "@/components/roles/presidency";
import { RolesOverview } from "@/components/roles/roles-overview";
import { TierPermissionsPage } from "@/components/roles/tier-permissions-page";
import { RolePage } from "@/components/roles/role-page";

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
   * The chapter-config read failed or was refused. The roles pages do not
   * need it, so only the default-invite-role control hides.
   */
  configUnavailable?: boolean;
};

/**
 * Chapter settings → Roles (#3990).
 *
 * Three pages in one tab, addressed by the URL so Back and a shared link work:
 *
 * | URL | Page |
 * | --- | ---- |
 * | `?tab=roles` | The tiers in order with their roles, then roles outside the tiers (`RolesOverview`) |
 * | `?tab=roles&tier=<id>` | One tier's permissions, a page of switches by module (`TierPermissionsPage`) |
 * | `?tab=roles&role=<id>` | One role: details, tier, and its own switches (`RolePage`) |
 *
 * The roles × permissions matrix that used to sit here is gone (#3990, which
 * also makes its keyboard grid #2173 and #2836 moot): Paul asked for "toggles,
 * not the matrix", set per tier. `/roles` still redirects here.
 *
 * Nothing here waits on the chapter-config read, which needs
 * `chapter-config:view`; only the default-invite-role control hides without
 * it.
 */
export function SettingsRolesTab({
  canManage,
  configUnavailable,
  defaultInviteRoleId,
  onSaveDefaultInviteRole,
  isSavingConfig,
}: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: permissionsPayload } = useMyPermissions();
  const tierId = searchParams.get("tier");
  const roleId = searchParams.get("role");

  const goTo = (query: string) => router.push(`/settings?tab=roles${query}`);
  const openTier = (id: string) => goTo(`&tier=${encodeURIComponent(id)}`);
  const openRole = (id: string) => goTo(`&role=${encodeURIComponent(id)}`);
  const backToRoles = () => goTo("");

  if (tierId) {
    return (
      <TierPermissionsPage
        tierId={tierId}
        onBack={backToRoles}
        onOpenRole={openRole}
      />
    );
  }
  if (roleId) {
    return (
      <RolePage roleId={roleId} onBack={backToRoles} onOpenTier={openTier} />
    );
  }

  return (
    <div className="space-y-10">
      {/*
        Outside any `roles:manage` check: the member who can claim a vacant
        presidency is by definition not the President, the role that holds
        `roles:manage` by default.
      */}
      <PresidencyClaimBanner />
      <RolesOverview onOpenTier={openTier} onOpenRole={openRole} />
      {permissionsPayload?.permissions?.includes("*") ? (
        <TransferPresidencySection />
      ) : null}
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
 * The picker's "no default" choice. Radix `Select` reads an empty-string value
 * as "nothing picked, show the placeholder", so an item cannot carry it: the
 * choice carries this sentinel and `onValueChange` turns it back into the
 * `null` the API clears the setting with.
 */
const NO_DEFAULT_INVITE_ROLE = "__no-default__";
const NO_DEFAULT_INVITE_ROLE_LABEL = "No role";

/**
 * Settings → Roles → Default invite role (#422).
 *
 * Its own section rather than part of the tier list: it is a chapter-level
 * setting about roles, not a view of the roles.
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
  defaultInviteRoleId: configuredDefaultId,
  onSave,
  isSaving,
}: {
  canManage: boolean;
  defaultInviteRoleId: string | null;
  onSave: (roleId: string | null) => Promise<void> | void;
  isSaving?: boolean;
}) {
  const rolesQuery = useRoles();

  const roles = useMemo(
    () => parseChapterRoles(rolesQuery.data),
    [rolesQuery.data],
  );
  // A role holding `*` is no default: an invite can't grant it (the API
  // answers 403). One already configured stays listed, so the card names it
  // rather than calling it gone, and the officer can pick another.
  const roleOptions = useMemo(
    () =>
      roles
        .filter(
          (role) =>
            !role.everyone && (!role.locked || role.id === configuredDefaultId),
        )
        .map(({ id, name }) => ({ id, name }))
        .sort((first, second) => first.name.localeCompare(second.name)),
    [roles, configuredDefaultId],
  );

  // The Everyone role (#4191) is what an invite with no default grants, so a
  // chapter whose default names it reads as having none.
  const everyoneId = roles.find((role) => role.everyone)?.id;
  const defaultInviteRoleId =
    configuredDefaultId !== null && configuredDefaultId === everyoneId
      ? null
      : configuredDefaultId;

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
      hint="Used when an invite doesn't pick a role. With none, new members join with no role and get what Everyone gets. Changes are written to the chapter audit log."
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
            it. New invites join with no role until then.
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
