"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { useRoles } from "@repo/hooks";
import { matchesWordStarts, normalizeWords } from "@repo/hooks/fuzzy-match";
import { asArray, cn } from "@/lib/utils";
import { ProfileSection } from "@/components/profile/profile-section";
import {
  InlineNote,
  inlineNoteActionClassName,
} from "@/components/shared/inline-note";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FOCUS_RING } from "@/components/ui/focus";
import { modulePermissions } from "@/components/settings/settings-modules";
import { useRolePermissionToggle } from "@/components/roles/use-role-permission-toggle";

type WhoCanRole = {
  id: string;
  name: string;
  color: string | null;
  permissions: readonly string[];
  displayOrder: number;
};

function normalizeRoles(data: unknown): WhoCanRole[] {
  return asArray<Record<string, unknown>>(data)
    .map((role) => ({
      id: String(role.id ?? ""),
      name: String(role.name ?? ""),
      color: typeof role.color === "string" ? role.color : null,
      permissions: Array.isArray(role.permissions)
        ? role.permissions.map(String)
        : [],
      displayOrder: Number(role.display_order ?? 0),
    }))
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

/**
 * A module page's "Who can" block (#4073): each of the module's permissions,
 * in the registry's words, with the roles that hold it, edited right here.
 *
 * An officer setting up Events asks "who can create events?" on the Events
 * page, so the answer and the change sit together: a role chip's × takes the
 * permission away, and "Add role" grants it, saved on click like the Roles
 * matrix and through the same writer (`useRolePermissionToggle`). Discord's
 * channel permissions and Slack's per-feature "who can" pickers both edit in
 * place for the same reason. The Roles page stays the view of every
 * permission at once.
 *
 * Editing needs `roles:manage`, the guard on `PATCH /v1/roles/:id`; without it
 * the chips are read-only. The President's wildcard is said once in the hint
 * rather than drawn as a chip on every row, and can't be added or removed
 * here, as on the matrix (the API refuses `*` outside the presidency
 * transfer).
 *
 * Roles only for now. Tiers (#4071) and per-role overrides (#4072) join this
 * list when the API serves them.
 */
export function ModuleWhoCan({
  moduleKey,
  moduleLabel,
  canEdit,
}: {
  moduleKey: string;
  moduleLabel: string;
  /** Whether the viewer holds `roles:manage`. */
  canEdit: boolean;
}) {
  const rolesQuery = useRoles();
  const roles = useMemo(
    () => normalizeRoles(rolesQuery.data),
    [rolesQuery.data],
  );
  const { permissionsOf, toggle, pending } = useRolePermissionToggle(roles);
  const permissions = modulePermissions(moduleKey);
  if (permissions.length === 0) return null;

  // Roles that can gain or lose a permission: every role but a wildcard one.
  const editable = roles.filter((role) => !role.permissions.includes("*"));

  const rolesLink = (
    <Link href="/settings?tab=roles" className={inlineNoteActionClassName}>
      {canEdit ? "See every permission in Roles" : "Change in Roles"}
    </Link>
  );

  return (
    <ProfileSection
      id={`settings-module-${moduleKey}-who`}
      title="Who can"
      hint={
        <>
          {canEdit
            ? `Which roles can do each thing in ${moduleLabel}. Changes save as you make them. The President can do everything.`
            : `What each role can do in ${moduleLabel}. The President can do everything.`}{" "}
          {rolesLink}
        </>
      }
    >
      {rolesQuery.isError ? (
        <InlineNote>
          Couldn&apos;t load your chapter&apos;s roles. {rolesLink} shows them.
        </InlineNote>
      ) : (
        <ul className="divide-y divide-border rounded-[14px] border border-border">
          {permissions.map((entry) => {
            const holders = editable.filter((role) =>
              permissionsOf(role).includes(entry.permission),
            );
            const others = editable.filter(
              (role) => !permissionsOf(role).includes(entry.permission),
            );
            return (
              <li
                key={entry.permission}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
              >
                <div className="min-w-0 sm:max-w-[50%]">
                  <p className="text-sm font-medium text-foreground">
                    {entry.label}
                  </p>
                  <p className="mt-0.5 text-caption text-muted-foreground">
                    {entry.description}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                  {rolesQuery.isPending ? (
                    <span className="text-caption text-muted">Loading</span>
                  ) : (
                    <>
                      {holders.length === 0 ? (
                        <span className="text-caption text-muted-foreground">
                          Only the President
                        </span>
                      ) : (
                        holders.map((role) => (
                          <RoleChip
                            key={role.id}
                            role={role}
                            saving={
                              pending?.roleId === role.id &&
                              pending.permission === entry.permission
                            }
                            onRemove={
                              canEdit
                                ? () => void toggle(role, entry.permission, true)
                                : undefined
                            }
                            permissionLabel={entry.label}
                          />
                        ))
                      )}
                      {canEdit && others.length > 0 ? (
                        <AddRole
                          permissionLabel={entry.label}
                          roles={others}
                          onAdd={(role) =>
                            void toggle(role, entry.permission, false)
                          }
                        />
                      ) : null}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ProfileSection>
  );
}

function RoleDot({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden
      className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground"
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

/**
 * A role holding the permission. With `onRemove`, a × takes it away. A chip
 * whose write is in flight goes muted rather than growing a spinner, so the
 * row never shifts.
 */
function RoleChip({
  role,
  saving,
  onRemove,
  permissionLabel,
}: {
  role: WhoCanRole;
  saving: boolean;
  onRemove?: () => void;
  permissionLabel: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border border-border pl-2 text-caption",
        onRemove ? "pr-0.5" : "pr-2",
        saving ? "text-muted-foreground" : "text-foreground",
      )}
    >
      <RoleDot color={role.color} />
      {role.name}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          disabled={saving}
          aria-label={`Remove ${role.name} from ${permissionLabel}`}
          className={cn(
            "grid h-5 w-5 place-items-center rounded-full text-muted-foreground hover:bg-card-hover hover:text-foreground disabled:pointer-events-none",
            FOCUS_RING,
          )}
        >
          <X className="h-3 w-3" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

/**
 * "Add role": a filterable list of the roles that don't hold the permission.
 * Filterable because a chapter imported from Discord can carry a hundred
 * roles, the same reason the toolbar filter chips are.
 */
function AddRole({
  permissionLabel,
  roles,
  onAdd,
}: {
  permissionLabel: string;
  roles: readonly WhoCanRole[];
  onAdd: (role: WhoCanRole) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const commandRef = useRef<HTMLDivElement>(null);
  const shown =
    normalizeWords(query).length === 0
      ? roles
      : roles.filter((role) => matchesWordStarts(role.name, query));
  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Add a role to ${permissionLabel}`}
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-border px-2 text-caption font-semibold text-muted-foreground hover:border-input hover:text-foreground",
            FOCUS_RING,
          )}
        >
          <Plus className="h-3 w-3" aria-hidden />
          Add role
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-max min-w-[14rem] max-w-[min(22rem,calc(100vw-2rem))] p-0"
        onEscapeKeyDown={(event) => {
          if (!query) return;
          event.preventDefault();
          setQuery("");
        }}
      >
        <Command
          ref={commandRef}
          tabIndex={-1}
          className="outline-none"
          shouldFilter={false}
          label={`Roles to add to ${permissionLabel}`}
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Find a role"
            className="h-9 py-2 text-sm pointer-coarse:h-11 pointer-coarse:text-base"
          />
          <CommandList className="max-h-72 p-1">
            {shown.length === 0 ? (
              <p role="status" className="px-2 py-3 text-sm text-muted">
                No role matches “{query.trim()}”.
              </p>
            ) : (
              shown.map((role) => (
                <CommandItem
                  key={role.id}
                  value={role.id}
                  className="min-h-8 gap-2 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base"
                  onSelect={() => {
                    onAdd(role);
                    close();
                  }}
                >
                  <RoleDot color={role.color} />
                  <span className="min-w-0 flex-1 break-words">
                    {role.name}
                  </span>
                </CommandItem>
              ))
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
