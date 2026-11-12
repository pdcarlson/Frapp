"use client";

import { useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { useCorrectMemberProfile } from "@repo/hooks";
import {
  correctionDraft,
  correctionPatch,
  DISPLAY_NAME_MAX_LENGTH,
  PROFILE_FIELD_COPY,
  type ProfileCorrectionDraft,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  /** How the profile names them, for the title and the toast. */
  label: string;
  /** Their stored name, `""` when none is set: what the field opens on. */
  displayName: string;
  graduationYear: number | null;
};

/**
 * An officer fixes another member's name or graduation year (#4367): a typo
 * in a name, or the class year a new member never filled in. Opened from the
 * profile sheet's `⋯`, only where the profile read says
 * `viewer_can_edit_profile`. The rest of the profile (photo, phone, bio,
 * major) is the member's own and has no officer editor
 * (`spec/behavior/members.md` § Profiles, Officer corrections).
 *
 * Mobile's `MemberCorrectionSheet` is the same form; both read their rules
 * from `correctionPatch` in `@repo/validation`.
 */
export function MemberCorrectionDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <CorrectionForm {...props} /> : null}
    </Dialog>
  );
}

/**
 * Mounted only while open, so every opening starts from the profile as it
 * stands now, never a draft left from the last one.
 */
function CorrectionForm({
  onOpenChange,
  memberId,
  label,
  displayName,
  graduationYear,
}: Props) {
  const nameId = useId();
  const yearId = useId();
  const errorId = useId();
  const { toast } = useToast();
  const correct = useCorrectMemberProfile();
  const [original] = useState(() =>
    correctionDraft({ displayName, graduationYear }),
  );
  const [draft, setDraft] = useState<ProfileCorrectionDraft>(original);
  // Shown after a save is tried, never per keystroke.
  const [error, setError] = useState<{
    field: keyof ProfileCorrectionDraft;
    message: string;
  } | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = correctionPatch(original, draft);
    if (!result.ok) {
      setError({ field: result.field, message: result.message });
      return;
    }
    setError(null);
    if (Object.keys(result.patch).length === 0) {
      onOpenChange(false);
      return;
    }
    try {
      await correct.mutateAsync({ id: memberId, ...result.patch });
      toast({
        title: "Saved",
        description: `${result.patch.display_name ?? label}'s profile was updated.`,
      });
      onOpenChange(false);
    } catch (caught) {
      toast({
        title: "Could not save",
        description: getErrorMessage(
          caught,
          "Something went wrong. Please retry.",
        ),
        variant: "destructive",
      });
    }
  }

  return (
    <DialogContent>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <DialogHeader>
          <DialogTitle className="break-words">
            Edit {label}&apos;s profile
          </DialogTitle>
          <DialogDescription>
            Fix their name or graduation year. The rest of their profile is
            theirs to change.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor={nameId}>{PROFILE_FIELD_COPY.displayName.label}</Label>
          <Input
            id={nameId}
            value={draft.name}
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            autoComplete="off"
            disabled={correct.isPending}
            aria-invalid={error?.field === "name" || undefined}
            aria-describedby={error?.field === "name" ? errorId : undefined}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, name: event.target.value }))
            }
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={yearId}>
            {PROFILE_FIELD_COPY.graduationYear.accessibleLabel}
          </Label>
          <Input
            id={yearId}
            inputMode="numeric"
            maxLength={4}
            value={draft.graduationYear}
            placeholder={PROFILE_FIELD_COPY.graduationYear.placeholder}
            disabled={correct.isPending}
            aria-invalid={error?.field === "graduationYear" || undefined}
            aria-describedby={
              error?.field === "graduationYear" ? errorId : undefined
            }
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                graduationYear: event.target.value,
              }))
            }
          />
        </div>
        {error ? (
          <p
            id={errorId}
            role="alert"
            className="text-caption text-destructive-text"
          >
            {error.message}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={correct.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={correct.isPending}>
            {correct.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            Save
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
