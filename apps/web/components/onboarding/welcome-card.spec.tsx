import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/** The welcome card in a new member's first channel (#5627). */
const mocks = vi.hoisted(() => ({
  due: true,
  events: [] as unknown[],
  roles: [] as unknown[],
  clear: vi.fn(),
}));

vi.mock("@repo/hooks", () => ({
  useCurrentUser: () => ({
    data: { id: "u-1", display_name: "Jordan Avery", avatar_url: null },
  }),
  useCurrentChapter: () => ({ data: { name: "Beta Theta Omega" } }),
  useEvents: () => ({ data: mocks.events, isPending: false }),
  usePickableRoles: () => ({ roles: mocks.roles, isLoading: false }),
}));
vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (pick: (s: { activeChapterId: string }) => unknown) =>
    pick({ activeChapterId: "ch-1" }),
}));
vi.mock("@/lib/onboarding/welcome-due", () => ({
  isWelcomeDue: () => mocks.due,
  clearWelcomeDue: () => mocks.clear(),
}));
vi.mock("@/components/profile/profile-photo-control", () => ({
  ProfilePhotoControl: () => <button type="button">Add photo</button>,
}));
vi.mock("@/components/profile/chat-density-control", () => ({
  ChatDensityControl: () => <div>Cozy Compact Bubbles</div>,
}));
vi.mock("@/components/roles/pick-roles-section", () => ({
  PickRolesList: () => <div>Rush committee</div>,
}));

import { WelcomeCard } from "./welcome-card";

const soon = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

describe("WelcomeCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.due = true;
    mocks.events = [];
    mocks.roles = [];
  });

  it("greets by first name and lists the next two events", () => {
    mocks.events = [
      { id: "e3", name: "Formal", start_time: soon(20) },
      { id: "e1", name: "Chapter meeting", start_time: soon(2) },
      { id: "e2", name: "Car wash", start_time: soon(9) },
    ];
    render(<WelcomeCard inDefaultChannel />);

    expect(
      screen.getByRole("heading", {
        name: "Welcome to Beta Theta Omega, Jordan",
      }),
    ).toBeTruthy();
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/events?event=e1",
      "/events?event=e2",
    ]);
    expect(screen.queryByText("Formal")).toBeNull();
  });

  it("shows nothing when it isn't due, or outside the default channel", () => {
    mocks.due = false;
    const notDue = render(<WelcomeCard inDefaultChannel />);
    expect(notDue.container.textContent).toBe("");
    notDue.unmount();

    mocks.due = true;
    const elsewhere = render(<WelcomeCard inDefaultChannel={false} />);
    expect(elsewhere.container.textContent).toBe("");
  });

  it("closes for good", () => {
    render(<WelcomeCard inDefaultChannel />);

    fireEvent.click(
      screen.getByRole("button", { name: "Close the welcome card" }),
    );

    expect(mocks.clear).toHaveBeenCalled();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("opens Finish your profile with the photo, the roles and the display", () => {
    mocks.roles = [{ id: "r-1", name: "Rush committee", picked: false }];
    render(<WelcomeCard inDefaultChannel />);

    fireEvent.click(
      screen.getByRole("button", { name: /Finish your profile/ }),
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add photo" })).toBeTruthy();
    expect(screen.getByText("Rush committee")).toBeTruthy();
    expect(screen.getByText("Cozy Compact Bubbles")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
