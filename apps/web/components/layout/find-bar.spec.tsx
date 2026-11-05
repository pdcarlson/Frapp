import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  act,
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

const { push, searchQuery, channelsQuery, departmentsQuery, moduleGate } =
  vi.hoisted(() => ({
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
    departmentsQuery: { current: { data: [] as unknown[] } },
    moduleGate: {
      current: undefined as ((key: string) => boolean) | undefined,
    },
  }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@repo/hooks", () => ({
  useSearch: () => searchQuery.current,
  useChannels: () => channelsQuery.current,
  useDepartments: () => departmentsQuery.current,
  SEARCH_MIN_QUERY_LENGTH: 3,
  SEARCH_COMPLETED_EVENT: "search-completed",
}));

vi.mock("@/lib/hooks/use-chapter-module-gate", () => ({
  useChapterModuleGate: () => moduleGate.current,
}));

// The debounce is real elsewhere; here it would only make every assertion wait.
vi.mock("@/lib/hooks/use-debounced-value", () => ({
  useDebouncedValue: (value: unknown) => value,
}));

import { FindBar } from "./find-bar";
import { FIND_PLACEHOLDER } from "./find-dialog";

function searchPayload() {
  return {
    payload: {
      members: [{ user_id: "u1", display_name: "Ada Lovelace", email: "ada@x.co" }],
      messages: [
        {
          id: "m1",
          content: "announce the thing",
          channel_id: "c1",
          created_at: "2026-10-28T19:08:00Z",
        },
      ],
      events: [
        { id: "e1", name: "announce party", start_time: "2026-11-09T19:00:00Z" },
      ],
      backwork: [
        {
          id: "b1",
          title: "announcements 101",
          department_id: "d1",
          course_number: "101",
          semester: "Fall",
          year: 2025,
          created_at: "2025-09-14T12:00:00Z",
        },
      ],
    },
    timedOut: false,
    timedOutSources: [],
  };
}

/** The shape `useSearch` returns, with sane defaults. */
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

