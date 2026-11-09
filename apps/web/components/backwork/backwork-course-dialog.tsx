"use client";

import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import { useBackworkCourses, useSaveBackworkCourse } from "@repo/hooks";
import {
  MAX_COURSE_NAME_LENGTH,
  MAX_COURSE_NICKNAMES,
  MAX_COURSE_NICKNAME_LENGTH,
  collapseCourseText,
  normalizeCourseNicknames,
} from "@repo/validation";
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
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import type { BackworkCourse } from "@/components/backwork/backwork-library";
import { useToast } from "@/lib/hooks/use-toast";
import { asArray, getErrorMessage } from "@/lib/utils";

export type CourseTarget = {
  departmentId: string;
  courseNumber: string;
  /** "MATH 1010", for the title and the toast. */
  label: string;
};

/**
 * "Name MATH 1010": a course's name and the nicknames members call it
 * (#3848), opened from a `/backwork` row's menu.
 *
 * Who may change what is the API's rule (`courseEditRefusal` in
 * `apps/api/src/domain/utils/backwork-course-rules.ts`); this mirrors it only
 * to hide what would be refused. Anyone who may upload names a course that
 * has no name and adds nicknames; only a `backwork:admin` changes a set name
 * or removes a nickname someone saved. A chip added in this dialog can be
 * taken back before saving by anyone.
 *
 * The save is a paid-ops write, gated like the department rename.
 */
function nicknameKey(text: string): string {
  return collapseCourseText(text).toLowerCase();
}

