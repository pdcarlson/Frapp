"use client";

import { useMemo } from "react";
import { cn, initials } from "@/lib/utils";
import { EYEBROW } from "@/components/ui/typography";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { useRolePermissionToggle } from "@/components/roles/use-role-permission-toggle";
import { groupPermissionsByModule, permissionLabel } from "@repo/validation";

export type MatrixRole = {
  id: string;
  name: string;
  permissions: string[];
  is_system: boolean;
  display_order: number;
  color: string | null;
};

export type MatrixCatalogEntry = {
  key: string;
  permission: string;
};

type Props = {
  roles: MatrixRole[];
  catalog: MatrixCatalogEntry[];
  /**
   * Member count per role id, for the column headers' second line. `null` when
   * the members read has not landed: the header then says nothing rather than
   * "0", which an officer auditing who holds a role would read as a fact.
   */
  memberCounts: Map<string, number> | null;
  /** Whether the viewer may flip a cell. Read-only otherwise. */
  canManage: boolean;
};

/**
 * Board `4e`: the roles × permissions matrix.
 *
 * **This is where every permission is edited at once**, which is the whole
 * reason the board draws it — "roles gate everything, so this is the one place
 * they're edited". A module page's "Who can" (#4073) also edits that module's
 * permissions in place, through the same writer (`useRolePermissionToggle`),
 * since Paul asked for it on 2026-11-11. What the matrix replaced is two
 * surfaces that disagreed about that:
 *
 * | Was | Why it went |
 * | --- | ----------- |
 * | `settings-roles-tab`'s `MatrixView` | A real capabilities × roles table, but **read-only**, and every pack-role cell rendered the literal string `n/a` because no client-side capability data exists for archetype roles. A matrix that cannot be edited and cannot answer half its own cells is a diagram, not a control |
 * | `roles-page`'s per-role permission checklist | One role at a time behind a list → detail selection, so "which roles can take attendance" — the question a president actually arrives with — took seven clicks and a memory |
 *
 * **Cells write on click, with no Save button** (`4e` pin 2, "Click flips and
 * saves"). That matches `4c`'s autosave rule for the per-page drawer, and it is
 * why there is no draft state here at all: the previous editor's draft/save
 * cycle is what made a seven-role sweep feel like seven forms.
 *
 * **Rows group by module** (`4e` pin 3). The groups, their order and each
 * row's words come from the permission registry in `@repo/validation`
 * (`groupPermissionsByModule`, `permissionLabel`), the same list the API
 * serves and mobile reads (#4069). A row reads as the registry words it
 * ("Create events"), never as the constant or the raw string; the tooltip
 * repeats the words for a label the column truncates.
 *
 * **The marks take no opacity modifier.** `●` and `○` are characters, so
 * §6's 4.5:1 text floor applies rather than the 3:1 glyph one, and
 * `text-muted-foreground/60` measures under it — the exact defect
 * `settings-roles-tab.spec.tsx` guards at the call site, because a value-level
 * contrast spec cannot see which class a component reached for. A granted cell
 * the viewer can toggle takes `--accent-text`, because it is a control they
 * switched on (`foundations.md` §6), not `--success`: a held permission is an
 * entitlement, not a status. A locked cell reads `--foreground`: nobody can act
 * on it, so it does not take the accent.
 *
 * **The wildcard column is not editable, and that is an API rule, not a style
 * choice.** A role holding `*` (the President) shows every cell granted and
 * every cell locked: the API rejects introducing or stripping `*` outside the
 * presidency-transfer flow, so a clickable cell there would be a control that
 * always fails. `4e` states the same thing in copy — "President always holds
 * everything and cannot be edited".
 */
