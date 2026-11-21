import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { cardFilledContainers } from "@/tests/card-surfaces";
import { chapterSubscription } from "@/tests/chapter-subscription";
import {
  expectClearingEntriesEmpty,
  expectRefusedEntriesKeep,
} from "@/tests/numeric-input";

const {
  mockCurrentChapter,
  mockCreateMutate,
  mockUpdateMutate,
  mockDeleteMutate,
  mockToast,
} = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
  mockCreateMutate: vi.fn().mockResolvedValue({}),
  mockUpdateMutate: vi.fn().mockResolvedValue({}),
  mockDeleteMutate: vi.fn().mockResolvedValue({}),
  mockToast: vi.fn(),
}));

// Only the chapter payload is stubbed — `useSubscriptionWriteState` and
// `subscriptionWriteState` run for real, so this covers the whole path from the
// wire format to the disabled control.
const ZONE = {
  id: "gf-1",
  chapter_id: "chap-1",
  name: "Main library",
  coordinates: [
    { lat: 30.286, lng: -97.74 },
    { lat: 30.287, lng: -97.74 },
    { lat: 30.287, lng: -97.739 },
  ],
  is_active: true,
  minutes_per_point: 30,
  points_per_interval: 1,
  min_session_minutes: 15,
  pause_grace_minutes: 5,
  created_at: "2026-08-01T00:00:00Z",
};

vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  // Drives the New study zone button. Read as a boolean rather than through
  // a second `<Can>`, so `can-fallback.spec.tsx`'s per-surface lookup still
  // finds this file's screen-level gate.
  useMyPermissions: () => ({
    data: { permissions: ["geofences:manage"] },
    isPending: false,
    isError: false,
  }),
  useGeofences: () => ({
    data: [ZONE],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCreateGeofence: () => ({
    mutateAsync: mockCreateMutate,
    isPending: false,
  }),
  useUpdateGeofence: () => ({
    mutateAsync: mockUpdateMutate,
    isPending: false,
  }),
  useDeleteGeofence: () => ({
    mutateAsync: mockDeleteMutate,
    isPending: false,
  }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// No network in a test: the campus lookup and place search answer nothing.
vi.mock("@/lib/maps/map-provider", () => ({
  MAP_STYLE_URL: "about:blank",
  searchPlaces: vi.fn().mockResolvedValue([]),
}));

// MapLibre needs WebGL, which jsdom has none of. The stand-in draws what the
// real map would let an officer do: drop the pin, or click three corners.
vi.mock("@/components/geofences/zone-map", () => ({
  ZoneMap: ({
    draft,
    onChange,
  }: {
    draft: import("./zone-shape").ZoneDraft;
    onChange: (next: import("./zone-shape").ZoneDraft) => void;
  }) => (
    <div data-testid="zone-map">
      <button
        type="button"
        onClick={() =>
          onChange(
            draft.mode === "circle"
              ? { ...draft, center: { lat: 42.7298, lng: -73.6826 } }
              : {
                  ...draft,
                  points: [
                    { lat: 30.286, lng: -97.74 },
                    { lat: 30.287, lng: -97.74 },
                    { lat: 30.287, lng: -97.739 },
                  ],
                },
          )
        }
      >
        Draw on map
      </button>
    </div>
  ),
}));

const { StudyZonesManager } = await import("./study-zones-manager");
const { searchPlaces } = await import("@/lib/maps/map-provider");

const chapter = chapterSubscription(mockCurrentChapter);

const createTrigger = () =>
  screen.getByRole("button", { name: /new study zone/i });
/** The row itself, which opens the zone's editor. */
const editButton = () => screen.getByRole("button", { name: /^main library/i });
const menuButton = () =>
  screen.getByRole("button", { name: "More for Main library" });
/** Opens the row's ⋯ menu and finds an item on it. */
async function menuItem(name: RegExp) {
  await userEvent.click(menuButton());
  return screen.getByRole("menuitem", { name });
}
const turnOffItem = () => menuItem(/turn off/i);
const deleteItem = () => menuItem(/delete/i);

describe("StudyZonesManager subscription gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("leaves every write alone on an active chapter", async () => {
    chapter.active();
    render(<StudyZonesManager />);

    expect(createTrigger()).toBeEnabled();
    expect(editButton()).toBeEnabled();
    expect(await turnOffItem()).not.toHaveAttribute("data-disabled");
    expect(screen.getByRole("menuitem", { name: /delete/i })).not.toHaveAttribute(
      "data-disabled",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  // The row opens the zone, as a Settings row does; turning it off and
  // deleting it are on its ⋯ menu, named for the zone.
  it("opens the zone from its row and keeps the rest on a ⋯ menu", async () => {
    chapter.active();
    render(<StudyZonesManager />);

    expect(menuButton()).toHaveAccessibleName("More for Main library");
    await userEvent.click(menuButton());
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Edit", "Turn off", "Delete"]);
  });

  it("disables the create trigger and names blocker plus recovery when incomplete", async () => {
    chapter.incomplete();
    render(<StudyZonesManager />);

    // §5 rule 1: gate the trigger, never the submit.
    expect(createTrigger()).toBeDisabled();
    expect(screen.getByText(/subscription is not active/i)).toBeInTheDocument();
    // §5 rule 2: name the next action, not just the blocker.
    expect(
      screen.getByRole("link", { name: /complete checkout/i }),
    ).toHaveAttribute("href", "/settings?tab=billing");

    // §5 rule 4: disabled, not hidden — the zones are still readable.
    expect(screen.getByText(/main library/i)).toBeInTheDocument();

    // And the dialog must not open onto a doomed action.
    await userEvent.click(createTrigger());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("gates the row writes too, not just the create trigger", async () => {
    // PATCH and DELETE /v1/geofences/:id sit behind the same guard, so leaving
    // these live would have the page claim writes are blocked while offering
    // three of them.
    chapter.incomplete();
    render(<StudyZonesManager />);

    expect(editButton()).toBeDisabled();
    expect(await turnOffItem()).toHaveAttribute("data-disabled");
    expect(screen.getByRole("menuitem", { name: /delete/i })).toHaveAttribute(
      "data-disabled",
    );
  });

  it("ties every disabled control to the one explanation", async () => {
    chapter.incomplete();
    render(<StudyZonesManager />);

    const describedBy = createTrigger().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(editButton()).toHaveAttribute("aria-describedby", describedBy);
    expect(await deleteItem()).toHaveAttribute("aria-describedby", describedBy);
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /subscription is not active/i,
    );
  });

  it("blocks paid-ops geofence writes immediately on past_due, grace or not", () => {
    chapter.pastDue();
    render(<StudyZonesManager />);

    expect(createTrigger()).toBeDisabled();
    expect(screen.getByText(/past due/i)).toBeInTheDocument();
  });

  it("points a canceled chapter at the portal rather than checkout", () => {
    chapter.canceled();
    render(<StudyZonesManager />);

    expect(createTrigger()).toBeDisabled();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /billing portal/i }),
    ).toBeInTheDocument();
  });

  it("holds the gate shut while the chapter is still loading", () => {
    // The window between mount and the chapter resolving is the most common
    // path to the very 403 this gate prevents: a trigger that paints enabled
    // for that round trip still lets a fast click reach a doomed form.
    chapter.loading();
    render(<StudyZonesManager />);

    expect(createTrigger()).toBeDisabled();
    expect(screen.getByText(/checking this chapter/i)).toBeInTheDocument();
    // No blocked explanation yet — nothing has established a reason.
    expect(
      screen.queryByText(/subscription is not active/i),
    ).not.toBeInTheDocument();
  });

  it("fails open when the chapter record cannot be read", async () => {
    // A failed chapter fetch must not lock a paying chapter out of its study
    // zones; the server guard is still the enforcement.
    chapter.unreadable();
    render(<StudyZonesManager />);

    expect(createTrigger()).toBeEnabled();
    expect(editButton()).toBeEnabled();
    expect(await deleteItem()).not.toHaveAttribute("data-disabled");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("closes the editor when the subscription lapses under it", async () => {
    // Radix fires onOpenChange only on an open/close request, so a background
    // refetch that revokes the write cannot be caught there.
    chapter.active();
    const { rerender } = render(<StudyZonesManager />);
    await userEvent.click(editButton());
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    chapter.pastDue();
    rerender(<StudyZonesManager />);

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("still opens the editor and toggles a zone on an active chapter", async () => {
    chapter.active();
    render(<StudyZonesManager />);

    await userEvent.click(await turnOffItem());
    expect(mockUpdateMutate).toHaveBeenCalledTimes(1);

    await userEvent.click(editButton());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeEnabled();
  });
});

describe("StudyZonesManager layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chapter.active();
  });

  it("lists zones flush, with no --card panel", () => {
    const { container } = render(<StudyZonesManager />);

    expect(cardFilledContainers(container)).toEqual([]);
    const rows = within(
      screen.getByRole("list", { name: "Study zones" }),
    ).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(
      within(rows[0]!).getByText("1 point every 30 min · 15 min minimum"),
    ).toBeInTheDocument();
    // Only the exception is marked: an active zone carries no badge.
    expect(within(rows[0]!).queryByText("Active")).toBeNull();
  });

  it("keeps coordinates off the row and out of the editor", async () => {
    render(<StudyZonesManager />);

    expect(document.body.textContent).not.toContain("30.286");
    await userEvent.click(editButton());
    // The shape is the map's, never a box of numbers (Paul, 2026-11-12).
    expect(screen.queryByLabelText(/vertices/i)).toBeNull();
    expect(screen.getByTestId("zone-map")).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Outline" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("puts New study zone beside the Zones heading, with no page h1", () => {
    render(<StudyZonesManager />);

    // The page's title is Chapter settings'; this is one section of it.
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByRole("heading", { name: "Zones" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /new study zone/i }),
    ).toBeInTheDocument();
  });
});

describe("StudyZonesManager map editor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chapter.active();
  });

  it("creates a circle zone from a dropped pin, at the default radius", async () => {
    render(<StudyZonesManager />);
    await userEvent.click(createTrigger());
    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "Folsom Library" },
    });
    // A new zone starts as a circle.
    expect(screen.getByRole("radio", { name: "Circle" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await userEvent.click(screen.getByRole("button", { name: "Draw on map" }));
    fireEvent.click(screen.getByRole("button", { name: "Create study zone" }));

    await waitFor(() => expect(mockCreateMutate).toHaveBeenCalledTimes(1));
    const body = mockCreateMutate.mock.calls[0]![0];
    expect(body).toMatchObject({
      name: "Folsom Library",
      circle: { lat: 42.7298, lng: -73.6826, radius_m: 75 },
    });
    expect(body).not.toHaveProperty("coordinates");
  });

  it("sizes the circle in feet and stores meters", async () => {
    render(<StudyZonesManager />);
    await userEvent.click(createTrigger());
    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "Quad" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Draw on map" }));
    const radius = screen.getByLabelText(/^radius$/i);
    expect(radius).toHaveValue("246");
    fireEvent.change(radius, { target: { value: "500" } });
    fireEvent.blur(radius);
    fireEvent.click(screen.getByRole("button", { name: "Create study zone" }));

    await waitFor(() => expect(mockCreateMutate).toHaveBeenCalledTimes(1));
    expect(mockCreateMutate.mock.calls[0]![0].circle.radius_m).toBe(152);
  });

  it("says where to start instead of saving a zone with no place", async () => {
    render(<StudyZonesManager />);
    await userEvent.click(createTrigger());
    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "Nowhere" },
    });
    fireEvent.submit(document.getElementById("study-zone-form")!);

    expect(
      await screen.findByText(/search for the place or click the map/i),
    ).toBeInTheDocument();
    expect(mockCreateMutate).not.toHaveBeenCalled();
  });

  it("drops the pin on a searched place and names the zone after it", async () => {
    vi.mocked(searchPlaces).mockResolvedValueOnce([
      {
        id: "W1",
        name: "Folsom Library",
        detail: "Troy, New York",
        lat: 42.7297,
        lng: -73.6826,
      },
    ]);
    render(<StudyZonesManager />);
    await userEvent.click(createTrigger());
    const search = screen.getByPlaceholderText("Find a building or address");
    await userEvent.type(search, "Folsom");
    fireEvent.mouseDown(await screen.findByRole("option", { name: /folsom library/i }));
    fireEvent.click(screen.getByRole("button", { name: "Create study zone" }));

    await waitFor(() => expect(mockCreateMutate).toHaveBeenCalledTimes(1));
    expect(mockCreateMutate.mock.calls[0]![0]).toMatchObject({
      name: "Folsom Library",
      circle: { lat: 42.7297, lng: -73.6826, radius_m: 75 },
    });
  });

  it("never saves the zone from Enter in the search box", async () => {
    render(<StudyZonesManager />);
    await userEvent.click(editButton());
    await userEvent.type(
      screen.getByPlaceholderText("Find a building or address"),
      "Folsom{Enter}",
    );
    expect(mockUpdateMutate).not.toHaveBeenCalled();
  });

  it("renames a zone without resending its shape", async () => {
    render(<StudyZonesManager />);
    await userEvent.click(editButton());
    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "Main library, 2nd floor" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mockUpdateMutate).toHaveBeenCalledTimes(1));
    const { body } = mockUpdateMutate.mock.calls[0]![0];
    expect(body.name).toBe("Main library, 2nd floor");
    expect(body).not.toHaveProperty("coordinates");
    expect(body).not.toHaveProperty("circle");
  });

  it("saves a traced outline as corners, which clears any circle", async () => {
    render(<StudyZonesManager />);
    await userEvent.click(createTrigger());
    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "Science library" },
    });
    await userEvent.click(screen.getByRole("radio", { name: "Outline" }));
    await userEvent.click(screen.getByRole("button", { name: "Draw on map" }));
    fireEvent.click(screen.getByRole("button", { name: "Create study zone" }));

    await waitFor(() => expect(mockCreateMutate).toHaveBeenCalledTimes(1));
    const body = mockCreateMutate.mock.calls[0]![0];
    expect(body.coordinates).toHaveLength(3);
    expect(body).not.toHaveProperty("circle");
  });
});

