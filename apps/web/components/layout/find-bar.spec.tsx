import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  assertContentFreeProperties,
  type AnalyticsProperties,
} from "@repo/validation";
import { AnalyticsContext } from "@/lib/providers/analytics-provider";

const { push, searchQuery, channelsQuery } = vi.hoisted(() => ({
  push: vi.fn(),
  searchQuery: {
    current: {
      data: undefined as unknown,
      isFetching: false,
      isError: false,
      dataUpdatedAt: 1,
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
  SEARCH_COMPLETED_EVENT: "search-completed",
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

/**
 * The shape `useSearch` returns, with sane defaults. A helper rather than an
 * object literal per case: every new field `FindBar` reads would otherwise mean
 * editing every assignment in this file.
 */
function searchState(
  over: Partial<{
    data: unknown;
    isFetching: boolean;
    isError: boolean;
    dataUpdatedAt: number;
  }> = {},
) {
  return {
    data: undefined as unknown,
    isFetching: false,
    isError: false,
    dataUpdatedAt: 1,
    ...over,
  };
}

function renderWithTrack(
  track: (name: string, properties?: AnalyticsProperties) => void,
) {
  return render(
    <AnalyticsContext.Provider value={track}>
      <FindBar />
    </AnalyticsContext.Provider>,
  );
}

describe("FindBar", () => {
  beforeEach(() => {
    push.mockClear();
    searchQuery.current = searchState({
      data: undefined,
      isFetching: false,
      isError: false,
      dataUpdatedAt: 1,
    });
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
    searchQuery.current = searchState({ data: searchPayload() });

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
    searchQuery.current = searchState({ data: searchPayload() });

    const user = userEvent.setup();
    render(<FindBar />);
    await user.type(screen.getByRole("combobox"), "announce");

    // Events and Backwork are in the payload and must not be rendered.
    expect(screen.queryByText("announce party")).not.toBeInTheDocument();
    expect(screen.queryByText("announcements 101")).not.toBeInTheDocument();
  });

  it("preselects the first hit and opens it on Enter", async () => {
    channelsQuery.current = { data: [{ id: "c1", name: "announcements" }] };
    searchQuery.current = searchState({ data: searchPayload() });

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
    searchQuery.current = searchState({ data: searchPayload() });

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
    searchQuery.current = searchState({ data: searchPayload() });

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
    searchQuery.current = searchState({
      data: { payload: {}, timedOut: true, timedOutSources: ["messages"] },
    });
    const user = userEvent.setup();
    render(<FindBar />);
    await user.type(screen.getByRole("combobox"), "announce");

    // Rendered twice by design — visibly in the panel, and again in the
    // sr-only live region so a screen reader hears it. Scope to the panel.
    const panel = within(screen.getByRole("listbox"));
    expect(panel.getByText(/took too long/i)).toBeInTheDocument();
    expect(panel.queryByText("No matches.")).not.toBeInTheDocument();
  });

  it("emits search-completed, which the palette used to own", async () => {
    // `spec/behavior/observability.md` § Search Telemetry. Deleting the palette
    // deleted the only emitter; if the find field does not carry the event, the
    // zero-result taxonomy that section describes reports nothing forever and
    // nobody can tell a telemetry regression from a collapse in search usage.
    const events: Array<{ name: string; properties?: AnalyticsProperties }> = [];
    searchQuery.current = searchState({
      data: searchPayload(),
      isFetching: false,
      isError: false,
      dataUpdatedAt: 4000,
    });
    const user = userEvent.setup();
    renderWithTrack((name, properties) => events.push({ name, properties }));
    await user.type(screen.getByRole("combobox"), "announce");

    await waitFor(() => expect(events.length).toBeGreaterThan(0));
    const event = events.find((e) => e.name === "search-completed");
    expect(event).toBeDefined();
    expect(event!.properties).toMatchObject({
      surface: "find-bar",
      members_count: 1,
      messages_count: 1,
      zero_result: false,
      timed_out: false,
    });
    /*
     * `query_length` is asserted as shape, not value. The dedupe key is
     * `dataUpdatedAt`, which this test holds constant, so the event fires once
     * at whatever length first cleared the 3-character minimum rather than at
     * the final length. Pinning the number here would be pinning the harness.
     */
    expect(typeof event!.properties!.query_length).toBe("number");
  });

  it("never carries the raw query text or another forbidden property", async () => {
    // Ported from the deleted palette suite. `observability.md` cites this
    // assertion as the *proof* that the raw query is never sent — and the
    // shared gate cannot provide it: `"query"` is not a forbidden key, so a
    // property holding the raw text would pass `assertContentFreeProperties`
    // untouched. Losing this test would leave that guarantee asserted nowhere.
    const events: Array<{ name: string; properties?: AnalyticsProperties }> = [];
    searchQuery.current = searchState({
      data: searchPayload(),
      isFetching: false,
      isError: false,
      dataUpdatedAt: 5000,
    });
    const user = userEvent.setup();
    renderWithTrack((name, properties) => events.push({ name, properties }));
    await user.type(screen.getByRole("combobox"), "announce");

    await waitFor(() => expect(events.length).toBeGreaterThan(0));
    for (const event of events) {
      expect(() =>
        assertContentFreeProperties({
          name: event.name,
          distinctId: "test",
          properties: event.properties ?? {},
        }),
      ).not.toThrow();
      expect(Object.values(event.properties ?? {})).not.toContain("announce");
    }
  });

  it("says it stopped looking even when it has results to show", async () => {
    // The 500ms budget is per SOURCE, so a slow message scan degrades alone.
    // Rendering the notice only in the empty branch is what makes a partial
    // result look complete (spec/behavior/search.md).
    channelsQuery.current = { data: [{ id: "c1", name: "announcements" }] };
    searchQuery.current = searchState({
      data: { ...searchPayload(), timedOut: true, timedOutSources: ["messages"] },
      isFetching: false,
      isError: false,
      dataUpdatedAt: 6000,
    });
    const user = userEvent.setup();
    render(<FindBar />);
    await user.type(screen.getByRole("combobox"), "announce");

    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
    expect(
      within(screen.getByRole("listbox")).getByText(/stopped looking in messages/i),
    ).toBeInTheDocument();
  });

  it("distinguishes a failed search from an empty one", async () => {
    searchQuery.current = searchState({
      data: undefined,
      isFetching: false,
      isError: true,
      dataUpdatedAt: 0,
    });
    const user = userEvent.setup();
    render(<FindBar />);
    await user.type(screen.getByRole("combobox"), "announce");

    const panel = within(screen.getByRole("listbox"));
    expect(panel.getByText(/unavailable right now/i)).toBeInTheDocument();
    expect(panel.queryByText("No matches.")).not.toBeInTheDocument();
  });

  it("points the combobox at the highlighted option", async () => {
    channelsQuery.current = { data: [{ id: "c1", name: "announcements" }] };
    searchQuery.current = searchState({
      data: searchPayload(),
      isFetching: false,
      isError: false,
      dataUpdatedAt: 7000,
    });
    const user = userEvent.setup();
    render(<FindBar />);
    const input = screen.getByRole("combobox");
    await user.type(input, "announce");

    const options = screen.getAllByRole("option");
    expect(input).toHaveAttribute("aria-activedescendant", options[0]!.id);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", options[1]!.id);
  });

  it("keeps focus in the field on Escape", async () => {
    // Blurring to <body> restarts the next Tab from the top of the document.
    channelsQuery.current = { data: [{ id: "c1", name: "announcements" }] };
    searchQuery.current = searchState({
      data: searchPayload(),
      isFetching: false,
      isError: false,
      dataUpdatedAt: 8000,
    });
    const user = userEvent.setup();
    render(<FindBar />);
    const input = screen.getByRole("combobox");
    await user.type(input, "announce");
    fireEvent.keyDown(input, { key: "Escape" });

    expect(input).toHaveFocus();
  });

  it("stands down inside a modal layer rather than killing native find", () => {
    // This field is outside every Radix focus scope, so focusing it from inside
    // a dialog is bounced straight back - and preventDefault would already have
    // killed the browser's own find, leaving the member with neither.
    render(<FindBar />);
    const guard = document.createElement("span");
    guard.setAttribute("data-radix-focus-guard", "");
    document.body.appendChild(guard);

    const event = new KeyboardEvent("keydown", {
      key: "f",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(screen.getByRole("combobox")).not.toHaveFocus();
    guard.remove();
  });
});