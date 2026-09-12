"use client";

import { useMemo, useState } from "react";
import { useUpdateRole } from "@repo/hooks";
import { cn, getErrorMessage } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

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
  /** Member count per role id, for the column headers' second line. */
  memberCounts: Map<string, number>;
  /** Whether the viewer may flip a cell. Read-only otherwise. */
  canManage: boolean;
};

/**
 * Board `4e`: the roles × permissions matrix.
 *
 * **This is the one place permissions are edited**, which is the whole reason
 * the board draws it — "roles gate everything, so this is the one place they're
 * edited". What it replaces is two surfaces that disagreed about that:
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
 * **Rows group by module** (`4e` pin 3). The group is derived from the
 * permission string's prefix (`events:create` → Events) rather than from
 * `entry.key`, because the catalog's `key` is a display label and several
 * modules spell theirs differently from the permission namespace. A permission
 * with no prefix lands under "Chapter", which is where the ungrouped
 * chapter-wide permissions belong anyway.
 *
 * **The marks take no opacity modifier.** `●` and `○` are characters, so
 * §6's 4.5:1 text floor applies rather than the 3:1 glyph one, and
 * `text-muted-foreground/60` measures under it — the exact defect
 * `settings-roles-tab.spec.tsx` guards at the call site, because a value-level
 * contrast spec cannot see which class a component reached for. Granted takes
 * `--accent-text` rather than `--success` for `pro-chip.tsx`'s reason: a held
 * permission is an entitlement, not a status.
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
  const { toast } = useToast();
  const updateRole = useUpdateRole();

  // The cell currently in flight, as `roleId:permission`. Board `4e` pin 2
  // draws a focus ring on "the one being edited"; this is what that ring reads.
  const [pendingCell, setPendingCell] = useState<string | null>(null);

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
  const groups = useMemo(() => groupByModule(catalog), [catalog]);

  async function toggle(role: MatrixRole, permission: string, held: boolean) {
    const cell = `${role.id}:${permission}`;
    setPendingCell(cell);
    const next = held
      ? role.permissions.filter((p) => p !== permission)
      : [...role.permissions, permission];
    try {
      await updateRole.mutateAsync({
        id: role.id,
        body: { permissions: next },
      });
    } catch (error) {
      toast({
        title: `Couldn't update ${role.name}`,
        description: getErrorMessage(
          error,
          "The permission was not changed. Retry, or check you still hold roles:manage.",
        ),
        variant: "destructive",
      });
    } finally {
      setPendingCell(null);
    }
  }

  // `200px repeat(N,1fr)` is the board's track list. It is an inline style
  // rather than a class because N is the chapter's role count — Tailwind cannot
  // generate a class per possible column count, and an arbitrary value built by
  // template literal is exactly the string JIT cannot see.
  const gridTemplateColumns = `200px repeat(${columns.length}, minmax(76px, 1fr))`;

  return (
    <div className="overflow-x-auto">
      <div
        className="min-w-fit overflow-hidden rounded-[14px] border border-border text-[13.5px]"
        role="table"
        aria-label="Roles and permissions"
      >
        <div
          role="row"
          className="grid h-16 items-end gap-1 bg-card py-2.5 pl-4"
          style={{ gridTemplateColumns }}
        >
          <span
            role="columnheader"
            className="text-[12.5px] font-semibold text-muted-foreground"
          >
            Permission
          </span>
          {columns.map((role) => {
            const count = memberCounts.get(role.id) ?? 0;
            return (
              <div
                key={role.id}
                role="columnheader"
                // Named explicitly rather than from contents. The count and the
                // initials chip are both inside, so a computed name would read
                // "EB Exec board 4" — and the initials are decorative.
                aria-label={`${role.name}, ${count} ${count === 1 ? "member" : "members"}`}
                className="px-1 text-center"
              >
                <span
                  aria-hidden
                  className={cn(
                    "mx-auto mb-1 grid h-7 w-7 place-items-center rounded-full text-[10px] font-bold",
                    role.permissions.includes("*")
                      ? "border border-accent-border bg-accent-subtle text-accent-text"
                      : "bg-muted text-foreground",
                  )}
                >
                  {initials(role.name)}
                </span>
                <span
                  className={cn(
                    "block truncate text-xs font-semibold",
                    role.permissions.includes("*") && "text-accent-text",
                  )}
                  title={role.name}
                >
                  {role.name}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {count}
                </span>
              </div>
            );
          })}
        </div>

        {groups.map((group) => (
          <div key={group.label}>
            <div
              role="row"
              className="grid h-8 items-center border-t border-border bg-background pl-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
              style={{ gridTemplateColumns }}
            >
              <span role="rowheader">{group.label}</span>
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
                  title={entry.permission}
                >
                  {entry.key || entry.permission}
                </span>
                {columns.map((role) => {
                  const wildcard = role.permissions.includes("*");
                  const held =
                    wildcard || role.permissions.includes(entry.permission);
                  const locked = wildcard || !canManage;
                  const cell = `${role.id}:${entry.permission}`;
                  const label = `${entry.key || entry.permission} for ${role.name}`;

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
                          held ? "text-accent-text" : "text-muted-foreground",
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
                        disabled={pendingCell !== null}
                        onClick={() =>
                          void toggle(role, entry.permission, held)
                        }
                        className={cn(
                          "grid h-[22px] w-[22px] place-items-center rounded-[7px] leading-none transition",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                          held ? "text-accent-text" : "text-muted-foreground",
                          pendingCell === cell &&
                            "border border-accent-border shadow-[0_0_0_3px_hsl(var(--ring)/0.25)]",
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

/** First letters of the first two words, so "Exec board" reads "EB" (`4e`). */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2);
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

const MODULE_LABELS: Record<string, string> = {
  billing: "Money",
  invoices: "Money",
  dues: "Money",
  points: "Money",
};

/**
 * Groups catalog rows by the permission namespace, preserving catalog order
 * within a group and ordering groups by first appearance. A few namespaces
 * collapse into one board group (`4e` draws "Money", which this product spells
 * across `billing`, `invoices`, `dues` and `points`).
 */
function groupByModule(
  catalog: MatrixCatalogEntry[],
): Array<{ label: string; entries: MatrixCatalogEntry[] }> {
  const order: string[] = [];
  const byLabel = new Map<string, MatrixCatalogEntry[]>();

  for (const entry of catalog) {
    if (entry.permission === "*") continue;
    const namespace = entry.permission.includes(":")
      ? entry.permission.slice(0, entry.permission.indexOf(":"))
      : "chapter";
    const label =
      MODULE_LABELS[namespace] ??
      namespace.charAt(0).toUpperCase() +
        namespace.slice(1).replace(/[-_]/g, " ");
    if (!byLabel.has(label)) {
      byLabel.set(label, []);
      order.push(label);
    }
    byLabel.get(label)!.push(entry);
  }

  return order.map((label) => ({ label, entries: byLabel.get(label)! }));
}
