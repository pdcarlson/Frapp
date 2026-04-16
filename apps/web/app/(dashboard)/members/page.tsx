"use client";

import { useMemo, useState } from "react";
import { Search, UserPlus } from "lucide-react";
import { useMemberSearch, useMembers } from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState, OfflineState } from "@/components/shared/async-states";
import {
  dashboardFilterSelectClassName,
  dashboardTableCheckboxClassName,
} from "@/components/shared/table-controls";
import { useToast } from "@/hooks/use-toast";
import { InviteMemberDialog } from "@/components/members/invite-member-dialog";
import { MemberDetailSheet } from "@/components/members/member-detail-sheet";
import { useNetwork } from "@/lib/providers/network-provider";
import { stateMicrocopy } from "@/lib/state-microcopy";

type MemberRow = {
  id: string;
  user_id: string;
  chapter_id: string;
  role_ids: string[];
  has_completed_onboarding: boolean;
  created_at: string;
  updated_at: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  graduation_year: number | null;
  current_city: string | null;
  current_company: string | null;
  email: string;
};

const EXEC_ROLE_KEYWORDS = [
  "president",
  "vice",
  "treasurer",
  "secretary",
  "exec",
  "officer",
  "admin",
];

function isExecBoardMember(member: MemberRow): boolean {
  if (!Array.isArray(member.role_ids)) {
    return false;
  }

  return member.role_ids.some((roleId) => {
    if (typeof roleId !== "string") {
      return false;
    }
    const normalizedRoleId = roleId.toLowerCase();
    return EXEC_ROLE_KEYWORDS.some((keyword) => normalizedRoleId.includes(keyword));
  });
}

