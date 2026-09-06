"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * In-product confirmation, replacing `window.confirm` and `window.prompt`.
 *
 * `spec/ui/design-system/README.md` §2 bans "`window.confirm` (and other
 * browser-chrome dialogs)" on **every surface** — not just Signet ones, which
 * is the one row of that table whose Binds column is not scoped to the reskin —
 * and §9 spells the replacement: "destructive confirmation is always a dialog
 * (web) or sheet (mobile) pairing a Destructive button with a Secondary
 * cancel". `ui/dialog.tsx` has carried that sentence since the primitives
 * slice; nothing implemented it, so ten surfaces kept calling out to the
 * browser. Chapter Ops holds six of them, which is why the shared control lands
 * with this slice — the same reason the chat slice added the `mention` badge
 * and the Directory & Finance slice added `nested-states.tsx`.
 *
 * **The API is a promise, deliberately.** Every call site reads
 * `const ok = window.confirm(...); if (!ok) return;` inside an async handler,
 * and a declarative `open`/`pending-target` rewrite would restructure six
 * handlers to change a presentation rule. `await confirm({...})` keeps each
 * handler's control flow identical, so the diff is the dialog and nothing else.
 *
 * **`null` and `""` are different answers, and two call sites depend on it.**
 * `window.prompt` returns `null` when a person cancels and `""` when they press
 * OK having typed nothing; `tasks-board.tsx` and `service-page.tsx` both branch
 * on `=== null` and then pass `comment || undefined`. A confirmation that
 * collapsed those would silently reject a task with no comment where the person
 * meant to abandon the rejection entirely. So this resolves `null` for cancel
 * and a `{ comment }` object — with `comment` possibly `""` — for confirm, and
 * `confirm-dialog.spec.tsx` pins that distinction.
 *
 * **Focus return is not Radix's default here.** These dialogs open from a plain
 * `onClick`, not a `DialogTrigger`, so Radix restores focus to whatever was
 * focused when they opened — which is the right answer only while that control
 * survives the confirmation. It often does not: a delete removes the row its
 * own button lives in, and every one of these buttons carries
 * `gate.controlProps()` and can go `disabled` mid-flight. That is the same
 * failure `useGatedDialog` documents on the revoke path, and the fix is the
 * same one — preempt `onCloseAutoFocus` rather than chase it with a
 * `requestAnimationFrame`, which Radix overwrites. When the opener is gone or
 * disabled, focus goes to the shell's `#main-content` landmark — the target the
 * "Skip to main content" link already uses — rather than to a detached node,
 * which is `<body>` and restarts keyboard navigation at the top of the page.
 */

export type ConfirmTone = "destructive" | "default";

export type ConfirmRequest = {
  /** The question, as a question. `writing.md` §2. */
  title: string;
  description: string;
  /**
   * The verb and its object — "Delete study zone", never "Confirm".
   * `writing.md` §2's CTA rule, and it also keeps the accessible name unique:
   * the suites already query these screens by `name: /^confirm$/i` and
   * `/delete/i` for the page's own buttons.
   */
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  /** Present for the two flows that replace `window.prompt`. */
  comment?: { label: string; placeholder?: string };
};

export type ConfirmResult = { comment: string };

type PendingRequest = ConfirmRequest & {
  resolve: (result: ConfirmResult | null) => void;
};

