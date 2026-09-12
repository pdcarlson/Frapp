import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { networkMock } from "@/tests/network";

/**
 * The greenfield Directory lane's acceptance, pinned.
 *
 * `members-directory.tsx` had **no** test file before this one, which is the
 * same gap lane 2 closed for the shell (`dashboard-shell.spec.tsx`) when it
 * rewrote it. The cases below are deliberately about the things
 * [`spec/ui/web-greenfield/deletion-checklist.md`](../../../../spec/ui/web-greenfield/deletion-checklist.md)
 * §9 claims — a card that is gone, a table that is gone, a row that is now the
 * control, and one empty state that became three — rather than about the
 * layout in general. A suite that asserted the whole render would go red on
 * every future restyle without telling anyone which rule broke.
 */

const { mockOffline } = vi.hoisted(() => ({ mockOffline: { value: false } }));

type Read = {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
};

function read(data: unknown = []): Read {
  return { data, isLoading: false, isError: false, refetch: vi.fn() };
}

const MEMBERS = [
  {
    id: "m-1",
    user_id: "u-1",
    chapter_id: "chap-1",
    role_ids: ["r-1"],
    has_completed_onboarding: true,
    created_at: "2024-08-14T00:00:00.000Z",
    updated_at: "2024-08-14T00:00:00.000Z",
    display_name: "Ada Lovelace",
    avatar_url: null,
    bio: null,
    graduation_year: 2026,
    current_city: null,
    current_company: null,
    email: "ada@example.test",
  },
  {
    // No role and an unparseable join date: the two fields that used to render
    // an em dash. They must now be absent from the meta line, not dashed.
    id: "m-2",
    user_id: "u-2",
    chapter_id: "chap-1",
    role_ids: [],
    has_completed_onboarding: false,
    created_at: "not-a-date",
    updated_at: "not-a-date",
    display_name: "Grace Hopper",
    avatar_url: null,
    bio: null,
    graduation_year: 2027,
    current_city: null,
    current_company: null,
    email: "grace@example.test",
  },
];

const membersRead = read(MEMBERS);
const searchRead = read([]);
const rolesRead = read([{ id: "r-1", name: "Treasurer", is_system: false, permissions: [] }]);
const leaderboardRead = read([{ user_id: "u-1", total: 42 }]);

