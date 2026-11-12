"use client";

import { describeLoadFailure } from "@repo/hooks/error-copy";
import { useMemo } from "react";
import { CheckCircle2, Plus, XCircle } from "lucide-react";
import {
  useDeleteServiceEntry,
  useGetServiceProofUrl,
  useMembers,
  useMyPermissions,
  useServiceEntries,
  useServicePointsRate,
} from "@repo/hooks";
import { can } from "@repo/validation";
import { memberFallbackLabel, memberLabel } from "@repo/hooks/display-names";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { useServiceReview } from "@/components/service/use-service-review";
import { useFrappUser } from "@/lib/auth/use-frapp-user";
import { serviceStatusKind } from "@/components/service/service-status";
import { Badge } from "@/components/ui/badge";
import { InlineNote, InlineNoteAction } from "@/components/shared/inline-note";
import { SectionLabel } from "@/components/shared/section-label";
import { denseListClassName } from "@/components/shared/table-controls";
import {
  ErrorState,
  anyReadUncached,
  OfflineState,
  PermissionsOfflineSurface,
} from "@/components/shared/async-states";
import { Can } from "@/components/shared/can";
import { PageActions } from "@/components/layout/page-actions";
import {
  SubscriptionNotice,
  useGatedDialog,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useToast } from "@/lib/hooks/use-toast";
import { useNetwork } from "@/lib/providers/network-provider";
import { asArray, getErrorMessage } from "@/lib/utils";
import type { components } from "@repo/api-sdk";
import { awardedPointsLabel, statusLabel } from "@repo/validation";
import { formatDay, formatMinutesRounded } from "@repo/formatting";
import { ServicePageSkeleton } from "@/components/service/service-skeleton";
import { approvePointsPreview } from "@/components/service/service-points-preview";
import { LogHoursDialog } from "@/components/service/log-hours-dialog";

/**
 * One row of `GET /v1/service-entries`, from the generated contract, so a
 * change to a field the page reads (`awarded_points`, #3868) fails the
 * typecheck here rather than silently falling back.
 */
type ServiceEntry = components["schemas"]["ServiceEntryResponseDto"];

/**
 * A row's when and how long: `"Nov 4 · 3h"`. `date` is a bare `YYYY-MM-DD`
 * column, which `formatDay` reads at local noon so it keeps its calendar day
 * in every zone; an unreadable date drops out of the line rather than
 * printing a placeholder. Minutes are rounded, as mobile prints them.
 */
function entryMeta(entry: Pick<ServiceEntry, "date" | "duration_minutes">) {
  return [formatDay(entry.date), formatMinutesRounded(entry.duration_minutes)]
    .filter(Boolean)
    .join(" · ");
}

