import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { beyondGrace, chapterSubscription } from "@/tests/chapter-subscription";

const {
  mockCurrentChapter,
  mockOrgConfig,
  mockRoles,
  mockToast,
  mockCreateInvite,
  mockEmailInvites,
  mockRevoke,
  mockInvites,
  mockRefetchRoles,
  mockRefetchInvites,
  activeChapterId,
} = vi.hoisted(() => ({
  activeChapterId: { current: "chapter-1" as string | null },
  mockRefetchRoles: vi.fn(),
  mockRefetchInvites: vi.fn(),
  mockCurrentChapter: vi.fn(),
  mockCreateInvite: vi.fn(),
  mockEmailInvites: vi.fn(),
  mockRevoke: vi.fn(),
  mockInvites: vi.fn(),
  mockOrgConfig: vi.fn(),
  mockRoles: vi.fn(),
  mockToast: vi.fn(),
}));

const NOW = Date.now();
const INVITE = {
  id: "inv-1",
  token: "8f0c2a5e-0000-4000-8000-00000000c123",
  role: "Member",
  email: "pledge@school.edu",
  status: "pending" as const,
  expires_at: new Date(NOW + 20 * 3600_000).toISOString(),
  used_at: null,
  revoked_at: null,
  created_at: new Date(NOW - 4 * 3600_000).toISOString(),
};