describe("StudyZonesManager study-rule guard (#2206)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chapter.active();
  });

  async function openCreate() {
    render(<StudyZonesManager />);
    await userEvent.click(createTrigger());
    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "Science library" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Draw on map" }));
  }

  const rate = (label: RegExp) => screen.getByLabelText(label);
  const submitCreate = () =>
    fireEvent.submit(document.getElementById("study-zone-form")!);

  it("keeps each rate's last whole number through a negative or a decimal", async () => {
    await openCreate();
    expectRefusedEntriesKeep(rate(/every \(minutes\)/i), "30");
    expectRefusedEntriesKeep(rate(/^points$/i), "2");
    expectRefusedEntriesKeep(rate(/shortest session/i), "15");
    expectRefusedEntriesKeep(rate(/pause grace/i), "5");
  });

  it("reads an emptied or unparseable rate as blank", async () => {
    await openCreate();
    expectClearingEntriesEmpty(rate(/every \(minutes\)/i), "30");
    expectClearingEntriesEmpty(rate(/^points$/i), "2");
    expectClearingEntriesEmpty(rate(/shortest session/i), "15");
    expectClearingEntriesEmpty(rate(/pause grace/i), "5");
  });

  it("keeps the 0 left by deleting a leading digit, so the edit isn't refused mid-way", async () => {
    await openCreate();
    for (const label of [
      /every \(minutes\)/i,
      /^points$/i,
      /shortest session/i,
      /pause grace/i,
    ]) {
      fireEvent.change(rate(label), { target: { value: "30" } });
      fireEvent.change(rate(label), { target: { value: "0" } });
      expect(rate(label)).toHaveValue(0);
    }
  });

  it.each([/every \(minutes\)/i, /^points$/i, /pause grace/i])(
    "refuses %s under its floor of 1 at save, on create",
    async (label) => {
      await openCreate();
      fireEvent.change(rate(label), { target: { value: "0" } });
      submitCreate();

      await waitFor(() =>
        expect(
          screen.getByText(/each needs a whole number of 1 or more/i),
        ).toBeInTheDocument(),
      );
      expect(mockCreateMutate).not.toHaveBeenCalled();
    },
  );

  it.each([/every \(minutes\)/i, /^points$/i, /pause grace/i])(
    "refuses %s under its floor of 1 at save, on edit",
    async (label) => {
      render(<StudyZonesManager />);
      await userEvent.click(editButton());
      fireEvent.change(rate(label), { target: { value: "0" } });
      fireEvent.submit(document.getElementById("study-zone-form")!);

      await waitFor(() =>
        expect(
          screen.getByText(/each needs a whole number of 1 or more/i),
        ).toBeInTheDocument(),
      );
      expect(mockUpdateMutate).not.toHaveBeenCalled();
    },
  );

  it("creates with the kept whole numbers, never NaN or Infinity", async () => {
    await openCreate();
    fireEvent.change(rate(/every \(minutes\)/i), { target: { value: "45" } });
    fireEvent.change(rate(/every \(minutes\)/i), { target: { value: "1.5" } });
    // Through the footer's button, which sits outside the form and reaches it
    // only through `form=`. The refusal cases submit the form directly because
    // a click runs the browser's own min/required check first.
    fireEvent.click(screen.getByRole("button", { name: "Create study zone" }));

    await waitFor(() => expect(mockCreateMutate).toHaveBeenCalledTimes(1));
    expect(mockCreateMutate.mock.calls[0]![0]).toMatchObject({
      minutes_per_point: 45,
      points_per_interval: 1,
      min_session_minutes: 15,
      pause_grace_minutes: 5,
    });
  });

  it("refuses an emptied rate rather than sending 1 in its place", async () => {
    await openCreate();
    fireEvent.change(rate(/every \(minutes\)/i), { target: { value: "" } });
    submitCreate();

    await waitFor(() =>
      expect(
        screen.getByText(/each needs a whole number of 1 or more/i),
      ).toBeInTheDocument(),
    );
    expect(mockCreateMutate).not.toHaveBeenCalled();
  });

  it("guards the edit form's four rates the same way", async () => {
    render(<StudyZonesManager />);
    await userEvent.click(editButton());
    expectRefusedEntriesKeep(rate(/every \(minutes\)/i), "30");
    expectRefusedEntriesKeep(rate(/^points$/i), "1");
    expectRefusedEntriesKeep(rate(/shortest session/i), "15");
    expectRefusedEntriesKeep(rate(/pause grace/i), "5");
    expectClearingEntriesEmpty(rate(/every \(minutes\)/i), "30");
    expectClearingEntriesEmpty(rate(/^points$/i), "1");
    expectClearingEntriesEmpty(rate(/shortest session/i), "15");
    expectClearingEntriesEmpty(rate(/pause grace/i), "5");
  });

  it("saves a 0-minute minimum session as 0, not rewritten to 1", async () => {
    render(<StudyZonesManager />);
    await userEvent.click(editButton());
    fireEvent.change(rate(/shortest session/i), { target: { value: "0" } });
    fireEvent.submit(document.getElementById("study-zone-form")!);

    await waitFor(() => expect(mockUpdateMutate).toHaveBeenCalledTimes(1));
    expect(mockUpdateMutate.mock.calls[0]![0].body.min_session_minutes).toBe(0);
  });

  it("saves from the panel footer's Save changes, outside the form", async () => {
    // The footer is pinned below the scrolling body, so the button reaches
    // its form through `form=`. Drop that and Save does nothing.
    render(<StudyZonesManager />);
    await userEvent.click(editButton());
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mockUpdateMutate).toHaveBeenCalledTimes(1));
  });
});

