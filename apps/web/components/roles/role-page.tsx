"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, Eye, Loader2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDeleteRole, useUpdateRole } from "@repo/hooks";
import {
  isEveryoneRole,
  roleColorOrNull,
  type RoleColorHex,
  SELF_ASSIGNABLE_REFUSAL_COPY,
  selfAssignableRefusal,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorState } from "@/components/shared/async-states";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { ProfileSection } from "@/components/profile/profile-section";
import { SettingsListCardSkeleton } from "@/components/settings/settings-skeleton";
import { RoleColorSwatches } from "@/components/roles/role-color-swatches";
import { PermissionSwitchList } from "@/components/roles/permission-switch-list";
import { RoleOverrideList } from "@/components/roles/role-override-list";
import { useRolePermissionToggle } from "@/components/roles/use-role-permission-toggle";
import { useRolesData } from "@/components/roles/use-roles-data";
import { CANT_GIVE, lockedReasonFor } from "@repo/hooks/use-roles-data";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage, guardIntDraft, parseGuardedInt } from "@/lib/utils";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { useRolePreviewStore } from "@/lib/stores/role-preview-store";
import {
  isWildcardRole,
  mayGrant,
  previewPermissions,
  reachesOutside,
  reachesRole,
  reachesTier,
  type TieredRole,
} from "@repo/hooks/role-tiers";

/** The Select's value for "outside the tiers"; Radix can't carry `""`. */
const OUTSIDE = "__outside__";

/**
 * One role's page (#3990): its name, color, tier and @mention switch, then
 * what it can do.
 *
 * A role in a tier shows two columns (#4072): what its tier sets, read-only,
 * and this role's own answer, Off, Same as tier or On
 * (`role-override-list.tsx`). A role outside the tiers, which has no tier to
 * follow, shows one column of live switches.
 *
 * "View as" opens the dashboard as a member holding only this role sees it
 * (#4072), the way Discord's View Server As Role does.
 */
export function RolePage({
  roleId,
  onBack,
  onOpenTier,
}: {
  roleId: string;
  onBack: () => void;
  onOpenTier: (tierId: string) => void;
}) {
  const data = useRolesData();
  const { rolesQuery, tiersQuery, roles, words } = data;
  const role = roles.find((candidate) => candidate.id === roleId) ?? null;

  const back = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onBack}
      className="-ml-3"
    >
      <ChevronLeft aria-hidden />
      Roles
    </Button>
  );

  if (rolesQuery.isPending || tiersQuery.isPending) {
    return (
      <div className="space-y-4">
        {back}
        <SettingsListCardSkeleton label="Loading role" rows={6} />
      </div>
    );
  }
  if (rolesQuery.isError || !role) {
    return (
      <div className="space-y-4">
        {back}
        <ErrorState
          title={
            rolesQuery.isError ? "Couldn't load this role" : "This role is gone"
          }
          description={
            rolesQuery.isError
              ? "Retry, or go back to Roles."
              : `Someone may have deleted it. Go back to Roles to see the ${words.plural} as they are now.`
          }
          onRetry={
            rolesQuery.isError ? () => void rolesQuery.refetch() : undefined
          }
        />
      </div>
    );
  }
  // Keyed by role so the drafts start over when another role opens.
  return (
    <RoleBody
      key={role.id}
      role={role}
      data={data}
      back={back}
      onBack={onBack}
      onOpenTier={onOpenTier}
    />
  );
}

