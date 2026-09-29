import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { networkMock } from "@/tests/network";

/**
 * #2484 — alumni rows open the member detail sheet.
 *
 * The Actives tab used to list every alumnus as well, and its detail sheet is
 * where roles are assigned. Now that alumni are only here, a row that opened
 * nothing would leave an officer no way on web to correct a mistaken Alumni
 * role. The offline read path has its own file
 * (`alumni-directory-offline.spec.tsx`).
 */

const { mockOffline } = vi.hoisted(() => ({ mockOffline: { value: false } }));

const ALUMNI = [
  {
    id: "al-1",
    user_id: "u-1",
    display_name: "Charles Whitmore III",
    bio: "Still reads the minutes.",
    avatar_url: null,
    graduation_year: 2019,
    current_city: "Boston",
    current_company: "Acme",
    email: "charles@example.test",
    is_alumni: true,
  },
];

const alumniRead = {
  data: ALUMNI as unknown,
  isPending: false,
  isError: false,
  isSuccess: true,
  isPlaceholderData: false,
  refetch: vi.fn(),
};

vi.mock("@repo/hooks", () => ({
  useAlumni: () => alumniRead,
}));

vi.mock("@/lib/providers/network-provider", () => networkMock(mockOffline));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (
    selector: (state: { activeChapterId: string }) => unknown,
  ) => selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/components/members/member-detail-sheet", () => ({
  MemberDetailSheet: ({
    open,
    member,
    points,
  }: {
    open: boolean;
    member: { display_name?: string } | null;
    points?: number | null;
  }) =>
    open ? (
      <div data-testid="detail-sheet" data-points={String(points)}>
        {member?.display_name ?? "none"}
      </div>
    ) : null,
}));

import { AlumniDirectory } from "./alumni-directory";

beforeEach(() => {
  vi.clearAllMocks();
  mockOffline.value = false;
  alumniRead.data = ALUMNI;
});

describe("AlumniDirectory rows (#2484)", () => {
  it("makes each row a control named for everything it shows", () => {
    render(<AlumniDirectory />);

    expect(
      screen.getByRole("button", {
        name: "Charles Whitmore III, Class of 2019 · Acme · Boston, Still reads the minutes.",
      }),
    ).toBeInTheDocument();
  });

  it("opens the member detail sheet, with no points line for an alumnus", async () => {
    const user = userEvent.setup();
    render(<AlumniDirectory />);

    expect(screen.queryByTestId("detail-sheet")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: /^Charles Whitmore III,/ }),
    );

    const sheet = screen.getByTestId("detail-sheet");
    expect(sheet).toHaveTextContent("Charles Whitmore III");
    expect(sheet).toHaveAttribute("data-points", "null");
  });

  it("keeps the sheet on the member after they leave the alumni list", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AlumniDirectory />);
    await user.click(
      screen.getByRole("button", { name: /^Charles Whitmore III,/ }),
    );

    // An officer revoked the Alumni role from the sheet; the refetched list
    // no longer holds him, and the sheet he is being edited in stays his.
    alumniRead.data = [];
    rerender(<AlumniDirectory />);

    expect(screen.getByTestId("detail-sheet")).toHaveTextContent(
      "Charles Whitmore III",
    );
  });
});
