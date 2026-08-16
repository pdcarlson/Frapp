"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Can } from "@/components/shared/can";
import { useSubscriptionWriteState } from "@/lib/hooks/use-subscription-write-state";
import type {
  SubscriptionWriteClass,
  SubscriptionWriteState,
} from "@/lib/subscription";
import { cn } from "@/lib/utils";

/**
 * The reusable half of the §5 entitlement-gating standard
 * (`spec/ui/design-system/README.md`), extracted from `InvoiceAdminCard` so the
 * remaining paid-ops surfaces do not each re-solve it (#841).
 *
 * `useSubscriptionWriteState` answers *whether* a write is permitted. Turning
 * that answer into a correct control is the part that kept going wrong: it is
 * five separate concerns — the pending fold-in, the mid-flight revoke, the
 * refusal to open, the aria wiring, and the notice — and getting any one of
 * them wrong produces a control that either lies or traps focus.
 *
 * This is deliberately **not** a `<Can>`-style wrapper. §5 rule 4 requires
 * *disabling* the control rather than hiding it, so the caller needs the reason
 * and not just a boolean.
 *
 * ```tsx
 * const gate = useSubscriptionGate();
 * const upload = useGatedDialog(gate);
 *
 * <Dialog {...upload.dialogProps}>
 *   <DialogTrigger asChild>
 *     <Button {...gate.controlProps()}>Upload</Button>
 *   </DialogTrigger>
 *   …
 * </Dialog>
 * <SubscriptionNotice gate={gate} feature="uploading" />
 * ```
 */
export type SubscriptionGate = {
  /**
   * Writes in this class are permitted right now. Already folds in the pending
   * case, so callers never have to remember to `&& !isPending` — forgetting
   * that is what leaves a control live through the whole fetch.
   */
  allowed: boolean;
  /** The chapter record has not resolved; `allowed` is provisional (fails open). */
  isPending: boolean;
  /** The underlying verdict, for callers that need `reason` / `code` directly. */
  state: SubscriptionWriteState;
  /** Ties every control this gate disables to the sentence explaining it. */
  noticeId: string;
  /**
   * Spread onto every control the gate covers — §5's "gate every write on the
   * surface, not just the headline one".
   *
   * Takes the caller's own disabled conditions as an argument rather than
   * expecting them to be OR-ed in afterwards. A caller who spreads these props
   * and *then* writes `disabled={busy}` silently drops the gate; passing
   * `controlProps(busy)` cannot express that mistake.
   */
  controlProps: (alsoDisabled?: boolean) => {
    disabled: boolean;
    "aria-describedby": string | undefined;
  };
  /** @internal — wiring for `SubscriptionNotice` and `useGatedDialog`. */
  noticeRef: React.RefObject<HTMLParagraphElement | null>;
};

/**
 * Read the subscription verdict for one surface.
 *
 * Pass the `writeClass` matching the route's decorators; `paid` is the default
 * and the safe one. `free-tier` / `grace-blocked` correspond to `@FreeTier` and
 * `@FreeTier` + `@GraceBlocked` on the API side.
 */
export function useSubscriptionGate(
  writeClass: SubscriptionWriteClass = "paid",
): SubscriptionGate {
  const { state, isPending } = useSubscriptionWriteState(writeClass);
  const allowed = state.allowed && !isPending;
  const noticeRef = useRef<HTMLParagraphElement | null>(null);
  // `useId` rather than a module-level constant: several gated surfaces render
  // more than one control group, and a shared literal id would point every
  // `aria-describedby` at whichever notice mounted last.
  const noticeId = useId();

  const controlProps = useCallback(
    (alsoDisabled = false) => ({
      disabled: !allowed || alsoDisabled,
      "aria-describedby": allowed ? undefined : noticeId,
    }),
    [allowed, noticeId],
  );

  return { allowed, isPending, state, noticeId, noticeRef, controlProps };
}

export type GatedDialog = {
  open: boolean;
  setOpen: (next: boolean) => void;
  /** Spread onto the Radix `<Dialog>` / `<Sheet>` / `<AlertDialog>` root. */
  dialogProps: { open: boolean; onOpenChange: (next: boolean) => void };
  /**
   * Spread onto the matching `<DialogContent>`. Handles focus on the revoke
   * path; without it that path falls back to Radix's default, which lands focus
   * on a now-disabled trigger and therefore on `<body>`.
   */
  contentProps: {
    onCloseAutoFocus: (event: Event) => void;
  };
};

/**
 * Dialog open-state that can never be open while the gate is blocked.
 *
 * Two distinct failure modes, both real:
 *
 * 1. **Opening while blocked** — handled in `onOpenChange`, because §5 rule 1
 *    is "gate the trigger, not the submit": a dialog must never open onto an
 *    action that cannot succeed.
 * 2. **Being revoked while already open** — a background refetch, or the
 *    chapter query simply resolving, can flip the verdict after the dialog is
 *    up. Radix's `onOpenChange` never fires for that, so without the effect the
 *    user finishes a form that is guaranteed to 403.
 *
 * Focus has to be placed deliberately on that second path. Radix returns focus
 * to the trigger on close, but the trigger goes `disabled` in the same commit,
 * so `.focus()` on it is a no-op and focus falls to `<body>` — restarting
 * keyboard navigation at the top of the document. It goes to the notice
 * instead, which is focusable and is the explanation for what just happened.
 *
 * That redirect runs through Radix's own `onCloseAutoFocus` rather than a
 * `requestAnimationFrame` chase. Radix restores focus *after* the next animation
 * frame, so a rAF-scheduled `.focus()` is silently overwritten — it looks
 * correct in review and does nothing at runtime. Only the revoke path preempts
 * the default; an ordinary close still returns focus to the trigger, which is
 * both enabled and where the user was.
 */