function chord(over: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent("keydown", {
    key: "f",
    metaKey: true,
    bubbles: true,
    cancelable: true,
    ...over,
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

function trigger() {
  return screen.getByRole("button", { name: FIND_PLACEHOLDER });
}

/** Opens the dialog from the top-bar field and types a query into it. */
async function openAndType(
  user: ReturnType<typeof userEvent.setup>,
  text: string,
) {
  await user.click(trigger());
  const input = await screen.findByRole("combobox");
  await user.type(input, text);
  return input;
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
    searchQuery.current = searchState();
    channelsQuery.current = { data: [] };
    departmentsQuery.current = { data: [{ id: "d1", code: "COGS" }] };
    moduleGate.current = undefined;
  });

  it("carries no keyboard hint, closed or open", async () => {
    // The ⌘F / esc keycap was removed (2026-11-05); the binding still works,
    // it just is not advertised. The palette before it advertised ⌘K, which
    // nothing binds (components.md §7).
    const user = userEvent.setup();
    render(<FindBar />);
    expect(screen.queryByText("⌘F")).not.toBeInTheDocument();
    expect(screen.queryByText(/⌘K/)).not.toBeInTheDocument();
    await user.click(trigger());
    await screen.findByRole("dialog");
    expect(screen.queryByText("esc")).not.toBeInTheDocument();
    expect(screen.queryByText("⌘F")).not.toBeInTheDocument();
  });

  it("opens the dialog on Cmd+F instead of the browser's own find", async () => {
    render(<FindBar />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const event = chord();

    expect(event.defaultPrevented).toBe(true);
    const input = await screen.findByRole("combobox");
    await waitFor(() => expect(input).toHaveFocus());
  });

  it("binds Ctrl+F too, for anyone not on a Mac", async () => {
    render(<FindBar />);
    chord({ metaKey: false, ctrlKey: true });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("does not re-fire while the chord is held down", () => {
    render(<FindBar />);
    const event = chord({ repeat: true });
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("leaves the chord alone while someone is typing elsewhere", () => {
    render(
      <>
        <textarea aria-label="Composer" />
        <FindBar />
      </>,
    );
    screen.getByLabelText("Composer").focus();
    const event = chord();
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stands down inside another modal layer rather than killing native find", () => {
    render(<FindBar />);
    const guard = document.createElement("span");
    guard.setAttribute("data-radix-focus-guard", "");
    document.body.appendChild(guard);

    const event = chord();

    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    guard.remove();
  });

  it("sends Cmd+F back to the search text when the dialog is already open", async () => {
    const user = userEvent.setup();
    render(<FindBar />);
    const input = await openAndType(user, "abc");
    // Move focus off the input, inside the dialog, then press the chord.
    screen.getByRole("button", { name: "All" }).focus();
    const event = chord();
    expect(event.defaultPrevented).toBe(true);
    expect(input).toHaveFocus();
  });

  it("ranks channels, members, messages, events, then backwork", async () => {
    channelsQuery.current = {
      data: [{ id: "c1", name: "announcements", category: "General" }],
    };
    searchQuery.current = searchState({ data: searchPayload() });

    const user = userEvent.setup();
    render(<FindBar />);
    await openAndType(user, "announce");

    const listbox = within(screen.getByRole("listbox"));
    const headings = listbox
      .getAllByText(/^(Channels|Members|Messages|Events|Backwork)$/)
      .map((el) => el.textContent);
    expect(headings).toEqual([
      "Channels",
      "Members",
      "Messages",
      "Events",
      "Backwork",
    ]);
  });

  it("dates every dated result and names a backwork file's course and term", async () => {
    channelsQuery.current = { data: [{ id: "c1", name: "announcements" }] };
    searchQuery.current = searchState({ data: searchPayload() });

    const user = userEvent.setup();
    render(<FindBar />);
    await openAndType(user, "announce");

    const backwork = screen.getByRole("option", { name: /announcements 101/ });
    expect(backwork).toHaveTextContent(/COGS 101 · Fall 2025 · added Sep 14/);
    const message = screen.getByRole("option", { name: /announce the thing/ });
    expect(message).toHaveTextContent(/#announcements · Oct 28/);
    const event = screen.getByRole("option", { name: /announce party/ });
    expect(event).toHaveTextContent(/Nov 9/);
  });

  it("hides a group whose module the chapter switched off", async () => {
    moduleGate.current = (key) => key !== "backwork";
    searchQuery.current = searchState({ data: searchPayload() });

    const user = userEvent.setup();
    render(<FindBar />);
    await openAndType(user, "announce");

    expect(screen.queryByText("announcements 101")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Backwork" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("announce party")).toBeInTheDocument();
  });

  it("narrows to one group with a chip", async () => {
    channelsQuery.current = { data: [{ id: "c1", name: "announcements" }] };
    searchQuery.current = searchState({ data: searchPayload() });

    const user = userEvent.setup();
    render(<FindBar />);
    await openAndType(user, "announce");
    await user.click(screen.getByRole("button", { name: "Events" }));

    expect(screen.getByRole("button", { name: "Events" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("announce party");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
  });

  it("preselects the first hit and opens it on Enter", async () => {
    channelsQuery.current = { data: [{ id: "c1", name: "announcements" }] };
    searchQuery.current = searchState({ data: searchPayload() });

    const user = userEvent.setup();
    render(<FindBar />);
    const input = await openAndType(user, "announce");

    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/chat?channel=c1"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("moves the selection with the arrow keys", async () => {
    channelsQuery.current = { data: [{ id: "c1", name: "announcements" }] };
    searchQuery.current = searchState({ data: searchPayload() });

    const user = userEvent.setup();
    render(<FindBar />);
    const input = await openAndType(user, "announce");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    const options = screen.getAllByRole("option");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", options[1]!.id);
  });

  it("lists nothing under the minimum query length", async () => {
    channelsQuery.current = { data: [{ id: "c1", name: "announcements" }] };
    const user = userEvent.setup();
    render(<FindBar />);
    await openAndType(user, "an");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("closes on Escape, hands focus back, and keeps the query for next time", async () => {
    channelsQuery.current = { data: [{ id: "c1", name: "announcements" }] };
    searchQuery.current = searchState({ data: searchPayload() });

    const user = userEvent.setup();
    render(<FindBar />);
    await openAndType(user, "announce");

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger()).toHaveFocus());
    expect(trigger()).toHaveTextContent("announce");

    await user.click(trigger());
    expect(await screen.findByRole("combobox")).toHaveValue("announce");
  });

  it("tells a timeout apart from an empty result", async () => {
    searchQuery.current = searchState({
      data: { payload: {}, timedOut: true, timedOutSources: ["messages"] },
    });
    const user = userEvent.setup();
    render(<FindBar />);
    await openAndType(user, "announce");

    // Rendered twice by design: visibly in the list, and in the sr-only live
    // region. Scope to the list.
    const list = within(screen.getByRole("listbox"));
    expect(list.getByText(/took too long/i)).toBeInTheDocument();
    expect(list.queryByText("No matches.")).not.toBeInTheDocument();
  });

  it("says it stopped looking even when it has results to show", async () => {
    channelsQuery.current = { data: [{ id: "c1", name: "announcements" }] };
    searchQuery.current = searchState({
      data: { ...searchPayload(), timedOut: true, timedOutSources: ["messages"] },
      dataUpdatedAt: 6000,
    });
    const user = userEvent.setup();
    render(<FindBar />);
    await openAndType(user, "announce");

    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
    expect(
      within(screen.getByRole("listbox")).getByText(/stopped looking in messages/i),
    ).toBeInTheDocument();
  });

  it("distinguishes a failed search from an empty one", async () => {
    searchQuery.current = searchState({ isError: true, dataUpdatedAt: 0 });
    const user = userEvent.setup();
    render(<FindBar />);
    await openAndType(user, "announce");

    const list = within(screen.getByRole("listbox"));
    expect(list.getByText(/unavailable right now/i)).toBeInTheDocument();
    expect(list.queryByText("No matches.")).not.toBeInTheDocument();
  });

  it("emits search-completed with the find-bar surface", async () => {
    // `spec/behavior/observability.md` § Search Telemetry.
    const events: Array<{ name: string; properties?: AnalyticsProperties }> = [];
    searchQuery.current = searchState({
      data: searchPayload(),
      dataUpdatedAt: 4000,
    });
    const user = userEvent.setup();
    renderWithTrack((name, properties) => events.push({ name, properties }));
    await openAndType(user, "announce");

    await waitFor(() => expect(events.length).toBeGreaterThan(0));
    const event = events.find((e) => e.name === "search-completed");
    expect(event).toBeDefined();
    expect(event!.properties).toMatchObject({
      surface: "find-bar",
      members_count: 1,
      messages_count: 1,
      events_count: 1,
      backwork_count: 1,
      zero_result: false,
      timed_out: false,
    });
    // Shape, not value: the dedupe key is held constant, so the event fires
    // once at whatever length first cleared the minimum.
    expect(typeof event!.properties!.query_length).toBe("number");
  });

  it("never carries the raw query text or another forbidden property", async () => {
    // `observability.md` cites this as the proof that the raw query is never
    // sent: `"query"` is not a forbidden key, so the shared gate alone would
    // let a property holding the raw text through.
    const events: Array<{ name: string; properties?: AnalyticsProperties }> = [];
    searchQuery.current = searchState({
      data: searchPayload(),
      dataUpdatedAt: 5000,
    });
    const user = userEvent.setup();
    renderWithTrack((name, properties) => events.push({ name, properties }));
    await openAndType(user, "announce");

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
});
