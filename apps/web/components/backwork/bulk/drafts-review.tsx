"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Lock, Trash2, Upload } from "lucide-react";
import {
  useBackworkDrafts,
  useDeleteBackworkDraft,
  usePublishBackworkDrafts,
  useUpdateBackworkDrafts,
  type BackworkDraft,
  type BackworkDraftFields,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  dashboardCheckboxHitAreaClassName,
  dashboardTableCheckboxClassName,
  dashboardToolbarHeightClassName,
} from "@/components/shared/table-controls";
import { useSubscriptionGate } from "@/components/shared/subscription-gate";
import { useToast } from "@/lib/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  DRAFT_COLUMNS,
  cellPatch,
  cellText,
  chunkIds,
  columnSpec,
  draftLabel,
  publishBlocker,
  type DraftColumn,
} from "@/lib/backwork-bulk/drafts";

/** A Radix Select item can't hold "", so a cleared choice goes as this. */
const NONE = "__none";

const CELL_CLASS = cn(dashboardToolbarHeightClassName, "min-w-0 px-2 text-body");

/**
 * The review table for a bulk upload's drafts (#5208). Every document saved
 * from the queue lands here, visible only to the person who uploaded it. They
 * fix any cell in place, select rows and set one column for all of them, and
 * publish the selection (or everything) into the library.
 *
 * Comparables: Google Sheets and Airtable (edit a cell where it sits, fill a
 * column across a selection), Gmail (the "N selected" bar with actions for
 * the selection), and Google Photos' upload review (nothing is shared until
 * you say so).
 */
