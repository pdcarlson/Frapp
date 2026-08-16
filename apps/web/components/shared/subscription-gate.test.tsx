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
import { beyondGrace, chapterSubscription } from "@/tests/chapter-subscription";
import type { SubscriptionWriteClass } from "@/lib/subscription";

const { mockCurrentChapter, mockMyPermissions } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
  mockMyPermissions: vi.fn(),
}));

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

function grantBilling(permissions: string[] = ["billing:view"]) {
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
});

describe("useGatedDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
