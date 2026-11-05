"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import {
  useDepartments,
  useMergeDepartments,
  useMergeProfessors,
  useProfessors,
  useUpdateDepartment,
  useUpdateProfessor,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useSubscriptionGate,
  type SubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useToast } from "@/lib/hooks/use-toast";
import { asArray, getErrorMessage } from "@/lib/utils";

export type TaxonomyEntity = "department" | "professor";

type Department = { id: string; code: string; name: string | null };
type Professor = { id: string; name: string };
type Target = { entity: TaxonomyEntity; id: string; label: string };
type RenameTarget = Target & { current: string };

/**
 * Rename and merge for one Backwork department or professor, as dialogs any
 * surface can open: the `/backwork` row menu ("Rename Bram…", "Merge COGS
 * into…") and the clean-up drawer both call these, so the two paths share one
 * dialog and one set of toasts.
 *
 * A department's rename sets its full name (`PATCH` takes only `name`); its
 * code is what members typed on upload and stays as the row's label.
 *
 * Rename and merge are paid-ops writes: each dialog's submit spreads the
 * subscription gate, so a chapter that lapses while one is open cannot send it.
 * The page's `SubscriptionNotice` explains the disabled control.
 *
 * Delete is not offered here. From a row it would always fail, since that row
 * still references the entry; the drawer keeps delete for unused entries.
 */
export function useBackworkTaxonomyActions(pageGate?: SubscriptionGate): {
  requestRename: (target: RenameTarget) => void;
  requestMerge: (target: Target) => void;
  dialogs: ReactNode;
} {
  const { toast } = useToast();
  // The page's gate when it passes one, so `aria-describedby` names the
  // notice the page renders; a gate of its own otherwise.
  const ownGate = useSubscriptionGate();
  const gate = pageGate ?? ownGate;
  const departmentsQuery = useDepartments();
  const professorsQuery = useProfessors();
  const departments = useMemo(
    () => asArray<Department>(departmentsQuery.data),
    [departmentsQuery.data],
  );
  const professors = useMemo(
    () => asArray<Professor>(professorsQuery.data),
    [professorsQuery.data],
  );
  const updateDepartment = useUpdateDepartment();
  const updateProfessor = useUpdateProfessor();
  const mergeDepartments = useMergeDepartments();
  const mergeProfessors = useMergeProfessors();

  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  // The last target, kept after close: Radix keeps the content mounted for
  // its exit animation, and a title built from `null` would read
  // "Rename undefined" as it fades.
  const [renameShown, setRenameShown] = useState<RenameTarget | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);

  const [mergeTarget, setMergeTarget] = useState<Target | null>(null);
  const [mergeShown, setMergeShown] = useState<Target | null>(null);
  const [mergeSelection, setMergeSelection] = useState("");
  const [merging, setMerging] = useState(false);

  function requestRename(target: RenameTarget) {
    setRenameTarget(target);
    setRenameShown(target);
    setRenameDraft(target.current);
  }

  function requestMerge(target: Target) {
    setMergeTarget(target);
    setMergeShown(target);
    setMergeSelection("");
  }

  async function submitRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renameTarget || !gate.allowed) return;
    const name = renameDraft.trim();
    if (!name || name === renameTarget.current) {
      setRenameTarget(null);
      return;
    }
    setRenaming(true);
    try {
      if (renameTarget.entity === "department") {
        await updateDepartment.mutateAsync({
          id: renameTarget.id,
          body: { name },
        });
      } else {
        await updateProfessor.mutateAsync({ id: renameTarget.id, body: { name } });
      }
      toast({ title: `Saved "${name}"` });
      setRenameTarget(null);
    } catch (error) {
      toast({
        title: "Unable to rename",
        description: getErrorMessage(error, "Something went wrong."),
        variant: "destructive",
      });
    } finally {
      setRenaming(false);
    }
  }

  async function submitMerge() {
    if (!mergeTarget || !mergeSelection || !gate.allowed) return;
    setMerging(true);
    try {
      const result =
        mergeTarget.entity === "department"
          ? await mergeDepartments.mutateAsync({
              id: mergeTarget.id,
              targetId: mergeSelection,
            })
          : await mergeProfessors.mutateAsync({
              id: mergeTarget.id,
              targetId: mergeSelection,
            });
      toast({
        title: `Merged "${mergeTarget.label}"`,
        description: `${result.reassigned} resource(s) reassigned.`,
      });
      setMergeTarget(null);
    } catch (error) {
      toast({
        title: "Unable to merge",
        description: getErrorMessage(error, "Something went wrong."),
        variant: "destructive",
      });
    } finally {
      setMerging(false);
    }
  }

  const mergeOptions =
    mergeTarget?.entity === "department"
      ? departments
          .filter((d) => d.id !== mergeTarget.id)
          .map((d) => ({
            id: d.id,
            label: d.name ? `${d.code} · ${d.name}` : d.code,
          }))
      : mergeTarget?.entity === "professor"
        ? professors
            .filter((p) => p.id !== mergeTarget.id)
            .map((p) => ({ id: p.id, label: p.name }))
        : [];

  const isDepartment = renameShown?.entity === "department";

  const dialogs = (
    <>
      <Dialog
        open={!!renameTarget}
        onOpenChange={(next) => {
          if (!next && !renaming) setRenameTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submitRename} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>
                {isDepartment
                  ? `Name the ${renameShown?.label} department`
                  : `Rename ${renameShown?.label}`}
              </DialogTitle>
              <DialogDescription>
                Every file filed under it shows the new name.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="bw-taxonomy-rename">
                {isDepartment ? "Full name" : "Name"}
              </Label>
              <Input
                id="bw-taxonomy-rename"
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.target.value)}
                placeholder={isDepartment ? "Computer Science" : "Dr. Lastname"}
                maxLength={255}
                autoFocus
                disabled={renaming}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setRenameTarget(null)}
                disabled={renaming}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                {...gate.controlProps(renaming || !renameDraft.trim())}
              >
                {renaming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!mergeTarget}
        onOpenChange={(next) => {
          if (!next && !merging) setMergeTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Merge &quot;{mergeShown?.label}&quot;</DialogTitle>
            <DialogDescription>
              Every resource tagged with this entry moves to the one you pick
              below, then this entry is deleted. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <Select value={mergeSelection} onValueChange={setMergeSelection}>
            <SelectTrigger aria-label="Merge into">
              <SelectValue placeholder="Merge into…" />
            </SelectTrigger>
            <SelectContent>
              {mergeOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setMergeTarget(null)}
              disabled={merging}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void submitMerge()}
              {...gate.controlProps(!mergeSelection || merging)}
            >
              {merging ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  return { requestRename, requestMerge, dialogs };
}
