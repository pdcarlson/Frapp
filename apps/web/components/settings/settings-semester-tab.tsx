"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { type SemesterArchive, type useSemesterRollover } from "@repo/hooks";
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
import { Label } from "@/components/ui/label";
import {
  EmptyState,
  LoadingState,
  PermissionsOfflineSurface,
} from "@/components/shared/async-states";
import { Can } from "@/components/shared/can";
import { type useConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  SubscriptionNotice,
  type SubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";

export type RolloverForm = ReturnType<typeof useRolloverForm>;

/**
 * The rollover form's fields, held by the page rather than the tab: Radix
 * unmounts an inactive `TabsContent`, and a rollover awaiting its confirmation
 * finishes (and clears the form) even if the officer has moved tab meanwhile.
 */
export function useRolloverForm() {
  const [label, setLabel] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  // Defaults to off: promotion rewrites roles across the whole chapter and is
  // not one-click undoable, so it is opted into per rollover, never inherited.
  const [promoteNewMembers, setPromoteNewMembers] = useState(false);

  function reset() {
    setLabel("");
    setStart("");
    setEnd("");
    setPromoteNewMembers(false);
  }

  return {
    label,
    setLabel,
    start,
    setStart,
    end,
    setEnd,
    promoteNewMembers,
    setPromoteNewMembers,
    reset,
  };
}

export function SettingsSemesterTab({
  form,
  pledgeTerm,
  confirm,
  rollover,
  rolloverGate,
  semesters,
  semestersPending,
}: {
  form: RolloverForm;
  pledgeTerm: string;
  /**
   * The page's dialog. `{confirmDialog}` renders above the tabs so switching
   * tab never unmounts an open confirmation mid-flight.
   */
  confirm: ReturnType<typeof useConfirmDialog>["confirm"];
  rollover: ReturnType<typeof useSemesterRollover>;
  /**
   * Scoped to the rollover card on purpose. `SemesterRolloverController` is the
   * only paid-ops write on this screen (#841); `chapter-config`, `chapter`, and
   * `user` are `@FreeTier` and `notification` is not chapter-guarded at all, so
   * gating the rest would lock a lapsed chapter out of settings it is still
   * entitled to change — over-gating is the worse defect here.
   */
  rolloverGate: SubscriptionGate;
  semesters: SemesterArchive[];
  semestersPending: boolean;
}) {
  const { toast } = useToast();
  const {
    label: semesterLabel,
    start: semesterStart,
    end: semesterEnd,
    promoteNewMembers,
  } = form;
  // "every X", not "Xs": `pledgeTerm` can be an officer-typed free-text
  // override with no plural-form guarantee (see settings-org-tab.tsx's
  // vocab editor) — naively appending "s" breaks for a term already plural
  // or ending in s/x/z/ch/sh.
  const promoteToggleLabel = `Also promote every ${pledgeTerm} to Member`;

  async function startRollover(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!semesterLabel || !semesterStart || !semesterEnd) return;
    const confirmed = await confirm({
      title: `Start a new semester labelled "${semesterLabel}"?`,
      description: promoteNewMembers
        ? `The current leaderboard period is archived and a new one begins. Points already awarded are kept — only the leaderboard's default window moves. Every ${pledgeTerm} is also promoted to Member; they keep any other roles they hold, and this cannot be undone in one step.`
        : "The current leaderboard period is archived and a new one begins. Points already awarded are kept — only the leaderboard's default window moves.",
      confirmLabel: "Start new semester",
      // Not destructive: a rollover archives rather than deletes, and
      // `writing.md` §7's own copy for this flow says the history stays. A red
      // button would state a loss the API does not perform. Promotion is a role
      // change rather than a deletion, so it does not change that reading — the
      // description above states its scope instead.
      tone: "default",
    });
    if (!confirmed) return;
    try {
      await rollover.mutateAsync({
        label: semesterLabel,
        start_date: semesterStart,
        end_date: semesterEnd,
        promote_new_members: promoteNewMembers,
      });
      toast({
        title: "Semester archived",
        description: promoteNewMembers
          ? `${semesterLabel} is now the active period, and every ${pledgeTerm} was promoted to Member.`
          : `${semesterLabel} is now the active period.`,
      });
      form.reset();
    } catch (error) {
      toast({
        title: "Couldn't archive semester",
        description: getErrorMessage(
          error,
          "Rollovers are limited to one per month. Check the archive list below.",
        ),
        variant: "destructive",
      });
    }
  }

  return (
    <>
      <Can
        permission="semester:rollover"
        deniedFallback={null}
        offlineFallback={(retry) => (
          <PermissionsOfflineSurface
            description="Reconnect to check whether you can start a new semester."
            onRetry={retry}
          />
        )}
      >
        <Card>
          <CardHeader>
            <CardTitle>Start a new semester</CardTitle>
            <CardDescription>
              Archives the current leaderboard period with a label and date
              range. Points keep accumulating. The leaderboard just resets its
              default window.
            </CardDescription>
          </CardHeader>
          <form onSubmit={startRollover}>
            <CardContent className="grid gap-3 md:grid-cols-3">
              {/*
                Disable, don't hide (§5 rule 4) — and the notice sits on
                the rollover card rather than the page header so it never
                reads as "all of settings is blocked". `mb-0` because the
                grid gap already spaces it.
              */}
              <SubscriptionNotice
                gate={rolloverGate}
                feature="semester rollover"
                className="mb-0 md:col-span-3"
              />
              <div className="grid gap-1 md:col-span-1">
                <Label htmlFor="semester-label">Label</Label>
                <Input
                  id="semester-label"
                  value={semesterLabel}
                  onChange={(event) => form.setLabel(event.target.value)}
                  placeholder="Fall 2026"
                  required
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="semester-start">Start date</Label>
                <Input
                  id="semester-start"
                  type="date"
                  value={semesterStart}
                  onChange={(event) => form.setStart(event.target.value)}
                  required
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="semester-end">End date</Label>
                <Input
                  id="semester-end"
                  type="date"
                  value={semesterEnd}
                  onChange={(event) => form.setEnd(event.target.value)}
                  required
                />
              </div>
              {/*
                Pledge promotion (spec/behavior/semester-rollover.md step
                3). Optional and off by default — it rewrites roles across
                the chapter, so it is opted into per rollover. The
                confirmation dialog restates the consequence before it
                runs. Same `gate.controlProps` as the submit button so an
                ungated chapter cannot toggle a control it cannot use.

                Wrapped in `<Can permission="roles:manage">` because the
                API enforces exactly that on the promotion path: rewriting
                `members.role_ids` is what `PATCH /members/:id/roles`
                gates, and `semester:rollover` alone does not carry it.
                Offering the toggle without it would produce a 403 at
                submit. A rollover *without* promotion stays available —
                this hides the toggle, never the card.

                `aria-label` is explicit rather than inherited from the
                wrapping `<label>`: a `<label>` does not name a `button`,
                which is what Radix renders for `role="switch"`. Same
                reason `settings-fields-tab.tsx` names its switches.
              */}
              <Can permission="roles:manage">
                <label className="flex items-start gap-2 text-sm md:col-span-3">
                  <Switch
                    id="semester-promote"
                    aria-label={promoteToggleLabel}
                    checked={promoteNewMembers}
                    onCheckedChange={form.setPromoteNewMembers}
                    {...rolloverGate.controlProps(rollover.isPending)}
                  />
                  <span>
                    {promoteToggleLabel}
                    <span className="block text-xs text-muted-foreground">
                      {`Everyone currently holding the ${pledgeTerm} role becomes a Member. Other roles they hold are kept.`}
                    </span>
                  </span>
                </label>
              </Can>
            </CardContent>
            <CardFooter className="flex justify-end">
              {/*
                No dialog to gate here, so the submit *is* the entry
                control — and a disabled default button also suppresses
                implicit Enter submission from the three fields above.
              */}
              <Button
                type="submit"
                {...rolloverGate.controlProps(rollover.isPending)}
              >
                {rollover.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Archive current semester
              </Button>
            </CardFooter>
          </form>
        </Card>
      </Can>

      <Card>
        <CardHeader>
          <CardTitle>Archived semesters</CardTitle>
          <CardDescription>
            Every rollover is preserved and viewable in reports and
            leaderboards.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {semestersPending ? (
            <LoadingState message="Loading archives..." />
          ) : semesters.length === 0 ? (
            <EmptyState
              title="No archived semesters yet"
              description="After you run your first rollover, the history appears here."
            />
          ) : (
            <ul className="divide-y divide-border/70">
              {semesters.map((archive) => (
                <li
                  key={archive.id}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span className="font-medium">{archive.label}</span>
                  <span className="text-muted-foreground">
                    {archive.start_date} – {archive.end_date}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
