import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * #4175: the Directory's List/Grid toggle sits in the tab row, one pick for
 * both tabs. The lists themselves have their own specs; here they only say
 * which layout they were handed.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@repo/hooks", () => ({ useViewerUserId: () => "viewer-1" }));

function LayoutProbe({ tab }: { tab: string }) {
  // Reads the same store the real lists do.
  const [layout] = useListLayout("directory");
  return <p data-testid={`${tab}-layout`}>{layout}</p>;
}

vi.mock("@/components/members/members-directory", () => ({
  MembersDirectory: () => <LayoutProbe tab="actives" />,
}));
vi.mock("@/components/alumni/alumni-directory", () => ({
  AlumniDirectory: () => <LayoutProbe tab="alumni" />,
}));

import { useListLayout } from "@/lib/list-layout";
import { DirectoryPage } from "@/components/members/directory-page";

afterEach(() => {
  window.localStorage.clear();
});

describe("DirectoryPage's List/Grid toggle (#4175)", () => {
  it("sits in the tab row and lays out the list under it", async () => {
    const user = userEvent.setup();
    render(<DirectoryPage />);

    const toggle = await screen.findByRole("radiogroup", { name: "Layout" });
    // Beside the tabs, not inside one tab's panel.
    const tabs = screen.getByRole("tablist");
    expect(tabs.parentElement).toBe(toggle.parentElement);

    expect(screen.getByTestId("actives-layout")).toHaveTextContent("list");
    await user.click(within(toggle).getByRole("radio", { name: "Grid" }));
    expect(screen.getByTestId("actives-layout")).toHaveTextContent("grid");
    expect(window.localStorage.getItem("frapp.directory.layout.viewer-1")).toBe(
      "grid",
    );
  });
});
