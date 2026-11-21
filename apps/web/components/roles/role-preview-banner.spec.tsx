import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { RolePreviewBanner } from "@/components/roles/role-preview-banner";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { useRolePreviewStore } from "@/lib/stores/role-preview-store";

const PREVIEW = {
  chapterId: "c1",
  roleId: "brother",
  roleName: "Brothers",
  permissions: ["members:view"],
  returnTo: "/settings?tab=roles&role=brother",
};

beforeEach(() => {
  push.mockReset();
  useChapterStore.setState({ activeChapterId: "c1" });
  useRolePreviewStore.setState({ preview: null });
});

describe("the View as a role bar (#4072)", () => {
  it("draws nothing without a preview", () => {
    const { container } = render(<RolePreviewBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the role, and Exit goes back to its page", async () => {
    const user = userEvent.setup();
    useRolePreviewStore.setState({ preview: PREVIEW });
    render(<RolePreviewBanner />);
    expect(screen.getByText("Viewing as Brothers")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Exit preview" }));
    expect(useRolePreviewStore.getState().preview).toBeNull();
    expect(push).toHaveBeenCalledWith(PREVIEW.returnTo);
  });

  it("stands down in another chapter", () => {
    useRolePreviewStore.setState({ preview: PREVIEW });
    useChapterStore.setState({ activeChapterId: "c2" });
    const { container } = render(<RolePreviewBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});
