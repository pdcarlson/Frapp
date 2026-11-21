"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useAssignPledgeClasses, usePledgeClasses } from "@repo/hooks";
import { vocab } from "@repo/org-archetypes";
import {
  ORDER_NUMBER_INVALID_MESSAGE,
  parseOrderNumber,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { inlineNoteActionClassName } from "@/components/shared/inline-note";
import {
  DETAIL_LIST,
  DetailRow,
} from "@/components/members/member-detail-rows";
import { useChapterVocabulary } from "@/lib/hooks/use-chapter-vocabulary";
import { useToast } from "@/lib/hooks/use-toast";
import { cn, getErrorMessage } from "@/lib/utils";

/** The select's value for "no class": Radix refuses an empty-string item. */
const NO_CLASS = "none";

type Props = {
  /** Whether the sheet is open; closing drops an unsaved edit. */
  open: boolean;
  /** The membership id the write takes, or `null` until the profile loads. */
  memberId: string | null;
  displayName: string;
  pledgeClassId: string | null;
  orderNumber: number | null;
  /** The viewer holds `roles:manage`, the gate on the write. */
  canEdit: boolean;
};

/**
 * A member's pledge class and order number on their profile sheet (#3939),
 * named in the chapter's own words (`vocab("class")`, `vocab("order")`).
 *
 * Anyone sees the ones that are set. A member with neither shows nothing, so a
 * chapter that uses neither never sees the section
 * (`spec/behavior/members.md` § Pledge class and order number). An officer
 * holding `roles:manage` always sees it, with Edit, because this is one of the
 * two places they are set; the other is Settings, for a whole class at once.
 * It is the only place a chapter that keeps a number and no classes can set
 * one, which is why it does not wait for the chapter to have used either.
 */
export function MemberPledgeClassSection({
  open,
  memberId,
  displayName,
  pledgeClassId,
  orderNumber,
  canEdit,
}: Props) {
  const chapterWords = useChapterVocabulary();
  const classTerm = vocab("class", chapterWords);
  const orderTerm = vocab("order", chapterWords);
  const headingId = useId();
  const classFieldId = useId();
  const numberFieldId = useId();
  const { toast } = useToast();
  const assign = useAssignPledgeClasses();
  // The list names the member's class and fills the editor's picker, so it is
  // not read for a member with no class by a viewer who can't edit.
  const classesQuery = usePledgeClasses({
    enabled: open && (canEdit || pledgeClassId !== null),
  });
  const classes = classesQuery.data ?? [];

  const [editing, setEditing] = useState(false);
  const [classDraft, setClassDraft] = useState(NO_CLASS);
  const [numberDraft, setNumberDraft] = useState("");
  // Adjusted during render, as the sheet does for its role editor: a closed
  // sheet reopens on the saved values, never a stale draft.
  if (!open && editing) setEditing(false);

  if (!canEdit && pledgeClassId === null && orderNumber === null) return null;

  const className = pledgeClassId
    ? (classes.find((entry) => entry.id === pledgeClassId)?.name ?? null)
    : null;
  const parsedNumber = parseOrderNumber(numberDraft);

  function startEditing() {
    setClassDraft(pledgeClassId ?? NO_CLASS);
    setNumberDraft(orderNumber === null ? "" : String(orderNumber));
    setEditing(true);
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!memberId || parsedNumber === undefined) return;
    try {
      await assign.mutateAsync([
        {
          member_id: memberId,
          pledge_class_id: classDraft === NO_CLASS ? null : classDraft,
          order_number: parsedNumber,
        },
      ]);
      toast({
        title: "Saved",
        description: `${displayName}'s profile was updated.`,
      });
      setEditing(false);
    } catch (error) {
      toast({
        title: "Could not save",
        description: getErrorMessage(
          error,
          "Something went wrong. Please retry.",
        ),
        variant: "destructive",
      });
    }
  }

  return (
    <section className="mt-6 space-y-2" aria-labelledby={headingId}>
      <div className="flex items-center justify-between">
        <h3
          id={headingId}
          className="text-label font-semibold text-muted-foreground"
        >
          {/*
            Both words, as the chapter typed them, so the heading never
            repeats the first row's label. Neither is lowercased or
            pluralized: a free-text word like "PC" would come out wrong.
          */}
          {classTerm} · {orderTerm}
        </h3>
        {canEdit && !editing ? (
          <button
            type="button"
            onClick={startEditing}
            aria-label={`Edit ${displayName}'s ${classTerm}`}
            className={cn(
              "rounded-sm text-label font-semibold text-accent-text hover:underline",
              FOCUS_RING_OFFSET,
            )}
          >
            Edit
          </button>
        ) : null}
      </div>

      {editing ? (
        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid gap-1">
            <Label htmlFor={classFieldId}>{classTerm}</Label>
            <Select
              value={classDraft}
              onValueChange={setClassDraft}
              disabled={assign.isPending}
            >
              <SelectTrigger id={classFieldId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CLASS}>None</SelectItem>
                {classes.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {classesQuery.isSuccess && classes.length === 0 ? (
              <p className="text-caption text-muted-foreground">
                This chapter&apos;s list is empty.{" "}
                <Link
                  href="/settings?tab=classes"
                  className={inlineNoteActionClassName}
                >
                  Add to it in Settings
                </Link>
              </p>
            ) : null}
            {classesQuery.isError && !classesQuery.data ? (
              <p role="alert" className="text-caption text-destructive-text">
                Couldn&apos;t load the chapter&apos;s list.
              </p>
            ) : null}
          </div>
          <div className="grid gap-1">
            <Label htmlFor={numberFieldId}>{orderTerm}</Label>
            <Input
              id={numberFieldId}
              inputMode="numeric"
              value={numberDraft}
              onChange={(event) => setNumberDraft(event.target.value)}
              placeholder="None"
              aria-invalid={parsedNumber === undefined || undefined}
              disabled={assign.isPending}
            />
            {parsedNumber === undefined ? (
              <p role="alert" className="text-caption text-destructive-text">
                {ORDER_NUMBER_INVALID_MESSAGE}
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setEditing(false)}
              disabled={assign.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={assign.isPending || parsedNumber === undefined}
            >
              {assign.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Save
            </Button>
          </div>
        </form>
      ) : (
        <dl className={DETAIL_LIST}>
          {canEdit || pledgeClassId !== null ? (
            <DetailRow label={classTerm}>
              {pledgeClassId === null
                ? "Not set"
                : (className ??
                  (classesQuery.isPending ? "Loading" : "Not available"))}
            </DetailRow>
          ) : null}
          {canEdit || orderNumber !== null ? (
            <DetailRow label={orderTerm}>{orderNumber ?? "Not set"}</DetailRow>
          ) : null}
        </dl>
      )}
    </section>
  );
}
