"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { guardIntDraft, parseGuardedInt } from "@/lib/utils";
import { intDraftRefusal } from "./int-draft-refusal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { OrgDues } from "@repo/hooks";

type Props = {
  /** The chapter's singleton dues config (table defaults when unconfigured). */
  dues: OrgDues;
  /** Whether the caller holds `chapter-config:manage`. */
  canManage: boolean;
  /** Persist the full dues config through `usePatchOrgConfig`. */
  onSave: (dues: OrgDues) => void;
  isSaving?: boolean;
  /**
   * This chapter's term for the pre-promotion role (#351), e.g. "New member"
   * (IFC default), "Aspirant" (NPHC) — labels the amount field below.
   */
  pledgeTerm: string;
};

const CADENCE_OPTIONS: ReadonlyArray<{ value: OrgDues["cadence"]; label: string }> =
  [
    { value: "monthly", label: "Monthly" },
    { value: "per_semester", label: "Per semester" },
    { value: "per_quarter", label: "Per quarter" },
  ];

/** Cents-valued fields shown as plain integer inputs (amounts are stored in cents). */
function centsFieldsFor(
  pledgeTerm: string,
): ReadonlyArray<{ key: CentsKey; label: string }> {
  return [
    { key: "active_amount_cents", label: "Active member dues (cents)" },
    {
      key: "new_member_amount_cents",
      label: `${pledgeTerm} dues (cents)`,
    },
    { key: "alumni_amount_cents", label: "Alumni dues (cents)" },
    { key: "late_fee_cents", label: "Late fee (cents)" },
    { key: "scholarship_pool_cents", label: "Scholarship pool (cents)" },
  ];
}

type CentsKey =
  | "active_amount_cents"
  | "new_member_amount_cents"
  | "alumni_amount_cents"
  | "late_fee_cents"
  | "scholarship_pool_cents";
type NumberKey = CentsKey | "grace_days" | "installment_count";

/** The dues config with every numeric field held as the text the input shows. */
type DuesDraft = Omit<OrgDues, NumberKey> & Record<NumberKey, string>;

const NUMBER_KEYS: readonly NumberKey[] = [
  "active_amount_cents",
  "new_member_amount_cents",
  "alumni_amount_cents",
  "late_fee_cents",
  "scholarship_pool_cents",
  "grace_days",
  "installment_count",
];

function toDraft(dues: OrgDues): DuesDraft {
  const draft = { ...dues } as unknown as DuesDraft;
  for (const key of NUMBER_KEYS) draft[key] = String(dues[key]);
  return draft;
}

/**
 * Settings → Dues. Edits the chapter's singleton `chapter_dues_config` row:
 * cadence, per-class amounts, an optional installment plan, grace period, late
 * fee, and scholarship pool. Edits are held locally and committed with one save,
 * which writes a `chapter_audit_log` row (mirrored to `#chapter-audit`).
 *
 * Every numeric input holds a text draft (`guardIntDraft`): a negative or a
 * decimal keeps the previous text, while a field can be emptied mid-edit and
 * keeps the transient "0" left by deleting a leading digit. Each floor (cents
 * and days `>= 0`, installment count `>= 1`) is checked at save, which refuses
 * an empty or under-floor field by name rather than sending it (#3050).
 */
export function SettingsDuesTab({
  dues,
  canManage,
  onSave,
  isSaving,
  pledgeTerm,
}: Props) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<DuesDraft>(() => toDraft(dues));
  const centsFields = centsFieldsFor(pledgeTerm);

  // Reconcile the local draft when the server config refetches after a save.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-seed the dues draft when the server config refetches after a save
    setDraft(toDraft(dues));
  }, [dues]);

  const disabled = !canManage || isSaving;

  function setNumber(key: NumberKey, raw: string) {
    const next = guardIntDraft(raw);
    if (next === undefined) return;
    setDraft((prev) => ({ ...prev, [key]: next }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked: Array<{ key: NumberKey; label: string; min: number }> = [
      ...centsFields.map((field) => ({ ...field, min: 0 })),
      { key: "grace_days", label: "Grace period (days)", min: 0 },
    ];
    // A hidden count isn't the officer's to fix: with installments off it
    // falls back to the saved value below rather than blocking the save.
    if (draft.installments_allowed) {
      checked.push({
        key: "installment_count",
        label: "Number of installments",
        min: 1,
      });
    }
    for (const field of checked) {
      const refusal = intDraftRefusal(draft[field.key], field.min, field.label);
      if (refusal) {
        toast({ ...refusal, variant: "destructive" });
        return;
      }
    }
    const read = (key: NumberKey, min: number) =>
      parseGuardedInt(draft[key], min) ?? dues[key];
    onSave({
      ...draft,
      active_amount_cents: read("active_amount_cents", 0),
      new_member_amount_cents: read("new_member_amount_cents", 0),
      alumni_amount_cents: read("alumni_amount_cents", 0),
      late_fee_cents: read("late_fee_cents", 0),
      scholarship_pool_cents: read("scholarship_pool_cents", 0),
      grace_days: read("grace_days", 0),
      installment_count: read("installment_count", 1),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dues</CardTitle>
        <CardDescription>
          Set how often dues are billed, the amount each member class owes, and
          optional payment plans. Amounts are in cents. Saving writes an entry to
          the chapter audit log.
        </CardDescription>
      </CardHeader>
      {/* noValidate: the browser's own `min` bubble would stop the submit
          before the save check below names the field, as the other tabs do. */}
      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="dues-cadence">Cadence</Label>
            <Select
              value={draft.cadence}
              disabled={disabled}
              onValueChange={(value) =>
                setDraft((prev) => ({
                  ...prev,
                  cadence: value as OrgDues["cadence"],
                }))
              }
            >
              <SelectTrigger id="dues-cadence" className="max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CADENCE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {centsFields.map((field) => (
              <div key={field.key} className="grid gap-1.5">
                <Label htmlFor={`dues-${field.key}`}>{field.label}</Label>
                <Input
                  id={`dues-${field.key}`}
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={draft[field.key]}
                  disabled={disabled}
                  onChange={(event) => setNumber(field.key, event.target.value)}
                />
              </div>
            ))}
            <div className="grid gap-1.5">
              <Label htmlFor="dues-grace_days">Grace period (days)</Label>
              <Input
                id="dues-grace_days"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={draft.grace_days}
                disabled={disabled}
                onChange={(event) =>
                  setNumber("grace_days", event.target.value)
                }
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border p-4">
            <div className="min-w-0">
              <span className="text-sm font-medium">Allow installments</span>
              <p className="text-xs text-muted-foreground">
                Let members split dues into multiple payments.
              </p>
            </div>
            <Switch
              checked={draft.installments_allowed}
              disabled={disabled}
              onCheckedChange={(next) =>
                setDraft((prev) => ({ ...prev, installments_allowed: next }))
              }
              aria-label="Allow installments"
            />
          </div>
          {draft.installments_allowed ? (
            <div className="grid max-w-xs gap-1.5">
              <Label htmlFor="dues-installment_count">
                Number of installments
              </Label>
              <Input
                id="dues-installment_count"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                aria-label="Number of installments"
                value={draft.installment_count}
                disabled={disabled}
                onChange={(event) =>
                  setNumber("installment_count", event.target.value)
                }
              />
            </div>
          ) : null}
        </CardContent>
        <CardFooter className="flex justify-end">
          <Button type="submit" disabled={disabled}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save dues
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