vi.mock("@repo/hooks", () => ({
  useActiveChapterId: () => activeChapterId.current,
  // `refetch`: opening the panel re-reads invites and roles.
  useRoles: () => ({ refetch: mockRefetchRoles, ...mockRoles() }),
  useOrgConfig: () => mockOrgConfig(),
  useInvites: () => ({
    data: mockInvites(),
    isError: false,
    refetch: mockRefetchInvites,
  }),
  useCreateInvite: () => ({ mutateAsync: mockCreateInvite, isPending: false }),
  useEmailInvites: () => ({ mutateAsync: mockEmailInvites, isPending: false }),
  useRevokeInvite: () => ({ mutateAsync: mockRevoke, isPending: false }),
  useCurrentChapter: () => mockCurrentChapter(),
  useMyPermissions: () => ({
    data: { permissions: ["billing:manage"] },
    isPending: false,
    isError: false,
  }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const { InviteMemberDialog, listedInvites, sentLabel } =
  await import("./invite-member-dialog");

const chapter = chapterSubscription(mockCurrentChapter);

async function openDialog() {
  const view = render(<InviteMemberDialog trigger={<button>Invite</button>} />);
  await userEvent.click(screen.getByRole("button", { name: /^invite$/i }));
  return view;
}

const copyLink = () => screen.getByRole("button", { name: /copy link/i });
const emailField = () => screen.getByLabelText(/invite by email/i);
const send = () => screen.getByRole("button", { name: /^send/i });

/** Opens the ⋯ menu on the pledge@ row and returns its Revoke item. */
async function revoke() {
  await userEvent.click(
    screen.getByRole("button", { name: `More for ${INVITE.email}` }),
  );
  return screen.findByRole("menuitem", { name: /revoke invite/i });
}

/** Default hook state every test starts from; individual tests override. */
function primeHooks() {
  mockRoles.mockReturnValue({
    data: [{ id: "r1", name: "Member" }],
    isError: false,
  });
  mockOrgConfig.mockReturnValue({ data: {}, isError: false });
  mockInvites.mockReturnValue([INVITE]);
}

/**
 * `POST /invites` and `POST /invites/email` are `@FreeTier` + `@GraceBlocked`.
 * That combination behaves unlike anything else in the entitlement sweep, and
 * it is the case #841's acceptance criteria call out by name: free-tier writes
 * keep working during the `past_due` grace window, and only invites are
 * blocked. Copy link is the control every state can check, since Send also
 * waits for an address.
 */
describe("InviteMemberDialog subscription gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHooks();
  });

  it("keeps invites available on an incomplete chapter", async () => {
    // The distinguishing case. A `paid` control is blocked here; these routes
    // are `@FreeTier`, so gating them on `incomplete` would lock a chapter out
    // of the very recruiting it needs to grow before it converts.
    chapter.incomplete();
    await openDialog();

    expect(copyLink()).toBeEnabled();
    expect(
      screen.queryByText(/subscription is not active/i),
    ).not.toBeInTheDocument();
  });

  it("blocks invites by name inside the past_due grace window", async () => {
    chapter.pastDue();
    await openDialog();

    expect(copyLink()).toBeDisabled();
    expect(screen.getByText(/new invites are blocked/i)).toBeInTheDocument();
  });

  it("leaves revoke live during grace — only invites are blocked", async () => {
    // The other half of the same acceptance criterion. `DELETE /invites/:id`
    // carries the class-level `@FreeTier` without `@GraceBlocked`, so a chapter
    // inside grace can still withdraw a token it already issued.
    chapter.pastDue();
    await openDialog();

    expect(await revoke()).not.toHaveAttribute("data-disabled");
  });

  it("locks invites once the grace window closes", async () => {
    chapter.pastDue(beyondGrace());
    await openDialog();

    expect(copyLink()).toBeDisabled();
    // Revoke locks here too — `@FreeTier` survives grace, not past it — so both
    // notices render the same sentence.
    expect(await revoke()).toHaveAttribute("data-disabled");
    expect(
      screen.getAllByText(/write actions are blocked/i).length,
    ).toBeGreaterThan(0);
  });

  it("blocks invites on a canceled chapter", async () => {
    // `canceled` is checked above the free-tier carve-out in the guard, so a
    // naive "free-tier means always allowed" mapping gets this one wrong.
    chapter.canceled();
    await openDialog();

    expect(copyLink()).toBeDisabled();
    // `canceled` is checked above the free-tier carve-out, so revoke goes too.
    expect(await revoke()).toHaveAttribute("data-disabled");
    expect(screen.getAllByText(/read-only/i).length).toBeGreaterThan(0);
  });

  it("leaves everything alone on an active chapter", async () => {
    chapter.active();
    await openDialog();

    expect(copyLink()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("fails open when the chapter record cannot be read", async () => {
    chapter.unreadable();
    await openDialog();

    expect(copyLink()).toBeEnabled();
  });
});

/**
 * #422. The picker used to seed `"Member"` and then snap to
 * `roleOptions[0]` — the *alphabetically first* role — whenever Member was
 * absent from the catalog. That made the effective default arbitrary, which is
 * what this issue reported.
 */
describe("InviteMemberDialog default role", () => {
  const ROLES = [
    { id: "role-alumni", name: "Alumni" },
    { id: "role-member", name: "Member" },
    { id: "role-pledge", name: "New Member" },
  ];

  // The trigger reads "Joins as <role>"; its value is the role after that.
  const rolePicker = () => {
    const trigger = screen.getByRole("combobox", {
      name: /role they join as/i,
    });
    return { value: trigger.textContent?.replace(/^Joins as/, "") ?? "" };
  };
  async function pick(name: string) {
    await userEvent.click(
      screen.getByRole("combobox", { name: /role they join as/i }),
    );
    await userEvent.click(await screen.findByRole("option", { name }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    primeHooks();
    chapter.active();
  });

  it("pre-selects the chapter's configured default invite role", async () => {
    mockRoles.mockReturnValue({ data: ROLES, isError: false });
    mockOrgConfig.mockReturnValue({
      data: { default_invite_role_id: "role-pledge" },
      isError: false,
    });
    await openDialog();

    expect(rolePicker().value).toBe("New Member");
  });

  /*
   * The regression that motivated tracking the choice separately. The roles
   * query and the config query resolve independently; when roles land first
   * the picker settles on a valid-but-arbitrary role, and a correction keyed
   * on "is the current value broken?" never fires because it is not broken —
   * it is merely wrong. Simulated here by the config arriving as a second
   * render with roles already present.
   */
  it("adopts the default when the config query resolves after the roles query", async () => {
    mockRoles.mockReturnValue({ data: ROLES, isError: false });
    mockOrgConfig.mockReturnValue({ data: undefined, isError: false });
    const view = await openDialog();
    // The no-default fallback, and not what the chapter configured.
    expect(rolePicker().value).toBe("Member");

    mockOrgConfig.mockReturnValue({
      data: { default_invite_role_id: "role-pledge" },
      isError: false,
    });
    // A re-render re-reads the (now resolved) config hook — the same
    // sequence a settled query produces, without needing a real query client.
    view.rerender(<InviteMemberDialog trigger={<button>Invite</button>} />);

    expect(rolePicker().value).toBe("New Member");
  });

  it("keeps an explicit pick over the configured default", async () => {
    mockRoles.mockReturnValue({ data: ROLES, isError: false });
    mockOrgConfig.mockReturnValue({
      data: { default_invite_role_id: "role-pledge" },
      isError: false,
    });
    await openDialog();
    await pick("Alumni");

    expect(rolePicker().value).toBe("Alumni");
  });

  /*
   * The regression guard. `roleOptions` is sorted alphabetically, so seeding
   * the picker off `roleOptions[0]` pre-selects **Alumni** on every chapter
   * that has not configured a default — which is all of them, since the column
   * ships null with no backfill. That would hand new members the alumni
   * lifecycle restrictions instead of Member, reintroducing the arbitrary
   * default #422 exists to remove. Member must win whenever it is in the
   * catalog, exactly as it did before this field existed.
   */
  it("falls back to Member, not the alphabetically first role, when no default is configured", async () => {
    mockRoles.mockReturnValue({ data: ROLES, isError: false });
    mockOrgConfig.mockReturnValue({ data: {}, isError: false });
    await openDialog();

    expect(rolePicker().value).toBe("Member");
  });

  // `GET /v1/roles` carries `system_key`, so a chapter that renamed Member
  // still gets it pre-selected, not the Alumni role that sorts first (#2484).
  it("finds a renamed Member role by its system key", async () => {
    mockRoles.mockReturnValue({
      data: [
        { id: "role-alumni", name: "Alumni", system_key: "ALUMNI" },
        { id: "role-member", name: "Brother", system_key: "MEMBER" },
        { id: "role-pledge", name: "New Member", system_key: "NEW_MEMBER" },
      ],
      isError: false,
    });
    mockOrgConfig.mockReturnValue({ data: {}, isError: false });
    await openDialog();

    expect(rolePicker().value).toBe("Brother");
  });

  it("falls back to the first role only when the catalog has no Member role", async () => {
    mockRoles.mockReturnValue({
      data: [
        { id: "role-alumni", name: "Alumni" },
        { id: "role-pledge", name: "New Member" },
      ],
      isError: false,
    });
    mockOrgConfig.mockReturnValue({ data: {}, isError: false });
    await openDialog();

    expect(rolePicker().value).toBe("Alumni");
  });

  /*
   * `GET /chapters/:id/config` needs `chapter-config:view`, while the dialog
   * needs only `members:invite` — so a delegated recruitment officer can get a
   * 403 here. Degrading to Member (not to whatever sorts first) keeps that
   * failure boring.
   *
   * The component reaches this through `data` being absent rather than by
   * reading `isError`, so mechanically this is the same path as the
   * unresolved-config case above. It is kept as a separate case because the
   * *guarantee* is what matters — a config read the inviter is not allowed to
   * make must not silently change which role gets issued.
   */
  it("degrades to Member when the config query fails", async () => {
    mockRoles.mockReturnValue({ data: ROLES, isError: false });
    mockOrgConfig.mockReturnValue({ data: undefined, isError: true });
    await openDialog();

    expect(rolePicker().value).toBe("Member");
  });

  it("re-adopts the default after the panel is closed", async () => {
    mockRoles.mockReturnValue({ data: ROLES, isError: false });
    mockOrgConfig.mockReturnValue({
      data: { default_invite_role_id: "role-pledge" },
      isError: false,
    });
    await openDialog();
    await pick("Alumni");
    expect(rolePicker().value).toBe("Alumni");

    // The panel's X is its only close control now that the Done footer is
    // gone; it goes through `handleOpenChange`, which owns the reset.
    await userEvent.click(screen.getByRole("button", { name: /^close$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^invite$/i }));

    expect(rolePicker().value).toBe("New Member");
  });

  /*
   * `on delete set null` clears a deleted role's id server-side, but a client
   * holding a stale config read can still name one the catalog no longer has.
   * Falling through to the existing behaviour beats a picker whose value
   * matches no option.
   */
  it("ignores a configured default that no longer exists", async () => {
    mockRoles.mockReturnValue({ data: ROLES, isError: false });
    mockOrgConfig.mockReturnValue({
      data: { default_invite_role_id: "role-deleted" },
      isError: false,
    });
    await openDialog();

    expect(rolePicker().value).toBe("Member");
  });
});

// The panel has no Refresh button: opening it re-reads both lists (invites are
// cached for a minute, so another officer's revoke would otherwise show as
// live), and a failed read offers its retry beside the reason.
describe("InviteMemberDialog live data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHooks();
    chapter.active();
  });

  it("re-reads invites and roles each time the panel opens", async () => {
    await openDialog();
    expect(mockRefetchInvites).toHaveBeenCalledTimes(1);
    expect(mockRefetchRoles).toHaveBeenCalledTimes(1);
  });

  it("reads nothing before a chapter is active, since refetch skips the hooks' guard", async () => {
    activeChapterId.current = null;
    try {
      await openDialog();
      expect(mockRefetchInvites).not.toHaveBeenCalled();
      expect(mockRefetchRoles).not.toHaveBeenCalled();
    } finally {
      activeChapterId.current = "chapter-1";
    }
  });

  it("offers Try again beside a failed read, and it re-reads both lists", async () => {
    mockRoles.mockReturnValue({ data: undefined, isError: true });
    await openDialog();
    vi.clearAllMocks();
    mockRoles.mockReturnValue({ data: undefined, isError: true });

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(mockRefetchInvites).toHaveBeenCalledTimes(1);
    expect(mockRefetchRoles).toHaveBeenCalledTimes(1);
  });
});

describe("InviteMemberDialog sending by email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHooks();
    chapter.active();
    mockEmailInvites.mockResolvedValue({ invites: [], failed: [] });
  });

  it("sends every address in the field, including one still being typed, as the picked role", async () => {
    await openDialog();
    await userEvent.type(
      emailField(),
      "a@school.edu, b@school.edu c@school.edu",
    );

    expect(send()).toHaveTextContent("Send 3 invites");
    await userEvent.click(send());

    expect(mockEmailInvites).toHaveBeenCalledWith({
      role: "Member",
      emails: ["a@school.edu", "b@school.edu", "c@school.edu"],
    });
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({ title: "3 invites sent" }),
    );
  });

  it("splits a pasted list into chips and drops repeats", async () => {
    await openDialog();
    await userEvent.click(emailField());
    await userEvent.paste("a@school.edu\nA@School.edu; b@school.edu");

    expect(screen.getByText("a@school.edu")).toBeInTheDocument();
    expect(screen.getByText("b@school.edu")).toBeInTheDocument();
    expect(send()).toHaveTextContent("Send 2 invites");
  });

  it("waits for a send to check addresses, then holds a bad one in red", async () => {
    await openDialog();
    await userEvent.type(emailField(), "not-an-email");
    // Typing alone says nothing (validate on commit, not per keystroke).
    expect(
      screen.queryByText(/isn't an email address/i),
    ).not.toBeInTheDocument();

    await userEvent.type(emailField(), "{Enter}");

    expect(
      screen.getByText(
        "One address in red isn't an email address. Fix or remove it.",
      ),
    ).toBeInTheDocument();
    expect(send()).toBeDisabled();
    expect(mockEmailInvites).not.toHaveBeenCalled();
  });

  it("keeps addresses the server couldn't email, so Send tries them again", async () => {
    mockEmailInvites.mockResolvedValue({
      invites: [],
      failed: ["b@school.edu"],
    });
    await openDialog();
    await userEvent.type(emailField(), "a@school.edu b@school.edu{Enter}");
    await userEvent.click(send());

    expect(
      await screen.findByText(/couldn't email this address/i),
    ).toBeInTheDocument();
    expect(screen.getByText("b@school.edu")).toBeInTheDocument();
    expect(screen.queryByText("a@school.edu")).not.toBeInTheDocument();
    expect(mockToast).toHaveBeenCalledWith({
      title: "Invite sent to a@school.edu",
    });
  });

  it("takes the last chip back into the field on Backspace, to fix it", async () => {
    await openDialog();
    await userEvent.type(emailField(), "a@school.edu{Enter}{Backspace}");

    expect(emailField()).toHaveValue("a@school.edu");
  });
});

