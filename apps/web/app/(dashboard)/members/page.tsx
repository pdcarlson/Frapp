"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Search, UserPlus } from "lucide-react";
import { useMemberSearch, useMembers } from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, LoadingState } from "@/components/shared/async-states";
import {
  dashboardFilterSelectClassName,
  dashboardTableCheckboxClassName,
} from "@/components/shared/table-controls";

type MemberRow = Record<string, unknown>;
const fallbackMembers: MemberRow[] = [
  {
    id: "preview-1",
    user_id: "preview-user-1",
    display_name: "Jordan M.",
    role_ids: ["president-role-id", "admin-role-id"],
    has_completed_onboarding: true,
  },
  {
    id: "preview-2",
    user_id: "preview-user-2",
    display_name: "Evan R.",
    role_ids: ["treasurer-role-id"],
    has_completed_onboarding: true,
  },
  {
    id: "preview-3",
    user_id: "preview-user-3",
    display_name: "Dylan P.",
    role_ids: ["member-role-id"],
    has_completed_onboarding: false,
  },
];

export default function MembersPage() {
  const [query, setQuery] = useState("");
  const [onboardingFilter, setOnboardingFilter] = useState<"all" | "complete" | "pending">("all");
  const [savedView, setSavedView] = useState<"all" | "exec" | "new">("all");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const trimmedQuery = query.trim();
  const membersQuery = useMembers();
  const searchQuery = useMemberSearch(trimmedQuery);
  const usingSearch = trimmedQuery.length > 0;
  const activeQuery = usingSearch ? searchQuery : membersQuery;
  const usingPreviewData = activeQuery.isError;

  const members = useMemo(() => {
    if (usingPreviewData) {
      if (!usingSearch) return fallbackMembers;
      return fallbackMembers.filter((member) => {
        const displayName = String(member.display_name ?? "").toLowerCase();
        return displayName.includes(trimmedQuery.toLowerCase());
      });
    }
    const raw = activeQuery.data;
    if (!Array.isArray(raw)) return [];
    return raw as MemberRow[];
  }, [activeQuery.data, usingPreviewData, usingSearch, trimmedQuery]);
  const visibleMembers = useMemo(() => {
    return members.filter((member) => {
      const onboardingComplete =
        typeof member.has_completed_onboarding === "boolean"
          ? member.has_completed_onboarding
          : false;
      const roleCount = Array.isArray(member.role_ids) ? member.role_ids.length : 0;

      if (onboardingFilter === "complete" && !onboardingComplete) {
        return false;
      }
      if (onboardingFilter === "pending" && onboardingComplete) {
        return false;
      }

      if (savedView === "exec" && roleCount < 2) {
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

  if (activeQuery.isLoading) {
    return <LoadingState message="Loading chapter members..." />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Members Directory</CardTitle>
            <CardDescription>Search and review chapter membership records.</CardDescription>
          </div>
          <Button className="gap-2">
            <UserPlus className="h-4 w-4" />
            Invite Member
          </Button>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by member name"
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <select
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

      {usingPreviewData ? (
        <Card className="border-amber-200 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/30">
          <CardContent className="flex items-center justify-between gap-4 pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-700 dark:text-amber-300" />
              <div>
                <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                  Showing preview member data
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  Sign in to load live chapter member records.
                </p>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => activeQuery.refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {selectedCount > 0 ? (
        <Card className="border-primary/30 bg-primary-50/70 dark:bg-primary/10">
          <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium">
              {selectedCount} member{selectedCount > 1 ? "s" : ""} selected
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline">
                Assign role
              </Button>
              <Button size="sm" variant="outline">
                Mark onboarding complete
              </Button>
              <Button size="sm" variant="outline">
                Remove selected
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {visibleMembers.length === 0 ? (
        <EmptyState
          title="No members match this view"
          description="Try a broader search or invite your first members to populate this directory."
          actionLabel="Generate invite link"
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Member Records</CardTitle>
            <CardDescription>
              {usingSearch ? `Search results for “${trimmedQuery}”` : "All chapter members"}
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
                        <div className="flex items-center gap-2">
                          <span>{displayName}</span>
                          {usingPreviewData ? (
                            <Badge variant="outline" className="text-[10px]">
                              Preview
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {userId}
                      </TableCell>
                      <TableCell>{roleCount} role(s)</TableCell>
                      <TableCell>{onboardingComplete ? "Complete" : "Pending"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
