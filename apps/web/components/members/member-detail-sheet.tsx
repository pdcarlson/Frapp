"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquare, Trash2 } from "lucide-react";
import { DirectoryGlyph, RolesGlyph } from "@/components/members/directory-glyphs";
import {
  useCustomRoles,
  useGetOrCreateDm,
  useMember,
  useMyPermissions,
  useRemoveMember,
  useRoles,
  useUpdateMemberRoles,
} from "@repo/hooks";
import { can } from "@repo/validation";
import { formatLocaleDate as formatDate } from "@repo/formatting";
import { useFrappUser } from "@/lib/auth/use-frapp-user";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { dashboardTableCheckboxClassName } from "@/components/shared/table-controls";
import { asArray, getErrorMessage } from "@/lib/utils";

type MemberRecord = Record<string, unknown>;

type CustomFieldValue = {
  field_id: string;
  key: string;
  label: string;
  type: string;
  visibility: string;
  value: string | null;
};

function formatCustomValue(field: CustomFieldValue): string {
  if (field.value === null || field.value === "") return "—";
  if (field.type === "boolean") {
    return field.value === "true" ? "Yes" : "No";
  }
  return field.value;
}

function parseCustomFields(member: MemberRecord | null): CustomFieldValue[] {
  return asArray<Record<string, unknown>>(member?.custom_fields).flatMap((entry) => {
    if (
      !entry ||
      typeof entry.field_id !== "string" ||
      typeof entry.label !== "string" ||
      typeof entry.type !== "string" ||
      typeof entry.visibility !== "string"
    ) {
      return [];
    }
    return [
      {
        field_id: entry.field_id,
        key: typeof entry.key === "string" ? entry.key : entry.field_id,
        label: entry.label,
        type: entry.type,
        visibility: entry.visibility,
        value: typeof entry.value === "string" ? entry.value : null,
      },
    ];
  });
}

type MemberDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: MemberRecord | null;
  points?: number | null;
  usingPreviewData: boolean;
};

