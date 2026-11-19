import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MEETING_LIST_COPY } from "@repo/validation";

const HOUR = 3_600_000;
const mocks = vi.hoisted(() => ({
  meetings: [] as unknown[],
  events: [] as unknown[],
  taking: [] as unknown[],
  takingReady: true,
  permissions: ["meetings:record"] as string[],
  start: vi.fn(),
  push: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@repo/hooks", () => ({
  useMeetings: () => ({
    data: mocks.meetings,
    isPending: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  }),
  useMeetingNoteTaking: () =>
    mocks.takingReady
      ? { data: mocks.taking, isSuccess: true, refetch: vi.fn() }
      : { data: undefined, isSuccess: false, refetch: vi.fn() },
  useEvents: (options?: { enabled?: boolean }) =>
    options?.enabled === false
      ? { data: undefined, isSuccess: false }
      : { data: mocks.events, isSuccess: true },
  useMemberDisplayNames: () => ({ nameFor: () => "Shawn Klein" }),
  useMyPermissions: () => ({ data: { permissions: mocks.permissions } }),
  useStartMeeting: () => ({ mutateAsync: mocks.start, isPending: false }),
  useViewerUserId: () => "u-1",
}));
vi.mock("@repo/hooks/kept-drafts", () => ({ useKeptPanel: () => undefined }));
vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (pick: (state: { activeChapterId: string }) => unknown) =>
    pick({ activeChapterId: "c-1" }),
}));
vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/layout/page-actions", () => ({
  PageActions: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/meetings/start-minutes-panel", () => ({
  MINUTES_DRAFT: "minutes-start",
  StartMinutesPanel: () => null,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

const { MeetingsPage } = await import("./meetings-page");

const iso = (offset: number) => new Date(Date.now() + offset).toISOString();

beforeEach(() => {
  mocks.permissions = ["meetings:record"];
  mocks.taking = [];
  mocks.takingReady = true;
  mocks.meetings = [
    {
      id: "m-posted",
      event_id: "e-posted",
      event_name: "Cabinet Meeting",
      event_start_time: iso(-48 * HOUR),
      meeting_type: "exec",
      other_label: null,
      status: "posted",
      action_item_count: 4,
    },
  ];
  mocks.events = [
    {
      id: "e-needs",
      name: "Chapter Meeting",
      start_time: iso(-26 * HOUR),
      end_time: iso(-25 * HOUR),
    },
    { id: "e-posted", name: "Cabinet Meeting", start_time: iso(-48 * HOUR) },
    { id: "e-social", name: "Date party", start_time: iso(-30 * HOUR) },
    { id: "e-next", name: "Exec Meeting", start_time: iso(30 * HOUR) },
  ];
  mocks.start.mockReset();
  mocks.push.mockReset();
  mocks.toast.mockReset();
});

describe("Meetings, tied to their events", () => {
  it("lists a meeting that ended with no minutes, and starts them in one press", async () => {
    mocks.start.mockResolvedValue({ id: "m-new" });
    render(<MeetingsPage />);
    expect(screen.getByText(MEETING_LIST_COPY.needsMinutes)).toBeTruthy();
    // A social asks for no minutes, and posted minutes aren't asked again.
    expect(screen.queryByText("Date party")).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: `${MEETING_LIST_COPY.startMinutes}: Cabinet Meeting`,
      }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: `${MEETING_LIST_COPY.startMinutes}: Chapter Meeting`,
      }),
    );
    await waitFor(() =>
      expect(mocks.start).toHaveBeenCalledWith({
        event_id: "e-needs",
        meeting_type: "chapter",
      }),
    );
    expect(mocks.push).toHaveBeenCalledWith("/meetings/m-new");
  });

  it("says posted minutes' action items, and shows the next meeting", () => {
    render(<MeetingsPage />);
    expect(screen.getByText(/4 action items/)).toBeTruthy();
    expect(screen.getByText(MEETING_LIST_COPY.nextUp)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Exec Meeting/ }).getAttribute("href"),
    ).toBe("/events?event=e-next");
  });

  it("asks nothing of a member who doesn't record minutes", () => {
    mocks.permissions = [];
    render(<MeetingsPage />);
    expect(screen.queryByText(MEETING_LIST_COPY.needsMinutes)).toBeNull();
    expect(screen.queryByText(MEETING_LIST_COPY.nextUp)).toBeNull();
  });

  it("leaves out a meeting the viewer takes notes on, and waits for that read", () => {
    mocks.taking = [{ meeting_id: "m-other", event_id: "e-needs" }];
    const { unmount } = render(<MeetingsPage />);
    expect(screen.queryByText(MEETING_LIST_COPY.needsMinutes)).toBeNull();
    unmount();
    mocks.taking = [];
    mocks.takingReady = false;
    render(<MeetingsPage />);
    expect(screen.queryByText(MEETING_LIST_COPY.needsMinutes)).toBeNull();
  });

  it("says so when someone else already started them, and drops the row", async () => {
    mocks.start.mockRejectedValue({ code: "meeting.already_started" });
    render(<MeetingsPage />);
    fireEvent.click(
      screen.getByRole("button", {
        name: `${MEETING_LIST_COPY.startMinutes}: Chapter Meeting`,
      }),
    );
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.queryByText(MEETING_LIST_COPY.needsMinutes)).toBeNull();
  });
});
