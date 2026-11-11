"use client";

import {
  useEffect,
  useId,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ADJUSTMENT_RATE_LIMIT_MAX,
  CHAPTER_POINTS_CONFIG_DEFAULTS,
  POINTS_ADJUSTMENT_MAX,
  SERVICE_MINUTES_PER_POINT_DEFAULT,
  servicePointsForDuration,
  type PatchChapterConfig,
} from "@repo/validation";
import type { OrgPoints, OrgWorkflow } from "@repo/hooks";
import { ProfileSection } from "@/components/profile/profile-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { guardIntDraft, parseGuardedInt } from "@/lib/utils";

/**
 * The Rules block of a module page (#4073): only settings that are stored and
 * read. Service hours has its point rate (`chapter_service_config`) and the
 * proof switch (`wf_hours_receipt`); Points has its two anti-fraud limits
 * (`chapter_points_config`). Neither had a web control before: the rate and
 * limits were API-only, and the proof switch sat in a Workflows list beside
 * seven switches nothing read (#3439).
 *
 * Numbers validate when the officer saves or leaves the field, not on every
 * keystroke (Paul, 2026-11-06), and say what is wrong under the field.
 * A switch saves the moment it flips, like Privacy's.
 */

type Patch = (diff: PatchChapterConfig, successTitle: string) => Promise<void>;

/** A bounded whole number as typed, or the sentence saying why it isn't one. */
function readBounded(
  draft: string,
  min: number,
  max: number,
): { value: number } | { error: string } {
  const value = parseGuardedInt(draft, min);
  if (draft.trim() === "") return { error: "Enter a number." };
  if (value === undefined) return { error: `Use a whole number from ${min}.` };
  if (value > max) {
    return { error: `Use ${max.toLocaleString("en-US")} or less.` };
  }
  return { value };
}