// One row shared by the live-role and custom-role checklists so the two
// adjacent sections can never drift in markup or behavior.
function RoleChecklistItem({
  title,
  subtitle,
  monoSubtitle,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  subtitle: string;
  monoSubtitle?: boolean;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-md border border-border p-3 transition-colors hover:bg-accent-subtle">
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p
          className={
            monoSubtitle
              ? "font-mono text-[12.5px] text-muted-foreground"
              : "text-[12.5px] text-muted-foreground"
          }
        >
          {subtitle}
        </p>
      </div>
      <input
        type="checkbox"
        className={dashboardTableCheckboxClassName}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function toggleSelection(
  setter: React.Dispatch<React.SetStateAction<string[]>>,
  roleId: string,
  isChecked: boolean,
) {
  setter((previous) =>
    isChecked
      ? [...new Set([...previous, roleId])]
      : previous.filter((id) => id !== roleId),
  );
}

export function MemberDetailSheet({
  open,
  onOpenChange,
  member,
  points,
  usingPreviewData,
}: MemberDetailSheetProps) {
  const memberId =
    (typeof member?.id === "string" && member.id.length > 0
      ? member.id
      : typeof member?.user_id === "string"
        ? member.user_id
        : "") ?? "";
  const rolesQuery = useRoles();
  // Custom roles are enforced (bridge model): assignment happens here alongside
  // live roles. The list read needs `chapter-config:view`, so only fire it for
  // viewers who hold that permission — otherwise the sheet (mounted for every
  // directory visitor) would emit guaranteed-403 requests on each visit. When
  // the list is unavailable the section hides and saves omit `custom_role_ids`
  // (server treats omission as "leave unchanged"), so custom-role assignments
  // are never silently stripped.
  const myPermissionsQuery = useMyPermissions();
  const canViewCustomRoles = can(
    "chapter-config:view",
    myPermissionsQuery.data?.permissions,
  );
  const customRolesQuery = useCustomRoles({ enabled: canViewCustomRoles });
  const memberQuery = useMember(!usingPreviewData ? memberId : "");
  const updateRolesMutation = useUpdateMemberRoles();
  const removeMemberMutation = useRemoveMember();
  const dmMutation = useGetOrCreateDm();
  const router = useRouter();
  const { userId: currentUserId } = useFrappUser();
  const { toast } = useToast();
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [selectedCustomRoleIds, setSelectedCustomRoleIds] = useState<string[]>([]);

  const resolvedMember = useMemo(() => {
    if (!member) return null;
    if (usingPreviewData) {
      return member;
    }
    if (memberQuery.data && typeof memberQuery.data === "object") {
      return memberQuery.data as MemberRecord;
    }
    return member;
  }, [member, memberQuery.data, usingPreviewData]);

  const memberRoleIds = useMemo(() => {
    if (!resolvedMember) return [];
    const roleIds = resolvedMember.role_ids;
    if (!Array.isArray(roleIds)) return [];
    return roleIds.filter((roleId): roleId is string => typeof roleId === "string");
  }, [resolvedMember]);

  const memberCustomRoleIds = useMemo(() => {
    if (!resolvedMember) return [];
    const ids = resolvedMember.custom_role_ids;
    if (!Array.isArray(ids)) return [];
    return ids.filter((id): id is string => typeof id === "string");
  }, [resolvedMember]);

  const customRoleOptions = useMemo(() => {
    const data = customRolesQuery.data;
    if (!Array.isArray(data)) return [];
    return data.map((role) => ({ id: role.id, label: role.label, key: role.key }));
  }, [customRolesQuery.data]);

  const roleOptions = useMemo(() => {
    const rolesData = rolesQuery.data as unknown;
    if (Array.isArray(rolesData)) {
      const parsed = rolesData.flatMap((role: unknown) => {
        if (!role || typeof role !== "object") return [];
        const candidate = role as Record<string, unknown>;
        if (typeof candidate.id !== "string" || typeof candidate.name !== "string") {
          return [];
        }
        return [{ id: candidate.id, name: candidate.name }];
      });
      if (parsed.length > 0) return parsed;
    }

    if (memberRoleIds.length > 0) {
      return memberRoleIds.map((roleId) => ({
        id: roleId,
        name: `Role ${roleId.slice(0, 8)}`,
      }));
    }

    return [];
  }, [memberRoleIds, rolesQuery.data]);

  /* eslint-disable react-hooks/set-state-in-effect -- hydrate role drafts from the opened member; edits must not leak across sheets */
  useEffect(() => {
    if (!open) return;
    setSelectedRoleIds(memberRoleIds);
    setSelectedCustomRoleIds(memberCustomRoleIds);
  }, [open, memberRoleIds, memberCustomRoleIds]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const displayName =
    typeof resolvedMember?.display_name === "string" && resolvedMember.display_name.length > 0
      ? resolvedMember.display_name
      : "Unknown member";
  const userId =
    typeof resolvedMember?.user_id === "string" ? resolvedMember.user_id : "unknown-user";
  // Distinct from the display-formatted `userId` above: this is null rather
  // than the "unknown-user" placeholder, so the Message button and its
  // handler can never fire a DM request at a fallback string.
  const dmTargetUserId =
    typeof resolvedMember?.user_id === "string" && resolvedMember.user_id.length > 0
      ? resolvedMember.user_id
      : null;
  const email = typeof resolvedMember?.email === "string" ? resolvedMember.email : "Unavailable";
  const hasCompletedOnboarding =
    typeof resolvedMember?.has_completed_onboarding === "boolean"
      ? resolvedMember.has_completed_onboarding
      : false;
  const customFields = useMemo(() => parseCustomFields(resolvedMember), [resolvedMember]);
  const canMutate = !usingPreviewData && !rolesQuery.isError && !memberQuery.isError;

  async function handleSaveRoles() {
    if (!memberId) return;
    try {
      await updateRolesMutation.mutateAsync({
        id: memberId,
        role_ids: selectedRoleIds,
        // Only send the custom-role assignment when the list actually loaded;
        // omission tells the server to leave it unchanged. The selection is
        // sent as-is — NOT filtered against the loaded catalog, which can be
        // up to a minute stale and would silently strip a freshly assigned
        // role. Leftover ids of since-deleted roles are harmless: the server
        // exempts ids the member already holds, and they resolve to nothing.
        ...(customRolesQuery.isSuccess
          ? { custom_role_ids: selectedCustomRoleIds }
          : {}),
      });
      toast({
        title: "Roles updated",
        description: `${displayName}'s access levels were saved.`,
      });
      await memberQuery.refetch();
    } catch (error) {
      toast({
        title: "Could not update roles",
        description: getErrorMessage(error, "Something went wrong. Please retry."),
        variant: "destructive",
      });
    }
  }

  async function handleRemoveMember() {
    if (!memberId) return;
    const confirmed = window.confirm(
      `Remove ${displayName} from this chapter? They can rejoin only with a new invite.`,
    );
    if (!confirmed) return;

    try {
      await removeMemberMutation.mutateAsync(memberId);
      toast({
        title: "Member removed",
        description: `${displayName} was removed from the chapter roster.`,
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not remove member",
        description: getErrorMessage(error, "Something went wrong. Please retry."),
        variant: "destructive",
      });
    }
  }

  // `POST /v1/channels/dm` doesn't reject a self-DM (member_ids: [userId, userId]
  // still passes the "exactly 2 members" check) — it silently creates a
  // degenerate channel. Guarding here, not server-side, since this issue is
  // scoped to the web UI; the button is simply absent for the viewer's own row.
  async function handleMessage() {
    if (!dmTargetUserId || dmTargetUserId === currentUserId) return;

    try {
      const dm = await dmMutation.mutateAsync({ member_id: dmTargetUserId });
      const channelId =
        dm && typeof dm === "object" && typeof (dm as { id?: unknown }).id === "string"
          ? (dm as { id: string }).id
          : null;
      if (!channelId) {
        throw new Error("No channel id returned");
      }
      onOpenChange(false);
      router.push(`/chat?channel=${channelId}`);
    } catch (error) {
      toast({
        title: "Could not start conversation",
        description: getErrorMessage(
          error,
          "Something went wrong. Please retry.",
        ),
        variant: "destructive",
      });
    }
  }

  function handleRoleChange(roleId: string, isChecked: boolean) {
    toggleSelection(setSelectedRoleIds, roleId, isChecked);
  }

  function handleCustomRoleChange(roleId: string, isChecked: boolean) {
    toggleSelection(setSelectedCustomRoleIds, roleId, isChecked);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <DirectoryGlyph className="h-5 w-5" />
            {displayName}
          </SheetTitle>
          <SheetDescription>
            Review member profile context and update chapter role assignments.
          </SheetDescription>
        </SheetHeader>

        {!usingPreviewData && dmTargetUserId && dmTargetUserId !== currentUserId ? (
          <div className="mt-4">
            <Button
              variant="secondary"
              onClick={handleMessage}
              disabled={dmMutation.isPending}
            >
              {dmMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MessageSquare className="h-4 w-4" />
              )}
              Message
            </Button>
          </div>
        ) : null}

        {memberQuery.isLoading && !usingPreviewData ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading member profile...
          </div>
        ) : null}

        {memberQuery.isError && !usingPreviewData ? (
          <div className="mt-6 rounded-md border border-destructive/[.28] bg-destructive/[.13] p-3 text-sm text-destructive-text">
            Could not load the latest member profile. Retry from the directory to re-open this member.
          </div>
        ) : null}

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-border p-3">
            <p className="text-[12.5px] text-muted-foreground">User ID</p>
            <p className="mt-1 font-mono text-[12.5px]">{userId}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-[12.5px] text-muted-foreground">Onboarding</p>
            <div className="mt-1">
              <Badge variant={hasCompletedOnboarding ? "success" : "warning"}>
                {hasCompletedOnboarding ? "Complete" : "Pending"}
              </Badge>
            </div>
          </div>
          <div className="rounded-md border border-border p-3 sm:col-span-2">
            <p className="text-[12.5px] text-muted-foreground">Email</p>
            <p className="mt-1 text-sm">{email}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-[12.5px] text-muted-foreground">Joined chapter</p>
            <p className="mt-1 text-sm">{formatDate(resolvedMember?.created_at)}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-[12.5px] text-muted-foreground">Points</p>
            <p className="mt-1 text-sm">
              {typeof points === "number" ? points : "—"}
            </p>
          </div>
        </div>

        {customFields.length > 0 ? (
          <section className="mt-6 space-y-3">
            <p className="text-sm font-semibold">Custom fields</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {customFields.map((field) => (
                <div key={field.field_id} className="rounded-md border border-border p-3">
                  <p className="text-[12.5px] text-muted-foreground">{field.label}</p>
                  <p className="mt-1 text-sm">{formatCustomValue(field)}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="mt-6 space-y-3">
          <div className="flex items-center gap-2">
            <RolesGlyph className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold">Role access</p>
          </div>
          <div className="space-y-2">
            {roleOptions.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                No roles are available for this chapter yet.
              </div>
            ) : roleOptions.map((role) => (
              <RoleChecklistItem
                key={role.id}
                title={role.name}
                subtitle={role.id}
                checked={selectedRoleIds.includes(role.id)}
                disabled={!canMutate}
                onChange={(isChecked) => handleRoleChange(role.id, isChecked)}
              />
            ))}
          </div>
        </section>

        {customRoleOptions.length > 0 ? (
          <section className="mt-6 space-y-3">
            <div className="flex items-center gap-2">
              <RolesGlyph className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-semibold">Custom roles</p>
            </div>
            <p className="text-[12.5px] text-muted-foreground">
              Capabilities from assigned custom roles apply on the member&apos;s
              next request, alongside their live-role permissions.
            </p>
            <div className="space-y-2">
              {customRoleOptions.map((role) => (
                <RoleChecklistItem
                  key={role.id}
                  title={role.label}
                  subtitle={role.key}
                  monoSubtitle
                  checked={selectedCustomRoleIds.includes(role.id)}
                  disabled={!canMutate}
                  onChange={(isChecked) =>
                    handleCustomRoleChange(role.id, isChecked)
                  }
                />
              ))}
            </div>
          </section>
        ) : null}

        <SheetFooter className="mt-8 gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setSelectedRoleIds(memberRoleIds);
              setSelectedCustomRoleIds(memberCustomRoleIds);
            }}
            disabled={updateRolesMutation.isPending}
          >
            Reset
          </Button>
          <Button
            onClick={handleSaveRoles}
            disabled={!canMutate || updateRolesMutation.isPending}
          >
            {updateRolesMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            Save role changes
          </Button>
          <Button
            variant="destructive"
            onClick={handleRemoveMember}
            disabled={!canMutate || removeMemberMutation.isPending}
          >
            {removeMemberMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Remove member
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
