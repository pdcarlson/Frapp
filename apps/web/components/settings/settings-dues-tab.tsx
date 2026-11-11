"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProfileSection } from "@/components/profile/profile-section";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/lib/hooks/use-toast";
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

const CADENCE_OPTIONS: ReadonlyArray<{
  value: OrgDues["cadence"];
  label: string;
}> = [
  { value: "monthly", label: "Monthly" },
  { value: "per_semester", label: "Per semester" },
  { value: "per_quarter", label: "Per quarter" },
];

/** Cents-valued fields shown as plain integer inputs (amounts are stored in cents). */
function centsFieldsFor(
  pledgeTerm: string,
): ReadonlyArray<{ key: CentsKey; label: string }> {
  return [
    { key: "active_amount_cents", label: "Active member dues" },
    { key: "new_member_amount_cents", label: `${pledgeTerm} dues` },
    { key: "alumni_amount_cents", label: "Alumni dues" },
    { key: "late_fee_cents", label: "Late fee" },
    { key: "scholarship_pool_cents", label: "Scholarship pool" },
  ];
}

/*
 * Amounts are typed in dollars and stored in cents, as the invoice form
 * already took them. They used to be typed in cents ("85000" for $850), which
 * asked an officer to do the conversion the screen should.
 */
const DOLLAR_DRAFT = /^\d*(?:\.\d{0,2})?$/;

/** `"850"` for 85000, `"42.50"` for 4250. */
function dollarsDraft(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** Whole cents for a dollar draft, or `undefined` when it isn't an amount yet. */
function parseDollars(draft: string): number | undefined {
  const trimmed = draft.trim();
  if (trimmed === "" || trimmed === "." || !DOLLAR_DRAFT.test(trimmed)) {
    return undefined;
  }
  return Math.round(Number(trimmed) * 100);
}

type CentsKey =
  | "active_amount_cents"
  | "new_member_amount_cents"
  | "alumni_amount_cents"
  | "late_fee_cents"
  | "scholarship_pool_cents";
type CountKey = "grace_days" | "installment_count";
type NumberKey = CentsKey | CountKey;

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

const CENTS_KEYS: readonly CentsKey[] = [
  "active_amount_cents",
  "new_member_amount_cents",
  "alumni_amount_cents",
  "late_fee_cents",
  "scholarship_pool_cents",
];

function toDraft(dues: OrgDues): DuesDraft {
  const draft = { ...dues } as unknown as DuesDraft;
  for (const key of NUMBER_KEYS) {
    draft[key] = (CENTS_KEYS as readonly string[]).includes(key)
      ? dollarsDraft(dues[key])
      : String(dues[key]);
  }
  return draft;
}

/**
 * Settings → Dues. Edits the chapter's singleton `chapter_dues_config` row:
 * cadence, per-class amounts, an optional installment plan, grace period, late
 * fee, and scholarship pool. Edits are held locally and committed with one save,
 * which writes a `chapter_audit_log` row (mirrored to `#chapter-audit`).
 *
 * Every numeric input holds a text draft, and a field can be emptied mid-edit.
 * Amounts are typed in dollars with up to two decimals (`DOLLAR_DRAFT`): a
 * keystroke that can't become an amount ("-", "1.234") keeps the previous
 * text, and save stores whole cents (`parseDollars`). Counts (`guardIntDraft`)
 * refuse a negative or a decimal the same way, and keep the transient "0" left
 * by deleting a leading digit. Save refuses an empty amount, and an empty or
 * under-floor count (days `>= 0`, installment count `>= 1`), by name rather
 * than sending it (#3050).
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

  function setNumber(key: CountKey, raw: string) {
    const next = guardIntDraft(raw);
    if (next === undefined) return;
    setDraft((prev) => ({ ...prev, [key]: next }));
  }

  /** Keeps the last amount through anything that can't become one ("-", "1.234", "abc"). */
  function setDollars(key: CentsKey, raw: string) {
    const next = raw.replace(/^\$/, "").trim();
    if (!DOLLAR_DRAFT.test(next)) return;
    setDraft((prev) => ({ ...prev, [key]: next }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    for (const field of centsFields) {
      if (parseDollars(draft[field.key]) === undefined) {
        toast({
          title: `${field.label} needs an amount`,
          description: "Enter an amount in dollars, like 425 or 42.50.",
          variant: "destructive",
        });
        return;
      }
    }
    const checked: Array<{ key: CountKey; label: string; min: number }> = [
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
    const read = (key: CountKey, min: number) =>
      parseGuardedInt(draft[key], min) ?? dues[key];
    const cents = (key: CentsKey) => parseDollars(draft[key]) ?? dues[key];
    onSave({
      ...draft,
      active_amount_cents: cents("active_amount_cents"),
      new_member_amount_cents: cents("new_member_amount_cents"),
      alumni_amount_cents: cents("alumni_amount_cents"),
      late_fee_cents: cents("late_fee_cents"),
      scholarship_pool_cents: cents("scholarship_pool_cents"),
      grace_days: read("grace_days", 0),
      installment_count: read("installment_count", 1),
    });
  }

  return (
    <ProfileSection
      id="settings-dues"
      title="Dues"
      hint="Saving writes an entry to the chapter audit log."
    >
      {/* noValidate: the browser's own `min` bubble would stop the submit
          before the save check below names the field, as the other tabs do. */}
      <form onSubmit={handleSubmit} noValidate>
        <div className="space-y-4">
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
                <div className="relative">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                  >
                    $
                  </span>
                  <Input
                    id={`dues-${field.key}`}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={draft[field.key]}
                    disabled={disabled}
                    className="pl-7 tabular-nums"
                    onChange={(event) =>
                      setDollars(field.key, event.target.value)
                    }
                  />
                </div>
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
        </div>
        <div className="mt-4 flex justify-end">
          <Button type="submit" disabled={disabled}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save dues
          </Button>
        </div>
      </form>
    </ProfileSection>
  );
}