/**
 * Leaving the zone editor keeps its draft (#4593): no "are you sure", and it
 * opens on it next time. Cancel and saving give it up.
 */
describe("StudyZonesManager keeps the editor's draft (#4593)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chapter.active();
  });

  const nameField = () => screen.getByLabelText(/^name$/i);
  const back = () =>
    userEvent.click(screen.getByRole("button", { name: /^close$/i }));

  it("opens New study zone on what was typed after it was closed", async () => {
    render(<StudyZonesManager />);
    await userEvent.click(createTrigger());
    expect(screen.queryByText("Draft restored")).toBeNull();
    fireEvent.change(nameField(), { target: { value: "Science library" } });
    await back();
    await userEvent.click(createTrigger());

    expect(nameField()).toHaveValue("Science library");
    expect(screen.getByText("Draft restored")).toBeInTheDocument();
  });

  it("keeps an edit apart from New, and reopens it when the page was left", async () => {
    const first = render(<StudyZonesManager />);
    await userEvent.click(editButton());
    fireEvent.change(nameField(), {
      target: { value: "Main library, 2nd floor" },
    });
    first.unmount();

    render(<StudyZonesManager />);
    expect(await screen.findByText("Draft restored")).toBeInTheDocument();
    expect(nameField()).toHaveValue("Main library, 2nd floor");
    // Only the name changed, so the shape still isn't resent.
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mockUpdateMutate).toHaveBeenCalledTimes(1));
    const { body } = mockUpdateMutate.mock.calls[0]![0];
    expect(body.name).toBe("Main library, 2nd floor");
    expect(body).not.toHaveProperty("coordinates");
  });

  it("keeps nothing on Cancel, or for a form left untouched", async () => {
    render(<StudyZonesManager />);
    await userEvent.click(createTrigger());
    await back();
    await userEvent.click(createTrigger());
    expect(screen.queryByText("Draft restored")).toBeNull();

    fireEvent.change(nameField(), { target: { value: "Science library" } });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(createTrigger());
    expect(nameField()).toHaveValue("");
    expect(screen.queryByText("Draft restored")).toBeNull();
  });

  it("starts over on Discard", async () => {
    render(<StudyZonesManager />);
    await userEvent.click(editButton());
    fireEvent.change(nameField(), { target: { value: "Renamed" } });
    await back();
    await userEvent.click(editButton());
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(nameField()).toHaveValue("Main library");
    expect(screen.queryByText("Draft restored")).toBeNull();
  });
});
