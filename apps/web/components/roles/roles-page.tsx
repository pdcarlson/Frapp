"use client";

import { useMemo, useState } from "react";
import { Loader2, ShieldCheck, Trash2 } from "lucide-react";
import {
  useCreateRole,
  useDeleteRole,
  useMembers,
  usePermissionsCatalog,
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
  LoadingState,
} from "@/components/shared/async-states";
import { Can } from "@/components/shared/can";
import { useToast } from "@/hooks/use-toast";
import { asArray } from "@/lib/utils";

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

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: string }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return fallback;
}

export function RolesAndPermissionsPage() {
  const { toast } = useToast();
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
    const confirmed = window.confirm(
      `Delete ${role.name}? Members assigned this role will lose its permissions immediately.`,
    );
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
    const confirmed = window.confirm(
      "Transfer presidency? This immediately moves the President role to the selected member and removes it from you.",
    );
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

  if (rolesQuery.isPending || catalogQuery.isPending) {
    return <LoadingState message="Loading roles and permissions..." />;
  }

  if (rolesQuery.isError || catalogQuery.isError) {
    return (
      <ErrorState
        title="Couldn't load roles"
        description="Retry in a moment. This view requires the roles:manage permission."
        onRetry={() => {
          void rolesQuery.refetch();
          void catalogQuery.refetch();
        }}
      />
    );
  }

  return (
    <Can
      permission="roles:manage"
      deniedFallback={
        <Card>
          <CardHeader>
            <CardTitle>Roles & Permissions</CardTitle>
            <CardDescription>
              Managing roles requires the <code>roles:manage</code>{" "}
              permission. Ask your chapter president to grant access.
            </CardDescription>
          </CardHeader>
        </Card>
      }
    >
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
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1 text-left hover:bg-muted"
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
                      value={colorDraft || "#2563EB"}
                      onChange={(event) => setColorDraft(event.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Permissions ({permissionsDraft.size}/{catalog.length})
                  </Label>
                  <div className="mt-2 grid gap-2 rounded-md border border-border p-3 max-h-80 overflow-y-auto">
                    {catalog.map((entry) => (
                      <label
                        key={entry.permission}
                        className="flex cursor-pointer items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={permissionsDraft.has(entry.permission)}
                          onChange={() =>
                            toggleDraftPermission(entry.permission)
                          }
                        />
                        <code className="text-xs">{entry.permission}</code>
                        <span className="text-xs text-muted-foreground">
                          {entry.key}
                        </span>
                      </label>
                    ))}
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
                  variant="outline"
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
                    value={createColor || "#10B981"}
                    onChange={(event) => setCreateColor(event.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Permissions ({createPermissions.size}/{catalog.length})
                </Label>
                <div className="mt-2 grid gap-2 rounded-md border border-border p-3 max-h-60 overflow-y-auto">
                  {catalog.map((entry) => (
                    <label
                      key={entry.permission}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={createPermissions.has(entry.permission)}
                        onChange={() =>
                          toggleCreatePermission(entry.permission)
                        }
                      />
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
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
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
    </Can>
  );
}
