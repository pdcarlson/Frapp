"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Pencil } from "lucide-react";
import {
  meterFillClassName,
  meterTrackDenseClassName,
} from "@/components/shared/meter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/components/ui/focus";
import {
  compactControlClassName,
  dashboardCheckboxHitAreaClassName,
  dashboardTableCheckboxClassName,
  dashboardToolbarHeightClassName,
} from "@/components/shared/table-controls";
import { IconButton } from "@/components/ui/icon-button";
import type { StagedRole } from "./upload-step";
import type {
  FrappRole,
  MatchKind,
  RoleChoice,
  RoleIssue,
} from "./role-matching";

/**
 * Why every role is held on Skip: the viewer cannot manage roles, or the
 * roles (or the viewer's permissions) could not be loaded, which a retry may
 * fix. An all-Skip mapping is always accepted, so either way the import can
 * go on, with each private channel's readers chosen by hand.
 */
export type RoleStepLock =
  { reason: "permission" } | { reason: "unavailable"; retry: () => void };

const NEW = "__new__";
const IGNORE = "__ignore__";

/** Rows an open pile shows before "Show N more". */
const PILE_LIMIT = 15;

type PileKey = "access" | "matched" | "none";

/**
 * Which Frapp role each Discord role becomes (#2818), asked before the
 * channels because a private channel's default ("Same as Discord") is read
 * through it.
 *
 * A server can have a hundred roles, so they are sorted into three piles by
 * what they do, fixed by each role's starting answer so a row never jumps
 * pile while it is being changed:
 *
 * - **Open private channels**: no match, and the role could read at least one
 *   private channel. These decide who reads what, so the pile starts open,
 *   most channels first, with Create all and Skip all.
 * - **Match your roles**: a same-name or close match. Folded, with the close
 *   matches counted, since "Recording Secretary" → Secretary is a guess.
 * - **Open no private channel**: no match and nothing gated. Folded, with
 *   Create all and Skip all on the pile.
 *
 * Every row is one line, and ticked rows get one bar to act on all of them.
 *
 * **It never puts anyone into a role.** Imported authors are names on
 * messages, not accounts. Starting the import creates the new roles and lets
 * each mapped role read the channels gated on it; people are added to roles
 * by hand in Settings → Roles.
 */
