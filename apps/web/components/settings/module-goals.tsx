"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import {
  GOAL_ROLE_LIMIT,
  GOAL_TARGET_MAX,
  type GoalMetric,
} from "@repo/validation";
import {
  errorCopy,
  useChapterGoals,
  useRoles,
  useSetChapterGoals,
  type GoalSet,
} from "@repo/hooks";
import { matchesWordStarts, normalizeWords } from "@repo/hooks/fuzzy-match";
import { ProfileSection } from "@/components/profile/profile-section";
import {
  NumberRule,
  RulesList,
  SaveRow,
  readBounded,
} from "@/components/settings/module-rules";
import { FOCUS_RING } from "@/components/ui/focus";
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
import { useToast } from "@/lib/hooks/use-toast";
import { toRoleOptions, type RoleOption } from "@repo/hooks/chapter-roles";
import { cn } from "@/lib/utils";

/**
 * A module page's Goals block (#1062): what the chapter holds each member to,
 * so Activity's "This semester" block can draw a bar toward it. Points sets a
 * points goal for the semester; Service hours sets a service goal for the
 * semester and a study goal for the week.
 *
 * Each measure has one goal for everyone and, below it, any role set apart
 * with its own (pledges owing more study hours, say). That is how chapter
 * tools already hold members to requirements: GreekTrack and OmegaFi set a
 * requirement per member status, and Discord's role overrides are the
 * pattern for "everyone, except these roles". A member holding several roles
 * set apart answers to their highest-ranked one, as on the Roles page.
 *
 * Numbers validate on save or leaving the field, not per keystroke (Paul,
 * 2026-11-06). Hours are whole hours; the API stores minutes.
 */

const METRIC_COPY: Record<
  GoalMetric,
  { label: string; hint: string; suffix: string; save: string; saved: string }
> = {
  points: {
    label: "Points goal",
    hint: "Points each member works toward this semester. Leave it empty for no goal.",
    suffix: "points",
    save: "Save points goal",
    saved: "Points goal saved",
  },
  service: {
    label: "Service hours goal",
    hint: "Approved service hours each member works toward this semester. Leave it empty for no goal.",
    suffix: "hours",
    save: "Save service goal",
    saved: "Service hours goal saved",
  },
  study: {
    label: "Study hours goal",
    hint: "Study hours each member works toward each week, Sunday to Saturday. Leave it empty for no goal.",
    suffix: "hours a week",
    save: "Save study goal",
    saved: "Study hours goal saved",
  },
};

/** Points are stored as points; hours as minutes and typed as whole hours. */
const perUnit = (metric: GoalMetric) => (metric === "points" ? 1 : 60);
const toDraft = (metric: GoalMetric, stored: number | null) =>
  stored === null ? "" : String(Math.round(stored / perUnit(metric)));
const maxDraft = (metric: GoalMetric) =>
  Math.floor(GOAL_TARGET_MAX[metric] / perUnit(metric));

type RoleDraft = { role_id: string; draft: string };

export function ModuleGoals({
  metrics,
  canManage,
}: {
  metrics: readonly GoalMetric[];
  canManage: boolean;
}) {
  const goals = useChapterGoals();
  const roles = useRoles();
  const roleOptions = toRoleOptions(roles.data);

  return (
    <ProfileSection
      id={`settings-module-${metrics[0]}-goals`}
      title="Goals"
      hint="Each member sees a bar toward their goal at the top of Activity. Set a different goal for a role, and a member holding several answers to their highest-ranked one."
    >
      {goals.isPending || roles.isPending ? (
        <p className="text-caption text-muted-foreground">Loading goals</p>
      ) : goals.isError || roles.isError ? (
        <p className="text-caption text-muted-foreground">
          {`Goals couldn't load. ${errorCopy(goals.error ?? roles.error)}`}
        </p>
      ) : (
        <div className="space-y-6">
          {metrics.map((metric) => (
            <GoalForm
              key={metric}
              metric={metric}
              saved={goals.data[metric]}
              roleOptions={roleOptions}
              canManage={canManage}
            />
          ))}
        </div>
      )}
      {!canManage ? (
        <p className="text-caption text-muted-foreground">
          Your role can&apos;t change these.
        </p>
      ) : null}
    </ProfileSection>
  );
}

