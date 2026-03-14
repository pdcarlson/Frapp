"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Shield, Trash2, UserRound } from "lucide-react";
import { useMember, useRemoveMember, useRoles, useUpdateMemberRoles } from "@repo/hooks";
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

type MemberRecord = Record<string, unknown>;
type RoleRow = {
  id: string;
  name: string;
};

const fallbackRoles: RoleRow[] = [
  { id: "member-role", name: "Member" },
  { id: "new-member-role", name: "New Member" },
  { id: "exec-role", name: "Executive Board" },
];

function formatDate(value: unknown): string {
  if (typeof value !== "string") return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString();
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Something went wrong. Please retry.";
}

type MemberDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: MemberRecord | null;
  usingPreviewData: boolean;
};

export function MemberDetailSheet({
  open,
  onOpenChange,
  member,
  usingPreviewData,
}: MemberDetailSheetProps) {
  const memberId =
    (typeof member?.id === "string" && member.id.length > 0
      ? member.id
      : typeof member?.user_id === "string"
        ? member.user_id
        : "") ?? "";
  const rolesQuery = useRoles();
  const memberQuery = useMember(!usingPreviewData ? memberId : "");
  const updateRolesMutation = useUpdateMemberRoles();
  const removeMemberMutation = useRemoveMember();
  const { toast } = useToast();
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);

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

    return fallbackRoles;
  }, [memberRoleIds, rolesQuery.data]);

  useEffect(() => {
    if (!open) return;
    setSelectedRoleIds(memberRoleIds);
  }, [open, memberRoleIds]);

  const displayName =
    typeof resolvedMember?.display_name === "string" && resolvedMember.display_name.length > 0
      ? resolvedMember.display_name
      : "Unknown member";
  const userId =
    typeof resolvedMember?.user_id === "string" ? resolvedMember.user_id : "unknown-user";
  const email = typeof resolvedMember?.email === "string" ? resolvedMember.email : "Unavailable";
  const hasCompletedOnboarding =
    typeof resolvedMember?.has_completed_onboarding === "boolean"
      ? resolvedMember.has_completed_onboarding
      : false;
  const canMutate = !usingPreviewData && !rolesQuery.isError && !memberQuery.isError;

  async function handleSaveRoles() {
    if (!memberId) return;
    try {
      await updateRolesMutation.mutateAsync({
        id: memberId,
        role_ids: selectedRoleIds,
      });
      toast({
        title: "Roles updated",
        description: `${displayName}'s access levels were saved.`,
      });
      await memberQuery.refetch();
    } catch (error) {
      toast({
        title: "Could not update roles",
        description: getErrorMessage(error),
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
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <UserRound className="h-4 w-4" />
            {displayName}
          </SheetTitle>
          <SheetDescription>
            Review member profile context and update chapter role assignments.
          </SheetDescription>
        </SheetHeader>

        {usingPreviewData ? (
          <div className="mt-5 flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>Showing preview member details. Sign in to update live member access.</div>
          </div>
        ) : null}

        {memberQuery.isLoading && !usingPreviewData ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading member profile...
          </div>
        ) : null}

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">User ID</p>
            <p className="mt-1 font-mono text-xs">{userId}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Onboarding</p>
            <div className="mt-1">
              <Badge variant={hasCompletedOnboarding ? "default" : "secondary"}>
                {hasCompletedOnboarding ? "Complete" : "Pending"}
              </Badge>
            </div>
          </div>
          <div className="rounded-md border border-border p-3 sm:col-span-2">
            <p className="text-xs text-muted-foreground">Email</p>
            <p className="mt-1 text-sm">{email}</p>
          </div>
          <div className="rounded-md border border-border p-3 sm:col-span-2">
            <p className="text-xs text-muted-foreground">Joined chapter</p>
            <p className="mt-1 text-sm">{formatDate(resolvedMember?.created_at)}</p>
          </div>
        </div>

        <section className="mt-6 space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium">Role access</p>
          </div>
          <div className="space-y-2">
            {roleOptions.map((role) => {
              const checked = selectedRoleIds.includes(role.id);
              return (
                <label
                  key={role.id}
                  className="flex cursor-pointer items-center justify-between rounded-md border border-border p-3 transition hover:bg-muted/40"
                >
                  <div>
                    <p className="text-sm font-medium">{role.name}</p>
                    <p className="text-xs text-muted-foreground">{role.id}</p>
                  </div>
                  <input
                    type="checkbox"
                    className={dashboardTableCheckboxClassName}
                    checked={checked}
                    disabled={!canMutate}
                    onChange={(event) => {
                      if (event.target.checked) {
                        setSelectedRoleIds((previous) => [...new Set([...previous, role.id])]);
                        return;
                      }
                      setSelectedRoleIds((previous) =>
                        previous.filter((roleId) => roleId !== role.id),
                      );
                    }}
                  />
                </label>
              );
            })}
          </div>
        </section>

        <SheetFooter className="mt-8 gap-2">
          <Button
            variant="outline"
            onClick={() => setSelectedRoleIds(memberRoleIds)}
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