export function ServiceHoursPage() {
  const { toast } = useToast();
  const { isOffline } = useNetwork();
  // Every write on `ServiceEntryController` (proof-upload-url, create, review,
  // delete) carries no `@FreeTier`, so they are all paid-ops behind the same
  // subscription guard — one gate covers the surface (#841). `GET
  // /service-entries/:id/proof-url` is a read and stays ungated.
  const gate = useSubscriptionGate();
  const { confirm, confirmDialog } = useConfirmDialog();
  const entriesQuery = useServiceEntries();
  const membersQuery = useMembers();
  // Approve and Reject, with Reject's own prompt: shared with the Activity
  // page, which reviews the same queue (`use-service-review.tsx`).
  const review = useServiceReview();
  const deleteEntry = useDeleteServiceEntry();
  // The viewer's `users.id` — the id space `service_entries.user_id` references
  // (`users(id)`, not the Supabase auth uid). `null` until it resolves, which
  // the approval gate below treats as "might be me".
  const { userId: viewerUserId, isLoading: viewerLoading } = useFrappUser();
  const viewerUnknown = viewerUserId === null;

  const entries = useMemo(
    () => asArray<ServiceEntry>(entriesQuery.data),
    [entriesQuery.data],
  );
  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) {
      if (m.user_id)
        map.set(String(m.user_id), memberLabel(m.display_name, m.user_id));
    }
    return map;
  }, [members]);

  // Every pending entry in the chapter, and deliberately so: this feeds the
  // ADMIN REVIEW QUEUE, which exists to show work that is not yours.
  // `GET /v1/service-entries` widens for a `service:approve` holder
  // (`userId: isAdmin ? query.userId : userId`) and this page reads it unscoped
  // for exactly that reason. Do not filter this one — the queue is the point.
  const pending = useMemo(
    () =>
      entries
        .filter((e) => e.status === "PENDING")
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    [entries],
  );

  // The viewer's own pending entries, which is a different list with a
  // different job: the "Your pending entries" card at the bottom, whose
  // Withdraw deletes. It used to render from `pending` above, so an approver
  // saw every member's rows — date · duration · description, no name — under a
  // heading claiming they were their own, each with a live Withdraw. That was
  // not inert: `DELETE /v1/service-entries/:id` accepts `service:approve` as
  // well as `service:log`, and the service only refuses a foreign entry when
  // `!isAdmin`, so it succeeded and purged the other member's proof file. While
  // the viewer id is still resolving this is empty rather than unfiltered.
  const myPending = useMemo(
    () =>
      viewerUserId === null
        ? []
        : pending.filter((e) => e.user_id === viewerUserId),
    [pending, viewerUserId],
  );
  const history = useMemo(
    () =>
      entries
        .filter((e) => e.status !== "PENDING")
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [entries],
  );

  const logDialog = useGatedDialog(gate);
  const { data: permissionsPayload } = useMyPermissions();
  const canLog = can("service:log", permissionsPayload?.permissions ?? []);
  // The rate Approve will apply, for each queue row's points preview (#3862).
  // Read from its own `service:approve` route, not the chapter config, which
  // needs `chapter-config:view` that no stock approver but the President holds.
  // Unknown (loading, failed) leaves the preview off rather than guessing.
  const canApprove = can(
    "service:approve",
    permissionsPayload?.permissions ?? [],
  );
  const pointsRate = useServicePointsRate({ enabled: canApprove });
  const minutesPerPoint = pointsRate.data?.minutes_per_point;
  const getProofUrl = useGetServiceProofUrl();

  async function viewProof(entry: ServiceEntry) {
    try {
      const data = await getProofUrl.mutateAsync(entry.id);
      const url =
        data && typeof data === "object" && "url" in data
          ? (data as { url?: string }).url
          : null;
      if (!url) throw new Error("No download URL returned.");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast({
        title: "Couldn't open proof",
        description: getErrorMessage(
          error,
          "Older entries may reference proof that was never uploaded.",
        ),
        variant: "destructive",
      });
    }
  }

  async function withdraw(entry: ServiceEntry) {
    const confirmed = await confirm({
      title: "Withdraw this pending service entry?",
      description: "You can always resubmit it.",
      confirmLabel: "Withdraw entry",
      tone: "destructive",
    });
    if (!confirmed) return;
    try {
      await deleteEntry.mutateAsync(entry.id);
      toast({
        title: "Entry withdrawn",
        description: "The pending entry was removed.",
      });
    } catch (error) {
      toast({
        title: "Couldn't withdraw entry",
        description: getErrorMessage(
          error,
          "Only hours that haven't been reviewed can be withdrawn.",
        ),
        variant: "destructive",
      });
    }
  }

  /*
   * README §4 item 4: a network-dependent async view ships an offline state.
   * This screen had none, so a disconnected member sat on the loading
   * skeleton until the query gave up. Copy is writing.md §7's row.
   */
  /*
   * `membersQuery` is in this gate because this screen names every row from
   * the roster: an uncached roster would turn the approval queue into a list of
   * `Member 2f4a1c` fallback labels, which no officer can approve against. The
   * viewer read
   * is deliberately *not* here — an unresolved viewer already says so in
   * words on the Approve control ("Checking who you are…"), so that half
   * degrades honestly on its own.
   */
  if (isOffline && anyReadUncached(entriesQuery, membersQuery)) {
    return (
      <>
        <OfflineState
          title="Service hours unavailable offline"
          description="Reconnect to log hours and review the approval queue."
          onRetry={() => {
            void entriesQuery.refetch();
            void membersQuery.refetch();
          }}
        />
      </>
    );
  }

  if (entriesQuery.isPending) {
    return <ServicePageSkeleton />;
  }

  if (entriesQuery.isError) {
    return (
      <>
        <ErrorState
          title="Couldn't load service entries"
          description={describeLoadFailure(entriesQuery.error)}
          onRetry={() => void entriesQuery.refetch()}
        />
      </>
    );
  }

  return (
    // A container (#4033): beside chat (#3779) the page is narrow while the
    // window is wide, so the hour rows count the page's own width.
    <div className="@container space-y-6">
      <PageActions>
        <Can permission="service:log">
          <LogHoursDialog
            open={logDialog.open}
            onOpenChange={logDialog.setOpen}
            onCloseAutoFocus={logDialog.contentProps.onCloseAutoFocus}
            gate={gate}
            trigger={
              <Button size="toolbar" className="gap-2" {...gate.controlProps()}>
                <Plus className="h-4 w-4" /> Log service
              </Button>
            }
          />
        </Can>
      </PageActions>
      {/*
        Disable, don't hide (§5 rule 4): the review queue, history, and proof
        links stay readable for a lapsed chapter — only logging and reviewing
        stop, and this says why.
      */}
      <SubscriptionNotice gate={gate} feature="logging service hours" />

      <Can
        permission="service:approve"
        offlineFallback={(retry) => (
          <PermissionsOfflineSurface
            description="Reconnect to check whether you can review submitted hours."
            onRetry={retry}
          />
        )}
      >
        {/*
          Flush, not carded (README § Page grammar): three `<Card>`s sat here,
          each with a description narrating it, and History carried a footer
          explaining point awards. The queue's count is state, so it moved
          onto the section label.
        */}
        <section aria-labelledby="svc-queue-label" className="space-y-3">
          <SectionLabel
            id="svc-queue-label"
            count={pending.length > 0 ? `${pending.length} pending` : null}
          >
            Review queue
          </SectionLabel>
          {pending.length === 0 ? (
            <InlineNote>Nothing waiting for review.</InlineNote>
          ) : (
            <ul className={denseListClassName}>
              {pending.map((entry) => {
                const name =
                  memberNameById.get(entry.user_id) ??
                  memberFallbackLabel(entry.user_id);
                const isOwnEntry =
                  !viewerUnknown && entry.user_id === viewerUserId;
                const cannotApprove = isOwnEntry || viewerUnknown;
                // Only describe the button when the subscription gate is not
                // already doing it. Key on `state.allowed` / `isPending`,
                // not `allowed`: `allowed` folds in OFFLINE, and an
                // offline-only block does not set `aria-describedby` (the
                // reason is on `title`). Overriding that would hide the
                // self-approval sentence behind "Reconnect to make changes."
                const showApproveReason =
                  cannotApprove && gate.state.allowed && !gate.isPending;
                const approveReasonId = `svc-approve-reason-${entry.id}`;
                const pointsPreview = approvePointsPreview(
                  entry.duration_minutes,
                  minutesPerPoint,
                );
                const approveBlockedReason = isOwnEntry
                  ? "You can't approve your own hours. Another admin has to review them."
                  : viewerLoading
                    ? "Checking who you are\u2026"
                    : "Couldn't confirm who you are, so approving is unavailable. Reload to try again.";
                return (
                  <li
                    key={entry.id}
                    className="flex min-h-11 flex-col gap-2 py-2 @2xl:flex-row @2xl:items-center @2xl:justify-between @2xl:gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{name}</p>
                      <p className="text-caption text-muted-foreground">
                        {entryMeta(entry)}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {entry.description}
                      </p>
                      {pointsPreview ? (
                        <p className="mt-0.5 text-caption text-muted-foreground">
                          {pointsPreview}
                        </p>
                      ) : null}
                      {/* Deliberately ungated: the signed link comes from
                            `GET /v1/service-entries/:id/proof-url`, and
                            `enforceSubscription` returns early for GET — a
                            lapsed chapter can still read its own proof. */}
                      {entry.proof_path ? (
                        <Button
                          size="sm"
                          variant="link"
                          className="h-auto px-0 text-caption pointer-coarse:h-11"
                          onClick={() => void viewProof(entry)}
                          disabled={getProofUrl.isPending}
                        >
                          View proof
                        </Button>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {/*
                          `PATCH /v1/service-entries/:id/review` is paid-ops
                          too, so review mirrors the same gate as the log
                          trigger. Gating only the member's submit would leave
                          the page claiming writes are blocked while still
                          offering two per row.
                        */}
                      {/*
                          Approving awards SERVICE points to the submitter, and
                          the API refuses a self-approval (#1338). Mirror that
                          at the control rather than letting the click 403 —
                          the fail-fast entitlement rule.

                          Fails **closed** on an unresolved viewer, matching
                          `tasks-board.tsx:594-610` on the sibling task path:
                          `viewerUserId` is null while `/v1/users/me` is in
                          flight or errored, so keying on `isOwnEntry` alone
                          would put Approve back on your own entry during that
                          window. Unlike the task board it says why in both
                          cases — a silently withheld control is #1346.
                        */}
                      {/*
                          Secondary, not primary: every row in the queue
                          carries one, and a column of filled buttons is
                          louder than the entries it acts on (Billing's Mark
                          paid reads the same way). Reject is quiet beside it.
                        */}
                      <Button
                        size="toolbar"
                        variant="secondary"
                        onClick={() => void review.approve(entry)}
                        {...gate.controlProps(
                          review.isPending || cannotApprove,
                        )}
                        {...(showApproveReason
                          ? { "aria-describedby": approveReasonId }
                          : {})}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Approve
                      </Button>
                      {/*
                          Reject stays available on your own entry: it awards
                          no points, so the self-award rule does not reach it
                          (`spec/behavior/service-hours.md` § Approval Workflow).
                        */}
                      <Button
                        size="toolbar"
                        variant="ghost"
                        onClick={() => void review.reject(entry)}
                        {...gate.controlProps(review.isPending)}
                      >
                        <XCircle className="h-4 w-4" />
                        Reject
                      </Button>
                      {showApproveReason ? (
                        <p
                          id={approveReasonId}
                          className="basis-full text-caption text-muted-foreground"
                        >
                          {approveBlockedReason}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </Can>

      <section aria-labelledby="svc-history-label" className="space-y-3">
        <SectionLabel id="svc-history-label">History</SectionLabel>
        {/* `pending` is chapter-wide on purpose here, matching `history`, which
            is also everything the viewer may see. The second branch names no
            position: an approver reads the review queue above this section, but
            a member who cannot approve sees their pending entries only in the
            section below. */}
        {history.length === 0 && pending.length === 0 ? (
          // One line where the rows go (empty-states plan rule 7); the
          // first entry starts from the line, through the toolbar's gated
          // Log service dialog.
          <InlineNote>
            No service logged yet.
            {canLog ? (
              <>
                {" "}
                <InlineNoteAction
                  onClick={() => logDialog.setOpen(true)}
                  {...gate.controlProps()}
                >
                  Log the first hours
                </InlineNoteAction>
              </>
            ) : null}
          </InlineNote>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing reviewed yet.</p>
        ) : (
          <ul className={denseListClassName}>
            {history.map((entry) => {
              const name =
                memberNameById.get(entry.user_id) ??
                memberFallbackLabel(entry.user_id);
              const pointsLabel = awardedPointsLabel(entry);
              return (
                <li
                  key={entry.id}
                  className="flex min-h-11 flex-col gap-1 py-2 @2xl:flex-row @2xl:items-center @2xl:justify-between @2xl:gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{name}</p>
                    <p className="text-caption text-muted-foreground">
                      {entryMeta(entry)}
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {entry.description}
                    </p>
                    {entry.review_comment ? (
                      <p className="text-caption text-muted-foreground">
                        Reviewer note: {entry.review_comment}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={serviceStatusKind(entry.status)}>
                      {statusLabel("serviceEntry", entry.status)}
                    </Badge>
                    {pointsLabel ? (
                      <Badge variant="outline">{pointsLabel}</Badge>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {viewerUnknown ? (
        /* The viewer id is what scopes this section, so without it there is no
           honest list to show. But withholding the section silently is the
           wrong half of §5 rule 4 — a member whose `/v1/users/me` failed would
           find their only way to correct an entry simply gone, with no reason
           and no retry, which is the silent-dead-control gap #1346 records. Say
           which of the two states it is, in the same words the Approve control
           uses for them. */
        <section aria-labelledby="svc-mine-label" className="space-y-3">
          <SectionLabel id="svc-mine-label">Your pending entries</SectionLabel>
          <p className="text-sm text-muted-foreground">
            {viewerLoading
              ? "Confirming your account…"
              : "We couldn't confirm your account, so withdrawing is unavailable. Reload to try again."}
          </p>
        </section>
      ) : myPending.length > 0 ? (
        <section aria-labelledby="svc-mine-label" className="space-y-3">
          <SectionLabel
            id="svc-mine-label"
            count={`${myPending.length} pending`}
          >
            Your pending entries
          </SectionLabel>
          <ul className={denseListClassName}>
            {myPending.map((entry) => (
              <li
                key={entry.id}
                className="flex min-h-11 items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {entry.description}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {entryMeta(entry)}
                  </p>
                </div>
                {/* DELETE /v1/service-entries/:id accepts `service:log` OR
                    `service:approve`, and the service only refuses a foreign
                    entry when `!isAdmin` — so this is NOT "the same guard as
                    the submit that created the entry", which is what this
                    comment used to claim. An approver can delete anyone's
                    pending entry and its proof. The list is filtered to the
                    viewer above so that power is never reachable by mistake
                    from a section headed "Your pending entries". */}
                <Button
                  size="toolbar"
                  variant="ghost"
                  onClick={() => void withdraw(entry)}
                  {...gate.controlProps()}
                >
                  Withdraw
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {confirmDialog}
      {review.confirmDialog}
    </div>
  );
}