export function RoleMappingStep({
  roles,
  choices,
  matches,
  startingMatches = matches,
  privateReads,
  frappRoles,
  issues,
  lock,
  onChange,
}: {
  roles: StagedRole[];
  /** Every role's answer, defaults included. */
  choices: Record<string, RoleChoice>;
  /** Why an untouched answer is what it is. */
  matches: Record<string, MatchKind>;
  /** Each role's match before any edit: decides its pile, so rows stay put. */
  startingMatches?: Record<string, MatchKind>;
  privateReads: ReadonlyMap<string, number>;
  frappRoles: FrappRole[];
  issues: RoleIssue[];
  /** Set when every role is held on Skip, and why. */
  lock: RoleStepLock | null;
  onChange: (roleId: string, next: RoleChoice) => void;
}) {
  const problems = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const issue of issues) {
      map.set(issue.roleId, [...(map.get(issue.roleId) ?? []), issue.message]);
    }
    return map;
  }, [issues]);

  const piles = useMemo(() => {
    const reads = (role: StagedRole) => privateReads.get(role.roleId) ?? 0;
    const sorted = [...roles].sort((a, b) => reads(b) - reads(a));
    const access: StagedRole[] = [];
    const matched: StagedRole[] = [];
    const none: StagedRole[] = [];
    for (const role of sorted) {
      if (startingMatches[role.roleId]) matched.push(role);
      else if (reads(role) > 0) access.push(role);
      else none.push(role);
    }
    return { access, matched, none };
  }, [roles, privateReads, startingMatches]);

  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const disabled = lock !== null;
  const maxReads = Math.max(1, ...privateReads.values());

  const counts = { existing: 0, new: 0, ignore: 0 };
  for (const role of roles) {
    counts[choices[role.roleId]?.action ?? "ignore"] += 1;
  }

  function setMany(
    targets: readonly StagedRole[],
    next: (role: StagedRole) => RoleChoice,
  ) {
    for (const role of targets) onChange(role.roleId, next(role));
  }
  const asNew = (role: StagedRole): RoleChoice => {
    const current = choices[role.roleId];
    return current?.action === "new"
      ? current
      : { action: "new", name: role.roleName.trim() };
  };
  const asSkip = (): RoleChoice => ({ action: "ignore" });

  function toggle(roleId: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  }
  const selectedRoles = roles.filter((role) => selected.has(role.roleId));

  const rowProps = (role: StagedRole) => ({
    role,
    choice: choices[role.roleId] ?? ({ action: "ignore" } as RoleChoice),
    match: matches[role.roleId] ?? null,
    reads: privateReads.get(role.roleId) ?? 0,
    maxReads,
    frappRoles,
    problems: problems.get(role.roleId) ?? [],
    disabled,
    selected: selected.has(role.roleId),
    onSelect: () => toggle(role.roleId),
    onChange: (next: RoleChoice) => onChange(role.roleId, next),
  });

  const closeMatches = piles.matched.filter(
    (role) => startingMatches[role.roleId] === "close",
  ).length;
  const flagged = (pile: StagedRole[]) =>
    pile.some((role) => problems.has(role.roleId));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Pick what each Discord role becomes. Private channels are readable by
        the Frapp roles theirs map to. Nobody is added to a role.
      </p>

      {lock?.reason === "permission" ? (
        <p className="rounded-lg border border-warning/40 bg-warning-tint p-3 text-sm">
          Mapping a role creates roles and gives them access, which needs
          permission to manage roles. Every role stays on Skip, so you choose
          who can read each private channel yourself.
        </p>
      ) : null}
      {lock?.reason === "unavailable" ? (
        <p className="rounded-lg border border-warning/40 bg-warning-tint p-3 text-sm">
          Frapp could not load your chapter&apos;s roles, so every role stays on
          Skip and you choose who can read each private channel yourself.{" "}
          <button
            type="button"
            onClick={lock.retry}
            className={cn(
              "text-accent-text underline-offset-2 hover:underline",
              FOCUS_RING,
            )}
          >
            Try again
          </button>
        </p>
      ) : null}

      {roles.length === 0 ? (
        <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
          Frapp found no roles to map in this server. Choose who can read each
          private channel on the next step.
        </p>
      ) : (
        <>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>
              <span className="font-semibold text-foreground">
                {counts.existing}
              </span>{" "}
              matched
            </span>
            <span>
              <span className="font-semibold text-foreground">
                {counts.new}
              </span>{" "}
              new roles
            </span>
            <span>
              <span className="font-semibold text-foreground">
                {counts.ignore}
              </span>{" "}
              skipped
            </span>
          </p>

          {piles.access.length > 0 ? (
            <Pile
              pileKey="access"
              title="Open private channels"
              meta={`${piles.access.length} · most channels first`}
              defaultOpen
              forceOpen={flagged(piles.access)}
              roles={piles.access}
              rowProps={rowProps}
              bulk={
                disabled
                  ? null
                  : {
                      onCreate: () => setMany(piles.access, asNew),
                      onSkip: () => setMany(piles.access, asSkip),
                    }
              }
            />
          ) : null}
          {piles.matched.length > 0 ? (
            <Pile
              pileKey="matched"
              title="Match your roles"
              meta={
                closeMatches > 0
                  ? `${piles.matched.length} · ${closeMatches} close match${closeMatches === 1 ? "" : "es"} to check`
                  : `${piles.matched.length}`
              }
              forceOpen={flagged(piles.matched)}
              roles={piles.matched}
              rowProps={rowProps}
              bulk={null}
            />
          ) : null}
          {piles.none.length > 0 ? (
            <Pile
              pileKey="none"
              title="Open no private channel"
              meta={`${piles.none.length}`}
              forceOpen={flagged(piles.none)}
              roles={piles.none}
              rowProps={rowProps}
              bulk={
                disabled
                  ? null
                  : {
                      onCreate: () => setMany(piles.none, asNew),
                      onSkip: () => setMany(piles.none, asSkip),
                    }
              }
            />
          ) : null}

          {selectedRoles.length > 0 && !disabled ? (
            <SelectionBar
              count={selectedRoles.length}
              frappRoles={frappRoles}
              onCreate={() => {
                setMany(selectedRoles, asNew);
                setSelected(new Set());
              }}
              onSkip={() => {
                setMany(selectedRoles, asSkip);
                setSelected(new Set());
              }}
              onMap={(roleId) => {
                setMany(selectedRoles, () => ({ action: "existing", roleId }));
                setSelected(new Set());
              }}
              onClear={() => setSelected(new Set())}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

type RowProps = Parameters<typeof RoleRow>[0];

function Pile({
  pileKey,
  title,
  meta,
  defaultOpen = false,
  forceOpen,
  roles,
  rowProps,
  bulk,
}: {
  pileKey: PileKey;
  title: string;
  meta: string;
  defaultOpen?: boolean;
  /** A row in it has a problem: it opens, so the problem is on screen. */
  forceOpen: boolean;
  roles: StagedRole[];
  rowProps: (role: StagedRole) => RowProps;
  bulk: { onCreate: () => void; onSkip: () => void } | null;
}) {
  const [opened, setOpened] = useState<boolean | null>(null);
  const [all, setAll] = useState(false);
  // A problem keeps the pile open and its row on screen, past the limit too:
  // Continue waits on it, and a hidden reason is no reason.
  const open = forceOpen || (opened ?? defaultOpen);
  const shown = all
    ? roles
    : roles.filter(
        (role, index) =>
          index < PILE_LIMIT || rowProps(role).problems.length > 0,
      );
  const bodyId = `role-pile-${pileKey}`;

  return (
    <section className="rounded-lg border border-border">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
        <button
          type="button"
          onClick={() => setOpened(!open)}
          aria-expanded={open}
          aria-controls={bodyId}
          className={cn(
            "flex min-w-0 flex-1 items-baseline gap-2 text-left",
            FOCUS_RING,
          )}
        >
          <ChevronRight
            className={cn(
              "h-4 w-4 shrink-0 self-center text-muted-foreground transition-transform motion-reduce:transition-none",
              open && "rotate-90",
            )}
            aria-hidden
          />
          <span className="text-sm font-semibold">{title}</span>
          <span className="text-xs text-muted-foreground">{meta}</span>
        </button>
        {bulk ? (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={bulk.onCreate}
              aria-label={`Create every role in ${title} as a new role`}
            >
              Create all
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={bulk.onSkip}
              aria-label={`Skip every role in ${title}`}
            >
              Skip all
            </Button>
          </div>
        ) : null}
      </div>
      {open ? (
        <div id={bodyId} className="border-t border-border">
          <ul>
            {shown.map((role) => (
              <RoleRow key={role.roleId} {...rowProps(role)} />
            ))}
          </ul>
          {all || shown.length < roles.length ? (
            <button
              type="button"
              onClick={() => setAll(!all)}
              className={cn(
                "w-full border-t border-border px-3 py-2 text-left text-sm text-accent-text hover:bg-card-hover",
                FOCUS_RING,
              )}
            >
              {all ? "Show fewer" : `Show ${roles.length - shown.length} more`}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function RoleRow({
  role,
  choice,
  match,
  reads,
  maxReads,
  frappRoles,
  problems,
  disabled,
  selected,
  onSelect,
  onChange,
}: {
  role: StagedRole;
  choice: RoleChoice;
  match: MatchKind;
  reads: number;
  maxReads: number;
  frappRoles: FrappRole[];
  problems: string[];
  disabled: boolean;
  selected: boolean;
  onSelect: () => void;
  onChange: (next: RoleChoice) => void;
}) {
  const value =
    choice.action === "existing"
      ? choice.roleId
      : choice.action === "new"
        ? NEW
        : IGNORE;
  // The name box opens on request, or by itself when the name is a problem.
  const [renaming, setRenaming] = useState(false);
  const showName = choice.action === "new" && (renaming || problems.length > 0);
  const renamed =
    choice.action === "new" && choice.name.trim() !== role.roleName.trim();
  const id = `role-${role.roleId}`;

  return (
    <li
      className={cn(
        "group border-t border-border px-3 py-1 first:border-t-0",
        selected && "bg-popover",
        problems.length > 0 && "bg-warning-tint",
      )}
    >
      <div className="flex items-center gap-3">
        <label className={dashboardCheckboxHitAreaClassName}>
          <input
            type="checkbox"
            className={dashboardTableCheckboxClassName}
            checked={selected}
            disabled={disabled}
            onChange={onSelect}
            aria-label={`Select ${role.roleName}`}
          />
        </label>
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <span id={`${id}-name`} className="truncate font-medium">
            {role.roleName}
          </span>
          {match === "close" ? (
            <Badge variant="outline" className="shrink-0">
              Close match
            </Badge>
          ) : null}
          {renamed ? (
            <span className="truncate text-xs text-muted-foreground">
              as {choice.action === "new" ? choice.name.trim() : ""}
            </span>
          ) : null}
          {choice.action === "new" && !disabled ? (
            <IconButton
              type="button"
              onClick={() => setRenaming(!renaming)}
              label={`Rename the new role for ${role.roleName}`}
              aria-expanded={showName}
              className={cn(
                compactControlClassName,
                "shrink-0 text-muted-foreground",
                // Out of the way until the row is hovered or focused; never
                // hidden from touch, where there is no hover (as RowMenu).
                !showName &&
                  "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100",
              )}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </IconButton>
          ) : null}
        </div>
        <ReadsMeter reads={reads} max={maxReads} />
        <Select
          value={value}
          disabled={disabled}
          onValueChange={(next) => {
            if (next === NEW) {
              onChange({ action: "new", name: role.roleName.trim() });
            } else if (next === IGNORE) {
              onChange({ action: "ignore" });
            } else {
              onChange({ action: "existing", roleId: next });
            }
          }}
        >
          <SelectTrigger
            id={id}
            aria-label={`${role.roleName} becomes`}
            className={cn(
              dashboardToolbarHeightClassName,
              "w-40 shrink-0 text-sm sm:w-48",
              value === IGNORE && "text-muted-foreground",
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NEW}>New role</SelectItem>
            <SelectItem value={IGNORE}>Skip</SelectItem>
            {frappRoles.length > 0 ? (
              <>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Your roles</SelectLabel>
                  {frappRoles.map((frappRole) => (
                    <SelectItem key={frappRole.id} value={frappRole.id}>
                      {frappRole.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </>
            ) : null}
          </SelectContent>
        </Select>
      </div>

      {showName && choice.action === "new" ? (
        <div className="py-1.5 pl-7">
          <Input
            id={`${id}-new-name`}
            aria-label={`New role name for ${role.roleName}`}
            className="h-9 max-w-xs text-sm"
            value={choice.name}
            disabled={disabled}
            onChange={(event) =>
              onChange({ action: "new", name: event.target.value })
            }
          />
        </div>
      ) : null}

      {problems.length > 0 ? (
        <ul className="space-y-0.5 pb-1 pl-7">
          {problems.map((problem) => (
            <li key={problem} className="text-xs text-warning">
              {problem}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** How many private channels a role could read, as a number and a bar. */
function ReadsMeter({ reads, max }: { reads: number; max: number }) {
  const label =
    reads > 0
      ? `Could read ${reads} private channel${reads === 1 ? "" : "s"}`
      : "Could read no private channel";
  return (
    <span
      className="hidden shrink-0 items-center gap-2 text-xs tabular-nums text-muted-foreground sm:flex"
      title={label}
    >
      <span className="sr-only">{label}</span>
      <span
        className={cn("block", meterTrackDenseClassName, "w-14")}
        aria-hidden
      >
        <span
          className={cn("block", meterFillClassName)}
          style={{
            width: `${reads > 0 ? Math.max(6, Math.round((reads / max) * 100)) : 0}%`,
          }}
        />
      </span>
      <span className="w-6 text-right" aria-hidden>
        {reads > 0 ? reads : "–"}
      </span>
    </span>
  );
}

/** One bar for every ticked row, pinned to the bottom while any is ticked. */
function SelectionBar({
  count,
  frappRoles,
  onCreate,
  onSkip,
  onMap,
  onClear,
}: {
  count: number;
  frappRoles: FrappRole[];
  onCreate: () => void;
  onSkip: () => void;
  onMap: (roleId: string) => void;
  onClear: () => void;
}) {
  return (
    <div
      role="region"
      aria-label="Selected roles"
      className="sticky bottom-4 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-popover p-2 pl-3 shadow-lg"
    >
      <span className="text-sm font-semibold">{count} selected</span>
      <span className="flex-1" />
      <Button size="sm" variant="secondary" onClick={onCreate}>
        Create as new roles
      </Button>
      {frappRoles.length > 0 ? (
        // Always reads "Map to…": a pick acts on the rows and clears the
        // selection, which unmounts this bar.
        <Select value="" onValueChange={onMap}>
          <SelectTrigger
            aria-label="Map the selected roles to"
            className={cn(
              dashboardToolbarHeightClassName,
              "w-auto gap-2 text-sm",
            )}
          >
            <SelectValue placeholder="Map to…" />
          </SelectTrigger>
          <SelectContent>
            {frappRoles.map((frappRole) => (
              <SelectItem key={frappRole.id} value={frappRole.id}>
                {frappRole.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <Button size="sm" variant="secondary" onClick={onSkip}>
        Skip
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}