function RoleBody({
  role,
  data,
  back,
  onBack,
  onOpenTier,
}: {
  role: TieredRole;
  data: ReturnType<typeof useRolesData>;
  back: React.ReactNode;
  onBack: () => void;
  onOpenTier: (tierId: string) => void;
}) {
  const { tiers, roles, reach, canManage, words, memberCounts } = data;
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const startPreview = useRolePreviewStore((s) => s.start);
  const { confirm, confirmDialog } = useConfirmDialog();
  const updateRole = useUpdateRole();
  const deleteRole = useDeleteRole();
  const holders = useMemo(() => [role], [role]);
  const { permissionsOf, toggle, pending } = useRolePermissionToggle(holders);

  const tier = tiers.find((candidate) => candidate.id === role.tier_id) ?? null;
  // The Everyone role (#4191): its permissions and @everyone switch are
  // edited here; its name and tier are fixed, as the API holds them.
  const everyone = isEveryoneRole(role);
  const wildcard = isWildcardRole(role);
  const editable = canManage && reachesRole(reach, role, tiers);

  const [name, setName] = useState(role.name);
  // An off-palette value (a pre-#3485 seed or free pick) reads as none,
  // which is also how every client paints it.
  const [color, setColor] = useState<RoleColorHex | null>(
    roleColorOrNull(role.color),
  );
  // Whether the officer picked a swatch: an off-palette stored value shows as
  // "No color", so the draft alone can't tell "left alone" from "cleared".
  const [colorTouched, setColorTouched] = useState(false);
  const [placement, setPlacement] = useState(role.tier_id ?? OUTSIDE);
  const [mentionable, setMentionable] = useState(role.mentionable);
  // "Non-chapter business" (#4958, Shawn 2026-11-14): members add and remove
  // the role themselves. Judged against the drafted placement, since a move
  // into a tier is what most often rules it out.
  const [pickable, setPickable] = useState(role.self_assignable);
  const pickRefusal = selfAssignableRefusal({
    system_key: role.system_key,
    tier_id: placement === OUTSIDE ? null : placement,
    permissions: role.permissions,
  });
  const [order, setOrder] = useState(String(role.display_order));

  async function save() {
    const nextTier = placement === OUTSIDE ? null : placement;
    try {
      await updateRole.mutateAsync({
        id: role.id,
        body: {
          name:
            name.trim() && name.trim() !== role.name ? name.trim() : undefined,
          // Sent only when changed, so re-saving an untouched role writes no
          // audit row for it; `null` clears the color.
          color:
            colorTouched && color !== (role.color ?? null) ? color : undefined,
          display_order: parseGuardedInt(order),
          mentionable:
            mentionable !== role.mentionable ? mentionable : undefined,
          self_assignable:
            pickable !== role.self_assignable ? pickable : undefined,
          tier_id: nextTier !== role.tier_id ? nextTier : undefined,
          // **No `permissions` key.** The switches below save on their own;
          // sending a list here would roll back a flip made since this page
          // opened.
        },
      });
      setColorTouched(false);
      toast({
        title: "Role saved",
        description: `${name.trim() || role.name} is up to date.`,
      });
    } catch (error) {
      toast({
        title: "Couldn't save role",
        description: getErrorMessage(
          error,
          "Your change wasn't saved. Try again in a moment.",
        ),
        variant: "destructive",
      });
    }
  }

  async function remove() {
    const ok = await confirm({
      title: `Delete ${role.name}?`,
      description:
        "Members holding this role lose what it gives them right away. This can't be undone.",
      confirmLabel: "Delete role",
      tone: "destructive",
    });
    if (!ok) return;
    try {
      await deleteRole.mutateAsync(role.id);
      toast({
        title: "Role deleted",
        description: `${role.name} was removed.`,
      });
      onBack();
    } catch (error) {
      toast({
        title: "Couldn't delete role",
        description: getErrorMessage(
          error,
          "Remove the role from its members first, or try again.",
        ),
        variant: "destructive",
      });
    }
  }

  function viewAs() {
    if (!activeChapterId) return;
    const query = searchParams.toString();
    startPreview({
      chapterId: activeChapterId,
      roleId: role.id,
      roleName: role.name,
      permissions: previewPermissions(role, roles),
      returnTo: query ? `${pathname}?${query}` : pathname,
    });
    // Chat is where every member lands, so the preview starts there, with
    // the nav as the role would have it.
    router.push("/chat");
  }

  const held = permissionsOf(role);
  const count = memberCounts?.get(role.id) ?? (memberCounts ? 0 : null);
  const lockedReason = wildcard
    ? "This role can do everything. That only moves through Transfer presidency."
    : lockedReasonFor({ canManage, reach }, editable, "role");

  return (
    <div className="space-y-10">
      {confirmDialog}
      <header className="space-y-3 border-b border-border pb-6">
        {back}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            aria-hidden
            className="h-3 w-3 shrink-0 rounded-full border border-border"
            style={{
              backgroundColor: roleColorOrNull(role.color) ?? "transparent",
            }}
          />
          <h2 className="text-title text-foreground">{role.name}</h2>
          {/*
            Anyone who can edit roles may look (#4072), at any role but the
            President's, which can do everything. Looking changes nothing,
            so the rank rules that guard edits don't apply.
          */}
          {canManage && !wildcard ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={viewAs}
              className="ml-auto"
            >
              <Eye aria-hidden />
              View as {role.name}
            </Button>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {tier ? (
            <>
              In{" "}
              <button
                type="button"
                onClick={() => onOpenTier(tier.id)}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                {tier.name}
              </button>
            </>
          ) : (
            `Outside the ${words.plural}`
          )}
          {count === null
            ? null
            : ` · ${count} ${count === 1 ? "member" : "members"}`}
        </p>
        {everyone ? (
          <p className="max-w-2xl text-sm text-muted-foreground">
            What members get when no role of theirs gives them access: whoever
            joins with no role, and new members once they&apos;re made members.
            It isn&apos;t offered in any list, and its name and {words.singular}{" "}
            stay as they are.
          </p>
        ) : null}
      </header>

      <ProfileSection id="role-details" title="Details">
        <div className="grid max-w-2xl gap-4 md:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="role-name">Name</Label>
            <Input
              id="role-name"
              value={name}
              maxLength={60}
              disabled={!editable || everyone}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="role-tier">{words.Singular}</Label>
            <Select
              value={placement}
              onValueChange={setPlacement}
              disabled={!editable || everyone}
            >
              <SelectTrigger id="role-tier">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tiers.map((candidate) => (
                  <SelectItem
                    key={candidate.id}
                    value={candidate.id}
                    disabled={
                      candidate.id !== role.tier_id &&
                      !reachesTier(reach, candidate)
                    }
                  >
                    {candidate.name}
                  </SelectItem>
                ))}
                <SelectItem
                  value={OUTSIDE}
                  disabled={role.tier_id !== null && !reachesOutside(reach)}
                >
                  Outside the {words.plural}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1 md:col-span-2">
            <Label id="role-color-label">Color</Label>
            <RoleColorSwatches
              labelId="role-color-label"
              value={color}
              onChange={(next) => {
                setColor(next);
                setColorTouched(true);
              }}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="role-display-order">Position in its list</Label>
            <Input
              id="role-display-order"
              type="number"
              min={0}
              value={order}
              disabled={!editable}
              onChange={(event) => {
                const next = guardIntDraft(event.target.value);
                if (next !== undefined) setOrder(next);
              }}
            />
          </div>
          {/*
            Owner, 2026-11-06: "anyone can ping any role by default. officers
            can change defaults." Off, only a member who can manage channels
            or roles can @ it (spec/behavior/chat/README.md § Role mentions).
          */}
          <div className="flex items-start justify-between gap-4 md:col-span-2">
            <div className="grid gap-1">
              <Label htmlFor="role-mentionable">
                {everyone
                  ? "Anyone can use @everyone and @here"
                  : "Anyone can @mention this role"}
              </Label>
              <p
                id="role-mentionable-description"
                className="text-sm text-muted-foreground"
              >
                {everyone
                  ? "@everyone pings everyone in a channel, @here only those online. When off, only officers who manage channels or roles can use them."
                  : "When off, only officers who manage channels or roles can ping everyone in it."}
              </p>
            </div>
            <Switch
              id="role-mentionable"
              aria-describedby="role-mentionable-description"
              checked={mentionable}
              disabled={!editable}
              onCheckedChange={setMentionable}
            />
          </div>
          {/*
            Non-chapter business (#4958): interest roles members pick
            themselves. Built-in roles never are, so they don't show it.
            spec/behavior/rbac.md § Self-assignable roles.
          */}
          {role.system_key ? null : (
            <div className="flex items-start justify-between gap-4 md:col-span-2">
              <div className="grid gap-1">
                <Label htmlFor="role-self-assignable">
                  Non-chapter business
                </Label>
                <p
                  id="role-self-assignable-description"
                  className="text-sm text-muted-foreground"
                >
                  {pickRefusal
                    ? SELF_ASSIGNABLE_REFUSAL_COPY[pickRefusal]
                    : "Members add and remove this role themselves, like an intramurals team or a study group. It opens its channels and nothing else."}
                </p>
              </div>
              <Switch
                id="role-self-assignable"
                aria-describedby="role-self-assignable-description"
                checked={pickable}
                disabled={!editable || (!!pickRefusal && !pickable)}
                onCheckedChange={setPickable}
              />
            </div>
          )}
        </div>
        {editable ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={() => void save()}
              disabled={updateRole.isPending}
            >
              {updateRole.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Save role
            </Button>
            {role.is_system ? null : (
              <Button
                type="button"
                variant="destructive"
                onClick={() => void remove()}
                disabled={deleteRole.isPending}
              >
                Delete role
              </Button>
            )}
          </div>
        ) : null}
      </ProfileSection>

      <ProfileSection
        id="role-permissions"
        title="Permissions"
        hint={
          tier
            ? `Starts from ${tier.name}. Pick Off or On to set this role apart; Same as ${words.singular} follows ${tier.name}, even when it changes.`
            : `This role is outside the ${words.plural}, so its permissions are its own.`
        }
      >
        {tier && !wildcard ? (
          <RoleOverrideList
            role={role}
            tier={tier}
            tierWord={words.singular}
            lockedReason={lockedReason}
            mayGrant={(permission) => mayGrant(reach, permission)}
          />
        ) : (
          <PermissionSwitchList
            idPrefix={`role-${role.id}`}
            holderName={role.name}
            isOn={(permission) => wildcard || held.includes(permission)}
            onToggle={(permission, on) => void toggle(role, permission, on)}
            extraPermissions={wildcard ? [] : held}
            lockedReason={lockedReason}
            rowLockedReason={(permission, on) =>
              !on && !mayGrant(reach, permission) ? CANT_GIVE : null
            }
            pendingPermission={
              pending?.id === role.id ? pending.permission : null
            }
          />
        )}
      </ProfileSection>
    </div>
  );
}
