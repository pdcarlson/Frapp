"use client";

import { useState } from "react";
import { Loader2, Lock } from "lucide-react";
import {
  documentAccessChoices,
  useDocumentAccessOptions,
  useSetDocumentAccess,
} from "@repo/hooks";
import { isEmptyChannelAccessChoice } from "@repo/hooks/channel-access";
import { isDriveCopy } from "@repo/hooks/document-library";
import { sameChannelAccessList } from "@repo/validation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChannelAccessField } from "@/components/chat-admin/channel-access-field";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import type { ChapterDocument } from "@/components/documents/document-types";
import { useToast } from "@/lib/hooks/use-toast";
import { cn, getErrorMessage } from "@/lib/utils";

/** Under a folder's list: who passes it anyway. */
export const FOLDER_ALWAYS_LINE = "The President can always see it.";
/** Under a file's list: its uploader passes too (a Drive copy has none). */
export const FILE_ALWAYS_LINE =
  "The President and whoever uploaded it can always see it.";

/**
 * What a Documents "Who can see" field offers (#3642 piece 1): the shared
 * reading (`documentAccessChoices`, the phone's upload sheet reads the
 * same) of the access options. The field is left out while `canLimit` is
 * false rather than offered and refused.
 */
export function useDocumentAccessChoices(enabled = true) {
  return documentAccessChoices(useDocumentAccessOptions({ enabled }));
}

/**
 * Whether `userId` may set who can see this file: whoever uploaded it, or a
 * member who manages documents. A Drive copy has no uploader in that sense.
 * The uploader also needs Upload documents, which the field's choices are
 * read with, so the control isn't offered to someone whose list can't load.
 */
export function canSetDocumentAccess(
  doc: Pick<ChapterDocument, "uploaded_by" | "drive_file_id">,
  userId: string | null,
  { manages, uploads }: { manages: boolean; uploads: boolean },
): boolean {
  if (manages) return true;
  return uploads && !!userId && doc.uploaded_by === userId && !isDriveCopy(doc);
}

/**
 * The quiet mark on a folder or file not everyone can see, the way Slack
 * marks a private channel and Drive a restricted file: a lock beside the
 * name, said to a screen reader.
 */
export function LimitedMark({
  className,
  label = "Not everyone can see this",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span className={cn("inline-flex shrink-0", className)} title={label}>
      <Lock aria-hidden className="h-3.5 w-3.5" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Who can see one file: "Same as folder" or chosen tiers, roles and groups,
 * which narrow the folder's. Opened from the file's own controls by its
 * uploader or a member who manages documents.
 */
export function DocumentAccessDialog({
  doc,
  gate,
  onClose,
}: {
  /** The file being set, or null when the dialog is shut. */
  doc: ChapterDocument | null;
  gate: SubscriptionGate;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={doc !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        {doc ? (
          <DocumentAccessForm
            key={doc.id}
            doc={doc}
            gate={gate}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DocumentAccessForm({
  doc,
  gate,
  onClose,
}: {
  doc: ChapterDocument;
  gate: SubscriptionGate;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const choices = useDocumentAccessChoices();
  const setAccess = useSetDocumentAccess();
  const stored = doc.who_can_see ?? null;
  const [value, setValue] = useState<string[] | null>(stored);
  const saving = setAccess.isPending;
  /*
    A member outside every tier may still lift a list (the API takes `null`
    from them) but not write one, so the open choice stays on offer to them
    and nothing else does. An empty Chosen list is refused by the API, so
    Save waits for an entry.
  */
  const blocked =
    isEmptyChannelAccessChoice(value) || (!choices.canLimit && value !== null);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked) return;
    // Opened only to look: no write, so Save never widens a list by itself.
    if (sameChannelAccessList(value, stored)) {
      onClose();
      return;
    }
    try {
      await setAccess.mutateAsync({ id: doc.id, who_can_see: value });
      toast({
        title: "Saved who can see it",
        description:
          value === null
            ? `${doc.title} follows its folder again.`
            : `Only the people chosen can find ${doc.title}.`,
      });
      onClose();
    } catch (error) {
      toast({
        title: "Couldn't save who can see it",
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Who can see {doc.title}</DialogTitle>
        <DialogDescription>
          {doc.folder
            ? `Same as folder shows it to everyone who sees ${doc.folder}. Choosing roles narrows that: a member needs both.`
            : "Same as folder shows it to the whole chapter. Choosing roles limits it to them."}
        </DialogDescription>
      </DialogHeader>
      <form id="doc-access-form" onSubmit={save}>
        {choices.optionsState === "ready" &&
        !choices.canLimit &&
        stored === null ? (
          <p className="text-sm text-muted-foreground">
            You can limit who sees a file once you hold a role in one of the
            chapter&apos;s tiers.
          </p>
        ) : (
          <ChannelAccessField
            id="doc-access"
            question="see"
            value={value}
            onChange={setValue}
            options={choices.options}
            optionsState={choices.optionsState}
            everyoneLabel="Same as folder"
            locked={choices.locked}
            alwaysLine={
              isDriveCopy(doc) ? FOLDER_ALWAYS_LINE : FILE_ALWAYS_LINE
            }
            canChoose={choices.canLimit}
            disabled={saving || choices.optionsState === "loading"}
          />
        )}
      </form>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          form="doc-access-form"
          type="submit"
          {...gate.controlProps(saving || blocked)}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
