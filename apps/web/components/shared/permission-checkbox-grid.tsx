"use client";

import {
  dashboardCheckboxHitAreaClassName,
  dashboardTableCheckboxClassName,
} from "@/components/shared/table-controls";
import { useNetwork } from "@/lib/providers/network-provider";

export interface PermissionCatalogEntry {
  key: string;
  permission: string;
}

/**
 * The required-permissions picker for a ROLE_GATED channel.
 *
 * Shared by chat admin's create dialog and edit panel, and by the Discord
 * import's channel mapping, because all three are choosing the same thing: the
 * permission strings a member needs one of to read the channel. They also need
 * to degrade the same way when the catalog can't load.
 *
 * `holders` names the chapter's roles that hold each permission, when the
 * caller has them. A permission string alone ("chapter-config:manage") does
 * not tell an admin who will be able to read the channel; the roles do.
 *
 * A selected permission missing from `catalog` is listed too: a gate can
 * outlive every role that held it, and an option that is not shown can be
 * neither seen nor unticked.
 *
 * Offline, a catalog that is loading or failed is reported as offline, not as
 * a missing `members:view`: offline the read either pauses (and would show
 * "Loading" until reconnect) or fails (and would blame a permission nobody
 * checked), depending on how the dashboard got offline — `anyReadUncached` in
 * `async-states.tsx` has the two cases (#2267).
 */
export function PermissionCheckboxGrid({
  catalog,
  catalogLoading,
  catalogUnavailable,
  selected,
  onToggle,
  holders,
}: {
  catalog: PermissionCatalogEntry[];
  catalogLoading: boolean;
  catalogUnavailable: boolean;
  selected: Set<string>;
  onToggle: (permission: string) => void;
  holders?: ReadonlyMap<string, readonly string[]>;
}) {
  const { isOffline } = useNetwork();
  if (isOffline && (catalogUnavailable || catalogLoading)) {
    return (
      <p className="mt-2 rounded-md border border-border p-3 text-xs text-muted-foreground">
        Offline — can&apos;t load the permission list. Existing selections are
        unaffected; reconnect to change them.
      </p>
    );
  }
  if (catalogUnavailable) {
    return (
      <p className="mt-2 rounded-md border border-border p-3 text-xs text-muted-foreground">
        Couldn&apos;t load the permission catalog. You may be missing the{" "}
        <code>members:view</code> permission it requires. Existing selections
        are unaffected; ask your chapter president for access to change them.
      </p>
    );
  }
  if (catalogLoading) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">Loading permissions…</p>
    );
  }
  const listed = new Set(catalog.map((entry) => entry.permission));
  const entries = [
    ...catalog,
    ...[...selected]
      .filter((permission) => !listed.has(permission))
      .map((permission) => ({ key: permission, permission })),
  ];
  return (
    <div className="mt-2 grid gap-2 rounded-md border border-border p-3 max-h-48 overflow-y-auto">
      {entries
        .filter((entry) => entry.permission !== "*")
        .map((entry) => {
          const roles = holders?.get(entry.permission) ?? [];
          return (
            <label
              key={entry.permission}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <span className={dashboardCheckboxHitAreaClassName}>
                <input
                  type="checkbox"
                  className={dashboardTableCheckboxClassName}
                  checked={selected.has(entry.permission)}
                  onChange={() => onToggle(entry.permission)}
                />
              </span>
              <code className="text-xs">{entry.permission}</code>
              {holders ? (
                <span className="truncate text-xs text-muted-foreground">
                  {roles.length > 0 ? roles.join(", ") : "no role holds this"}
                </span>
              ) : null}
            </label>
          );
        })}
    </div>
  );
}
