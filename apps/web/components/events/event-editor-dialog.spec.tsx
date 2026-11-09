import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";

// Capture the create/update mutation args. `vi.hoisted` runs before the hoisted
// `vi.mock` factory, so the spies exist when the factory wires them in.
const { createMutate, updateMutate, mockCurrentChapter, mockToast } =
  vi.hoisted(() => ({
    createMutate: vi.fn(),
    updateMutate: vi.fn(),
    mockCurrentChapter: vi.fn(),
    mockToast: vi.fn(),
  }));

vi.mock("@repo/hooks", () => ({
  useCreateEvent: () => ({ mutateAsync: createMutate, isPending: false }),
  useUpdateEvent: () => ({ mutateAsync: updateMutate, isPending: false }),
  useRoles: () => ({
    data: [
      { id: "r1", name: "Exec" },
      { id: "r2", name: "Committee" },
    ],
    isError: false,
  }),
  // The event routes behind this dialog are paid-ops, so it reads the chapter's
  // subscription now (#841). Every case here predates the gate and asserts
  // editing behaviour, so they all run against an active chapter.
  useCurrentChapter: () => mockCurrentChapter(),
  useMyPermissions: () => ({
    data: { permissions: ["billing:manage"] },
    isPending: false,
    isError: false,
  }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import { EventEditorDialog } from "./event-editor-dialog";
import { chapterSubscription } from "@/tests/chapter-subscription";
import {
  expectClearingEntriesEmpty,
  expectRefusedEntriesKeep,
} from "@/tests/numeric-input";

const chapter = chapterSubscription(mockCurrentChapter);

/** Open "More options", which starts closed on create. Safe to call twice. */
function openMoreOptions() {
  const more = screen.queryByRole("button", { name: /More options/ });
  if (more) fireEvent.click(more);
}

/** Open More options and the check-in zone under it. */
function openZone() {
  openMoreOptions();
  if (!screen.queryByRole("button", { name: "Add point" })) {
    fireEvent.click(screen.getByRole("button", { name: /Check-in zone/ }));
  }
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("Event name"), {
    target: { value: "Exec Sync" },
  });
  fireEvent.change(screen.getByLabelText("Start"), {
    target: { value: "2026-07-01T18:00" },
  });
  fireEvent.change(screen.getByLabelText("End"), {
    target: { value: "2026-07-01T19:00" },
  });
}

describe("EventEditorDialog form shape and attendance by role", () => {
  beforeEach(() => {
    createMutate.mockReset();
    updateMutate.mockReset();
    mockToast.mockReset();
    createMutate.mockResolvedValue(undefined);
    updateMutate.mockResolvedValue(undefined);
    chapter.active();
  });

  function renderCreate() {
    render(
      <EventEditorDialog
        open
        mode="create"
        event={null}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
  }

  it("opens on the four fields every event needs, and says what the rest hold", () => {
    renderCreate();
    expect(screen.queryByLabelText("Points for attending")).toBeNull();
    expect(screen.queryByLabelText("Repeat")).toBeNull();
    expect(
      screen.getByRole("button", { name: /More options/ }),
    ).toHaveTextContent("10 pts · Optional for everyone · Doesn't repeat");
  });

  it("keeps meeting minutes to an edit, after the event exists", () => {
    renderCreate();
    openMoreOptions();
    expect(screen.queryByLabelText("Meeting minutes")).toBeNull();
  });

  it("labels the notes field as meeting minutes on edit", () => {
    render(
      <EventEditorDialog
        open
        mode="edit"
        event={{
          id: "e0",
          name: "Chapter",
          start_time: "2026-07-01T18:00:00.000Z",
          end_time: "2026-07-01T19:00:00.000Z",
        }}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
    expect(screen.getByLabelText("Meeting minutes")).toBeInTheDocument();
    expect(screen.queryByLabelText("Internal notes")).not.toBeInTheDocument();
  });

  it("creates an event required for one role and optional for everyone else", async () => {
    renderCreate();
    fillRequiredFields();
    openMoreOptions();
    fireEvent.click(
      screen.getByRole("button", { name: "Set a role differently" }),
    );
    fireEvent.click(await screen.findByText("Exec"));
    // The app's Select (Radix), not a native one.
    fireEvent.click(screen.getByRole("combobox", { name: "Repeat" }));
    fireEvent.click(await screen.findByRole("option", { name: "Every week" }));
    expect(screen.getByText(/13 meetings, the last on Sep 23\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const body = createMutate.mock.calls[0]![0];
    expect(body).toMatchObject({
      is_mandatory: false,
      others_invited: true,
      required_role_ids: ["r1"],
      recurrence_rule: "WEEKLY",
    });
    expect(body).not.toHaveProperty("optional_role_ids");
  });

  it("sends no role list on create when nothing differs", async () => {
    renderCreate();
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const body = createMutate.mock.calls[0]![0];
    expect(body).not.toHaveProperty("required_role_ids");
    expect(body).toMatchObject({ is_mandatory: false });
    // A plain event leaves `others_invited` out: stored null reads the same,
    // and an API that predates the field still accepts the create.
    expect(body).not.toHaveProperty("others_invited");
  });

  it("refuses an event that invites nobody", async () => {
    renderCreate();
    fillRequiredFields();
    openMoreOptions();
    const everyone = screen.getByRole("radiogroup", {
      name: "Attendance for everyone",
    });
    fireEvent.click(
      within(everyone).getByRole("radio", { name: "Not invited" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Nobody is invited" }),
      ),
    );
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("reads an officers-only event back and clears it on edit", async () => {
    render(
      <EventEditorDialog
        open
        mode="edit"
        event={{
          id: "e1",
          name: "Exec Sync",
          start_time: "2026-07-01T18:00:00.000Z",
          end_time: "2026-07-01T19:00:00.000Z",
          required_role_ids: ["r1"],
          others_invited: false,
        }}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );

    const everyone = screen.getByRole("radiogroup", {
      name: "Attendance for everyone",
    });
    expect(
      within(everyone).getByRole("radio", { name: "Not invited" }),
    ).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Remove Exec" }));
    fireEvent.click(within(everyone).getByRole("radio", { name: "Optional" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "e1",
        body: expect.objectContaining({
          required_role_ids: [],
          optional_role_ids: [],
          excluded_role_ids: [],
          others_invited: true,
        }),
      }),
    );
  });

  it("shows a role missing from the loaded list as a removable row", async () => {
    render(
      <EventEditorDialog
        open
        mode="edit"
        event={{
          id: "e3",
          name: "Legacy Targeted",
          start_time: "2026-07-01T18:00:00.000Z",
          end_time: "2026-07-01T19:00:00.000Z",
          required_role_ids: ["r1", "legacyrole99"],
          others_invited: false,
        }}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Remove Removed role" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ required_role_ids: ["r1"] }),
      }),
    );
  });
});

describe("EventEditorDialog check-in zone", () => {
  beforeEach(() => {
    createMutate.mockReset();
    updateMutate.mockReset();
    mockToast.mockReset();
    createMutate.mockResolvedValue(undefined);
    updateMutate.mockResolvedValue(undefined);
    chapter.active();
  });

  function addPoints(points: [string, string][]) {
    points.forEach(() =>
      fireEvent.click(screen.getByRole("button", { name: "Add point" })),
    );
    points.forEach(([lat, lng], index) => {
      fireEvent.change(screen.getByLabelText(`Point ${index + 1} latitude`), {
        target: { value: lat },
      });
      fireEvent.change(screen.getByLabelText(`Point ${index + 1} longitude`), {
        target: { value: lng },
      });
    });
  }

  const TRIANGLE: [string, string][] = [
    ["42.7298", "-73.6789"],
    ["42.7300", "-73.6780"],
    ["42.7290", "-73.6775"],
  ];

  it("sends check_in_zone and its name in the create payload", async () => {
    render(
      <EventEditorDialog
        open
        mode="create"
        event={null}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
    openZone();

    fillRequiredFields();
    fireEvent.change(screen.getByLabelText("Zone name"), {
      target: { value: "Great Hall" },
    });
    addPoints(TRIANGLE);
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        check_in_zone: [
          { lat: 42.7298, lng: -73.6789 },
          { lat: 42.73, lng: -73.678 },
          { lat: 42.729, lng: -73.6775 },
        ],
        check_in_zone_name: "Great Hall",
      }),
    );
  });

  // CreateEventDto carries @ArrayMinSize(3), so an empty array is a 400 rather
  // than "no zone" — the key has to be absent entirely. This is the asymmetry
  // with update below, and getting it backwards breaks every zone-less create.
  it("omits check_in_zone entirely on create when no points are entered", async () => {
    render(
      <EventEditorDialog
        open
        mode="create"
        event={null}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
    openZone();

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate).toHaveBeenCalledWith(
      expect.not.objectContaining({ check_in_zone: expect.anything() }),
    );
  });

  it("blocks submit with the server's own wording when under 3 points", async () => {
    render(
      <EventEditorDialog
        open
        mode="create"
        event={null}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
    openZone();

    fillRequiredFields();
    addPoints(TRIANGLE.slice(0, 2));
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining("at least 3 points"),
      }),
    );
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range coordinate before it reaches the API", async () => {
    render(
      <EventEditorDialog
        open
        mode="create"
        event={null}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
    openZone();

    fillRequiredFields();
    addPoints([["91", "0"], ...TRIANGLE.slice(1)]);
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining("between -90 and 90"),
      }),
    );
    expect(createMutate).not.toHaveBeenCalled();
  });

  // Number("") is 0, not NaN, so a row with one field filled would otherwise
  // pass the finite check and save a coordinate on the prime meridian.
  it("rejects a vertex row with only one of latitude and longitude filled", async () => {
    render(
      <EventEditorDialog
        open
        mode="create"
        event={null}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
    openZone();

    fillRequiredFields();
    addPoints(TRIANGLE);
    fireEvent.change(screen.getByLabelText("Point 2 longitude"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining(
          "Point 2 needs both a latitude and a longitude",
        ),
      }),
    );
    expect(createMutate).not.toHaveBeenCalled();
  });

  // Blank rows are skipped, but skipping them must not renumber the rows the
  // officer is looking at.
  it("names the on-screen row number when a blank row precedes the bad one", async () => {
    render(
      <EventEditorDialog
        open
        mode="create"
        event={null}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
    openZone();

    fillRequiredFields();
    addPoints(TRIANGLE);
    // Row 2 goes entirely blank; row 4 carries the out-of-range latitude.
    fireEvent.change(screen.getByLabelText("Point 2 latitude"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Point 2 longitude"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add point" }));
    fireEvent.change(screen.getByLabelText("Point 4 latitude"), {
      target: { value: "91" },
    });
    fireEvent.change(screen.getByLabelText("Point 4 longitude"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining("Point 4"),
      }),
    );
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("seeds a stored zone on edit and clears it to an empty array", async () => {
    render(
      <EventEditorDialog
        open
        mode="edit"
        event={{
          id: "e1",
          name: "Exec Sync",
          start_time: "2026-07-01T18:00:00.000Z",
          end_time: "2026-07-01T19:00:00.000Z",
          check_in_zone: [
            { lat: 1, lng: 2 },
            { lat: 3, lng: 4 },
            { lat: 5, lng: 6 },
          ],
          check_in_zone_name: "Great Hall",
        }}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
    openZone();

    expect(screen.getByLabelText("Point 1 latitude")).toHaveValue("1");
    expect(screen.getByLabelText("Zone name")).toHaveValue("Great Hall");

    // Removing row 1 three times empties the list — the rows renumber, so the
    // first "Remove point 1" click is repeated rather than 1/2/3 in turn.
    fireEvent.click(screen.getByRole("button", { name: "Remove point 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove point 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove point 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    // UpdateEventDto drops @ArrayMinSize so [] clears; the name clears with it.
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "e1",
        body: expect.objectContaining({
          check_in_zone: [],
          check_in_zone_name: "",
        }),
      }),
    );
  });

  it("reorders vertices, since order defines the polygon's edges", async () => {
    render(
      <EventEditorDialog
        open
        mode="edit"
        event={{
          id: "e2",
          name: "Exec Sync",
          start_time: "2026-07-01T18:00:00.000Z",
          end_time: "2026-07-01T19:00:00.000Z",
          check_in_zone: [
            { lat: 1, lng: 2 },
            { lat: 3, lng: 4 },
            { lat: 5, lng: 6 },
          ],
        }}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
    openZone();

    fireEvent.click(screen.getByRole("button", { name: "Move point 1 down" }));
    expect(screen.getByLabelText("Point 1 latitude")).toHaveValue("3");
    expect(screen.getByLabelText("Point 2 latitude")).toHaveValue("1");

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          check_in_zone: [
            { lat: 3, lng: 4 },
            { lat: 1, lng: 2 },
            { lat: 5, lng: 6 },
          ],
        }),
      }),
    );
  });
});

