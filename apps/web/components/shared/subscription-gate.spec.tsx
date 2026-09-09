import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { OfflineBanner } from "@/components/shared/offline-banner";
import { beyondGrace, chapterSubscription } from "@/tests/chapter-subscription";
import type { SubscriptionWriteClass } from "@repo/validation";

const { mockCurrentChapter, mockMyPermissions, mockOffline } = vi.hoisted(
  () => ({
    mockCurrentChapter: vi.fn(),
    mockMyPermissions: vi.fn(),
    mockOffline: { value: false, degraded: false as boolean | undefined },
  }),
);

vi.mock("@/lib/providers/network-provider", async () => {
  const { networkMock } = await import("@/tests/network");
  return networkMock(mockOffline);
});

vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useMyPermissions: () => mockMyPermissions(),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

const { SubscriptionNotice, useGatedDialog, useSubscriptionGate } =
  await import("./subscription-gate");

const chapter = chapterSubscription(mockCurrentChapter);

function grantBilling(permissions: string[] = ["billing:manage"]) {
  mockMyPermissions.mockReturnValue({
    data: { permissions },
    isPending: false,
    isError: false,
  });
}

/** A surface with one gated dialog trigger and one gated sibling control. */
function Harness({ writeClass }: { writeClass?: SubscriptionWriteClass }) {
  const gate = useSubscriptionGate(writeClass);
  const dialog = useGatedDialog(gate);

  return (
    <div>
      {/* Same chrome the dashboard layout mounts — the offline close path
          sends focus here rather than letting it fall to `<body>`. */}
      <OfflineBanner />
      <Dialog {...dialog.dialogProps}>
        <DialogTrigger asChild>
          <Button {...gate.controlProps()}>Upload</Button>
        </DialogTrigger>
        <DialogContent {...dialog.contentProps}>
          <DialogTitle>Upload document</DialogTitle>
        </DialogContent>
      </Dialog>
      {/* A sibling write on the same surface — §5's "gate every write". */}
      <Button {...gate.controlProps()}>Delete</Button>
      {/* Carries its own busy flag on top of the gate. */}
      <Button {...gate.controlProps(true)}>Retry</Button>
      <SubscriptionNotice gate={gate} feature="uploading documents" />
    </div>
  );
}

const uploadTrigger = () => screen.getByRole("button", { name: /upload$/i });
const deleteButton = () => screen.getByRole("button", { name: /delete/i });

