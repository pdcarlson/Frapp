"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePermissionsCatalog, useRoles } from "@repo/hooks";
import { asArray } from "@/lib/utils";
import {
  PageSettingsAccessRow,
  PageSettingsDrawer,
  PageSettingsRoleChip,
  PageSettingsSection,
} from "@/components/layout/page-settings-drawer";

type Role = { id: string; name: string; permissions?: string[] };

/**
 * Board `4c` on Study Zones.
 *
 * **Access only, and the omission is the honest part.** `4c` draws three
 * sections — Access, Defaults, and Posts to chat — on Events, and pin 4 scopes
 * the last two precisely: "per-module knobs **the API already has**
 * (check-in window, point value, announcement channel)". Study zones have no
 * such knobs. Their numbers (`minutes_per_point`, `points_per_interval`,
 * `min_session_minutes`, `pause_grace_minutes`) are columns on each zone, set
 * per zone in its own create and edit forms, and there is no chapter-level
 * geofence config route to hang a Defaults section on. Inventing one would be
 * capability, which `deletion-checklist.md` §8 puts outside this epic; moving
 * the per-zone fields up here would be worse, since it would make four numbers
 * that differ per polygon look like one setting.
 *
 * **Access reads the roles matrix rather than a second store.** The chips are
 * the live `roles` rows that hold each `geofences:*` permission, from the same
 * `useRoles` + `usePermissionsCatalog` pair board `4e` edits. So this drawer
 * reports, and `4e` is where it changes — which is exactly what `4c`'s own
 * footer says: "Roles are managed in Roles."
 */
export function StudyZonesSettingsDrawer() {
  const rolesQuery = useRoles();
  const catalogQuery = usePermissionsCatalog();

  const roles = useMemo(
    () => asArray<Role>(rolesQuery.data),
    [rolesQuery.data],
  );

  // Every permission in the module's namespace, so a permission added to the
  // catalog later shows up here without this file being edited.
  const verbs = useMemo(() => {
    const entries = asArray<{ key?: string; permission?: string }>(
      catalogQuery.data,
    ).filter((entry) => entry.permission?.startsWith("geofences:"));
    return entries.map((entry) => ({
      permission: entry.permission!,
      label: entry.key || entry.permission!,
    }));
  }, [catalogQuery.data]);

  return (
    <PageSettingsDrawer pageTitle="Study Zones">
      <PageSettingsSection
        label="Access"
        footer={
          <>
            Roles are managed in{" "}
            <Link
              href="/settings?tab=roles"
              className="font-semibold underline underline-offset-2"
            >
              Roles
            </Link>
            .
          </>
        }
      >
        {/*
          Viewing is not permission-gated: any member can see the zones they
          may study in, which is why there is no `geofences:view` in the
          catalog to derive a row from. Saying so beats an absent row that
          reads as "nobody".
        */}
        <PageSettingsAccessRow label="View">
          <PageSettingsRoleChip tone="everyone">Everyone</PageSettingsRoleChip>
        </PageSettingsAccessRow>

        {rolesQuery.isPending || catalogQuery.isPending ? (
          <p className="text-[12.5px] text-muted-foreground">
            Loading who holds what...
          </p>
        ) : rolesQuery.isError || catalogQuery.isError ? (
          <p className="text-[12.5px] text-muted-foreground">
            Couldn&apos;t load roles. Open Settings to see who can manage zones.
          </p>
        ) : (
          verbs.map((verb) => {
            const holders = roles.filter(
              (role) =>
                role.permissions?.includes(verb.permission) ||
                role.permissions?.includes("*"),
            );
            return (
              <PageSettingsAccessRow key={verb.permission} label={verb.label}>
                {holders.length === 0 ? (
                  <span className="text-[12.5px] text-muted-foreground">
                    No role holds this yet
                  </span>
                ) : (
                  holders.map((role) => (
                    <PageSettingsRoleChip key={role.id}>
                      {role.name}
                    </PageSettingsRoleChip>
                  ))
                )}
              </PageSettingsAccessRow>
            );
          })
        )}
      </PageSettingsSection>
    </PageSettingsDrawer>
  );
}