describe("InviteMemberDialog share link and list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHooks();
    chapter.active();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("mints a fresh link on Copy link and copies only the join URL", async () => {
    mockCreateInvite.mockResolvedValue({ ...INVITE, token: "fresh-token" });
    await openDialog();
    await userEvent.click(copyLink());

    expect(mockCreateInvite).toHaveBeenCalledWith({ role: "Member" });
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        `${window.location.origin}/join?token=fresh-token`,
      ),
    );
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("never shows a token: rows name the address, role, when, and status", async () => {
    await openDialog();
    const list = screen.getByRole("list");

    expect(within(list).getByText(INVITE.email)).toBeInTheDocument();
    expect(within(list).getByText("Pending")).toBeInTheDocument();
    expect(within(list).getByText(/^Member · Sent /)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(INVITE.token);
  });

  it("copies a pending invite's link from its menu", async () => {
    await openDialog();
    await userEvent.click(
      screen.getByRole("button", { name: `More for ${INVITE.email}` }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /copy link/i }),
    );

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        `${window.location.origin}/join?token=${INVITE.token}`,
      ),
    );
  });

  it("sends a pending invite again without revoking it first", async () => {
    // The server retires the old invite once the new one is delivered, so a
    // failed resend can't leave the address with no live link.
    mockEmailInvites.mockResolvedValue({ invites: [], failed: [] });
    await openDialog();
    await userEvent.click(
      screen.getByRole("button", { name: `More for ${INVITE.email}` }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /send again/i }),
    );

    await waitFor(() =>
      expect(mockEmailInvites).toHaveBeenCalledWith({
        role: "Member",
        emails: [INVITE.email],
      }),
    );
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it("revokes an invite from its menu", async () => {
    mockRevoke.mockResolvedValue({ success: true });
    await openDialog();
    await userEvent.click(await revoke());

    await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith(INVITE.id));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Invite revoked" }),
    );
  });

  it("tells share links apart by when they were made", async () => {
    mockInvites.mockReturnValue([{ ...INVITE, email: null }]);
    await openDialog();

    expect(
      screen.getByRole("button", { name: /^More for Invite link, sent / }),
    ).toBeInTheDocument();
  });
});

