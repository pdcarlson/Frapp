import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import { EventEditorDialog } from "./event-editor-dialog";
import { chapterSubscription } from "@/tests/chapter-subscription";

const chapter = chapterSubscription(mockCurrentChapter);

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

describe("EventEditorDialog role targeting", () => {
  beforeEach(() => {
    createMutate.mockReset();
    updateMutate.mockReset();
    createMutate.mockResolvedValue(undefined);
    updateMutate.mockResolvedValue(undefined);
    chapter.active();
  });

  it("labels the notes field as meeting minutes, not internal notes", () => {
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

    expect(screen.getByLabelText("Meeting minutes")).toBeInTheDocument();
    expect(screen.queryByLabelText("Internal notes")).not.toBeInTheDocument();
  });

  it("sends required_role_ids in the create payload when roles are selected", async () => {
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

    fillRequiredFields();
    fireEvent.click(screen.getByLabelText("Exec"));
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ required_role_ids: ["r1"] }),
    );
  });

  it("omits required_role_ids on create when no roles are selected (all members)", async () => {
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

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate).toHaveBeenCalledWith(
      expect.not.objectContaining({ required_role_ids: expect.anything() }),
    );
  });

  it("seeds existing roles and clears them to an empty array on edit", async () => {
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
        }}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );

    const execCheckbox = screen.getByLabelText("Exec");
    expect(execCheckbox).toBeChecked();
    fireEvent.click(execCheckbox);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "e1",
        body: expect.objectContaining({ required_role_ids: [] }),
      }),
    );
  });

  it("preserves seeded roles on edit when the selection is untouched", async () => {
    render(
      <EventEditorDialog
        open
        mode="edit"
        event={{
          id: "e2",
          name: "Committee Sync",
          start_time: "2026-07-01T18:00:00.000Z",
          end_time: "2026-07-01T19:00:00.000Z",
          required_role_ids: ["r1", "r2"],
        }}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Event name"), {
      target: { value: "Committee Sync (renamed)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ required_role_ids: ["r1", "r2"] }),
      }),
    );
  });

  it("renders a seeded role missing from the loaded list as removable", async () => {
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
        }}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );

    // The seeded id not returned by useRoles still renders as a checked,
    // removable row (stub label) so the admin can clear it instead of it
    // silently persisting into the saved payload.
    const execCheckbox = screen.getByLabelText("Exec");
    const phantomCheckbox = screen.getByLabelText("Role legacyro");
    expect(execCheckbox).toBeChecked();
    expect(phantomCheckbox).toBeChecked();

    fireEvent.click(execCheckbox);
    fireEvent.click(phantomCheckbox);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ required_role_ids: [] }),
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
