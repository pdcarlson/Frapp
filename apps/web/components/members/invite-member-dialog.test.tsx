import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { beyondGrace, chapterSubscription } from "@/tests/chapter-subscription";

const { mockCurrentChapter } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
}));

const INVITE = {
  id: "inv-1",
  token: "ABC123",
  role: "Member",
  expires_at: "2026-12-01T00:00:00Z",
  used_at: null,
};

vi.mock("@repo/hooks", () => ({
  useRoles: () => ({ data: [{ id: "r1", name: "Member" }], isError: false }),
  useInvites: () => ({ data: [INVITE], isError: false }),
  useCreateInvite: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBatchCreateInvites: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRevokeInvite: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCurrentChapter: () => mockCurrentChapter(),
  useMyPermissions: () => ({
    data: { permissions: ["billing:view"] },
    isPending: false,
    isError: false,
  }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { InviteMemberDialog } = await import("./invite-member-dialog");

const chapter = chapterSubscription(mockCurrentChapter);

async function openDialog() {
  render(<InviteMemberDialog trigger={<button>Invite</button>} />);
  await userEvent.click(screen.getByRole("button", { name: /^invite$/i }));
}

const generate = () => screen.getByRole("button", { name: /generate/i });
const revoke = () => screen.getByRole("button", { name: /revoke/i });

/**
 * `POST /invites` and `POST /invites/batch` are the repo's only two
 * `@FreeTier` + `@GraceBlocked` routes (`invite.controller.ts:46,60`). That
 * combination behaves unlike anything else in the entitlement sweep, and it is
 * the case #841's acceptance criteria call out by name: free-tier writes keep
 * working during the `past_due` grace window, and only invites are blocked.
 */
describe("InviteMemberDialog subscription gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps invites available on an incomplete chapter", async () => {
    // The distinguishing case. A `paid` control is blocked here; these routes
    // are `@FreeTier`, so gating them on `incomplete` would lock a chapter out
    // of the very recruiting it needs to grow before it converts.
    chapter.incomplete();
    await openDialog();

    expect(generate()).toBeEnabled();
    expect(
      screen.queryByText(/subscription is not active/i),
    ).not.toBeInTheDocument();
  });

  it("blocks invites by name inside the past_due grace window", async () => {
    chapter.pastDue();
    await openDialog();

    expect(generate()).toBeDisabled();
    expect(screen.getByText(/new invites are blocked/i)).toBeInTheDocument();
  });

  it("leaves revoke live during grace — only invites are blocked", async () => {
    // The other half of the same acceptance criterion. `DELETE /invites/:id`
    // carries the class-level `@FreeTier` without `@GraceBlocked`, so a chapter
    // inside grace can still withdraw a token it already issued.
    chapter.pastDue();
    await openDialog();

    expect(revoke()).toBeEnabled();
  });

  it("locks invites once the grace window closes", async () => {
    chapter.pastDue(beyondGrace());
    await openDialog();

    expect(generate()).toBeDisabled();
    // Revoke locks here too — `@FreeTier` survives grace, not past it — so both
    // notices render the same sentence.
    expect(revoke()).toBeDisabled();
    expect(
      screen.getAllByText(/write actions are blocked/i).length,
    ).toBeGreaterThan(0);
  });

  it("blocks invites on a canceled chapter", async () => {
    // `canceled` is checked above the free-tier carve-out in the guard, so a
    // naive "free-tier means always allowed" mapping gets this one wrong.
    chapter.canceled();
    await openDialog();

    expect(generate()).toBeDisabled();
    // `canceled` is checked above the free-tier carve-out, so revoke goes too.
    expect(revoke()).toBeDisabled();
    expect(screen.getAllByText(/read-only/i).length).toBeGreaterThan(0);
  });

  it("leaves everything alone on an active chapter", async () => {
    chapter.active();
    await openDialog();

    expect(generate()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("fails open when the chapter record cannot be read", async () => {
    chapter.unreadable();
    await openDialog();

    expect(generate()).toBeEnabled();
  });
});