function NumberRule({
  label,
  hint,
  suffix,
  draft,
  onDraft,
  error,
  onBlur,
  disabled,
  example,
}: {
  label: string;
  hint: ReactNode;
  suffix: string;
  draft: string;
  onDraft: (next: string) => void;
  error?: string;
  onBlur?: () => void;
  disabled: boolean;
  /** One line saying what the number means for a real member. */
  example?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
      <div className="min-w-0 space-y-0.5">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        <p className="text-caption text-muted-foreground">{hint}</p>
        {example ? (
          <p className="text-caption text-muted-foreground">{example}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
        <div className="flex items-center gap-2">
          <Input
            id={id}
            inputMode="numeric"
            value={draft}
            onChange={(event) => {
              const next = guardIntDraft(event.target.value);
              if (next !== undefined) onDraft(next);
            }}
            onBlur={onBlur}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className="w-24 text-right tabular-nums"
          />
          <span className="w-16 text-sm text-muted-foreground">{suffix}</span>
        </div>
        {error ? (
          <p id={`${id}-error`} className="text-caption text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SwitchRule({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-8 px-4 py-4">
      <div className="min-w-0 space-y-0.5">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        <p className="text-caption text-muted-foreground">{hint}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}

function RulesList({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border rounded-[14px] border border-border">
      {children}
    </div>
  );
}

function SaveRow({
  dirty,
  saving,
  disabled,
  label,
}: {
  dirty: boolean;
  saving: boolean;
  disabled: boolean;
  label: string;
}) {
  if (disabled) return null;
  return (
    <div className="flex justify-end">
      <Button type="submit" disabled={!dirty || saving}>
        {saving ? "Saving" : label}
      </Button>
    </div>
  );
}

function workflowEnabled(
  workflows: readonly OrgWorkflow[],
  key: string,
): boolean {
  return workflows.find((wf) => wf.key === key)?.enabled === true;
}

function hoursForPoints(points: number, minutesPerPoint: number): string {
  const hours = (points * minutesPerPoint) / 60;
  const shown = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  return `${shown} ${hours === 1 ? "hour" : "hours"}`;
}

/** Service hours → Rules: the point rate and the proof switch. */
export function ServiceHoursRules({
  minutesPerPoint,
  workflows,
  canManage,
  savingRate,
  savingWorkflows,
  onPatch,
}: {
  minutesPerPoint: number | undefined;
  workflows: readonly OrgWorkflow[];
  canManage: boolean;
  savingRate: boolean;
  savingWorkflows: boolean;
  onPatch: Patch;
}) {
  const saved = minutesPerPoint ?? SERVICE_MINUTES_PER_POINT_DEFAULT;
  const [draft, setDraft] = useState(String(saved));
  const [error, setError] = useState<string>();
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-seed the rate draft when the saved rate changes
    setDraft(String(saved));
    setError(undefined);
  }, [saved]);

  const read = readBounded(draft, 1, POINTS_ADJUSTMENT_MAX);
  const rate = "value" in read ? read.value : saved;
  const shiftPoints = servicePointsForDuration(180, rate);

  function check(): number | undefined {
    const next = readBounded(draft, 1, POINTS_ADJUSTMENT_MAX);
    if ("error" in next) {
      setError(next.error);
      return undefined;
    }
    setError(undefined);
    return next.value;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = check();
    if (value === undefined || value === saved) return;
    void onPatch({ service: { minutes_per_point: value } }, "Point rate saved");
  }

  const proof = workflowEnabled(workflows, "wf_hours_receipt");
  const hasProofWorkflow = workflows.some(
    (wf) => wf.key === "wf_hours_receipt",
  );

  return (
    <ProfileSection
      id="settings-module-hours-rules"
      title="Rules"
      hint="Changes are written to the chapter audit log."
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <RulesList>
          <NumberRule
            label="Minutes of service per point"
            hint="Approved service earns points at this rate. Entries already approved keep what they earned."
            suffix="minutes"
            draft={draft}
            onDraft={setDraft}
            onBlur={() => void check()}
            error={error}
            disabled={!canManage || savingRate}
            example={
              <>
                A 3-hour volunteer shift earns{" "}
                {shiftPoints.toLocaleString("en-US")}{" "}
                {shiftPoints === 1 ? "point" : "points"}, and 10 points take{" "}
                {hoursForPoints(10, rate)}.
              </>
            }
          />
          {hasProofWorkflow ? (
            <SwitchRule
              label="Ask for proof"
              hint="Members attach a photo or a signed slip when they log service. The officer approving it sees it."
              checked={proof}
              disabled={!canManage || savingWorkflows}
              onChange={(enabled) =>
                void onPatch(
                  { workflows: [{ key: "wf_hours_receipt", enabled }] },
                  enabled ? "Proof is now required" : "Proof is now optional",
                )
              }
            />
          ) : null}
        </RulesList>
        <SaveRow
          dirty={draft !== String(saved)}
          saving={savingRate}
          disabled={!canManage}
          label="Save rate"
        />
      </form>
      {!canManage ? (
        <p className="text-caption text-muted-foreground">
          Your role can&apos;t change these.
        </p>
      ) : null}
    </ProfileSection>
  );
}

/** Points → Rules: the two anti-fraud limits on manual adjustments. */
export function PointsRules({
  points,
  canManage,
  saving,
  onPatch,
}: {
  points: OrgPoints | undefined;
  canManage: boolean;
  saving: boolean;
  onPatch: Patch;
}) {
  const saved = points ?? CHAPTER_POINTS_CONFIG_DEFAULTS;
  const [rateDraft, setRateDraft] = useState(
    String(saved.adjustment_rate_limit_per_hour),
  );
  const [flagDraft, setFlagDraft] = useState(String(saved.anomaly_threshold));
  const [rateError, setRateError] = useState<string>();
  const [flagError, setFlagError] = useState<string>();
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-seed the drafts when the saved limits change
    setRateDraft(String(saved.adjustment_rate_limit_per_hour));
    setFlagDraft(String(saved.anomaly_threshold));
    setRateError(undefined);
    setFlagError(undefined);
  }, [saved.adjustment_rate_limit_per_hour, saved.anomaly_threshold]);

  function checkRate(): number | undefined {
    const next = readBounded(rateDraft, 1, ADJUSTMENT_RATE_LIMIT_MAX);
    setRateError("error" in next ? next.error : undefined);
    return "value" in next ? next.value : undefined;
  }
  function checkFlag(): number | undefined {
    const next = readBounded(flagDraft, 1, POINTS_ADJUSTMENT_MAX);
    setFlagError("error" in next ? next.error : undefined);
    return "value" in next ? next.value : undefined;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const rate = checkRate();
    const flag = checkFlag();
    if (rate === undefined || flag === undefined) return;
    void onPatch(
      {
        points: {
          adjustment_rate_limit_per_hour: rate,
          anomaly_threshold: flag,
        },
      },
      "Points limits saved",
    );
  }

  const dirty =
    rateDraft !== String(saved.adjustment_rate_limit_per_hour) ||
    flagDraft !== String(saved.anomaly_threshold);
  const disabled = !canManage || saving;

  return (
    <ProfileSection
      id="settings-module-points-rules"
      title="Rules"
      hint="Limits on officers adding or taking points by hand. Points from events, tasks and service aren't limited. Changes are written to the chapter audit log."
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <RulesList>
          <NumberRule
            label="Adjustments per officer each hour"
            hint="Past this, an officer's next adjustment is refused until the hour is up. It keeps a slip, or someone using an officer's account, from rewriting the board."
            suffix="an hour"
            draft={rateDraft}
            onDraft={setRateDraft}
            onBlur={() => void checkRate()}
            error={rateError}
            disabled={disabled}
          />
          <NumberRule
            label="Flag adjustments of"
            hint="An adjustment this size or bigger, up or down, is flagged in Points under Audit for another officer to look at. It still goes through."
            suffix="points"
            draft={flagDraft}
            onDraft={setFlagDraft}
            onBlur={() => void checkFlag()}
            error={flagError}
            disabled={disabled}
          />
        </RulesList>
        <SaveRow
          dirty={dirty}
          saving={saving}
          disabled={!canManage}
          label="Save limits"
        />
      </form>
      {!canManage ? (
        <p className="text-caption text-muted-foreground">
          Your role can&apos;t change these.
        </p>
      ) : null}
    </ProfileSection>
  );
}

/**
 * Dues → the grace period (`wf_dues_grace`): whether an unpaid invoice gets
 * one, and how many days. This workflow's threshold is the grace period
 * `GET /invoices/overdue` applies; the Dues form's own `grace_days` is not
 * read (`customization.md` § Workflows, the duplicate is in the backlog).
 */
export function DuesGraceRule({
  workflows,
  canManage,
  saving,
  onPatch,
}: {
  workflows: readonly OrgWorkflow[];
  canManage: boolean;
  saving: boolean;
  onPatch: Patch;
}) {
  const workflow = workflows.find((wf) => wf.key === "wf_dues_grace");
  const savedDays = workflow?.threshold ?? 7;
  const [draft, setDraft] = useState(String(savedDays));
  const [error, setError] = useState<string>();
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-seed the days draft when the saved grace period changes
    setDraft(String(savedDays));
    setError(undefined);
  }, [savedDays]);
  if (!workflow) return null;
  const enabled = workflow.enabled;
  const disabled = !canManage || saving;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = readBounded(draft, 0, 365);
    if ("error" in next) {
      setError(next.error);
      return;
    }
    setError(undefined);
    void onPatch(
      { workflows: [{ key: "wf_dues_grace", enabled, threshold: next.value }] },
      "Grace period saved",
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <RulesList>
        <SwitchRule
          label="Grace period before late"
          hint="Off, an unpaid invoice is late the day after it's due."
          checked={enabled}
          disabled={disabled}
          onChange={(next) =>
            void onPatch(
              { workflows: [{ key: "wf_dues_grace", enabled: next }] },
              next ? "Grace period on" : "Grace period off",
            )
          }
        />
        {enabled ? (
          <NumberRule
            label="Grace period"
            hint="Days after the due date before an unpaid invoice is late."
            suffix="days"
            draft={draft}
            onDraft={setDraft}
            error={error}
            disabled={disabled}
          />
        ) : null}
      </RulesList>
      {enabled ? (
        <SaveRow
          dirty={draft !== String(savedDays)}
          saving={saving}
          disabled={!canManage}
          label="Save grace period"
        />
      ) : null}
    </form>
  );
}
