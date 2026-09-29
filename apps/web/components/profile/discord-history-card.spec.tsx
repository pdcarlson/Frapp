import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  chapterId: "chapter-1" as string | null,
  link: {
    isPending: false,
    isError: false,
    data: {
      available: true,
      linked: false,
      discord_username: null as string | null,
      linked_at: null as string | null,
    },
    refetch: vi.fn(),
  },
  begin: vi.fn(),
  confirm: vi.fn(),
  unlink: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useActiveChapterId: () => state.chapterId,
    useDiscordAuthorLink: () => state.link,
    useBeginDiscordAuthorLink: () => ({
      mutateAsync: state.begin,
      isPending: false,
    }),
    useConfirmDiscordAuthorLink: () => ({
      mutateAsync: state.confirm,
      isPending: false,
    }),
    useUnlinkDiscordAuthor: () => ({
      mutateAsync: state.unlink,
      isPending: false,
    }),
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: state.toast }),
}));

const { DiscordHistoryCard, DISCORD_LINK_OUTCOME_MESSAGES, linkedMessage } =
  await import("./discord-history-card");

function renderCard() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <DiscordHistoryCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.chapterId = "chapter-1";
  state.link.isPending = false;
  state.link.isError = false;
  state.link.data = {
    available: true,
    linked: false,
    discord_username: null,
    linked_at: null,
  };
  state.begin.mockReset();
  state.confirm.mockReset();
  state.unlink.mockReset();
  state.toast.mockReset();
  window.history.replaceState(null, "", "/profile");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DiscordHistoryCard (#2878)", () => {
  it("offers to link when nothing is linked, and sends the browser to Discord", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    state.begin.mockResolvedValue({
      authorize_url: "https://discord.com/oauth2/authorize?state=s",
      expires_at: "2026-09-29T12:15:00Z",
    });
    renderCard();

    await userEvent.click(
      screen.getByRole("button", { name: "Link Discord account" }),
    );
    expect(state.begin).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(
      "https://discord.com/oauth2/authorize?state=s",
    );
  });

  it("shows the linked account and unlinks it", async () => {
    state.link.data = {
      available: true,
      linked: true,
      discord_username: "jkslayer",
      linked_at: "2026-09-29T12:00:00Z",
    };
    state.unlink.mockResolvedValue({ unlinked: true, messages_restored: 3 });
    renderCard();

    expect(screen.getByText("jkslayer")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Unlink" }));
    expect(state.unlink).toHaveBeenCalledTimes(1);
    expect(state.toast).toHaveBeenCalledWith({
      description:
        "Discord account unlinked. 3 imported messages show under the Discord name again.",
    });
  });

  it("says linking is unavailable rather than offering a button that fails", () => {
    state.link.data = { ...state.link.data, available: false };
    renderCard();
    expect(
      screen.queryByRole("button", { name: "Link Discord account" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/isn.t available right now/)).toBeInTheDocument();
  });

  it("confirms a returning handshake once and strips it from the address bar", async () => {
    window.history.replaceState(
      null,
      "",
      "/profile?discord=pending&handshake=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    state.confirm.mockResolvedValue({
      available: true,
      linked: true,
      discord_username: "jkslayer",
      linked_at: "2026-09-29T12:00:00Z",
      messages_linked: 412,
    });
    renderCard();

    await waitFor(() =>
      expect(state.toast).toHaveBeenCalledWith({
        description: linkedMessage(412),
      }),
    );
    expect(state.confirm).toHaveBeenCalledTimes(1);
    expect(state.confirm).toHaveBeenCalledWith({
      handshake: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
    expect(window.location.search).toBe("");
  });

  it("reports a declined link by its code, never by text from the URL", async () => {
    window.history.replaceState(
      null,
      "",
      "/profile?discord=declined&error_description=Click%20here",
    );
    renderCard();

    await waitFor(() =>
      expect(state.toast).toHaveBeenCalledWith({
        variant: undefined,
        description: DISCORD_LINK_OUTCOME_MESSAGES.declined,
      }),
    );
    expect(state.confirm).not.toHaveBeenCalled();
  });

  it("reports a refused confirm", async () => {
    window.history.replaceState(
      null,
      "",
      "/profile?discord=pending&handshake=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    state.confirm.mockRejectedValue(
      new Error(
        "That Discord account is already linked to another member of this chapter.",
      ),
    );
    renderCard();

    await waitFor(() =>
      expect(state.toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      ),
    );
  });

  it("words the zero-message link for a chapter that has not imported yet", () => {
    expect(linkedMessage(0)).toMatch(/when your chapter imports them/);
    expect(linkedMessage(1)).toBe(
      "Discord account linked. 1 imported message now shows as yours.",
    );
  });
});