export function RolesMatrix({
  roles,
  catalog,
  memberCounts,
  canManage,
}: Props) {
  // Saved on click through the same writer a module page's "Who can" uses
  // (#4073); the hook carries the overlay that keeps quick flips on one role
  // from dropping each other.
  const { toggle, pending } = useRolePermissionToggle(roles);

  const columns = useMemo(
    () =>
      [...roles].sort(
        (a, b) =>
          a.display_order - b.display_order || a.name.localeCompare(b.name),
      ),
    [roles],
  );

  // `*` is never a row: it is not a permission a president toggles, it is the
  // marker that says every row is already granted. Rendering it would put a
  // permanently-locked row at the top of a table whose whole job is flipping.
  const groups = useMemo(() => groupPermissionsByModule(catalog), [catalog]);

  // `200px repeat(N,1fr)` is the board's track list. It is an inline style
  // rather than a class because N is the chapter's role count — Tailwind cannot
  // generate a class per possible column count, and an arbitrary value built by
  // template literal is exactly the string JIT cannot see.
  const gridTemplateColumns = `200px repeat(${columns.length}, minmax(76px, 1fr))`;

  return (
    <div className="overflow-x-auto">
      <div
        className="min-w-fit overflow-hidden rounded-[14px] border border-border text-label font-normal"
        role="table"
        aria-label="Roles and permissions"
      >
        <div
          role="row"
          className="grid min-h-16 items-end gap-1 bg-card py-2.5 pl-4"
          style={{ gridTemplateColumns }}
        >
          <span
            role="columnheader"
            className="text-caption font-semibold text-muted-foreground"
          >
            Permission
          </span>
          {columns.map((role) => {
            /*
             * A role with no members has no map entry, so an absent entry is
             * genuinely 0 once the read has landed. `null` is reserved for
             * "the members read has not landed" — the whole map being null.
             * Collapsing the two would print "0 members" for every role on a
             * failed fetch.
             */
            const count =
              memberCounts === null ? null : (memberCounts.get(role.id) ?? 0);
            return (
              <div
                key={role.id}
                role="columnheader"
                // Named explicitly rather than from contents. The count and the
                // initials chip are both inside, so a computed name would read
                // "EB Exec board 4" — and the initials are decorative.
                aria-label={
                  count === null
                    ? role.name
                    : `${role.name}, ${count} ${count === 1 ? "member" : "members"}`
                }
                className="px-1 text-center"
              >
                <span
                  aria-hidden
                  className="mx-auto mb-1 grid h-7 w-7 place-items-center rounded-full bg-card-hover text-[10px] font-bold text-foreground"
                >
                  {initials(role.name)}
                </span>
                <span
                  className="block truncate text-xs font-semibold"
                  title={role.name}
                >
                  {role.name}
                </span>
                <span className="block text-caption text-muted-foreground">
                  {count}
                </span>
              </div>
            );
          })}
        </div>

        {groups.map((group) => (
          // `rowgroup`, not a bare `<div>`. An element with no role sitting
          // between `role="table"` and its `role="row"` children is not
          // reliably transparent for ARIA table ownership; `rowgroup` is the
          // role that legitimately holds rows, and it is what `<tbody>` maps to.
          <div key={group.label} role="rowgroup">
            <div
              role="row"
              // `EYEBROW` for the same reason the settings drawer takes it:
              // one section-label recipe, on the §7 scale.
              className={cn(
                "grid h-8 items-center border-t border-border bg-background pl-4 text-muted-foreground",
                EYEBROW,
              )}
              style={{ gridTemplateColumns }}
            >
              {/*
                The label is the row's only cell, in a grid track-listed for
                every role column. Without `aria-colspan` a screen reader
                walking column-wise counts one cell here against N+1 on a
                permission row and reads the table as truncated at every module
                boundary.
              */}
              <span role="rowheader" aria-colspan={columns.length + 1}>
                {group.label}
              </span>
            </div>
            {group.entries.map((entry) => (
              <div
                key={entry.permission}
                role="row"
                className="grid h-10 items-center border-t border-border/60 pl-4"
                style={{ gridTemplateColumns }}
              >
                <span
                  role="rowheader"
                  className="truncate pr-2"
                  title={permissionLabel(entry.permission)}
                >
                  {permissionLabel(entry.permission)}
                </span>
                {columns.map((role) => {
                  const wildcard = role.permissions.includes("*");
                  const held =
                    wildcard || role.permissions.includes(entry.permission);
                  const locked = wildcard || !canManage;
                  const label = `${permissionLabel(entry.permission)} for ${role.name}`;

                  if (locked) {
                    return (
                      <span
                        key={role.id}
                        role="cell"
                        title={
                          wildcard
                            ? `${role.name} holds every permission and cannot be edited here`
                            : undefined
                        }
                        className={cn(
                          "text-center",
                          held ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        <span aria-hidden="true">{held ? "●" : "○"}</span>
                        <span className="sr-only">
                          {held ? `Granted: ${label}` : `Not granted: ${label}`}
                        </span>
                      </span>
                    );
                  }

                  return (
                    <div
                      key={role.id}
                      role="cell"
                      className="grid place-items-center"
                    >
                      <button
                        type="button"
                        aria-pressed={held}
                        aria-label={label}
                        disabled={pending?.roleId === role.id}
                        onClick={() =>
                          void toggle(role, entry.permission, held)
                        }
                        className={cn(
                          "grid h-[22px] w-[22px] place-items-center rounded-[7px] leading-none transition",
                          // `FOCUS_RING_OFFSET`, not a copy of it. A cell has
                          // no border of its own for `FOCUS_RING` to swap, and
                          // `focus.ts` keeps these as constants precisely
                          // because copied strings drift.
                          FOCUS_RING_OFFSET,
                          held ? "text-accent-text" : "text-muted-foreground",
                          /*
                           * `4e` pin 2's ring on "the one being edited", and
                           * `ring-ring/25` is the repo's own recipe for it
                           * (`focus.ts`).
                           *
                           * Not a hand-rolled `shadow-[...]` arbitrary value:
                           * the ring token is stored as a complete colour, so
                           * an arbitrary value that wraps it in a colour
                           * function nests one colour inside another and
                           * renders nothing at all (#1151). `packages/theme`'s
                           * `tailwind.config.spec.ts` scans for that shape as
                           * plain text — including in comments, so do not
                           * spell the broken form out here.
                           */
                          pending?.roleId === role.id &&
                            pending.permission === entry.permission &&
                            "border border-accent-border ring-[3px] ring-ring/25",
                        )}
                      >
                        <span aria-hidden="true">{held ? "●" : "○"}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