describe("EventEditorDialog point value guard (#2206)", () => {
  beforeEach(() => {
    mockToast.mockReset();
    createMutate.mockReset();
    createMutate.mockResolvedValue(undefined);
    chapter.active();
  });

  function renderCreate() {
    render(
      <EventEditorDialog
        open
        mode="create"
        event={null}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
    openMoreOptions();
    return screen.getByLabelText("Points for attending");
  }

  it("keeps the last whole number through a negative or a decimal", () => {
    expectRefusedEntriesKeep(renderCreate(), "15");
  });

  it("carries no description restating the form", () => {
    renderCreate();

    expect(screen.queryByText(/configure scheduling/i)).toBeNull();
    expect(screen.getByRole("dialog")).not.toHaveAttribute("aria-describedby");
  });

  it("keeps an emptied or unparseable field empty while the officer types", () => {
    const input = renderCreate();
    expectClearingEntriesEmpty(input, "15");
    // Before #2206 an emptied field snapped to 0, so the next digit read "05".
    fireEvent.change(input, { target: { value: "5" } });
    expect(input).toHaveValue(5);
  });

  it("saves an emptied field as 0 points, as it always has", async () => {
    const input = renderCreate();
    fillRequiredFields();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate.mock.calls[0]![0].point_value).toBe(0);
  });

  it("refuses a stored negative on edit rather than saving it as 0", async () => {
    updateMutate.mockReset();
    render(
      <EventEditorDialog
        open
        mode="edit"
        event={{
          id: "e9",
          name: "Exec Sync",
          start_time: "2026-07-01T18:00:00.000Z",
          end_time: "2026-07-01T19:00:00.000Z",
          point_value: -5,
        }}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Valid point value required" }),
      ),
    );
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("sends the kept whole number, never Infinity", async () => {
    const input = renderCreate();
    fillRequiredFields();
    fireEvent.change(input, { target: { value: "15" } });
    fireEvent.change(input, { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate.mock.calls[0]![0].point_value).toBe(15);
  });
});
