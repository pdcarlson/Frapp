import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChatSearchPopover } from "./chat-search-popover";

const useSearch = vi.fn();

vi.mock("@repo/hooks", () => ({
  SEARCH_MIN_QUERY_LENGTH: 3,
  useSearch: (query: string, channelId?: string) => useSearch(query, channelId),
  resolveAuthorLabel: (message: { sender_id: string }) =>
    message.sender_id === "u-1" ? "Ada" : "Grace",
}));

vi.mock("@repo/formatting", () => ({ formatClock: () => "9:41 AM" }));

function result(overrides: Record<string, unknown> = {}) {
  return {
    data: { payload: { messages: [] }, timedOut: false, timedOutSources: [] },
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

function message(id: string, channelId: string, content: string) {
  return {
    id,
    channel_id: channelId,
    sender_id: "u-1",
    content,
    created_at: "2026-09-02T13:41:00Z",
  };
}

function renderPopover(props: Record<string, unknown> = {}) {
  return render(
    <ChatSearchPopover
      activeChannelId="chan-1"
      channelNameFor={(id) => (id === "chan-2" ? "random" : "general")}
      nameFor={() => "Ada"}
      onJump={vi.fn()}
      {...props}
    />,
  );
}

/**
 * In-channel message search for the web chat shell (#469).
 *
 * The behaviours pinned here are the ones a refactor would silently break, and
 * the two that would be *wrong but invisible*: that the channel filter reaches
 * the request rather than being applied to the response, and that a timed-out
 * search never renders as "no matches".
 */
describe("ChatSearchPopover", () => {
  beforeEach(() => {
    useSearch.mockReset();
    useSearch.mockReturnValue(result());
  });

  it("does not search until the query clears the minimum length", async () => {
    const user = userEvent.setup();
    renderPopover();
    await user.click(screen.getByRole("button", { name: /search messages/i }));

    await user.type(screen.getByRole("searchbox"), "bu");

    // Below the minimum the hook is called with an empty query, so `enabled`
    // keeps it from ever reaching the API.
    await waitFor(() => {
      expect(useSearch).toHaveBeenLastCalledWith("", "chan-1");
    });
    expect(screen.getByText(/type at least 3 characters/i)).toBeInTheDocument();
  });

  it("scopes to the active channel by passing channelId to the request", async () => {
    const user = userEvent.setup();
    renderPopover();
    await user.click(screen.getByRole("button", { name: /search messages/i }));

    await user.type(screen.getByRole("searchbox"), "budget");

    // The load-bearing assertion of this whole feature. SEARCH_LIMIT is applied
    // by the database across every accessible channel, so filtering the
    // response client-side would return nothing for a channel whose matches
    // rank below that cut — and render it as "no matches in this channel".
    await waitFor(() => {
      expect(useSearch).toHaveBeenLastCalledWith("budget", "chan-1");
    });
  });

  it("drops the channel filter when the member widens to all channels", async () => {
    const user = userEvent.setup();
    renderPopover();
    await user.click(screen.getByRole("button", { name: /search messages/i }));
    await user.type(screen.getByRole("searchbox"), "budget");
    await user.click(screen.getByRole("radio", { name: /all channels/i }));

    await waitFor(() => {
      expect(useSearch).toHaveBeenLastCalledWith("budget", undefined);
    });
  });

  it("falls back to chapter-wide when no channel is open", async () => {
    const user = userEvent.setup();
    renderPopover({ activeChannelId: null });
    await user.click(screen.getByRole("button", { name: /search messages/i }));

    await user.type(screen.getByRole("searchbox"), "budget");

    // "This channel" with no channel would scope to nothing and render an
    // honest-looking empty state for a question that was never asked.
    await waitFor(() => {
      expect(useSearch).toHaveBeenLastCalledWith("budget", undefined);
    });
  });

  it("hands the picked hit to the shell and dismisses itself", async () => {
    const onJump = vi.fn();
    useSearch.mockReturnValue(
      result({
        data: {
          payload: { messages: [message("m-1", "chan-1", "dues link")] },
          timedOut: false,
          timedOutSources: [],
        },
      }),
    );
    const user = userEvent.setup();
    renderPopover({ onJump });
    await user.click(screen.getByRole("button", { name: /search messages/i }));
    await user.type(screen.getByRole("searchbox"), "dues");

    await user.click(await screen.findByText("dues link"));

    expect(onJump).toHaveBeenCalledWith({
      message: expect.objectContaining({ id: "m-1" }),
      channelId: "chan-1",
    });
    // Dismiss on jump: a panel left open over the pane it just scrolled hides
    // the message it navigated to — the defect the pins panel already fixed.
    await waitFor(() => {
      expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    });
  });

  it("labels a hit that lives in another channel", async () => {
    useSearch.mockReturnValue(
      result({
        data: {
          payload: { messages: [message("m-2", "chan-2", "pizza night")] },
          timedOut: false,
          timedOutSources: [],
        },
      }),
    );
    const user = userEvent.setup();
    renderPopover();
    await user.click(screen.getByRole("button", { name: /search messages/i }));
    await user.click(screen.getByRole("radio", { name: /all channels/i }));
    await user.type(screen.getByRole("searchbox"), "pizza");

    // Picking this switches channel; an unlabelled row would make that jump
    // look like the timeline lost its place.
    expect(await screen.findByText(/in random/i)).toBeInTheDocument();
  });

  it("distinguishes a timed-out search from a search that found nothing", async () => {
    useSearch.mockReturnValue(
      result({
        data: {
          payload: { messages: [] },
          timedOut: true,
          timedOutSources: ["messages"],
        },
      }),
    );
    const user = userEvent.setup();
    renderPopover();
    await user.click(screen.getByRole("button", { name: /search messages/i }));
    await user.type(screen.getByRole("searchbox"), "budget");

    // spec/behavior/search.md requires the client to render "we stopped
    // looking here" differently from "we found nothing".
    expect(await screen.findByText(/timed out/i)).toBeInTheDocument();
    expect(screen.queryByText(/no messages match/i)).not.toBeInTheDocument();
  });

  // Replaces a weaker sibling that asserted `useSearch` was called with "" on a
  // freshly-rendered, never-typed popover — true under any implementation,
  // including one with no `open` gate at all. This one types first, so removing
  // the gate genuinely fails it.
  it("stops searching again once the popover is dismissed", async () => {
    const user = userEvent.setup();
    renderPopover();
    await user.click(screen.getByRole("button", { name: /search messages/i }));
    await user.type(screen.getByRole("searchbox"), "budget");
    await waitFor(() => {
      expect(useSearch).toHaveBeenLastCalledWith("budget", "chan-1");
    });

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(useSearch).toHaveBeenLastCalledWith("", "chan-1");
    });
  });

  it("does not announce a result count for a failed search", async () => {
    useSearch.mockReturnValue(
      result({ data: undefined, isError: true, refetch: vi.fn() }),
    );
    const user = userEvent.setup();
    renderPopover();
    await user.click(screen.getByRole("button", { name: /search messages/i }));
    await user.type(screen.getByRole("searchbox"), "budget");

    await screen.findByRole("alert");
    // Announcing "0 results" here tells a screen-reader user the channel holds
    // no match when the search never completed — the visual layer distinguishes
    // "we stopped looking" from "we found nothing" and the aria layer must too.
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe("");
  });

  it("does not announce a result count for a timed-out search", async () => {
    useSearch.mockReturnValue(
      result({
        data: {
          payload: { messages: [] },
          timedOut: true,
          timedOutSources: ["messages"],
        },
      }),
    );
    const user = userEvent.setup();
    renderPopover();
    await user.click(screen.getByRole("button", { name: /search messages/i }));
    await user.type(screen.getByRole("searchbox"), "budget");

    await screen.findByText(/timed out/i);
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe("");
  });

  it("shows the scope as chapter-wide when no channel is open, rather than claiming otherwise", async () => {
    const user = userEvent.setup();
    renderPopover({ activeChannelId: null });
    await user.click(screen.getByRole("button", { name: /search messages/i }));

    // The tab state, the request and the per-row labels all read from one
    // effective scope. Previously "This channel" rendered aria-checked while
    // the search ran chapter-wide AND the rows hid the channel labels that
    // would have revealed it.
    expect(
      screen.getByRole("radio", { name: /all channels/i }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("radio", { name: /this channel/i }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("offers a retry on failure instead of painting it as no matches", async () => {
    const refetch = vi.fn();
    useSearch.mockReturnValue(
      result({ data: undefined, isError: true, refetch }),
    );
    const user = userEvent.setup();
    renderPopover();
    await user.click(screen.getByRole("button", { name: /search messages/i }));
    await user.type(screen.getByRole("searchbox"), "budget");

    // Waits on the alert itself, not on the dialog: the popover is already
    // open, so `findByRole("dialog")` resolves before the debounce settles and
    // would assert against the "type at least 3 characters" hint.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /search failed/i,
    );
    const panel = within(screen.getByRole("dialog"));
    await user.click(panel.getByRole("button", { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });
});