export function useConfirmDialog(): {
  confirm: (request: ConfirmRequest) => Promise<ConfirmResult | null>;
  confirmDialog: React.ReactNode;
} {
  const [pending, setPending] = React.useState<PendingRequest | null>(null);
  const [comment, setComment] = React.useState("");
  const openerRef = React.useRef<Element | null>(null);
  /*
   * The last request, kept after `pending` clears. Radix keeps `DialogContent`
   * mounted through its 200ms exit transition, so reading the live `pending`
   * for the title and the button labels blanks them mid-animation on every
   * close. State rather than a ref because the compiler lint — correctly —
   * forbids reading or writing a ref during render.
   */
  const [shown, setShown] = React.useState<ConfirmRequest | null>(null);

  const settle = React.useCallback((result: ConfirmResult | null) => {
    setPending((current) => {
      current?.resolve(result);
      return null;
    });
  }, []);

  const confirm = React.useCallback((request: ConfirmRequest) => {
    openerRef.current = document.activeElement;
    setComment("");
    setShown(request);
    return new Promise<ConfirmResult | null>((resolve) => {
      setPending((current) => {
        /*
         * A second confirmation before the first settles would otherwise
         * drop the first `resolve` on the floor and hang its `await`
         * forever. Two clicks can land in one commit — a held Enter key
         * repeats faster than the overlay paints. The superseded request
         * answers `null`, which every call site already treats as cancel.
         */
        current?.resolve(null);
        return { ...request, resolve };
      });
    });
  }, []);

  function handleCloseAutoFocus(event: Event) {
    const opener = openerRef.current;
    const openerUsable =
      opener instanceof HTMLElement &&
      // `document.activeElement` is `<body>` when nothing holds focus, and
      // `<body>` passes every check below — WebKit does not focus a button on
      // mouse-down, so treating it as usable reproduces exactly the drop to
      // `<body>` this function exists to prevent.
      opener !== document.body &&
      opener.isConnected &&
      !opener.hasAttribute("disabled") &&
      opener.getAttribute("aria-disabled") !== "true";
    if (openerUsable) return;
    event.preventDefault();
    // The shell's own landmark, which the "Skip to main content" link already
    // targets. `tabindex="-1"` is the standard skip-link pattern: a landmark is
    // not focusable on its own.
    const main = document.getElementById("main-content");
    if (main) {
      main.setAttribute("tabindex", "-1");
      main.focus({ preventScroll: true });
    }
  }

  const confirmDialog = (
    <ConfirmDialogHost open={pending !== null} onSettle={settle}>
      <DialogContent onCloseAutoFocus={handleCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle className="break-words">{shown?.title}</DialogTitle>
          <DialogDescription>{shown?.description}</DialogDescription>
        </DialogHeader>
        {shown?.comment ? (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-dialog-comment">
              {shown.comment.label}
            </Label>
            <Textarea
              id="confirm-dialog-comment"
              value={comment}
              placeholder={shown.comment.placeholder}
              onChange={(event) => setComment(event.target.value)}
            />
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={() => settle(null)}>
            {shown?.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            variant={shown?.tone === "default" ? "default" : "destructive"}
            onClick={() => settle({ comment })}
          >
            {shown?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </ConfirmDialogHost>
  );

  return { confirm, confirmDialog };
}

/**
 * The `<Dialog>` root, plus the guarantee that a pending promise settles even
 * if the caller stops rendering it.
 *
 * That is not hypothetical: every screen using this hook renders
 * `{confirmDialog}` inside its main return, *after* early returns for the
 * offline, loading and error states. Going offline with a confirmation open
 * takes the whole subtree away — `onOpenChange` never fires for an unmount, so
 * without this the caller's `await confirm(...)` would hang forever, holding
 * its closure over the row and the mutation. Settling on unmount puts the
 * guarantee in the one place that cannot be forgotten by a call site.
 */
function ConfirmDialogHost({
  open,
  onSettle,
  children,
}: {
  open: boolean;
  /**
   * The hook's `settle`, passed directly rather than wrapped in an arrow.
   * It is `useCallback([])`-stable, which is what makes the cleanup below fire
   * on unmount and not on every render — an inline `() => settle(null)` would
   * be a new identity each render, so the effect would tear down and re-run
   * continuously and cancel every confirmation the moment it opened.
   */
  onSettle: (result: ConfirmResult | null) => void;
  children: React.ReactNode;
}) {
  React.useEffect(() => () => onSettle(null), [onSettle]);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Escape, the overlay and the close affordance all route here, and all
        // three mean cancel — never an empty confirmation.
        if (!next) onSettle(null);
      }}
    >
      {children}
    </Dialog>
  );
}
