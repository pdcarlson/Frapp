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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { guardIntDraft, parseGuardedInt } from "@/lib/utils";
import { intDraftRefusal } from "./int-draft-refusal";
import type { OrgWorkflow } from "@repo/hooks";

type WorkflowDraft = {
  key: string;
  label: string;
  enabled: boolean;
  /** The text the threshold input shows; `undefined` when the catalog gives none. */
  threshold?: string;
  units?: string;
};

function toDrafts(workflows: OrgWorkflow[]): WorkflowDraft[] {
  return workflows.map((wf) => ({
    ...wf,
    threshold:
      typeof wf.threshold === "number" ? String(wf.threshold) : undefined,
  }));
}

type Props = {
  /** Merged workflow catalog (seed defaults overlaid with chapter overrides). */
  workflows: OrgWorkflow[];
  /** Whether the caller holds `chapter-config:manage`. */
  canManage: boolean;
  /** Persist the full workflow array through `usePatchOrgConfig`. */
  onSave: (
    workflows: Array<{ key: string; enabled: boolean; threshold?: number }>,
  ) => void;
  isSaving?: boolean;
};

/** A workflow exposes a threshold input only when the catalog gives it one. */
function hasThreshold(workflow: WorkflowDraft): boolean {
  return workflow.units != null || workflow.threshold !== undefined;
}

/**
 * Settings → Workflows. A toggle list over the chapter's `chapter_workflows`,
 * each enabled workflow optionally carrying a numeric threshold. Edits are held
 * locally and committed with one save, which writes a `chapter_audit_log` row
 * (mirrored to `#chapter-audit`). Threshold inputs hold a text draft
 * (`guardIntDraft`): a decimal or negative keeps the previous text, a field can
 * be emptied mid-edit, and an enabled workflow's empty threshold is refused at
 * save by name rather than sent (#3050).
 */
export function SettingsWorkflowsTab({
  workflows,
  canManage,
  onSave,
  isSaving,
}: Props) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<WorkflowDraft[]>(() =>
    toDrafts(workflows),
  );

  // Reconcile local draft when the server config changes (e.g. after a save
  // settles and the query refetches). Skip the optimistic-update payload: it
  // briefly holds the partial PATCH body ({key,enabled,threshold}) without the
  // catalog's label/units, which would blank the rows until the refetch lands.
  // The local draft already mirrors what was saved, so leaving it is correct.
  useEffect(() => {
    if (workflows.some((wf) => wf.label === undefined)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-seed workflow drafts after a save refetch; skip the partial optimistic payload
    setDraft(toDrafts(workflows));
  }, [workflows]);

  function setEnabled(key: string, enabled: boolean) {
    setDraft((prev) =>
      prev.map((wf) => (wf.key === key ? { ...wf, enabled } : wf)),
    );
  }

  function setThreshold(key: string, raw: string) {
    const next = guardIntDraft(raw);
    if (next === undefined) return;
    setDraft((prev) =>
      prev.map((wf) => (wf.key === key ? { ...wf, threshold: next } : wf)),
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Only a shown threshold is checked. A disabled workflow's input is
    // hidden, so an emptied one is left out of the save, as before.
    for (const wf of draft) {
      if (!wf.enabled || wf.threshold === undefined) continue;
      // Catalog labels can end in "threshold" already, so the label is quoted.
      const refusal = intDraftRefusal(
        wf.threshold,
        0,
        `The threshold for “${wf.label}”`,
      );
      if (refusal) {
        toast({ ...refusal, variant: "destructive" });
        return;
      }
    }
    onSave(
      draft.map((wf) => {
        const threshold =
          wf.threshold === undefined
            ? undefined
            : parseGuardedInt(wf.threshold);
        return {
          key: wf.key,
          enabled: wf.enabled,
          ...(threshold !== undefined ? { threshold } : {}),
        };
      }),
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workflows</CardTitle>
        <CardDescription>
          Enable the approvals and enforcement rules your chapter runs on. Each
          enabled workflow can carry a numeric threshold. Saving writes an entry
          to the chapter audit log.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent>
          <ul className="divide-y divide-border rounded-md border border-border">
            {draft.map((wf) => (
              <li key={wf.key} className="flex items-start gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium">{wf.label}</span>
                  {wf.enabled && hasThreshold(wf) ? (
                    <div className="mt-2 flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        aria-label={`${wf.label} threshold`}
                        value={wf.threshold ?? ""}
                        disabled={!canManage || isSaving}
                        onChange={(event) =>
                          setThreshold(wf.key, event.target.value)
                        }
                        className="max-w-28"
                      />
                      {wf.units ? (
                        <span className="text-xs text-muted-foreground">
                          {wf.units}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center pt-0.5">
                  <Switch
                    checked={wf.enabled}
                    disabled={!canManage || isSaving}
                    onCheckedChange={(next) => setEnabled(wf.key, next)}
                    aria-label={`${wf.label} enabled`}
                  />
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
        <CardFooter className="flex justify-end">
          <Button type="submit" disabled={!canManage || isSaving}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save workflows
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
