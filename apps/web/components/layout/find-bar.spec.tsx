import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const {
  push,
  searchQuery,
  channelsQuery,
  departmentsQuery,
  departmentsOptions,
  moduleGate,
  permissionList,
  debounced,
} = vi.hoisted(() => ({
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
    departmentsOptions: { current: undefined as { enabled?: boolean } | undefined },
    moduleGate: {
      current: undefined as ((key: string) => boolean) | undefined,
    },
    permissionList: { current: [] as string[] },
    // `null` passes the live value through; a string pins the debounced one.
    debounced: { current: null as string | null },
  }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@repo/hooks", () => ({
  useSearch: () => searchQuery.current,
  useChannels: () => channelsQuery.current,
  useDepartments: (options?: { enabled?: boolean }) => {
    departmentsOptions.current = options;
    return departmentsQuery.current;
  },
  usePermissionList: () => permissionList.current,
  SEARCH_MIN_QUERY_LENGTH: 3,
  SEARCH_COMPLETED_EVENT: "search-completed",
}));

vi.mock("@/lib/hooks/use-chapter-module-gate", () => ({
  useChapterModuleGate: () => moduleGate.current,
}));

// The debounce is real elsewhere; here it would only make every assertion
// wait. A test that needs the list to trail the text pins `debounced`.
vi.mock("@/lib/hooks/use-debounced-value", () => ({
  useDebouncedValue: (value: unknown) => debounced.current ?? value,
}));

// Whether this member has Ask is the host's question (`ask-host.spec.tsx`).
// Null, as for a member without it, unless a test says otherwise.
const askEntry = vi.hoisted(() => ({
  current: null as { open: boolean; openWith: ReturnType<typeof vi.fn> } | null,
}));
vi.mock("@/components/ask/ask-host", () => ({
  useAskEntry: () => askEntry.current,
}));

import { FindBar } from "./find-bar";
import { FIND_ASK_PLACEHOLDER, FIND_PLACEHOLDER } from "./find-dialog";

