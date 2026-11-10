import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChatSearchPanel } from "./chat-search-popover";

const useSearch = vi.fn();

vi.mock("@repo/hooks", async () => {
  // The real gate rules, so the panel and the hook cannot drift in this spec.
  const actual = await vi.importActual<
    typeof import("../../../../packages/hooks/src/use-search")
  >("../../../../packages/hooks/src/use-search");
  // The real name matcher too: the pickers share it with the member column.
  const members = await vi.importActual<
    typeof import("../../../../packages/hooks/src/channel-members")
  >("../../../../packages/hooks/src/channel-members");
  return {
    SEARCH_MIN_QUERY_LENGTH: 3,
    filterChannelMembers: members.filterChannelMembers,
    memberLabel: (name: string | null, id: string) => name ?? `Member ${id}`,
    hasMessageFilter: actual.hasMessageFilter,
    isSearchRunnable: actual.isSearchRunnable,
    useSearch: (query: string, filters?: unknown) => useSearch(query, filters),
    resolveAuthorLabel: (message: { sender_id: string }) =>
      message.sender_id === "u-1" ? "Ada" : "Grace",
  };
});

function result(overrides: Record<string, unknown> = {}) {
  return {
    data: { payload: { messages: [] }, timedOut: false, timedOutSources: [] },
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

function messagesResult(
  messages: unknown[],
  extras: { timedOut?: boolean; timedOutSources?: string[] } = {},
) {
  return result({
    data: {
      payload: { messages },
      timedOut: extras.timedOut ?? false,
      timedOutSources: extras.timedOutSources ?? [],
    },
  });
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

function previewHit(
  id: string,
  extras: {
    kind?: string;
    attachment_count?: number;
    is_deleted?: boolean;
  } = {},
) {
  return {
    ...message(id, "chan-1", ""),
    kind: "text",
    attachment_count: 0,
    is_deleted: false,
    ...extras,
  };
}

function renderPanel(props: Record<string, unknown> = {}) {
  return render(
    <ChatSearchPanel
      activeChannelId="chan-1"
      channels={[
        { id: "chan-1", label: "general" },
        { id: "chan-2", label: "random" },
      ]}
      members={[
        { id: "u-1", label: "Ada Lovelace" },
        { id: "u-2", label: "Grace Hopper" },
      ]}
      channelNameFor={(id) => (id === "chan-2" ? "random" : "general")}
      nameFor={(id) => (id === "u-2" ? "Grace Hopper" : "Ada Lovelace")}
      onJump={vi.fn()}
      {...props}
    />,
  );
}

// The panel carries no trigger: `channel-menu.tsx` owns the popover and mounts
// this only while its view is selected, so rendering it IS opening it.
async function typeQuery(query: string, props: Record<string, unknown> = {}) {
  const user = userEvent.setup();
  renderPanel(props);
  await user.type(screen.getByRole("combobox"), query);
  return user;
}

/**
 * In-channel message search for the web chat shell (#469), as the search view
 * of the channel overflow menu.
 *
 * The behaviours pinned here are the ones a refactor would silently break, and
 * the two that would be *wrong but invisible*: that the channel filter reaches
 * the request rather than being applied to the response, and that a timed-out
 * search never renders as "no matches".
 */
describe("ChatSearchPanel", () => {
  beforeEach(() => {
    useSearch.mockReset();
    useSearch.mockReturnValue(result());
  });

  it("does not search until the query clears the minimum length", async () => {
    await typeQuery("bu");

    // The hook's own `enabled` gate (`isSearchRunnable`) holds this back; the
    // panel says why nothing is listed.
    await waitFor(() => {
      expect(useSearch).toHaveBeenLastCalledWith("bu", { channelId: "chan-1" });
    });
    expect(screen.getByText(/type at least 3 characters/i)).toBeInTheDocument();
  });

  it("scopes to the active channel by passing channelId to the request", async () => {
    await typeQuery("budget");

    // The load-bearing assertion of this whole feature. SEARCH_LIMIT is applied
    // by the database across every accessible channel, so filtering the
    // response client-side would return nothing for a channel whose matches
    // rank below that cut — and render it as "no matches in this channel".
    await waitFor(() => {
      expect(useSearch).toHaveBeenLastCalledWith("budget", {
        channelId: "chan-1",
      });
    });
  });

  it("drops the channel filter when the member widens to all channels", async () => {
    const user = await typeQuery("budget");
    await user.click(screen.getByRole("button", { name: "Clear In filter" }));

    await waitFor(() => {
      expect(useSearch).toHaveBeenLastCalledWith("budget", {});
    });
  });

  it("falls back to chapter-wide when no channel is open", async () => {
    await typeQuery("budget", { activeChannelId: null });

    // "This channel" with no channel would scope to nothing and render an
    // honest-looking empty state for a question that was never asked.
    await waitFor(() => {
      expect(useSearch).toHaveBeenLastCalledWith("budget", {});
    });
  });

  it("previews a poll hit by its kind noun, not an empty block", async () => {
    useSearch.mockReturnValue(
      messagesResult([previewHit("m-poll", { kind: "poll" })]),
    );
    await typeQuery("poll");

    expect(await screen.findByText("Poll")).toBeInTheDocument();
  });

  it("previews a file-only hit as an attachment count", async () => {
    useSearch.mockReturnValue(
      messagesResult([previewHit("m-file", { attachment_count: 3 })]),
    );
    await typeQuery("file");

    expect(await screen.findByText("3 attachments")).toBeInTheDocument();
  });

  it("previews a deleted hit as the tombstone, not a blank block", async () => {
    useSearch.mockReturnValue(
      messagesResult([previewHit("m-gone", { is_deleted: true })]),
    );
    await typeQuery("gone");

    expect(await screen.findByText("[message deleted]")).toBeInTheDocument();
  });

  // Dismiss-on-jump is no longer asserted here because it is no longer this
  // component's to do: the panel hands the hit up and `channel-menu.tsx` closes
  // the popover, so the panel never covers the message it just scrolled to.
  it("hands the picked hit to the shell", async () => {
    const onJump = vi.fn();
    useSearch.mockReturnValue(
      messagesResult([message("m-1", "chan-1", "dues link")]),
    );
    const user = await typeQuery("dues", { onJump });

    await user.click(await screen.findByText("dues link"));

    expect(onJump).toHaveBeenCalledWith({
      message: expect.objectContaining({ id: "m-1" }),
      channelId: "chan-1",
    });
  });

  it("labels a hit that lives in another channel", async () => {
    useSearch.mockReturnValue(
      messagesResult([message("m-2", "chan-2", "pizza night")]),
    );
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Clear In filter" }));
    await user.type(screen.getByRole("combobox"), "pizza");

    // Picking this switches channel; an unlabelled row would make that jump
    // look like the timeline lost its place.
    expect(await screen.findByText(/in random/i)).toBeInTheDocument();
  });

  it("distinguishes a timed-out search from a search that found nothing", async () => {
    useSearch.mockReturnValue(
      messagesResult([], { timedOut: true, timedOutSources: ["messages"] }),
    );
    await typeQuery("budget");

    // spec/behavior/search.md requires the client to render "we stopped
    // looking here" differently from "we found nothing".
    expect(await screen.findByText(/timed out/i)).toBeInTheDocument();
    expect(screen.queryByText(/no messages match/i)).not.toBeInTheDocument();
  });

  it("does not announce a result count for a failed search", async () => {
    useSearch.mockReturnValue(
      result({ data: undefined, isError: true, refetch: vi.fn() }),
    );
    await typeQuery("budget");

    await screen.findByRole("alert");
    // Announcing "0 results" here tells a screen-reader user the channel holds
    // no match when the search never completed — the visual layer distinguishes
    // "we stopped looking" from "we found nothing" and the aria layer must too.
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe("");
  });

  it("does not announce a result count for a timed-out search", async () => {
    useSearch.mockReturnValue(
      messagesResult([], { timedOut: true, timedOutSources: ["messages"] }),
    );
    await typeQuery("budget");

    await screen.findByText(/timed out/i);
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe("");
  });

  it("shows no channel on the In chip when no channel is open, rather than claiming one", async () => {
    renderPanel({ activeChannelId: null });

    // The chip, the request and the per-row labels all read one channel
    // filter, so the chip cannot name a channel the search is not narrowed to.
    expect(screen.getByRole("button", { name: "In" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear In filter" }),
    ).not.toBeInTheDocument();
  });

  it("offers a retry on failure instead of painting it as no matches", async () => {
    const refetch = vi.fn();
    useSearch.mockReturnValue(
      result({ data: undefined, isError: true, refetch }),
    );
    const user = await typeQuery("budget");

    // Waits on the alert itself rather than on the panel: the panel is mounted
    // from the first render, so anything less specific resolves before the
    // debounce settles and would assert against the "type at least 3
    // characters" hint.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /search failed/i,
    );
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  describe("filters (#3958)", () => {
    it("starts on the open channel and names it on the In chip", () => {
      renderPanel();

      expect(
        screen.getByRole("button", { name: "In: general" }),
      ).toBeInTheDocument();
    });

    it("offers members when from: is typed, and filters by the pick with no text", async () => {
      const user = await typeQuery("from:gra");

      const options = screen.getAllByRole("option");
      expect(options.map((option) => option.textContent)).toEqual([
        "Grace Hopper",
      ]);
      await user.keyboard("{Enter}");

      // The word leaves the box, the chip carries the pick, and the sender
      // reaches the request with empty text: a filter alone is a search.
      expect(screen.getByRole("combobox")).toHaveValue("");
      expect(
        screen.getByRole("button", { name: "From: Grace Hopper" }),
      ).toBeInTheDocument();
      await waitFor(() => {
        expect(useSearch).toHaveBeenLastCalledWith("", {
          channelId: "chan-1",
          fromUserId: "u-2",
        });
      });
      expect(
        screen.queryByText(/type at least 3 characters/i),
      ).not.toBeInTheDocument();
    });

    it("keeps the words before from: as the search text", async () => {
      const user = await typeQuery("budget from:ada");

      // The half-typed word is the picker's filter, never search text.
      await waitFor(() => {
        expect(useSearch).toHaveBeenLastCalledWith("budget", {
          channelId: "chan-1",
        });
      });
      await user.click(screen.getByRole("option", { name: "Ada Lovelace" }));

      await waitFor(() => {
        expect(useSearch).toHaveBeenLastCalledWith("budget", {
          channelId: "chan-1",
          fromUserId: "u-1",
        });
      });
    });

    it("picks any readable channel from in:, not only the open one", async () => {
      const user = await typeQuery("budget in:");

      expect(
        screen.getAllByRole("option").map((option) => option.textContent),
      ).toEqual(["All channels", "general", "random"]);
      await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

      expect(
        screen.getByRole("button", { name: "In: random" }),
      ).toBeInTheDocument();
      await waitFor(() => {
        expect(useSearch).toHaveBeenLastCalledWith("budget", {
          channelId: "chan-2",
        });
      });
    });

    it("opens the same picker from the From chip", async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByRole("button", { name: "From" }));

      expect(screen.getByRole("combobox")).toHaveValue("from:");
      expect(screen.getByRole("combobox")).toHaveFocus();
      expect(screen.getAllByRole("option")).toHaveLength(2);
    });

    it("says so when no member matches", async () => {
      await typeQuery("from:zed");

      expect(screen.getByText("No member named “zed”.")).toBeInTheDocument();
    });

    it("sends a Date choice as an instant with an offset, never a bare date", async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByRole("button", { name: "Date" }));
      await user.click(screen.getByRole("radio", { name: "Last 7 days" }));

      expect(
        screen.getByRole("button", { name: "Date: Last 7 days" }),
      ).toBeInTheDocument();
      await waitFor(() => {
        const [, filters] = useSearch.mock.lastCall as [
          string,
          { after?: string; before?: string },
        ];
        // The API answers a bare date with a 400 (`iso-instant.ts`).
        expect(filters.after).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        );
        expect(filters.before).toBeUndefined();
      });
    });

    it("sends every ticked Has trait and clears them from the chip", async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByRole("button", { name: "Has" }));
      await user.click(screen.getByRole("button", { name: "Link" }));
      await user.click(screen.getByRole("button", { name: "File" }));

      await waitFor(() => {
        expect(useSearch).toHaveBeenLastCalledWith("", {
          channelId: "chan-1",
          has: ["link", "file"],
        });
      });
      await user.click(
        screen.getByRole("button", { name: "Clear Has filter" }),
      );

      await waitFor(() => {
        expect(useSearch).toHaveBeenLastCalledWith("", {
          channelId: "chan-1",
        });
      });
      // Back to a channel alone, which is not a search without text.
      expect(
        screen.getByText(/or pick From, Date or Has to search without text/i),
      ).toBeInTheDocument();
    });

    it("sends a custom range through both date fields, and clears it", async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByRole("button", { name: "Date" }));
      await user.click(screen.getByRole("radio", { name: "Custom" }));
      // No date yet: not a set filter, and not a search.
      expect(screen.getByRole("button", { name: "Date" })).toBeInTheDocument();

      await user.type(screen.getByLabelText("From"), "2026-11-01");
      await user.type(screen.getByLabelText("To"), "2026-11-05");

      await waitFor(() => {
        expect(useSearch).toHaveBeenLastCalledWith("", {
          channelId: "chan-1",
          after: new Date(2026, 10, 1).toISOString(),
          before: new Date(2026, 10, 6).toISOString(),
        });
      });
      await user.click(
        screen.getByRole("button", { name: "Date: 2026-11-01 to 2026-11-05" }),
      );
      await user.click(
        screen.getByRole("button", { name: "Clear Date filter" }),
      );

      await waitFor(() => {
        expect(useSearch).toHaveBeenLastCalledWith("", { channelId: "chan-1" });
      });
    });

    it("sends each preset's own bound", async () => {
      const user = userEvent.setup();
      renderPanel();
      await user.click(screen.getByRole("button", { name: "Date" }));
      const after = () =>
        (useSearch.mock.lastCall as [string, { after?: string }])[1].after;

      await user.click(screen.getByRole("radio", { name: "Last 7 days" }));
      const week = after();
      await user.click(screen.getByRole("radio", { name: "Last 30 days" }));
      const month = after();

      const days = (iso: string | undefined) =>
        Math.round((Date.now() - new Date(iso ?? "").getTime()) / 86_400_000);
      expect(days(week)).toBeGreaterThanOrEqual(7);
      expect(days(week)).toBeLessThanOrEqual(8);
      expect(days(month)).toBeGreaterThanOrEqual(30);
      expect(days(month)).toBeLessThanOrEqual(31);
    });

    it("clears From and returns focus to the box", async () => {
      const user = await typeQuery("from:gra");
      await user.keyboard("{Enter}");

      await user.click(
        screen.getByRole("button", { name: "Clear From filter" }),
      );

      await waitFor(() => {
        expect(useSearch).toHaveBeenLastCalledWith("", { channelId: "chan-1" });
      });
      // The pressed button is gone; focus left on <body> would let the next
      // Tab close the menu with the search in it.
      expect(screen.getByRole("combobox")).toHaveFocus();
    });

    it("un-ticks a Has trait", async () => {
      const user = userEvent.setup();
      renderPanel();
      await user.click(screen.getByRole("button", { name: "Has" }));
      await user.click(screen.getByRole("button", { name: "Link" }));
      await user.click(screen.getByRole("button", { name: "File" }));

      await user.click(screen.getByRole("button", { name: "Link" }));

      await waitFor(() => {
        expect(useSearch).toHaveBeenLastCalledWith("", {
          channelId: "chan-1",
          has: ["file"],
        });
      });
    });

    it("puts the picker away on Escape and keeps the search text", async () => {
      const user = await typeQuery("budget from:gr");

      await user.keyboard("{Escape}");

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(screen.getByRole("combobox")).toHaveValue("budget");
    });

    it("puts the picker away on Escape from a chip too", async () => {
      const user = await typeQuery("budget from:gr");
      screen.getByRole("button", { name: "In: general" }).focus();

      await user.keyboard("{Escape}");

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(screen.getByRole("combobox")).toHaveValue("budget");
      expect(screen.getByRole("combobox")).toHaveFocus();
    });

    it("keeps narrowing through a space in a name", async () => {
      await typeQuery("from:grace hop");

      expect(
        screen.getAllByRole("option").map((option) => option.textContent),
      ).toEqual(["Grace Hopper"]);
    });

    it("searches the words as typed once they match no member", async () => {
      await typeQuery("from:grace budget");

      // Not a token any more: nothing typed is dropped from the search.
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      await waitFor(() => {
        expect(useSearch).toHaveBeenLastCalledWith("from:grace budget", {
          channelId: "chan-1",
        });
      });
    });

    it("names an unnamed member on the chip as the picker did", async () => {
      const user = await typeQuery("from:", {
        members: [{ id: "u-9", label: "Member u-9" }],
        nameFor: () => null,
      });
      await user.keyboard("{Enter}");

      expect(
        screen.getByRole("button", { name: "From: Member u-9" }),
      ).toBeInTheDocument();
    });

    it("searches from: and in: as typed when they are not the last word", async () => {
      await typeQuery("error in: login page");

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      await waitFor(() => {
        expect(useSearch).toHaveBeenLastCalledWith("error in: login page", {
          channelId: "chan-1",
        });
      });
    });

    it("labels hits when In names a channel other than the open one", async () => {
      useSearch.mockReturnValue(
        messagesResult([message("m-2", "chan-2", "pizza night")]),
      );
      const user = await typeQuery("pizza in:ran");
      await user.keyboard("{Enter}");

      // Picking this row switches channel, whatever In holds.
      expect(await screen.findByText(/in random/i)).toBeInTheDocument();
    });

    it("names the searched channel in the hint, not the open one", async () => {
      const user = await typeQuery("in:ran");
      await user.keyboard("{Enter}");

      expect(
        screen.getByText(/type at least 3 characters to search random,/i),
      ).toBeInTheDocument();
    });

    it("follows the open channel until In is touched", () => {
      // Opened on a cold load, before the shell knows the channel.
      const { rerender } = renderPanel({ activeChannelId: null });
      expect(screen.getByRole("button", { name: "In" })).toBeInTheDocument();

      rerender(
        <ChatSearchPanel
          activeChannelId="chan-1"
          channels={[{ id: "chan-1", label: "general" }]}
          members={[]}
          channelNameFor={() => "general"}
          nameFor={() => null}
          onJump={vi.fn()}
        />,
      );

      expect(
        screen.getByRole("button", { name: "In: general" }),
      ).toBeInTheDocument();
    });

    it("still refuses one or two characters beside a filter", async () => {
      const user = await typeQuery("from:gra");
      await user.keyboard("{Enter}");
      await user.type(screen.getByRole("combobox"), "bu");

      expect(
        await screen.findByText(/type at least 3 characters/i),
      ).toBeInTheDocument();
    });
  });
});
