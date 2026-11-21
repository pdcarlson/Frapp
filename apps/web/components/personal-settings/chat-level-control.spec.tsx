import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { mockOffline } = vi.hoisted(() => ({ mockOffline: { value: false } }));

const mocks = vi.hoisted(() => ({
  levelQuery: {
    data: "all" as "all" | "mentions" | undefined,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  },
  setLevel: {
    isPending: false,
    variables: undefined as "all" | "mentions" | undefined,
    mutateAsync: vi.fn<(level: string) => Promise<unknown>>(),
  },
  toast: vi.fn(),
}));

vi.mock("@repo/hooks", () => ({
  useChapterChatLevel: () => mocks.levelQuery,
  useSetChapterChatLevel: () => mocks.setLevel,
}));
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock("@/lib/providers/network-provider", () => networkMock(mockOffline));

import { networkMock } from "@/tests/network";
import { ChatLevelControl } from "./chat-level-control";

/**
 * Settings → Chapter alerts → Chat messages on web (#4124): the two choices
 * the phone has (#3840), no Off, saved through the API on the click.
 */
describe("ChatLevelControl", () => {
  beforeEach(() => {
    mockOffline.value = false;
    mocks.levelQuery.data = "all";
    mocks.levelQuery.isError = false;
    mocks.levelQuery.isLoading = false;
    mocks.setLevel.isPending = false;
    mocks.setLevel.variables = undefined;
    mocks.setLevel.mutateAsync.mockReset();
    mocks.setLevel.mutateAsync.mockResolvedValue({});
    mocks.toast.mockReset();
  });

  it("offers exactly All messages and Mentions and DMs only, with the current one checked", () => {
    mocks.levelQuery.data = "mentions";
    render(<ChatLevelControl />);
    const group = screen.getByRole("group", { name: "Chat messages" });
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(
      screen.getByRole("radio", { name: /All messages/ }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("radio", { name: /Mentions and DMs only/ }),
    ).toBeChecked();
    expect(screen.queryByRole("radio", { name: /off/i })).toBeNull();
  });

  it("saves the picked level through the API", () => {
    render(<ChatLevelControl />);
    fireEvent.click(
      screen.getByRole("radio", { name: /Mentions and DMs only/ }),
    );
    expect(mocks.setLevel.mutateAsync).toHaveBeenCalledWith("mentions");
  });

  it("checks nothing and refuses a pick until the level is read", () => {
    mocks.levelQuery.data = undefined;
    mocks.levelQuery.isLoading = true;
    render(<ChatLevelControl />);
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).not.toBeChecked();
      expect(radio).toBeDisabled();
    }
  });

  it("shows the pending pick while it saves", () => {
    mocks.setLevel.isPending = true;
    mocks.setLevel.variables = "mentions";
    render(<ChatLevelControl />);
    expect(
      screen.getByRole("radio", { name: /Mentions and DMs only/ }),
    ).toBeChecked();
  });

  it("says so when the save fails", async () => {
    mocks.setLevel.mutateAsync.mockRejectedValue(new Error("boom"));
    render(<ChatLevelControl />);
    fireEvent.click(
      screen.getByRole("radio", { name: /Mentions and DMs only/ }),
    );
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't change chat notifications",
          variant: "destructive",
        }),
      ),
    );
  });

  it("refuses a change offline and says why, without writing", () => {
    mockOffline.value = true;
    render(<ChatLevelControl />);
    fireEvent.click(
      screen.getByRole("radio", { name: /Mentions and DMs only/ }),
    );
    expect(mocks.setLevel.mutateAsync).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "You're offline" }),
    );
    expect(
      screen.getByText("You're offline, so this can't be changed right now."),
    ).toBeInTheDocument();
  });

  it("offers a retry when the level can't be read", () => {
    mocks.levelQuery.data = undefined;
    mocks.levelQuery.isError = true;
    render(<ChatLevelControl />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.levelQuery.refetch).toHaveBeenCalled();
  });
});