export default function MembersPage() {
  const { isOffline } = useNetwork();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [onboardingFilter, setOnboardingFilter] = useState<"all" | "complete" | "pending">("all");
  const [savedView, setSavedView] = useState<"all" | "exec" | "new">("all");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [activeMemberId, setActiveMemberId] = useState<string | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const trimmedQuery = query.trim();
  const membersQuery = useMembers();
  const searchQuery = useMemberSearch(trimmedQuery);
  const usingSearch = trimmedQuery.length > 0;
  const activeQuery = usingSearch ? searchQuery : membersQuery;

  const members = useMemo(() => {
    const raw = activeQuery.data;
    if (!Array.isArray(raw)) return [];
    return raw as MemberRow[];
  }, [activeQuery.data]);
  const visibleMembers = useMemo(() => {
    return members.filter((member) => {
      const onboardingComplete =
        typeof member.has_completed_onboarding === "boolean"
          ? member.has_completed_onboarding
          : false;

      if (onboardingFilter === "complete" && !onboardingComplete) {
        return false;
      }
      if (onboardingFilter === "pending" && onboardingComplete) {
        return false;
      }

      if (savedView === "exec" && !isExecBoardMember(member)) {
        return false;
      }
      if (savedView === "new" && onboardingComplete) {
        return false;
      }

      return true;
    });
  }, [members, onboardingFilter, savedView]);
  const visibleMemberIds = visibleMembers.map((member) => String(member.id ?? member.user_id ?? ""));
  const allVisibleSelected =
    visibleMemberIds.length > 0 &&
    visibleMemberIds.every((memberId) => selectedMemberIds.includes(memberId));
  const selectedCount = selectedMemberIds.length;
  const activeMember = useMemo(
    () =>
      visibleMembers.find(
        (member) => String(member.id ?? member.user_id ?? "") === activeMemberId,
      ) ?? null,
    [activeMemberId, visibleMembers],
  );

  function notifyBulkAction(actionLabel: string) {
    toast({
      title: "Bulk member action queued",
      description: `${actionLabel} for ${selectedCount} selected member${selectedCount > 1 ? "s" : ""} is not available yet.`,
    });
  }

  if (isOffline) {
    return (
      <OfflineState
        title="Members directory unavailable offline"
        description="Reconnect to load live membership records and role updates."
        onRetry={() => {
          void membersQuery.refetch();
          if (usingSearch) {
            void searchQuery.refetch();
          }
        }}
      />
    );
  }

  if (activeQuery.isLoading) {
    return <LoadingState message="Loading live chapter member records..." />;
  }

  if (activeQuery.isError) {
    return (
      <ErrorState
        title="Unable to load live member records"
        description="The members workflow no longer falls back to preview data. Verify your chapter access and API health, then retry."
        onRetry={() => {
          void activeQuery.refetch();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Members Directory</CardTitle>
            <CardDescription>Search and review chapter membership records.</CardDescription>
          </div>
          <InviteMemberDialog
            trigger={
              <Button className="gap-2">
                <UserPlus className="h-4 w-4" />
                Invite Member
              </Button>
            }
          />
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                aria-label="Search members by name"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by member name"
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                aria-label="Choose saved member view"
                value={savedView}
                onChange={(event) =>
                  setSavedView(event.target.value as "all" | "exec" | "new")
                }
                className={dashboardFilterSelectClassName}
              >
                <option value="all">Saved view: All members</option>
                <option value="exec">Saved view: Exec board</option>
                <option value="new">Saved view: New members</option>
              </select>
              <select
                aria-label="Filter members by onboarding status"
                value={onboardingFilter}
                onChange={(event) =>
                  setOnboardingFilter(
                    event.target.value as "all" | "complete" | "pending",
                  )
                }
                className={dashboardFilterSelectClassName}
              >
                <option value="all">Onboarding: All</option>
                <option value="complete">Onboarding: Complete</option>
                <option value="pending">Onboarding: Pending</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedCount > 0 ? (
        <Card className="border-primary/30 bg-primary-50/70 dark:bg-primary/10">
          <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium">
              {selectedCount} member{selectedCount > 1 ? "s" : ""} selected
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => notifyBulkAction("Assign role")}
              >
                Assign role
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => notifyBulkAction("Mark onboarding complete")}
              >
                Mark onboarding complete
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => notifyBulkAction("Remove selected")}
              >
                Remove selected
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {visibleMembers.length === 0 ? (
        <EmptyState
          title={stateMicrocopy.members.emptyTitle}
          description={stateMicrocopy.members.emptyDescription}
          actionLabel="Generate invite link"
          onAction={() => {
            toast({
              title: "Invite action available in header",
              description: "Use the Invite Member button at the top-right to generate links.",
            });
          }}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Member Records</CardTitle>
            <CardDescription>
              {usingSearch ? `Search results for “${trimmedQuery}”` : "All chapter members in the active staging chapter"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all visible members"
                      className={dashboardTableCheckboxClassName}
                      checked={allVisibleSelected}
                      onChange={(event) => {
                        if (event.target.checked) {
                          setSelectedMemberIds((previous) => [
                            ...new Set([...previous, ...visibleMemberIds]),
                          ]);
                          return;
                        }
                        setSelectedMemberIds((previous) =>
                          previous.filter((memberId) => !visibleMemberIds.includes(memberId)),
                        );
                      }}
                    />
                  </TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead>User ID</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Onboarding</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleMembers.map((member) => {
                  const memberId = String(member.id ?? member.user_id ?? "unknown-id");
                  const userId = String(member.user_id ?? "unknown-user");
                  const displayName =
                    typeof member.display_name === "string" && member.display_name.length > 0
                      ? member.display_name
                      : `Member ${userId.slice(0, 8)}`;
                  const roleCount = Array.isArray(member.role_ids) ? member.role_ids.length : 0;
                  const onboardingComplete =
                    typeof member.has_completed_onboarding === "boolean"
                      ? member.has_completed_onboarding
                      : false;
                  return (
                    <TableRow key={memberId}>
                      <TableCell className="w-10">
                        <input
                          type="checkbox"
                          aria-label={`Select ${displayName}`}
                          className={dashboardTableCheckboxClassName}
                          checked={selectedMemberIds.includes(memberId)}
                          onChange={(event) => {
                            if (event.target.checked) {
                              setSelectedMemberIds((previous) => [...new Set([...previous, memberId])]);
                              return;
                            }
                            setSelectedMemberIds((previous) =>
                              previous.filter((candidateId) => candidateId !== memberId),
                            );
                          }}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="space-y-1">
                          <span>{displayName}</span>
                          {member.email ? (
                            <p className="text-xs text-muted-foreground">{member.email}</p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {userId}
                      </TableCell>
                      <TableCell>{roleCount} role(s)</TableCell>
                      <TableCell>{onboardingComplete ? "Complete" : "Pending"}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setActiveMemberId(memberId);
                            setDetailSheetOpen(true);
                          }}
                        >
                          View details
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <MemberDetailSheet
        open={detailSheetOpen}
        onOpenChange={setDetailSheetOpen}
        member={activeMember}
        usingPreviewData={false}
      />
    </div>
  );
}