// Offsetless instants on purpose: they parse as local time, so the calendar
// days the assertions name hold in every runner timezone.
function searchPayload() {
  return {
    payload: {
      members: [{ user_id: "u1", display_name: "Ada Lovelace", email: "ada@x.co" }],
      messages: [
        {
          id: "m1",
          content: "announce the thing",
          channel_id: "c1",
          created_at: "2026-10-28T19:08:00",
        },
      ],
      events: [
        { id: "e1", name: "announce party", start_time: "2026-11-09T19:00:00" },
      ],
      backwork: [
        {
          id: "b1",
          title: "announcements 101",
          department_id: "d1",
          course_number: "101",
          semester: "Fall",
          year: 2025,
          created_at: "2025-09-14T12:00:00",
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
    departmentsOptions.current = undefined;
    moduleGate.current = () => true;
    permissionList.current = ["members:view", "backwork:upload"];
    debounced.current = null;
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

  it("hides Events when the events module is off", async () => {
    moduleGate.current = (key) => key !== "events";
    searchQuery.current = searchState({ data: searchPayload() });

    const user = userEvent.setup();
    render(<FindBar />);
    await openAndType(user, "announce");

    expect(screen.queryByText("announce party")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Events" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("announcements 101")).toBeInTheDocument();
  });

  it("keeps the module groups out until the module gate has loaded", async () => {
    // Right after a chapter switch the gate is still loading; the rows are
    // data a switched-off module would not show, so they wait for it.
    moduleGate.current = undefined;
    searchQuery.current = searchState({ data: searchPayload() });

    const user = userEvent.setup();
    render(<FindBar />);
    await openAndType(user, "announce");

    expect(screen.queryByText("announce party")).not.toBeInTheDocument();
    expect(screen.queryByText("announcements 101")).not.toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("hides Backwork, and skips the department read, for a member the library refuses", async () => {
    permissionList.current = ["members:view", "alumni:post"];
    searchQuery.current = searchState({ data: searchPayload() });

    const user = userEvent.setup();
    render(<FindBar />);
    await openAndType(user, "announce");

    expect(screen.queryByText("announcements 101")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Backwork" }),
    ).not.toBeInTheDocument();
    expect(departmentsOptions.current).toEqual({ enabled: false });
  });

  it("reads departments for a member who may browse backwork", async () => {
    const user = userEvent.setup();
    render(<FindBar />);
    await openAndType(user, "announce");
    expect(departmentsOptions.current).toEqual({ enabled: true });
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

  it("ignores Enter while the list still belongs to the previous text", async () => {
    channelsQuery.current = { data: [{ id: "c1", name: "announcements" }] };
    searchQuery.current = searchState({ data: searchPayload() });

    const user = userEvent.setup();
    render(<FindBar />);
    const input = await openAndType(user, "announce");
    // The member types on; the debounced query (and so the list) lags.
    debounced.current = "announce";
    await user.type(input, "x");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("leaves an IME's Enter to the IME", async () => {
    channelsQuery.current = { data: [{ id: "c1", name: "announcements" }] };
    searchQuery.current = searchState({ data: searchPayload() });

    const user = userEvent.setup();
    render(<FindBar />);
    const input = await openAndType(user, "announce");

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(push).not.toHaveBeenCalled();
  });

  it("draws result rows on the Row step: 32 on a mouse, 44 on touch", async () => {
    // foundations.md §9 (#3515). The row is hand-rolled, so the primitives'
    // touch-floor spec does not cover it.
    channelsQuery.current = { data: [{ id: "c1", name: "announcements" }] };
    searchQuery.current = searchState({ data: searchPayload() });

    const user = userEvent.setup();
    render(<FindBar />);
    await openAndType(user, "announce");

    for (const option of screen.getAllByRole("option")) {
      const classes = option.className.split(/\s+/);
      expect(classes).toEqual(
        expect.arrayContaining([
          "min-h-8",
          "text-sm",
          "pointer-coarse:min-h-11",
          "pointer-coarse:text-base",
        ]),
      );
      // Only heights split by pointer; padding never does (§9).
      expect(classes.filter((c) => /^pointer-coarse:p[xytrbl]?-/.test(c))).toEqual([]);
    }
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

  it("hands focus back to where the shortcut was pressed from", async () => {
    render(
      <>
        <button type="button">Elsewhere</button>
        <FindBar />
      </>,
    );
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
    elsewhere.focus();
    chord();
    await screen.findByRole("dialog");

    const user = userEvent.setup();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(elsewhere).toHaveFocus());
  });

  it("opens with the key typed on the field as the query", async () => {
    const user = userEvent.setup();
    render(<FindBar />);
    trigger().focus();
    await user.keyboard("r");

    const input = await screen.findByRole("combobox");
    expect(input).toHaveValue("r");
    await waitFor(() => expect(input).toHaveFocus());
    // Not selected, so the next key appends rather than replacing it.
    await user.keyboard("ush");
    expect(input).toHaveValue("rush");
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

  it("does not blame a timeout in a group the chip leaves out", async () => {
    // Channels are matched here and never time out, so under the Channels chip
    // a slow message scan is not "Search took too long".
    searchQuery.current = searchState({
      data: { payload: {}, timedOut: true, timedOutSources: ["messages"] },
    });
    const user = userEvent.setup();
    render(<FindBar />);
    await openAndType(user, "announce");
    await user.click(screen.getByRole("button", { name: "Channels" }));

    const list = within(screen.getByRole("listbox"));
    expect(list.getByText("No matches.")).toBeInTheDocument();
    expect(list.queryByText(/took too long/i)).not.toBeInTheDocument();
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
      // Every key is known, and the only string sent is the surface: a
      // property carrying the text (or any prefix of it) fails here.
      expect(Object.keys(event.properties ?? {}).sort()).toEqual(
        [
          "backwork_count",
          "events_count",
          "latency_ms",
          "members_count",
          "messages_count",
          "query_length",
          "query_word_count",
          "surface",
          "timed_out",
          "total_count",
          "zero_result",
        ].sort(),
      );
      for (const [key, value] of Object.entries(event.properties ?? {})) {
        if (typeof value === "string") expect(key).toBe("surface");
      }
    }
  });

  it("counts a search once, not again when the dialog reopens on it", async () => {
    const events: Array<{ name: string; properties?: AnalyticsProperties }> = [];
    searchQuery.current = searchState({
      data: searchPayload(),
      dataUpdatedAt: 7000,
    });
    const user = userEvent.setup();
    renderWithTrack((name, properties) => events.push({ name, properties }));
    // Pinned so the one event is for the whole text, as a real debounce gives.
    debounced.current = "announce";
    await openAndType(user, "announce");
    await waitFor(() => expect(events).toHaveLength(1));
    debounced.current = null;
    const before = events.length;

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    // The reopen refetches the kept query.
    searchQuery.current = searchState({
      data: searchPayload(),
      dataUpdatedAt: 8000,
    });
    await user.click(trigger());
    await screen.findByRole("combobox");

    expect(events.length).toBe(before);
  });

  it("measures the trimmed query", async () => {
    const events: Array<{ name: string; properties?: AnalyticsProperties }> = [];
    searchQuery.current = searchState({
      data: searchPayload(),
      dataUpdatedAt: 9000,
    });
    const user = userEvent.setup();
    renderWithTrack((name, properties) => events.push({ name, properties }));
    // Pinned so the one event fires for the whole text, padding included.
    debounced.current = "  rush  ";
    await openAndType(user, "  rush  ");

    await waitFor(() => expect(events.length).toBeGreaterThan(0));
    expect(events.at(-1)!.properties).toMatchObject({
      query_length: 4,
      query_word_count: 1,
    });
  });
});

/**
 * One field for search and Ask (#4904, Paul's pick of 2026-11-13). A member
 * with Ask gets a first row that asks Frapp what they typed; which row Enter
 * means is read from the words (`find-ask.ts`), so it never moves because
 * results arrived.
 */
describe("FindBar for a member with Ask (#4904)", () => {
  const askField = () =>
    screen.getByRole("button", { name: FIND_ASK_PLACEHOLDER });
  const askRow = () => screen.getByRole("option", { name: /^Ask Frapp/ });
  async function typeInto(user: ReturnType<typeof userEvent.setup>, text: string) {
    await user.click(askField());
    const input = await screen.findByRole("combobox");
    if (text) await user.type(input, text);
    return input;
  }

  beforeEach(() => {
    askEntry.current = { open: false, openWith: vi.fn() };
    push.mockClear();
    debounced.current = null;
    moduleGate.current = () => true;
    channelsQuery.current = { data: [{ id: "c1", name: "announcements" }] };
    searchQuery.current = searchState({ data: searchPayload() });
  });
  afterEach(() => {
    askEntry.current = null;
  });

  it("says so on the field and in the dialog, and is where Ask returns focus", async () => {
    const user = userEvent.setup();
    render(<FindBar />);
    expect(askField()).toHaveAttribute("data-ask-entry");
    const input = await typeInto(user, "");
    expect(input).toHaveAttribute("placeholder", FIND_ASK_PLACEHOLDER);
  });

  it("offers to open the conversation before anything is typed, and Enter does", async () => {
    const user = userEvent.setup();
    render(<FindBar />);
    const input = await typeInto(user, "");
    expect(askRow()).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(askEntry.current!.openWith).toHaveBeenCalledWith("", askField());
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("keeps a search a search: the first result is highlighted and Enter opens it", async () => {
    const user = userEvent.setup();
    render(<FindBar />);
    const input = await typeInto(user, "announce");
    const options = screen.getAllByRole("option");
    expect(options[0]).toBe(askRow());
    expect(options[0]).toHaveAttribute("aria-selected", "false");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/chat?channel=c1"));
    expect(askEntry.current!.openWith).not.toHaveBeenCalled();
  });

  it("asks Frapp on Enter when the words read as a question, and clears the field", async () => {
    const user = userEvent.setup();
    render(<FindBar />);
    const input = await typeInto(user, "when is the announce party?");
    expect(askRow()).toHaveAttribute("aria-selected", "true");
    expect(askRow()).toHaveTextContent("when is the announce party?");
    expect(input).toHaveAttribute("aria-activedescendant", askRow().id);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(askEntry.current!.openWith).toHaveBeenCalledWith(
      "when is the announce party?",
      askField(),
    );
    expect(push).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(askField()).toHaveTextContent(FIND_ASK_PLACEHOLDER);
  });

  it("asks a question without waiting for the list to catch up", async () => {
    const user = userEvent.setup();
    render(<FindBar />);
    const input = await typeInto(user, "announce");
    debounced.current = "announce";
    await user.type(input, " party when?");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(askEntry.current!.openWith).toHaveBeenCalledWith(
      "announce party when?",
      askField(),
    );
  });

  it("lights no row while a search is still loading, so Enter cannot ask by accident", async () => {
    searchQuery.current = searchState({ isFetching: true });
    channelsQuery.current = { data: [] };
    const user = userEvent.setup();
    render(<FindBar />);
    const input = await typeInto(user, "zzz");
    expect(askRow()).toHaveAttribute("aria-selected", "false");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(askEntry.current!.openWith).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("falls to the Ask row once a search has settled with nothing to show", async () => {
    searchQuery.current = searchState({
      data: { payload: {}, timedOut: false, timedOutSources: [] },
    });
    channelsQuery.current = { data: [] };
    const user = userEvent.setup();
    render(<FindBar />);
    await typeInto(user, "zzz");
    expect(screen.getAllByText("No matches.").length).toBeGreaterThan(0);
    expect(askRow()).toHaveAttribute("aria-selected", "true");
  });

  it("reaches the Ask row from a search with the arrow keys, and by clicking it", async () => {
    const user = userEvent.setup();
    render(<FindBar />);
    const input = await typeInto(user, "announce");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(askRow()).toHaveAttribute("aria-selected", "true");
    await user.click(askRow());
    expect(askEntry.current!.openWith).toHaveBeenCalledWith(
      "announce",
      askField(),
    );
  });

  it("is only a search for a member without Ask", async () => {
    askEntry.current = null;
    const user = userEvent.setup();
    render(<FindBar />);
    expect(trigger()).not.toHaveAttribute("data-ask-entry");
    await openAndType(user, "when is the announce party?");
    expect(screen.queryByRole("option", { name: /^Ask Frapp/ })).toBeNull();
  });
});