describe("useSubscriptionGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOffline.value = false;
    mockOffline.degraded = false;
    grantBilling();
  });

  it("leaves every control alone on an active chapter", () => {
    chapter.active();
    render(<Harness />);

    expect(uploadTrigger()).toBeEnabled();
    expect(deleteButton()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("disables the trigger and names blocker plus next action when incomplete", () => {
    chapter.incomplete();
    render(<Harness />);

    // §5 rule 1: gate the trigger, never the submit.
    expect(uploadTrigger()).toBeDisabled();
    // §5 rule 2: the blocker, in the API's own words...
    expect(
      screen.getByText(/subscription is not active/i),
    ).toBeInTheDocument();
    // ...then the next action, pointing at the screen that clears it.
    expect(
      screen.getByRole("link", { name: /complete checkout/i }),
    ).toHaveAttribute("href", "/billing");
  });

  it("gates every write on the surface, not just the headline one", () => {
    chapter.incomplete();
    render(<Harness />);

    expect(deleteButton()).toBeDisabled();
  });

  it("ties every disabled control to the one explanation", () => {
    chapter.incomplete();
    render(<Harness />);

    const describedBy = uploadTrigger().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(deleteButton()).toHaveAttribute("aria-describedby", describedBy);
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /subscription is not active/i,
    );
  });

  it("gives each gate on a page its own notice id", () => {
    // A module-level constant would point every aria-describedby at whichever
    // notice mounted last, silently mis-describing one of the two surfaces.
    chapter.incomplete();
    render(
      <>
        <Harness />
        <Harness />
      </>,
    );

    const ids = screen.getAllByRole("status").map((el) => el.id);
    expect(ids).toHaveLength(2);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(2);
  });

  it("ORs the caller's own disabled conditions into the gate", () => {
    chapter.active();
    render(<Harness />);

    expect(screen.getByRole("button", { name: /retry/i })).toBeDisabled();
    expect(uploadTrigger()).toBeEnabled();
  });

  it("holds the gate shut while the chapter is still loading", () => {
    // The window between mount and the chapter resolving is the most common
    // path to the very 403 this gate prevents: a trigger that paints enabled
    // for that round trip still lets a fast click reach a doomed form.
    chapter.loading();
    render(<Harness />);

    expect(uploadTrigger()).toBeDisabled();
    expect(screen.getByText(/checking this chapter/i)).toBeInTheDocument();
    // No blocked explanation yet — nothing has established a reason.
    expect(
      screen.queryByText(/subscription is not active/i),
    ).not.toBeInTheDocument();
    expect(uploadTrigger().getAttribute("aria-describedby")).toBeTruthy();
  });

  it("fails open when the chapter record cannot be read", () => {
    // Deliberately asymmetric with `<Can>`, which fails closed. An unresolved
    // permission may be one the user never holds; an unresolved subscription
    // most likely belongs to a paying chapter, and locking its whole paid
    // surface over a failed fetch is worse than the late 403.
    chapter.unreadable();
    render(<Harness />);

    expect(uploadTrigger()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("points a canceled chapter at the portal, not at checkout", () => {
    chapter.canceled();
    render(<Harness />);

    expect(uploadTrigger()).toBeDisabled();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /billing portal/i }),
    ).toBeInTheDocument();
  });

  it("names someone who can help when the member cannot reach billing", () => {
    // The member who hits this on /tasks is usually not the member who can pay.
    // A link their own permission gate will bounce is a second dead end.
    grantBilling([]);
    chapter.incomplete();
    render(<Harness />);

    expect(screen.getByText(/ask a chapter officer/i)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("keeps free-tier writes working while incomplete", () => {
    chapter.incomplete();
    render(<Harness writeClass="free-tier" />);

    expect(uploadTrigger()).toBeEnabled();
  });

  it("blocks grace-blocked writes inside the grace window", () => {
    chapter.pastDue();
    render(<Harness writeClass="grace-blocked" />);

    expect(uploadTrigger()).toBeDisabled();
    expect(screen.getByText(/new invites are blocked/i)).toBeInTheDocument();
  });

  it("locks free-tier writes once the grace window closes", () => {
    chapter.pastDue(beyondGrace());
    render(<Harness writeClass="free-tier" />);

    expect(uploadTrigger()).toBeDisabled();
    expect(screen.getByText(/write actions are blocked/i)).toBeInTheDocument();
  });

  it("blocks paid-ops on past_due immediately, grace or not", () => {
    chapter.pastDue();
    render(<Harness />);

    expect(uploadTrigger()).toBeDisabled();
  });

  it("disables queueless writes while OFFLINE and puts the reason on the control", () => {
    chapter.active();
    mockOffline.value = true;
    render(<Harness />);

    expect(uploadTrigger()).toBeDisabled();
    expect(deleteButton()).toBeDisabled();
    expect(uploadTrigger()).toHaveAttribute(
      "title",
      "Reconnect to make changes.",
    );
    expect(deleteButton()).toHaveAttribute(
      "title",
      "Reconnect to make changes.",
    );
    // Finding 3: do not point aria-describedby at a notice outside the dialog
    // (and finding 4: do not mount a notice at all for an offline-only block).
    expect(uploadTrigger()).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/checking this chapter/i),
    ).not.toBeInTheDocument();
  });

  it("clears the offline title once the connection returns", () => {
    chapter.active();
    mockOffline.value = true;
    const { rerender } = render(<Harness />);
    expect(uploadTrigger()).toHaveAttribute(
      "title",
      "Reconnect to make changes.",
    );

    mockOffline.value = false;
    rerender(<Harness />);

    expect(uploadTrigger()).toBeEnabled();
    expect(uploadTrigger()).not.toHaveAttribute("title");
  });

  it("does not disable writes while DEGRADED", () => {
    chapter.active();
    mockOffline.degraded = true;
    render(<Harness />);

    expect(uploadTrigger()).toBeEnabled();
    expect(uploadTrigger()).not.toHaveAttribute("title");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("still disables an unreadable chapter while OFFLINE", () => {
    // Fail-open is a subscription rule. A dropped connection is a different
    // axis — the write would be lost, so the control stays shut.
    chapter.unreadable();
    mockOffline.value = true;
    render(<Harness />);

    expect(uploadTrigger()).toBeDisabled();
    expect(uploadTrigger()).toHaveAttribute(
      "title",
      "Reconnect to make changes.",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("prefers the offline title over a subscription notice when both apply", () => {
    chapter.incomplete();
    mockOffline.value = true;
    render(<Harness />);

    expect(uploadTrigger()).toBeDisabled();
    expect(uploadTrigger()).toHaveAttribute(
      "title",
      "Reconnect to make changes.",
    );
    expect(uploadTrigger()).not.toHaveAttribute("aria-describedby");
    // Billing is unreachable offline, so the checkout sentence would be a
    // dead end — and the pending spinner would spin forever.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/subscription is not active/i),
    ).not.toBeInTheDocument();
  });
});

describe("useGatedDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOffline.value = false;
    mockOffline.degraded = false;
    grantBilling();
  });

  it("refuses to open onto an action that cannot succeed", async () => {
    chapter.incomplete();
    render(<Harness />);

    await userEvent.click(uploadTrigger());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens normally when the write is permitted", async () => {
    chapter.active();
    render(<Harness />);

    await userEvent.click(uploadTrigger());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes an already-open dialog when the subscription lapses under it", async () => {
    // Radix fires onOpenChange only on an open/close *request*, so a background
    // refetch that revokes the write cannot be caught there.
    chapter.active();
    const { rerender } = render(<Harness />);
    await userEvent.click(uploadTrigger());
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    chapter.pastDue();
    rerender(<Harness />);

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("does NOT close an open dialog when the chapter merely re-enters pending", async () => {
    // The defect this guards: `allowed` folds in `isPending`, so keying the
    // close effect on it would treat "verdict not yet known" as a revocation.
    // `activeChapterId` is empty on first paint and cleared on every chapter
    // switch, and the chapter query re-enters pending each time — so a user who
    // opened a dialog in that window (the gate fails open, so the trigger was
    // live) would have their half-filled form discarded and be handed a notice
    // reading "Checking this chapter's subscription…" as the reason.
    chapter.active();
    const { rerender } = render(<Harness />);
    await userEvent.click(uploadTrigger());
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    chapter.loading();
    rerender(<Harness />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not hijack an ordinary close after a block has lifted", async () => {
    // `revokedRef` is normally consumed by `onCloseAutoFocus`, which needs a
    // mounted DialogContent. A surface can unmount its dialog subtree while
    // `open` is still true, stranding the flag — and a stale flag suppresses
    // Radix's focus restore on the next, perfectly ordinary close while the
    // notice it wants to focus is no longer rendered.
    chapter.incomplete();
    const { rerender } = render(<Harness />);

    chapter.active();
    rerender(<Harness />);
    await userEvent.click(uploadTrigger());
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    // Focus went back to the trigger, not to a notice that is not on screen.
    expect(uploadTrigger()).toHaveFocus();
  });

  it("moves focus to the notice when the dialog is yanked away", async () => {
    // Radix restores focus to the trigger, but the trigger goes disabled in the
    // same commit, so focus would land on <body> and restart keyboard
    // navigation at the top of the document.
    chapter.active();
    const { rerender } = render(<Harness />);
    await userEvent.click(uploadTrigger());

    chapter.incomplete();
    rerender(<Harness />);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveFocus(),
    );
  });

  it("does not slam an open dialog when the connection drops", async () => {
    chapter.active();
    const { rerender } = render(<Harness />);
    await userEvent.click(uploadTrigger());
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    mockOffline.value = true;
    rerender(<Harness />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // The trigger is `aria-hidden` while the dialog is open, so don't query
    // it here. The slam this guards is the dialog unmounting; it has not.
  });

  it("refuses to open while OFFLINE", async () => {
    chapter.active();
    mockOffline.value = true;
    render(<Harness />);

    await userEvent.click(uploadTrigger());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("moves focus to the offline banner when a dialog closes while OFFLINE", async () => {
    // Finding 2: the trigger is now disabled, so Radix's restore is a no-op
    // and focus would fall to <body> unless onCloseAutoFocus preempts it.
    chapter.active();
    const { rerender } = render(<Harness />);
    await userEvent.click(uploadTrigger());
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    mockOffline.value = true;
    rerender(<Harness />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("alert")).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });
});
