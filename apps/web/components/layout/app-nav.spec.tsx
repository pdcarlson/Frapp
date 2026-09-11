import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@repo/hooks", () => ({
  useAccessibleChapters: () => ({ data: [], isSuccess: true }),
  useCurrentChapter: () => ({ data: undefined, isError: false }),
}));
vi.mock("@/lib/auth/select-chapter", () => ({
  useSelectChapter: () => vi.fn(),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (
    selector: (s: { activeChapterId: string | null }) => unknown,
  ) => selector({ activeChapterId: "chap-1" }),
}));

import { AppNav } from "./app-nav";

/** Permissions for a member who holds nothing role-gated. */
const ORDINARY_MEMBER: readonly string[] = [];
/** Enough to see the whole Admin group and both Directory/Billing rows. */
const OFFICER: readonly string[] = [
  "members:view",
  "billing:view",
  "roles:manage",
  "geofences:manage",
  "reports:export",
  "channels:manage",
  "chapter-config:view",
  "polls:view_all",
];

function renderNav(
  props: Partial<React.ComponentProps<typeof AppNav>> = {},
) {
  return render(
    <AppNav
      collapsed={false}
      permissions={OFFICER}
      pathname="/events"
      {...props}
    />,
  );
}

describe("AppNav", () => {
  it("orders the IA the way the board does", () => {
    const { container } = renderNav();
    // Headings are <p>, rows are <a>. Matching on text alone would also catch
    // the "Directory" row label, which is exactly the word this test is
    // asserting does NOT appear as a heading.
    const headings = Array.from(container.querySelectorAll("nav p")).map(
      (el) => el.textContent,
    );
    // Directory and Finance were two one-item sections whose headings each
    // restated the row beneath them; the board merges them into one unlabeled
    // group, so neither word may appear as a heading.
    expect(headings).toEqual(["Chapter", "Resources", "Admin"]);
  });

  it("keeps Chat ungrouped and first", () => {
    renderNav();
    const chat = screen.getByRole("link", { name: "Chat" });
    expect(chat).toBeInTheDocument();
    // Chat is the app's home, not a member of any group.
    const headings = Array.from(document.querySelectorAll("nav p")).map(
      (el) => el.textContent,
    );
    expect(headings).not.toContain("Chat");
  });

  it("still shows Directory and Billing without their headings", () => {
    renderNav();
    expect(screen.getByRole("link", { name: "Directory" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Billing" })).toBeInTheDocument();
  });

  it("takes the Admin heading away with its rows for an ordinary member", () => {
    renderNav({ permissions: ORDINARY_MEMBER });
    // A heading is a promise that something sits under it.
    const headings = Array.from(document.querySelectorAll("nav p")).map(
      (el) => el.textContent,
    );
    expect(headings).not.toContain("Admin");
    expect(
      screen.queryByRole("link", { name: "Settings" }),
    ).not.toBeInTheDocument();
  });

  it("fails open while permissions are unresolved", () => {
    // Hiding a link one render early is a visible flash of nav items
    // disappearing; the route itself is guarded server-side.
    renderNav({ permissions: undefined });
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("hides a row whose module is switched off", () => {
    renderNav({ isModuleEnabled: (key: string) => key !== "events" });
    expect(
      screen.queryByRole("link", { name: "Events" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tasks" })).toBeInTheDocument();
  });

  it("marks the active route", () => {
    renderNav({ pathname: "/events" });
    expect(screen.getByRole("link", { name: "Events" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("drops labels in the rail but keeps every row reachable by name", () => {
    renderNav({ collapsed: true });
    const events = screen.getByRole("link", { name: "Events" });
    expect(events).toBeInTheDocument();
    // The visible text is gone; the accessible name is not.
    expect(events).not.toHaveTextContent("Events");
    // Section headings have nowhere to render at 56px.
    expect(document.querySelectorAll("nav p")).toHaveLength(0);
  });

  it("offers a collapse toggle in the sidebar and none in the drawer", () => {
    const { unmount } = renderNav();
    expect(
      screen.getByRole("button", { name: /collapse navigation/i }),
    ).toBeInTheDocument();
    unmount();

    renderNav({ variant: "drawer" });
    expect(
      screen.queryByRole("button", { name: /collapse navigation/i }),
    ).not.toBeInTheDocument();
  });

  it("ignores the collapsed preference inside the drawer", () => {
    // The drawer has no room to be a rail and no toggle to leave one, so a
    // member who collapsed the desktop nav must not find an icon-only drawer.
    renderNav({ collapsed: true, variant: "drawer" });
    expect(screen.getByRole("link", { name: "Events" })).toHaveTextContent(
      "Events",
    );
  });
});