vi.mock("@repo/hooks", () => ({
  useMembers: () => membersRead,
  useMemberSearch: (q: string) => (q ? searchRead : membersRead),
  useRoles: () => rolesRead,
  useLeaderboard: () => leaderboardRead,
  useOrgConfig: () => ({ data: undefined }),
  useUpdateMemberRoles: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/providers/network-provider", () => networkMock(mockOffline));

vi.mock("@/lib/providers/chapter-presence-provider", () => ({
  useChapterPresenceContext: () => ({
    isReady: true,
    statusOf: () => "online",
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

/**
 * Stubbed, not rendered. The sheet pulls in six more hooks and a router, and
 * nothing here is about what it contains — only about whether the *row* opens
 * it, which the stub reports without any of that.
 */
/**
 * Stubbed for its own reasons: it fires six invite hooks this file's `@repo/hooks`
 * mock has no business knowing about. What matters here is only that the trigger
 * sits in the toolbar row, above the list *and* above every empty state — which
 * is what lets those states carry no CTA of their own.
 */
vi.mock("@/components/members/invite-member-dialog", () => ({
  InviteMemberDialog: ({ trigger }: { trigger: React.ReactNode }) => (
    <div data-testid="invite-trigger">{trigger}</div>
  ),
}));

vi.mock("@/components/members/member-detail-sheet", () => ({
  MemberDetailSheet: ({ open, member }: { open: boolean; member: { display_name?: string } | null }) =>
    open ? <div data-testid="detail-sheet">{member?.display_name ?? "none"}</div> : null,
}));

import { MembersDirectory } from "@/components/members/members-directory";

/**
 * Elements painting `--card` that are not controls.
 *
 * `bg-card` is also the Secondary *button* recipe (`ui/button.tsx`), which is
 * legitimate and unrelated — a bare `.bg-card` query counts a Retry button as a
 * restored panel. What this lane deleted is the card as a **container**, so the
 * assertions below look only at what is not a control.
 */
function cardFilledContainers(container: HTMLElement) {
  return Array.from(container.querySelectorAll(".bg-card")).filter(
    (el) => el.tagName !== "BUTTON",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOffline.value = false;
  Object.assign(membersRead, read(MEMBERS));
  Object.assign(searchRead, read([]));
  Object.assign(rolesRead, read([{ id: "r-1", name: "Treasurer", is_system: false, permissions: [] }]));
  Object.assign(leaderboardRead, read([{ user_id: "u-1", total: 42 }]));
});

describe("Directory on the greenfield shell", () => {
  it("renders the roster as a flush list, with no table and no wrapper card", () => {
    const { container } = render(<MembersDirectory />);

    // The `<Table>` is gone, not hidden: no grid roles survive anywhere.
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryAllByRole("columnheader")).toHaveLength(0);

    // The list carries the shared divider recipe and nothing else — no card
    // fill, no hairline box, no zebra.
    const list = container.querySelector("ul");
    expect(list).not.toBeNull();
    expect(list?.className).toContain("divide-y");
    expect(list?.className).toContain("border-t");
    expect(list?.querySelectorAll("li")).toHaveLength(MEMBERS.length);
    expect(cardFilledContainers(container)).toHaveLength(0);

    // The card titles the wrappers carried are gone with them. `PageHeader`
    // owns the route's only heading and it lives one component up.
    expect(screen.queryByText("Members Directory")).toBeNull();
    expect(screen.queryByText("Member Records")).toBeNull();
    expect(screen.queryByText(/Search and review chapter membership records/)).toBeNull();
  });

  it("keeps the row at 36px on a pointer and 44px on touch", () => {
    const { container } = render(<MembersDirectory />);
    const row = container.querySelector("li");
    expect(row?.className).toContain("min-h-9");
    // §2's touch floor, via the carve-out `denseRowControlClassName` uses.
    expect(row?.className).toContain("pointer-coarse:min-h-11");
  });

  it("makes the row itself the control that opens a member", async () => {
    const user = userEvent.setup();
    render(<MembersDirectory />);

    // The trailing "View details" button is deleted; the row is named for the
    // member and everything the row shows.
    expect(screen.queryByRole("button", { name: /view details/i })).toBeNull();

    await user.click(screen.getByRole("button", { name: /^Ada Lovelace,/ }));
    expect(screen.getByTestId("detail-sheet")).toHaveTextContent("Ada Lovelace");
  });

  it("drops an absent field from the meta line instead of rendering an em dash", () => {
    const { container } = render(<MembersDirectory />);

    // Grace has no role and an unparseable join date. Neither may appear as a
    // placeholder glyph, and no rendered text on the route may contain one.
    expect(container.textContent).not.toContain("—");
    // Ada is the positive control: without it, a matcher that silently never
    // matches would make the negative assertion below pass for free.
    expect(screen.getByRole("button", { name: /^Ada Lovelace,/ })).toHaveAccessibleName(
      /joined/i,
    );
    const grace = screen.getByRole("button", { name: /^Grace Hopper,/ });
    expect(grace).not.toHaveAccessibleName(/joined/i);
    expect(grace).not.toHaveAccessibleName(/Treasurer/);
  });

  it("answers an empty roster, a filtered miss and a search miss differently", async () => {
    const user = userEvent.setup();

    Object.assign(membersRead, read([]));
    const { unmount } = render(<MembersDirectory />);
    expect(screen.getByText("No actives yet")).toBeInTheDocument();
    // The state carries no CTA because the toolbar row above it still does.
    expect(screen.getByTestId("invite-trigger")).toBeInTheDocument();
    expect(
      within(screen.getByRole("heading", { name: "Actives" }).closest("section")!)
        .queryByRole("button", { name: /invite/i }),
    ).not.toBeNull();
    unmount();

    // A filter that matches nothing is not a claim about the roster.
    Object.assign(membersRead, read(MEMBERS));
    render(<MembersDirectory />);
    await user.selectOptions(
      screen.getByLabelText("Filter members by status"),
      "pending",
    );
    await user.selectOptions(
      screen.getByLabelText("Filter members by role"),
      "r-1",
    );
    expect(screen.getByText("No actives match the filters")).toBeInTheDocument();
  });

  it("names the query when a search matches nothing", async () => {
    const user = userEvent.setup();
    render(<MembersDirectory />);

    await user.type(screen.getByLabelText("Search members"), "pigg");

    // The board's no-results state names what was asked for, rather than
    // reusing the empty state's claim about the roster.
    expect(await screen.findByText(/No match for/)).toHaveTextContent("pigg");
    expect(screen.queryByText("No actives yet")).toBeNull();
  });

  it("keeps the member sheet mounted when the list drops into an error state", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MembersDirectory />);

    await user.click(screen.getByRole("button", { name: /^Ada Lovelace,/ }));
    expect(screen.getByTestId("detail-sheet")).toBeInTheDocument();

    // A background refetch fails while the sheet is open. The sheet owns a
    // `useConfirmDialog` promise for member removal, and `await confirm(...)`
    // only settles while its host is mounted — so unmounting it here would
    // hang that await forever. The state must replace the list, not the sheet.
    Object.assign(leaderboardRead, read([]), { isError: true });
    rerender(<MembersDirectory />);

    expect(screen.getByText("Couldn't load roles and points")).toBeInTheDocument();
    expect(screen.getByTestId("detail-sheet")).toBeInTheDocument();
  });

  it("draws its async states without repainting the card the lane deleted", () => {
    Object.assign(membersRead, read([]), { isError: true });
    const { container } = render(<MembersDirectory />);

    expect(screen.getByText("Couldn't load members")).toBeInTheDocument();
    // `NestedError`, not `ErrorState`: the whole-screen family paints
    // `--card` on its box, which would put back the wrapper this lane just
    // removed. The Retry button inside it may still be Secondary.
    expect(cardFilledContainers(container)).toHaveLength(0);
  });

  it("replaces the four sortable column headers with one sort control", () => {
    render(<MembersDirectory />);
    const sort = screen.getByLabelText("Sort members");
    // Every (key, direction) pair the deleted headers could reach.
    expect(within(sort).getAllByRole("option")).toHaveLength(8);
    expect(screen.queryByRole("button", { name: /sort by name/i })).toBeNull();
  });

  it("keeps bulk selection reachable without a checkbox column", async () => {
    const user = userEvent.setup();
    render(<MembersDirectory />);

    // No select-all in a header row, because there is no header row.
    expect(
      screen.queryByRole("checkbox", { name: /select all members on this page/i }),
    ).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: "Select Ada Lovelace" }));

    // Selecting one row raises the selection bar, which is where select-all
    // and the bulk role assignment now live.
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /select all members on this page/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Select role to assign")).toBeInTheDocument();
  });
});
