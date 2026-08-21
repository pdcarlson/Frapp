"use client";

import { useMemo, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { getArchetype, getRolePack } from "@repo/org-archetypes";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/async-states";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";
import { RolesAndPermissionsPage } from "@/components/roles/roles-page";
import {
  useCustomRoles,
  useCreateCustomRole,
  useUpdateCustomRole,
  useDeleteCustomRole,
} from "@repo/hooks";

type PermissionCatalogEntry = { key: string; permission: string };

type Props = {
  /** The chapter's active archetype key (drives the role pack). */
  archetypeKey: string;
  /** Whether the caller holds `chapter-config:manage`. */
  canManage: boolean;
  /** The system permission catalog (capability rows + custom-role multi-select). */
  catalog: PermissionCatalogEntry[];
};

const SUBTAB_TRIGGER = "data-[state=active]:bg-background";

/**
 * Settings → Roles. Four sub-views:
 * - **Pack** (read-only): the active archetype's role pack.
 * - **Matrix**: capabilities × roles. Columns derive at render time from the
 *   pack keys + the live `chapter_custom_roles` keys — never a hardcoded array.
 * - **Custom**: CRUD over `chapter_custom_roles` (audit-logged server-side).
 *   Custom-role capabilities are enforced (bridge model,
 *   spec/behavior/rbac.md): members assigned a custom role in the member
 *   directory gain its capabilities on their next request.
 * - **Live roles**: the existing RBAC manager (system-role permissions,
 *   create/delete, presidency transfer), folded in from the former `/roles` page.
 */
export function SettingsRolesTab({ archetypeKey, canManage, catalog }: Props) {
  const pack = useMemo(
    () => getRolePack(getArchetype(archetypeKey).rolePack),
    [archetypeKey],
  );

  return (
    <Tabs defaultValue="pack" className="space-y-4">
      <TabsList className="flex w-full flex-wrap justify-start gap-1 bg-secondary p-1">
        <TabsTrigger value="pack" className={SUBTAB_TRIGGER}>
          Pack
        </TabsTrigger>
        <TabsTrigger value="matrix" className={SUBTAB_TRIGGER}>
          Matrix
        </TabsTrigger>
        <TabsTrigger value="custom" className={SUBTAB_TRIGGER}>
          Custom
        </TabsTrigger>
        <TabsTrigger value="live" className={SUBTAB_TRIGGER}>
          Live roles
        </TabsTrigger>
      </TabsList>

      <TabsContent value="pack" className="mt-0">
        <PackView pack={pack} />
      </TabsContent>

      <TabsContent value="matrix" className="mt-0">
        <MatrixView pack={pack} catalog={catalog} />
      </TabsContent>

      <TabsContent value="custom" className="mt-0">
        <CustomView canManage={canManage} catalog={catalog} />
      </TabsContent>

      <TabsContent value="live" className="mt-0">
        <RolesAndPermissionsPage />
      </TabsContent>
    </Tabs>
  );
}

type RoleEntry = { key: string; label: string; rank: number; optional?: boolean };

function PackView({ pack }: { pack: readonly RoleEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Role pack</CardTitle>
        <CardDescription>
          The active archetype&apos;s baseline roles (read-only). Assign members
          to roles in the member directory, not here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border rounded-md border border-border">
          {pack.map((role) => (
            <li
              key={role.key}
              className="flex items-center justify-between p-3 text-sm"
            >
              <span className="font-medium">{role.label}</span>
              <span className="text-muted-foreground">
                rank {role.rank}
                {role.optional ? " · optional" : ""}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Capabilities × roles. Columns derive at render time from `pack.roleKeys` plus
 * the live custom-role keys, so adding a custom role extends the matrix with no
 * code change (spec/engineering invariant). Cells are read-only here.
 */
function MatrixView({
  pack,
  catalog,
}: {
  pack: readonly RoleEntry[];
  catalog: PermissionCatalogEntry[];
}) {
  const customRolesQuery = useCustomRoles();
  const customRolesData = customRolesQuery.data;
  const customRoles = useMemo(
    () => customRolesData ?? [],
    [customRolesData],
  );

  // Columns derive from the pack keys + custom-role keys at render time. Pack
  // roles carry no capability data client-side (the archetype `RoleEntry` is
  // label/rank only — live permissions live in the `roles` table edited under
  // "Live roles"), so their cells render "n/a" rather than a misleading "—".
  const columns = useMemo(
    () => [
      ...pack.map((r) => ({ key: r.key, label: r.label, kind: "pack" as const })),
      ...customRoles.map((r) => ({
        key: r.key,
        label: r.label,
        kind: "custom" as const,
      })),
    ],
    [pack, customRoles],
  );

  const capabilityByRole = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const role of customRoles) {
      map.set(role.key, new Set(role.capabilities));
    }
    return map;
  }, [customRoles]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Permission matrix</CardTitle>
        <CardDescription>
          Capabilities (rows) by role (columns). Columns include every pack role
          and every custom role — adding a custom role extends them automatically.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="p-2 text-left font-medium">Capability</th>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className="p-2 text-center font-medium whitespace-nowrap"
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {catalog.map((entry) => (
                <tr key={entry.permission} className="border-b border-border/60">
                  <td className="p-2 font-mono text-xs">{entry.permission}</td>
                  {columns.map((col) => {
                    if (col.kind === "pack") {
                      // Pack roles have no capability data on the client.
                      return (
                        <td key={col.key} className="p-2 text-center">
                          <span
                            aria-label={`${col.label} capabilities managed under Live roles`}
                            className="text-muted-foreground/40"
                            title="Pack-role permissions are managed under Live roles"
                          >
                            n/a
                          </span>
                        </td>
                      );
                    }
                    const held =
                      capabilityByRole.get(col.key)?.has(entry.permission) ??
                      false;
                    return (
                      <td key={col.key} className="p-2 text-center">
                        <span
                          aria-label={
                            held
                              ? `${col.label} has ${entry.permission}`
                              : `${col.label} lacks ${entry.permission}`
                          }
                          className={
                            held
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-muted-foreground/40"
                          }
                        >
                          {held ? "✓" : "—"}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
    // Guard-parse: only commit a nonnegative integer (matches Workflows/Dues).
    const trimmed = raw.trim();
    if (trimmed === "") return;
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 0) return;
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
    const confirmed = window.confirm(`Delete the custom role "${role.label}"?`);
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

  if (customRolesQuery.isPending) {
    return <LoadingState message="Loading custom roles..." />;
  }
  if (customRolesQuery.isError) {
    return (
      <ErrorState
        title="Couldn't load custom roles"
        description="Retry to fetch this chapter's custom roles."
        onRetry={() => void customRolesQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
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
                          <input
                            type="checkbox"
                            checked={held}
                            disabled={!canManage || updateRole.isPending}
                            onChange={() =>
                              void handleToggleCapability(role, entry.permission)
                            }
                            aria-label={`${role.label} ${entry.permission}`}
                          />
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
                    <input
                      type="checkbox"
                      checked={draft.capabilities.includes(entry.permission)}
                      disabled={!canManage}
                      onChange={() => toggleDraftCapability(entry.permission)}
                      aria-label={`new role ${entry.permission}`}
                    />
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
    </div>
  );
}
