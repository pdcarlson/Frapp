"use client";

import { useMemo } from "react";
import { useRoles } from "@repo/hooks";
import { asArray } from "@/lib/utils";
import type { PermissionCatalogEntry } from "./permission-checkbox-grid";

/**
 * What a ROLE_GATED channel can be gated on, and who holds each option.
 *
 * The system catalog lists only Frapp's own permissions, but a gate can be
 * any string a role holds: a chapter's custom permissions, and the
 * `channels:read:<role>` permission a Discord import gives each role it gates
 * a channel on (#2818). Without them, chat admin showed an imported channel
 * as gated on "1 permission" with nothing ticked, and nobody could see or
 * change who reads it. The role names beside each option are what tells an
 * admin who that is; a permission string alone does not.
 *
 * Shared by chat admin's create dialog and edit panel and the Discord
 * import's channel step, which choose the same thing.
 */
export function useGateCatalog(systemCatalog: PermissionCatalogEntry[]): {
  catalog: PermissionCatalogEntry[];
  /**
   * Undefined until the roles have loaded, so the grid claims nothing about
   * who holds what rather than "no role holds this" for every option.
   */
  holders: ReadonlyMap<string, readonly string[]> | undefined;
} {
  const rolesQuery = useRoles();
  const roles = useMemo(
    () => asArray<{ name?: string; permissions?: string[] }>(rolesQuery.data),
    [rolesQuery.data],
  );
  const catalog = useMemo(() => {
    const known = new Set(systemCatalog.map((entry) => entry.permission));
    const extra: PermissionCatalogEntry[] = [];
    for (const role of roles) {
      for (const permission of role.permissions ?? []) {
        if (permission === "*" || known.has(permission)) continue;
        known.add(permission);
        extra.push({ key: permission, permission });
      }
    }
    return [...systemCatalog, ...extra];
  }, [systemCatalog, roles]);
  const rolesLoaded = rolesQuery.data !== undefined;
  const holders = useMemo(() => {
    if (!rolesLoaded) return undefined;
    const map = new Map<string, string[]>();
    for (const role of roles) {
      for (const permission of role.permissions ?? []) {
        map.set(permission, [...(map.get(permission) ?? []), role.name ?? ""]);
      }
    }
    return map;
  }, [roles, rolesLoaded]);
  return { catalog, holders };
}
