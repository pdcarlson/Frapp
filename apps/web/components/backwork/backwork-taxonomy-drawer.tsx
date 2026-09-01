"use client";

import { useMemo, useState } from "react";
import {
  Check,
  Loader2,
  Merge,
  Pencil,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import {
  useDeleteDepartment,
  useDeleteProfessor,
  useDepartments,
  useMergeDepartments,
  useMergeProfessors,
  useProfessors,
  useUpdateDepartment,
  useUpdateProfessor,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
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
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { asArray, getErrorMessage } from "@/lib/utils";

type Department = { id: string; code: string; name: string | null };
type Professor = { id: string; name: string };
type Entity = "department" | "professor";
type MergeTarget = { entity: Entity; id: string; label: string };

/**
 * "Manage taxonomy" drawer (#376) — rename, merge, and delete for Backwork
 * departments/professors, gated on `backwork:admin` by the caller.
 *
 * Delete is blocked server-side (400) while any resource still references the
 * row; merge is the guided path to clear that — it reassigns every
 * referencing resource to the chosen target, then deletes the source. Both
 * error shapes surface via toast rather than a silent no-op, since the 400's
 * message names how many resources are still attached.
 */
export function BackworkTaxonomyDrawer() {
  const [open, setOpen] = useState(false);
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
  const deleteDepartment = useDeleteDepartment();
  const mergeDepartments = useMergeDepartments();
  const updateProfessor = useUpdateProfessor();
  const deleteProfessor = useDeleteProfessor();
  const mergeProfessors = useMergeProfessors();

  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();

  const [mergeTarget, setMergeTarget] = useState<MergeTarget | null>(null);
  const [mergeSelection, setMergeSelection] = useState("");
  const [merging, setMerging] = useState(false);

  async function handleRename(
    entity: Entity,
    id: string,
    name: string,
  ): Promise<void> {
    try {
      if (entity === "department") {
        await updateDepartment.mutateAsync({ id, body: { name } });
      } else {
        await updateProfessor.mutateAsync({ id, body: { name } });
      }
    } catch (error) {
      toast({
        title: "Unable to rename",
        description: getErrorMessage(error, "Something went wrong."),
        variant: "destructive",
      });
      throw error;
    }
  }

  async function handleDelete(
    entity: Entity,
    id: string,
    label: string,
  ): Promise<void> {
    const result = await confirm({
      title: `Delete "${label}"?`,
      description:
        "Only deletes if no backwork resource still references it. If any do, merge it into another entry first.",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!result) return;
    try {
      if (entity === "department") {
        await deleteDepartment.mutateAsync(id);
      } else {
        await deleteProfessor.mutateAsync(id);
      }
      toast({ title: `"${label}" deleted` });
    } catch (error) {
      toast({
        title: "Unable to delete",
        description: getErrorMessage(
          error,
          "It may still have resources attached — try merging it into another entry instead.",
        ),
        variant: "destructive",
      });
    }
  }

  function openMerge(entity: Entity, id: string, label: string) {
    setMergeTarget({ entity, id, label });
    setMergeSelection("");
  }

  async function handleMergeConfirm(): Promise<void> {
    if (!mergeTarget || !mergeSelection) return;
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

  const mergeOptions: { id: string; label: string }[] =
    mergeTarget?.entity === "department"
      ? departments
          .filter((d) => d.id !== mergeTarget.id)
          .map((d) => ({ id: d.id, label: d.name ?? d.code }))
      : mergeTarget?.entity === "professor"
        ? professors
            .filter((p) => p.id !== mergeTarget.id)
            .map((p) => ({ id: p.id, label: p.name }))
        : [];

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="secondary" className="gap-2">
            <Settings2 className="h-4 w-4" /> Manage taxonomy
          </Button>
        </SheetTrigger>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Manage departments &amp; professors</SheetTitle>
            <SheetDescription>
              Rename, merge, or delete entries created from uploads. Deleting is
              blocked while any resource still references an entry — merge it
              into another one first.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-8">
            <TaxonomySection
              title="Departments"
              entity="department"
              rows={departments.map((d) => ({
                id: d.id,
                name: d.name ?? d.code,
              }))}
              onRename={handleRename}
              onMerge={openMerge}
              onDelete={handleDelete}
            />
            <TaxonomySection
              title="Professors"
              entity="professor"
              rows={professors.map((p) => ({ id: p.id, name: p.name }))}
              onRename={handleRename}
              onMerge={openMerge}
              onDelete={handleDelete}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Dialog
        open={!!mergeTarget}
        onOpenChange={(next) => {
          if (!next) setMergeTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Merge &quot;{mergeTarget?.label}&quot;</DialogTitle>
            <DialogDescription>
              Every resource tagged with this entry moves to the one you pick
              below, then this entry is deleted. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <Select value={mergeSelection} onValueChange={setMergeSelection}>
            <SelectTrigger>
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
              onClick={handleMergeConfirm}
              disabled={!mergeSelection || merging}
            >
              {merging ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </>
  );
}

function TaxonomySection({
  title,
  entity,
  rows,
  onRename,
  onMerge,
  onDelete,
}: {
  title: string;
  entity: Entity;
  rows: { id: string; name: string }[];
  onRename: (entity: Entity, id: string, name: string) => Promise<void>;
  onMerge: (entity: Entity, id: string, label: string) => void;
  onDelete: (entity: Entity, id: string, label: string) => Promise<void>;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {rows.map((row) => (
            <TaxonomyRow
              key={row.id}
              entity={entity}
              row={row}
              onRename={onRename}
              onMerge={onMerge}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TaxonomyRow({
  entity,
  row,
  onRename,
  onMerge,
  onDelete,
}: {
  entity: Entity;
  row: { id: string; name: string };
  onRename: (entity: Entity, id: string, name: string) => Promise<void>;
  onMerge: (entity: Entity, id: string, label: string) => void;
  onDelete: (entity: Entity, id: string, label: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.name);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function save() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === row.name) {
      setEditing(false);
      setDraft(row.name);
      return;
    }
    setSaving(true);
    try {
      await onRename(entity, row.id, trimmed);
      setEditing(false);
    } catch {
      // onRename already toasted; keep the field open so the edit isn't lost.
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <li className="flex items-center gap-2 p-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
            if (event.key === "Escape") {
              setDraft(row.name);
              setEditing(false);
            }
          }}
          autoFocus
          disabled={saving}
          className="h-8"
        />
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          onClick={() => void save()}
          disabled={saving}
          aria-label="Save"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          onClick={() => {
            setDraft(row.name);
            setEditing(false);
          }}
          disabled={saving}
          aria-label="Cancel"
        >
          <X className="h-4 w-4" />
        </Button>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-2 p-2">
      <span className="truncate text-sm">{row.name}</span>
      <div className="flex shrink-0 gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={() => setEditing(true)}
          aria-label={`Rename ${row.name}`}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={() => onMerge(entity, row.id, row.name)}
          aria-label={`Merge ${row.name}`}
        >
          <Merge className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={async () => {
            setDeleting(true);
            try {
              await onDelete(entity, row.id, row.name);
            } finally {
              setDeleting(false);
            }
          }}
          disabled={deleting}
          aria-label={`Delete ${row.name}`}
        >
          {deleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </Button>
      </div>
    </li>
  );
}
