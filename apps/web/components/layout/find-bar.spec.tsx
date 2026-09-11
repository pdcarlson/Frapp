import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { push, searchQuery, channelsQuery } = vi.hoisted(() => ({
  push: vi.fn(),
  searchQuery: {
    current: {
      data: undefined as unknown,
      isFetching: false,
    },
  },
  channelsQuery: { current: { data: [] as unknown[] } },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@repo/hooks", () => ({
  useSearch: () => searchQuery.current,
  useChannels: () => channelsQuery.current,
  SEARCH_MIN_QUERY_LENGTH: 3,
}));

// The debounce is real elsewhere; here it would only make every assertion wait.
vi.mock("@/lib/hooks/use-debounced-value", () => ({
  useDebouncedValue: (value: unknown) => value,
}));

import { FindBar } from "./find-bar";

function searchPayload() {
  return {
    payload: {
      members: [{ user_id: "u1", display_name: "Ada Lovelace", email: "ada@x.co" }],
      messages: [{ id: "m1", content: "announce the thing", channel_id: "c9" }],
      // The API also returns these two. The find bar promises three groups in
      // its own placeholder and must not quietly widen past them.
      events: [{ id: "e1", name: "announce party" }],
      backwork: [{ id: "b1", title: "announcements 101" }],
    },
    timedOut: false,
    timedOutSources: [],
  };
}

describe("FindBar", () => {
  beforeEach(() => {
    push.mockClear();
    searchQuery.current = { data: undefined, isFetching: false };
    channelsQuery.current = { data: [] };
  });

  it("advertises the binding it actually wires", () => {
    // components.md §5 bans a keybinding hint that is not wired. The palette
    // this replaced advertised ⌘K; this field must advertise ⌘F.
    render(<FindBar />);
    expect(screen.getByText("⌘F")).toBeInTheDocument();
    expect(screen.queryByText(/⌘K/)).not.toBeInTheDocument();
  });

  it("focuses the field on Cmd+F instead of the browser's own find", () => {
    render(<FindBar />);
    const input = screen.getByRole("combobox");
    expect(input).not.toHaveFocus();

    const event = new KeyboardEvent("keydown", {
      key: "f",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(input).toHaveFocus();
    expect(event.defaultPrevented).toBe(true);
  });

  it("binds Ctrl+F too, for anyone not on a Mac", () => {
    render(<FindBar />);
    const event = new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(screen.getByRole("combobox")).toHaveFocus();
  });

  it("does not fight the caret while the chord is held down", () => {
    // A held chord repeats; re-selecting the field on every tick would make it
    // impossible to type.
    render(<FindBar />);
    const event = new KeyboardEvent("keydown", {
      key: "f",
      metaKey: true,
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("ranks channels, then members, then messages", async () => {
    channelsQuery.current = {
      data: [{ id: "c1", name: "announcements", category: "General" }],
    };
    searchQuery.current = { data: searchPayload(), isFetching: false };

    const user = userEvent.setup();
    render(<FindBar />);
    await user.type(screen.getByRole("combobox"), "announce");

    const headings = screen
      .getAllByText(/^(Channels|Members|Messages)$/)
      .map((el) => el.textContent);
    expect(headings).toEqual(["Channels", "Members", "Messages"]);
  });

  it("shows only the three groups its placeholder promises", async () => {
    channelsQuery.current = { data: [{ id: "c1", name: "announcements" }] };
    searchQuery.current = { data: searchPayload(), isFetching: false };

    const user = userEvent.setup();
    render(<FindBar />);
    await user.type(screen.getByRole("combobox"), "announce");

    // Events and Backwork are in the payload and must not be rendered.
    expect(screen.queryByText("announce party")).not.toBeInTheDocument();
    expect(screen.queryByText("announcements 101")).not.toBeInTheDocument();
  });

  it("preselects the first hit and opens it on Enter", async () => {
    channelsQuery.current = { data: [{ id: "c1", name: "announcements" }] };
    searchQuery.current = { data: searchPayload(), isFetching: false };

    const user = userEvent.setup();
    render(<FindBar />);
    const input = screen.getByRole("combobox");
    await user.type(input, "announce");

    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/chat?channel=c1"));
  });

  it("moves the selection with the arrow keys", async () => {
    channelsQuery.current = { data: [{ id: "c1", name: "announcements" }] };
    searchQuery.current = { data: searchPayload(), isFetching: false };

    const user = userEvent.setup();
    render(<FindBar />);
    const input = screen.getByRole("combobox");
    await user.type(input, "announce");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    const options = screen.getAllByRole("option");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
  });

  it("stays quiet under the minimum query length", async () => {
    channelsQuery.current = { data: [{ id: "c1", name: "announcements" }] };
    const user = userEvent.setup();
    render(<FindBar />);
    await user.type(screen.getByRole("combobox"), "an");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes on Escape and hands the page back", async () => {
    channelsQuery.current = { data: [{ id: "c1", name: "announcements" }] };
    searchQuery.current = { data: searchPayload(), isFetching: false };

    const user = userEvent.setup();
    render(<FindBar />);
    const input = screen.getByRole("combobox");
    await user.type(input, "announce");
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("tells a timeout apart from an empty result", async () => {
    // spec/behavior/search.md requires "we stopped looking" to read differently
    // from "we found nothing" — the per-source budget means a slow scan can
    // degrade alone while the query was perfectly good.
    searchQuery.current = {
      data: { payload: {}, timedOut: true, timedOutSources: ["messages"] },
      isFetching: false,
    };
    const user = userEvent.setup();
    render(<FindBar />);
    await user.type(screen.getByRole("combobox"), "announce");

    expect(screen.getByText(/took too long/i)).toBeInTheDocument();
    expect(screen.queryByText("No matches.")).not.toBeInTheDocument();
  });
});