function GoalForm({
  metric,
  saved,
  roleOptions,
  canManage,
}: {
  metric: GoalMetric;
  saved: GoalSet;
  roleOptions: readonly RoleOption[];
  canManage: boolean;
}) {
  const copy = METRIC_COPY[metric];
  const save = useSetChapterGoals(metric);
  const { toast } = useToast();
  const savedKey = JSON.stringify(saved);

  const [everyone, setEveryone] = useState(toDraft(metric, saved.everyone));
  const [rows, setRows] = useState<RoleDraft[]>(() => seedRows(metric, saved));
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-seed the drafts when the saved goals change
    setEveryone(toDraft(metric, saved.everyone));
    setRows(seedRows(metric, saved));
    setErrors({});
    // `savedKey` stands for `saved`, which is a new object on every read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, savedKey]);

  const nameOf = new Map(roleOptions.map((role) => [role.id, role.name]));
  const max = maxDraft(metric);

  /**
   * A target as typed. Empty is "no goal": for everyone, or for a role set
   * apart to be held to none (alumni, say, while everyone else owes hours).
   */
  function check(key: string, draft: string) {
    if (draft.trim() === "") {
      setErrors((prev) => ({ ...prev, [key]: undefined }));
      return { value: null };
    }
    const next = readBounded(draft, 1, max);
    setErrors((prev) => ({
      ...prev,
      [key]: "error" in next ? next.error : undefined,
    }));
    return "value" in next ? { value: next.value } : undefined;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const all = check("everyone", everyone);
    const roleTargets = rows.map((row) => ({
      role_id: row.role_id,
      checked: check(row.role_id, row.draft),
    }));
    if (!all || roleTargets.some((row) => !row.checked)) return;
    const unit = perUnit(metric);
    const stored = (value: number | null) =>
      value === null ? null : value * unit;
    const body: GoalSet = {
      everyone: stored(all.value),
      roles: roleTargets.map((row) => ({
        role_id: row.role_id,
        target: stored(row.checked!.value),
      })),
    };
    save.mutate(body, {
      onSuccess: () => toast({ title: copy.saved }),
      onError: (error) =>
        toast({
          title: `Couldn't save the ${copy.label.toLowerCase()}`,
          description: errorCopy(error),
          variant: "destructive",
        }),
    });
  }

  const dirty =
    everyone !== toDraft(metric, saved.everyone) ||
    JSON.stringify(rows) !== JSON.stringify(seedRows(metric, saved));
  const disabled = !canManage || save.isPending;
  const unset = roleOptions.filter(
    (role) => !rows.some((row) => row.role_id === role.id),
  );

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <RulesList>
        <NumberRule
          label={copy.label}
          hint={copy.hint}
          suffix={copy.suffix}
          draft={everyone}
          onDraft={setEveryone}
          onBlur={() => void check("everyone", everyone)}
          error={errors.everyone}
          disabled={disabled}
        />
        {rows.map((row) => {
          const name = nameOf.get(row.role_id) ?? "Removed role";
          return (
            <div key={row.role_id} className="relative">
              <NumberRule
                label={name}
                hint={`Members who hold ${name} work toward this instead. Leave it empty to hold them to no goal.`}
                suffix={copy.suffix}
                draft={row.draft}
                onDraft={(draft) =>
                  setRows((prev) =>
                    prev.map((r) =>
                      r.role_id === row.role_id ? { ...r, draft } : r,
                    ),
                  )
                }
                onBlur={() => void check(row.role_id, row.draft)}
                error={errors[row.role_id]}
                disabled={disabled}
              />
              {canManage ? (
                <button
                  type="button"
                  onClick={() =>
                    setRows((prev) =>
                      prev.filter((r) => r.role_id !== row.role_id),
                    )
                  }
                  disabled={disabled}
                  aria-label={`Remove ${name}'s own ${copy.label.toLowerCase()}`}
                  className={cn(
                    "absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-card-hover hover:text-foreground disabled:pointer-events-none",
                    FOCUS_RING,
                  )}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
            </div>
          );
        })}
      </RulesList>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {canManage && unset.length > 0 && rows.length < GOAL_ROLE_LIMIT ? (
          <AddRoleGoal
            label={copy.label}
            roles={unset}
            disabled={disabled}
            onAdd={(role) =>
              setRows((prev) => [...prev, { role_id: role.id, draft: "" }])
            }
          />
        ) : (
          <span />
        )}
        <SaveRow
          dirty={dirty}
          saving={save.isPending}
          disabled={!canManage}
          label={copy.save}
        />
      </div>
    </form>
  );
}

function seedRows(metric: GoalMetric, saved: GoalSet): RoleDraft[] {
  return saved.roles.map((goal) => ({
    role_id: goal.role_id,
    draft: toDraft(metric, goal.target),
  }));
}

/**
 * "Different goal for a role": a filterable list of the roles without one,
 * filterable because a chapter imported from Discord can carry a hundred
 * roles (the same picker as "Who can").
 */
function AddRoleGoal({
  label,
  roles,
  disabled,
  onAdd,
}: {
  label: string;
  roles: readonly RoleOption[];
  disabled: boolean;
  onAdd: (role: RoleOption) => void;
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
          disabled={disabled}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-border px-3 text-sm text-muted-foreground hover:border-input hover:text-foreground disabled:pointer-events-none",
            FOCUS_RING,
          )}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Different goal for a role
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
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
          label={`Role for a different ${label.toLowerCase()}`}
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
                Nothing matches “{query.trim()}”.
              </p>
            ) : (
              shown.map((role) => (
                <CommandItem
                  key={role.id}
                  value={role.id}
                  className="min-h-8 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base"
                  onSelect={() => {
                    onAdd(role);
                    close();
                  }}
                >
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
