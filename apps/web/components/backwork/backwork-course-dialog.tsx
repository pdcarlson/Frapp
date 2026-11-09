"use client";

import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import { useBackworkCourses, useSaveBackworkCourse } from "@repo/hooks";
import {
  MAX_COURSE_NAME_LENGTH,
  MAX_COURSE_NICKNAMES,
  MAX_COURSE_NICKNAME_LENGTH,
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
export function useBackworkCourseDialog(
  gate: SubscriptionGate,
  isAdmin: boolean,
): { requestCourseName: (target: CourseTarget) => void; dialog: ReactNode } {
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
  const [stored, setStored] = useState<BackworkCourse | null>(null);
  const [name, setName] = useState("");
  const [nicknames, setNicknames] = useState<string[]>([]);
  const [added, setAdded] = useState<ReadonlySet<string>>(() => new Set());
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  function requestCourseName(next: CourseTarget) {
    const key = next.courseNumber.trim().toLowerCase();
    const existing =
      courses.find((c) => c.department_id === next.departmentId && c.course_key === key) ??
      null;
    setTarget(next);
    setShown(next);
    setStored(existing);
    setName(existing?.name ?? "");
    setNicknames(existing?.nicknames ?? []);
    setAdded(new Set());
    setDraft("");
  }

  const nameLocked = !isAdmin && !!stored?.name;

  function addDraft(): string[] {
    const next = normalizeCourseNicknames([...nicknames, draft]).slice(0, MAX_COURSE_NICKNAMES);
    if (next.length > nicknames.length) {
      setAdded((prev) => new Set(prev).add(next[next.length - 1]!.toLowerCase()));
    }
    setNicknames(next);
    setDraft("");
    return next;
  }

  function onNicknameKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    // Enter adds a chip; it must not submit the form.
    event.preventDefault();
    if (draft.trim()) addDraft();
  }

  function removable(nickname: string): boolean {
    return isAdmin || added.has(nickname.toLowerCase());
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || !gate.allowed) return;
    // A nickname typed but not yet entered still counts.
    const list = draft.trim() ? addDraft() : nicknames;
    const trimmedName = name.trim();
    const nameChanged = !nameLocked && trimmedName !== (stored?.name ?? "");
    const listChanged =
      list.length !== (stored?.nicknames.length ?? 0) ||
      list.some((n, i) => n !== stored?.nicknames[i]);
    if (!nameChanged && !listChanged) {
      setTarget(null);
      return;
    }
    if (!stored && !trimmedName && list.length === 0) {
      setTarget(null);
      return;
    }
    setSaving(true);
    try {
      await save.mutateAsync({
        department_id: target.departmentId,
        course_number: target.courseNumber.trim(),
        ...(nameChanged ? { name: trimmedName || null } : {}),
        nicknames: list,
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
              onChange={(event) => setName(event.target.value)}
              placeholder="Calculus I"
              maxLength={MAX_COURSE_NAME_LENGTH}
              autoFocus={!nameLocked}
              readOnly={nameLocked}
              aria-describedby={nameLocked ? "bw-course-name-locked" : undefined}
              disabled={saving}
            />
            {nameLocked ? (
              <p id="bw-course-name-locked" className="text-caption text-muted-foreground">
                Only a backwork admin can change a name that&rsquo;s set.
              </p>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bw-course-nickname">Also called</Label>
            {nicknames.length ? (
              <ul className="flex flex-wrap gap-1.5" aria-label="Nicknames">
                {nicknames.map((nickname) => (
                  <li
                    key={nickname}
                    className="inline-flex h-6 items-center rounded-sm border border-input bg-card px-2 text-caption font-semibold"
                  >
                    {nickname}
                    {removable(nickname) ? (
                      <button
                        type="button"
                        className="-mr-1 ml-1 inline-flex h-4 w-4 items-center justify-center rounded-xs text-muted-foreground hover:text-foreground"
                        aria-label={`Remove ${nickname}`}
                        disabled={saving}
                        onClick={() =>
                          setNicknames((prev) => prev.filter((n) => n !== nickname))
                        }
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

  return { requestCourseName, dialog };
}