describe("listedInvites", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const row = (
    status: typeof INVITE.status | "joined" | "expired" | "revoked",
    created_at: string,
  ) => ({
    ...INVITE,
    id: `${status}-${created_at}`,
    status,
    created_at,
  });

  it("keeps every pending invite, recent joined and expired ones, and no revoked ones", () => {
    const rows = [
      row("pending", "2026-10-01T00:00:00Z"),
      row("joined", "2026-11-19T00:00:00Z"),
      row("joined", "2026-11-01T00:00:00Z"),
      row("expired", "2026-11-18T00:00:00Z"),
      row("revoked", "2026-11-19T00:00:00Z"),
    ];

    expect(listedInvites(rows, now).map((r) => r.id)).toEqual([
      "pending-2026-10-01T00:00:00Z",
      "joined-2026-11-19T00:00:00Z",
      "expired-2026-11-18T00:00:00Z",
    ]);
  });
});

describe("sentLabel", () => {
  it("says when, in words", () => {
    const now = new Date(2026, 10, 6, 18, 0);
    expect(sentLabel(new Date(2026, 10, 6, 16, 46).toISOString(), now)).toMatch(
      /^Sent today at 4:46/,
    );
    expect(sentLabel(new Date(2026, 10, 5, 9, 0).toISOString(), now)).toMatch(
      /^Sent yesterday at 9:00/,
    );
  });
});