export function useBackworkCourseDialog(
  gate: SubscriptionGate,
  isAdmin: boolean,
): {
  requestCourseName: (target: CourseTarget) => void;
  dialog: ReactNode;
  /**
   * Whether the course list has loaded. Until it has, the dialog can't tell a
   * named course from an unnamed one, so the page offers no entry into it.
   */
  ready: boolean;
} {
  const { toast } = useToast();
  const coursesQuery = useBackworkCourses();
  const courses = useMemo(
    () => asArray<BackworkCourse>(coursesQuery.data),
    [coursesQuery.data],
  );
  const save = useSaveBackworkCourse();

  const [target, setTarget] = useState<CourseTarget | null>(null);
  // Kept after close so the title doesn't read "Name undefined" as it fades.
  const [shown, setShown] = useState<CourseTarget | null>(null);
  // The edit, not a copy of the course: what was typed into the name (null
  // until touched) and the nicknames added and removed, exactly as written.
  // Shown over the stored row as it is now, so a refetch while the dialog is
  // open shows the fresh row and the save still sends only this edit.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  // Set when someone else named the course while this person was typing one.
  const [namedMeanwhile, setNamedMeanwhile] = useState(false);

  const stored = useMemo(() => {
    if (!shown) return null;
    const key = shown.courseNumber.trim().toLowerCase();
    return (
      courses.find((c) => c.department_id === shown.departmentId && c.course_key === key) ??
      null
    );
  }, [courses, shown]);
  const nameLocked = !isAdmin && !!stored?.name;
  // A refetch can name the course under a member's draft. The field turns
  // read-only, so the draft goes (a read-only field never shows text that
  // won't save) and a caption says why. Adjusted during render, React's
  // pattern for state that follows a prop, so the draft never paints locked.
  if (nameLocked && nameDraft !== null && target && !saving) {
    setNameDraft(null);
    setNamedMeanwhile(true);
  }
  const name = nameLocked ? (stored?.name ?? "") : (nameDraft ?? stored?.name ?? "");

  // What the chips show: the stored nicknames as they are now, minus this
  // edit's removals, plus its additions, de-duplicated case-insensitively.
  // A stored spelling wins over a local add of the same nickname, which
  // also keeps each chip's key (its lowercased text) unique.
  const removedKeys = new Set(removed.map(nicknameKey));
  const storedKeys = new Set((stored?.nicknames ?? []).map(nicknameKey));
  const chips: { text: string; key: string; local: boolean }[] = [];
  for (const [list, local] of [
    [stored?.nicknames ?? [], false],
    [added, true],
  ] as const) {
    for (const text of list) {
      const key = nicknameKey(text);
      if ((!local && removedKeys.has(key)) || chips.some((c) => c.key === key)) continue;
      chips.push({ text, key, local });
    }
  }
  const nicknames = chips.map((c) => c.text);

  function requestCourseName(next: CourseTarget) {
    setTarget(next);
    setShown(next);
    setNameDraft(null);
    setAdded([]);
    setRemoved([]);
    setDraft("");
    setNamedMeanwhile(false);
  }

  /** Adds the typed nickname to the edit; returns the edit's additions. */
  function addDraft(): { add: string[]; remove: string[] } {
    const text = normalizeCourseNicknames([draft])[0];
    setDraft("");
    if (!text || nicknames.length >= MAX_COURSE_NICKNAMES) return { add: added, remove: removed };
    if (removed.includes(text)) {
      // Typed back exactly what was removed: undo the removal.
      const remove = removed.filter((n) => n !== text);
      setRemoved(remove);
      return { add: added, remove };
    }
    if (chips.some((c) => c.key === nicknameKey(text))) {
      return { add: added, remove: removed };
    }
    const add = [...added, text];
    setAdded(add);
    return { add, remove: removed };
  }

  function onNicknameKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    // Enter adds a chip; it must not submit the form.
    event.preventDefault();
    if (draft.trim()) addDraft();
  }

  function removable(chip: { local: boolean }): boolean {
    return isAdmin || chip.local;
  }

  function removeNickname(chip: { text: string; key: string; local: boolean }) {
    if (chip.local) {
      setAdded((prev) => prev.filter((n) => nicknameKey(n) !== chip.key));
    } else {
      setRemoved((prev) => [...prev, chip.text]);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || !gate.allowed) return;
    // A nickname typed but not yet entered still counts.
    const edit = draft.trim() ? addDraft() : { add: added, remove: removed };
    // An add the stored row now has anyway (a refetch brought it) is no edit.
    const add = edit.add.filter((n) => !storedKeys.has(nicknameKey(n)) || removedKeys.has(nicknameKey(n)));
    const remove = edit.remove;
    const trimmedName = name.trim();
    const nameChanged =
      !nameLocked && nameDraft !== null && trimmedName !== (stored?.name ?? "");
    if (!nameChanged && add.length === 0 && remove.length === 0) {
      toast({ title: "Nothing to save", description: "Nothing changed." });
      setTarget(null);
      return;
    }
    setSaving(true);
    try {
      // Exactly what this person changed, by exact text: the API removes
      // first (case-insensitively), then adds, against the row as it is when
      // it writes, so replacing "orgo" with "Orgo" is remove "orgo", add
      // "Orgo", and a nickname someone else saved meanwhile stays.
      await save.mutateAsync({
        department_id: target.departmentId,
        course_number: target.courseNumber.trim(),
        ...(nameChanged ? { name: trimmedName || null } : {}),
        ...(add.length ? { add_nicknames: add } : {}),
        ...(remove.length ? { remove_nicknames: remove } : {}),
      });
      toast({ title: `Saved ${target.label}` });
      setTarget(null);
    } catch (error) {
      toast({
        title: "Couldn't save the course",
        description: getErrorMessage(error, "Something went wrong."),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const dialog = (
    <Dialog
      open={!!target}
      onOpenChange={(next) => {
        if (!next && !saving) setTarget(null);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Name {shown?.label}</DialogTitle>
            <DialogDescription>
              What members call this class. Any of these names finds its files.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="bw-course-name">Course name</Label>
            <Input
              id="bw-course-name"
              value={name}
              onChange={(event) => setNameDraft(event.target.value)}
              placeholder="Calculus I"
              maxLength={MAX_COURSE_NAME_LENGTH}
              autoFocus={!nameLocked}
              readOnly={nameLocked}
              aria-describedby={nameLocked ? "bw-course-name-locked" : undefined}
              disabled={saving}
            />
            {nameLocked ? (
              <p id="bw-course-name-locked" className="text-caption text-muted-foreground">
                {namedMeanwhile
                  ? "Someone just named this course. Only a backwork admin can change it."
                  : "Only a backwork admin can change a name that’s set."}
              </p>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bw-course-nickname">Also called</Label>
            {nicknames.length ? (
              <ul className="flex flex-wrap gap-1.5" aria-label="Nicknames">
                {chips.map((chip) => (
                  <li
                    key={chip.key}
                    className="inline-flex h-6 items-center rounded-sm border border-input bg-card px-2 text-caption font-semibold"
                  >
                    {chip.text}
                    {removable(chip) ? (
                      <button
                        type="button"
                        className="-mr-1 ml-1 inline-flex h-4 w-4 items-center justify-center rounded-xs text-muted-foreground hover:text-foreground"
                        aria-label={`Remove ${chip.text}`}
                        disabled={saving}
                        onClick={() => removeNickname(chip)}
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <Input
              id="bw-course-nickname"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onNicknameKey}
              placeholder="Calc 1, then Enter"
              maxLength={MAX_COURSE_NICKNAME_LENGTH}
              autoFocus={nameLocked}
              disabled={saving || nicknames.length >= MAX_COURSE_NICKNAMES}
              aria-describedby="bw-course-nickname-help"
            />
            <p id="bw-course-nickname-help" className="text-caption text-muted-foreground">
              Numbers match either way: “Calc 1” also finds “Calc I”.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setTarget(null)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" {...gate.controlProps(saving)}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  // Loaded at least once; a background refetch error keeps the data.
  return { requestCourseName, dialog, ready: coursesQuery.data !== undefined };
}