export function DraftsReview() {
  const { toast } = useToast();
  const gate = useSubscriptionGate();
  const draftsQuery = useBackworkDrafts();
  const update = useUpdateBackworkDrafts();
  const publish = usePublishBackworkDrafts();
  const remove = useDeleteBackworkDraft();
  const drafts = useMemo(() => draftsQuery.data ?? [], [draftsQuery.data]);

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [failures, setFailures] = useState<ReadonlyMap<string, string>>(new Map());
  const [publishing, setPublishing] = useState(false);

  // Selection only ever holds drafts that are still here.
  const liveSelected = useMemo(
    () => drafts.filter((draft) => selected.has(draft.id)).map((draft) => draft.id),
    [drafts, selected],
  );

  if (drafts.length === 0) return null;

  const allSelected = liveSelected.length === drafts.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(drafts.map((d) => d.id)));
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function save(ids: string[], fields: BackworkDraftFields) {
    try {
      for (const chunk of chunkIds(ids)) {
        await update.mutateAsync({ ids: chunk, fields });
      }
    } catch {
      toast({
        title: "Couldn't save that change",
        description: "Check your connection and try again.",
        variant: "destructive",
      });
    }
  }

  async function publishIds(ids: string[]) {
    if (ids.length === 0 || publishing) return;
    setPublishing(true);
    let filed = 0;
    const failed = new Map<string, string>();
    try {
      for (const chunk of chunkIds(ids)) {
        const result = await publish.mutateAsync(chunk);
        filed += result.published.length;
        for (const failure of result.failed) failed.set(failure.id, failure.message);
      }
    } catch {
      for (const id of ids) if (!failed.has(id)) failed.set(id, "Couldn't publish this one. Try again.");
    } finally {
      setPublishing(false);
    }
    setFailures(failed);
    setSelected(new Set([...failed.keys()]));
    toast({
      title:
        filed > 0
          ? `Published ${filed} ${filed === 1 ? "file" : "files"} to Backwork`
          : "Nothing was published",
      description:
        failed.size > 0
          ? `${failed.size} stayed ${failed.size === 1 ? "a draft" : "drafts"}. The reason is on each row.`
          : undefined,
      variant: failed.size > 0 && filed === 0 ? "destructive" : undefined,
    });
  }

  async function deleteDraft(draft: BackworkDraft) {
    try {
      await remove.mutateAsync(draft.id);
    } catch {
      toast({
        title: `Couldn't delete ${draftLabel(draft)}`,
        description: "Check your connection and try again.",
        variant: "destructive",
      });
    }
  }

  const publishTargets = liveSelected.length > 0 ? liveSelected : drafts.map((d) => d.id);

  return (
    <section aria-labelledby="drafts-review-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="drafts-review-heading" className="text-title font-semibold text-foreground">
          Review and publish
        </h2>
        <p className="text-caption text-muted-foreground tabular-nums">
          {drafts.length} {drafts.length === 1 ? "draft" : "drafts"}. Only you can see{" "}
          {drafts.length === 1 ? "it" : "them"} until you publish.
        </p>
      </div>

      <div className="flex min-h-11 flex-wrap items-center gap-2" role="toolbar" aria-label="Drafts">
        {liveSelected.length > 0 ? (
          <>
            <span className="text-label font-semibold text-foreground tabular-nums" aria-live="polite">
              {liveSelected.length} selected
            </span>
            <SetColumn
              disabled={!gate.allowed}
              onApply={(fields) => save(liveSelected, fields)}
            />
          </>
        ) : (
          <span className="text-caption text-muted-foreground">
            Select rows to set a column for all of them.
          </span>
        )}
        <Button
          type="button"
          size="toolbar"
          className="ml-auto gap-2"
          onClick={() => publishIds(publishTargets)}
          {...gate.controlProps(publishing)}
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          {liveSelected.length > 0
            ? `Publish ${liveSelected.length} selected`
            : `Publish all ${drafts.length}`}
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">
              <label className={dashboardCheckboxHitAreaClassName}>
                <input
                  type="checkbox"
                  className={dashboardTableCheckboxClassName}
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all drafts"
                />
              </label>
            </TableHead>
            {DRAFT_COLUMNS.map((column) => (
              <TableHead key={column.key} scope="col">
                {column.label}
              </TableHead>
            ))}
            <TableHead className="w-12">
              <span className="sr-only">Delete</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {drafts.map((draft) => {
            const problem = failures.get(draft.id) ?? publishBlocker(draft);
            return (
              <TableRow key={draft.id} data-state={selected.has(draft.id) ? "selected" : undefined}>
                <TableCell className="w-12 align-top">
                  <label className={dashboardCheckboxHitAreaClassName}>
                    <input
                      type="checkbox"
                      className={dashboardTableCheckboxClassName}
                      checked={selected.has(draft.id)}
                      onChange={() => toggle(draft.id)}
                      aria-label={`Select ${draftLabel(draft)}`}
                    />
                  </label>
                </TableCell>
                {DRAFT_COLUMNS.map((column) => (
                  <TableCell
                    key={column.key}
                    className={cn("align-top", column.key === "title" ? "min-w-[14rem]" : "min-w-[7rem]")}
                  >
                    <DraftCell
                      draft={draft}
                      column={column.key}
                      disabled={!gate.allowed}
                      onSave={(fields) => save([draft.id], fields)}
                    />
                    {column.key === "title" ? (
                      <div className="mt-1 flex items-center gap-1.5 text-caption">
                        {draft.is_redacted ? (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Redacted
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Uploaded as-is</span>
                        )}
                        {problem ? (
                          <span className="text-destructive-text" role="status">
                            {problem}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </TableCell>
                ))}
                <TableCell className="w-12 align-top">
                  <IconButton
                    label={`Delete ${draftLabel(draft)}`}
                    onClick={() => deleteDraft(draft)}
                    {...gate.controlProps(remove.isPending && remove.variables === draft.id)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}

/**
 * One line on `/backwork` when the member has drafts waiting, so a batch
 * started yesterday isn't forgotten. Says nothing when there are none.
 */
export function DraftsWaitingNote() {
  const { data } = useBackworkDrafts();
  const count = data?.length ?? 0;
  if (count === 0) return null;
  return (
    <p className="text-caption text-muted-foreground" role="status">
      {count === 1 ? "1 of your uploads is a draft" : `${count} of your uploads are drafts`}{" "}
      only you can see.{" "}
      <Link href="/backwork/upload" className="font-semibold text-accent-text hover:underline">
        Review and publish
      </Link>
    </p>
  );
}

/** One editable cell. Text saves on blur or Enter; a choice saves when picked. */
function DraftCell({
  draft,
  column,
  disabled,
  onSave,
}: {
  draft: BackworkDraft;
  column: DraftColumn;
  disabled: boolean;
  onSave: (fields: BackworkDraftFields) => void;
}) {
  const spec = columnSpec(column);
  const stored = cellText(draft, column);
  const label = `${spec.label} for ${draftLabel(draft)}`;

  if (spec.kind === "choice") {
    return (
      <Select
        value={stored || NONE}
        disabled={disabled}
        onValueChange={(next) => {
          const patch = cellPatch(column, next === NONE ? "" : next);
          if (patch) onSave(patch);
        }}
      >
        <SelectTrigger className={CELL_CLASS} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>None</SelectItem>
          {spec.choices?.map((choice) => (
            <SelectItem
              key={choice}
              value={choice}
              // Only a flattened file may be a Student Copy (`publishBlocker`).
              disabled={column === "document_variant" && choice === "Student Copy" && !draft.is_redacted}
            >
              {choice}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <TextCell
      // A saved value from elsewhere (a column set for the selection) resets the field.
      key={stored}
      stored={stored}
      label={label}
      numeric={spec.kind === "int"}
      disabled={disabled}
      onCommit={(raw) => {
        if (raw.trim() === stored) return true;
        const patch = cellPatch(column, raw);
        if (!patch) return false;
        onSave(patch);
        return true;
      }}
    />
  );
}

function TextCell({
  stored,
  label,
  numeric,
  disabled,
  onCommit,
}: {
  stored: string;
  label: string;
  numeric: boolean;
  disabled: boolean;
  /** False when the text isn't a value the column takes; the field goes back. */
  onCommit: (raw: string) => boolean;
}) {
  const [value, setValue] = useState(stored);
  const commit = () => {
    if (!onCommit(value)) setValue(stored);
  };
  return (
    <Input
      className={CELL_CLASS}
      value={value}
      inputMode={numeric ? "numeric" : undefined}
      aria-label={label}
      disabled={disabled}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          setValue(stored);
        }
      }}
    />
  );
}

/** "Set [column] to [value]" for every selected draft. */
function SetColumn({
  disabled,
  onApply,
}: {
  disabled: boolean;
  onApply: (fields: BackworkDraftFields) => void;
}) {
  const [column, setColumn] = useState<DraftColumn>("semester");
  const [value, setValue] = useState("");
  const spec = columnSpec(column);
  const patch = cellPatch(column, value);

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (patch) onApply(patch);
      }}
    >
      <span className="text-caption text-muted-foreground">Set</span>
      <Select
        value={column}
        onValueChange={(next) => {
          setColumn(next as DraftColumn);
          setValue("");
        }}
      >
        <SelectTrigger className={cn(CELL_CLASS, "w-36")} aria-label="Column to set">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DRAFT_COLUMNS.filter((c) => c.key !== "title").map((c) => (
            <SelectItem key={c.key} value={c.key}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-caption text-muted-foreground">to</span>
      {spec.kind === "choice" ? (
        <Select value={value || NONE} onValueChange={(next) => setValue(next === NONE ? "" : next)}>
          <SelectTrigger className={cn(CELL_CLASS, "w-36")} aria-label={`${spec.label} for the selected drafts`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>None</SelectItem>
            {spec.choices?.map((choice) => (
              <SelectItem key={choice} value={choice}>
                {choice}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          className={cn(CELL_CLASS, "w-36")}
          value={value}
          inputMode={spec.kind === "int" ? "numeric" : undefined}
          onChange={(event) => setValue(event.target.value)}
          aria-label={`${spec.label} for the selected drafts`}
          placeholder="Blank clears it"
        />
      )}
      <Button type="submit" variant="secondary" size="toolbar" disabled={disabled || !patch}>
        Apply
      </Button>
    </form>
  );
}
