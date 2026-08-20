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
};

const CADENCE_OPTIONS: ReadonlyArray<{ value: OrgDues["cadence"]; label: string }> =
  [
    { value: "monthly", label: "Monthly" },
    { value: "per_semester", label: "Per semester" },
    { value: "per_quarter", label: "Per quarter" },
  ];

/** Cents-valued fields shown as plain integer inputs (amounts are stored in cents). */
const CENTS_FIELDS: ReadonlyArray<{ key: keyof OrgDues; label: string }> = [
  { key: "active_amount_cents", label: "Active member dues (cents)" },
  { key: "new_member_amount_cents", label: "New member dues (cents)" },
  { key: "alumni_amount_cents", label: "Alumni dues (cents)" },
  { key: "late_fee_cents", label: "Late fee (cents)" },
  { key: "scholarship_pool_cents", label: "Scholarship pool (cents)" },
];

/**
 * Settings → Dues. Edits the chapter's singleton `chapter_dues_config` row:
 * cadence, per-class amounts, an optional installment plan, grace period, late
 * fee, and scholarship pool. Edits are held locally and committed with one save,
 * which writes a `chapter_audit_log` row (mirrored to `#chapter-audit`).
 *
 * Every numeric input guard-parses: a value is committed only when it parses to
 * a finite integer in range (cents/days `>= 0`; installment count `>= 1`); an
 * invalid, negative, or empty intermediate value keeps the previous value rather
 * than storing `NaN`.
 */
export function SettingsDuesTab({ dues, canManage, onSave, isSaving }: Props) {
  const [draft, setDraft] = useState<OrgDues>(dues);

  // Reconcile the local draft when the server config refetches after a save.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-seed the dues draft when the server config refetches after a save
    setDraft(dues);
  }, [dues]);

  const disabled = !canManage || isSaving;

  function setNumber(key: keyof OrgDues, raw: string, min: number) {
    // Guard-parse: only commit a finite integer >= min. Anything else (empty,
    // negative, decimal, NaN) preserves the previous value. The empty check is
    // explicit because `Number("")` is `0`, not `NaN`.
    const trimmed = raw.trim();
    if (trimmed === "") return;
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < min) return;
    setDraft((prev) => ({ ...prev, [key]: parsed }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(draft);
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
      <form onSubmit={handleSubmit}>
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
            {CENTS_FIELDS.map((field) => (
              <div key={field.key} className="grid gap-1.5">
                <Label htmlFor={`dues-${field.key}`}>{field.label}</Label>
                <Input
                  id={`dues-${field.key}`}
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={draft[field.key] as number}
                  disabled={disabled}
                  onChange={(event) =>
                    setNumber(field.key, event.target.value, 0)
                  }
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
                  setNumber("grace_days", event.target.value, 0)
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
                  setNumber("installment_count", event.target.value, 1)
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