export function useGatedDialog(gate: SubscriptionGate): GatedDialog {
  const [open, setOpenState] = useState(false);
  const { allowed, noticeRef } = gate;
  const revokedRef = useRef(false);

  // Closing keys on the *verdict*, not on `allowed` — the two differ by
  // `isPending`, and conflating them destroys the user's work.
  //
  // `activeChapterId` starts empty on first paint and is cleared again on every
  // chapter switch, and the chapter query re-enters `pending` each time. With
  // `allowed` here, a user who opened a dialog during that window (the gate
  // fails open, so the trigger was enabled) would have the dialog slammed shut
  // and their draft discarded the moment the query started resolving — and be
  // handed a notice reading "Checking this chapter's subscription…" as the
  // reason. Only a definite `allowed: false` is a revocation.
  const blocked = !gate.state.allowed;

  useEffect(() => {
    if (!open || !blocked) return;
    revokedRef.current = true;
    setOpenState(false);
  }, [open, blocked]);

  // Clear the flag once the block lifts. It is normally consumed by
  // `onCloseAutoFocus`, but that needs a mounted `DialogContent` — and a
  // surface can unmount its dialog subtree (an error state, a permission
  // refetch) while `open` is still true. Without this reset the flag survives
  // into a later, ordinary close and steals focus to a notice that is no longer
  // rendered, dropping focus to `<body>`: the exact failure this hook exists to
  // prevent, on the happy path.
  useEffect(() => {
    if (!blocked) revokedRef.current = false;
  }, [blocked]);

  const setOpen = useCallback(
    (next: boolean) => {
      if (next && !allowed) return;
      setOpenState(next);
    },
    [allowed],
  );

  const onCloseAutoFocus = useCallback(
    (event: Event) => {
      if (!revokedRef.current) return;
      revokedRef.current = false;
      event.preventDefault();
      noticeRef.current?.focus();
    },
    [noticeRef],
  );

  return {
    open,
    setOpen,
    dialogProps: { open, onOpenChange: setOpen },
    contentProps: { onCloseAutoFocus },
  };
}

export type SubscriptionNoticeProps = {
  gate: SubscriptionGate;
  /**
   * What is unavailable, as a gerund phrase completing "…to restore {feature}".
   * Keep it concrete — "uploading documents" beats "this feature".
   */
  feature: string;
  /**
   * Replaces the default recovery sentence. The billing screen passes its own,
   * because §5 rule 3 says never gate a user out of the screen that ungates
   * them — and pointing that screen at itself is noise.
   */
  recovery?: React.ReactNode;
  className?: string;
};

/**
 * The `role="status"` explanation that every disabled control on the surface
 * points at via `aria-describedby`.
 *
 * Renders nothing when the write is permitted, so callers can mount it
 * unconditionally.
 *
 * The recovery link is wrapped in `<Can permission="billing:manage">` — the
 * permission the checkout card itself requires
 * (`components/billing/subscription-checkout-card.tsx`), not the weaker
 * `billing:view` that merely opens the screen. The member who hits this on
 * /tasks is usually neither, and offering them a link to a page where the
 * button is gated too is a second dead end rather than a recovery path.
 */
export function SubscriptionNotice({
  gate,
  feature,
  recovery,
  className,
}: SubscriptionNoticeProps) {
  const { allowed, isPending, state, noticeId, noticeRef } = gate;

  if (allowed) return null;

  return (
    <p
      id={noticeId}
      ref={noticeRef}
      tabIndex={-1}
      // `status` so a screen reader hears the reason when the write is revoked
      // under an open dialog — that close is otherwise silent.
      role="status"
      className={cn(
        "mb-4 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground",
        className,
      )}
    >
      {isPending ? (
        <>
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Checking this chapter&apos;s subscription…
        </>
      ) : state.allowed ? null : (
        <>
          {state.reason}{" "}
          {recovery ?? <DefaultRecovery feature={feature} state={state} />}
        </>
      )}
    </p>
  );
}

function DefaultRecovery({
  feature,
  state,
}: {
  feature: string;
  state: Extract<SubscriptionWriteState, { allowed: false }>;
}) {
  // `canceled` is the one state the member cannot clear by paying, so it gets
  // portal copy rather than a checkout link that would not help.
  const action = state.recoverable
    ? "Complete checkout on the billing screen"
    : "Reopen the subscription from the billing portal";

  // `<Can>` fails closed and defaults `fallback` to `null`, which here would
  // leave the reason stated with no next action at all while permissions load.
  // Both non-granted branches therefore render the officer copy: naming someone
  // who can fix it is always better than naming nobody.
  const askAnOfficer = <>Ask a chapter officer to restore {feature}.</>;

  return (
    <Can
      permission="billing:manage"
      fallback={askAnOfficer}
      deniedFallback={askAnOfficer}
    >
      <Link href="/billing" className="font-medium underline underline-offset-4">
        {action}
      </Link>{" "}
      to restore {feature}.
    </Can>
  );
}
