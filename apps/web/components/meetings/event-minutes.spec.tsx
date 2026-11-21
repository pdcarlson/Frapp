import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  moduleOn: { current: true },
  meetings: {
    current: { isPending: false, isError: false, data: [] as unknown[] },
  },
  permissions: { current: [] as string[] },
  taking: { current: { isPending: false, data: [] as unknown[] } },
  request: { current: { isLoading: false, data: null as unknown } },
  live: { current: [] as unknown[] },
  ask: vi.fn(),
  start: vi.fn(),
  push: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@repo/hooks", () => ({
  useMeetings: () => ({ ...mocks.meetings.current, refetch: vi.fn() }),
  useMyPermissions: () => ({
    data: { permissions: mocks.permissions.current },
  }),
  useStartMeeting: () => ({ mutateAsync: mocks.start, isPending: false }),
  useMeetingNoteTaking: () => mocks.taking.current,
  useMinutesRequest: () => mocks.request.current,
  useRequestMinutes: () => ({ mutateAsync: mocks.ask, isPending: false }),
  useLiveMeetingRecordings: () => ({ data: mocks.live.current }),
  useViewerUserId: () => "u-viewer",
  useMemberDisplayNames: () => ({
    nameFor: (id: string) => (id === "u-winston" ? "Winston Hewitt" : null),
  }),
}));

vi.mock("@/lib/hooks/use-chapter-module-gate", () => ({
  useChapterModuleGateState: () => ({
    status: "ready",
    isModuleEnabled: (key: string) =>
      key === "meetings" && mocks.moduleOn.current,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

const { EventMinutes } = await import("./event-minutes");

beforeEach(() => {
  mocks.moduleOn.current = true;
  mocks.meetings.current = { isPending: false, isError: false, data: [] };
  mocks.permissions.current = [];
  mocks.taking.current = { isPending: false, data: [] };
  mocks.request.current = { isLoading: false, data: null };
  mocks.live.current = [];
  mocks.ask.mockReset();
  mocks.start.mockReset();
  mocks.push.mockReset();
  mocks.toast.mockReset();
});

describe("EventMinutes", () => {
  it("offers Take notes on someone else's draft, to a member they added (#4935)", () => {
    mocks.taking.current = {
      isPending: false,
      data: [
        {
          meeting_id: "m-9",
          event_id: "e-1",
          author_name: "Eli Sorensen",
          joined: true,
          added: true,
        },
      ],
    };
    render(<EventMinutes eventId="e-1" eventName="Chapter" />);
    expect(screen.getByText(/Minutes by Eli Sorensen/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Taking notes" }).getAttribute("href"),
    ).toBe("/meetings/m-9/notes");
  });

  it("draws nothing while the meetings module is off", () => {
    mocks.moduleOn.current = false;
    mocks.permissions.current = ["meetings:record"];
    const { container } = render(
      <EventMinutes eventId="e-1" eventName="Chapter" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("draws nothing for a member when there are no minutes they can read", () => {
    const { container } = render(
      <EventMinutes eventId="e-1" eventName="Chapter" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("links to minutes the viewer can read", () => {
    mocks.meetings.current = {
      isPending: false,
      isError: false,
      data: [{ id: "m-1", status: "posted", event_id: "e-1" }],
    };
    render(<EventMinutes eventId="e-1" eventName="Chapter" />);
    expect(
      screen.getByRole("link", { name: "Open minutes" }).getAttribute("href"),
    ).toBe("/meetings/m-1");
  });

  it("says where the minutes stand, what they hold, and their TL;DR's first line", () => {
    mocks.meetings.current = {
      isPending: false,
      isError: false,
      data: [
        {
          id: "m-1",
          status: "posted",
          event_id: "e-1",
          posted_at: "2026-11-18T12:00:00Z",
          decision_count: 2,
          action_item_count: 3,
          gist: "Dues are due Friday.",
        },
      ],
    };
    render(<EventMinutes eventId="e-1" eventName="Chapter" />);
    expect(
      screen.getByText(
        /^Posted \w+, November 18 · 2 decisions · 3 action items$/,
      ),
    ).toBeTruthy();
    expect(screen.getByText("Dues are due Friday.")).toBeTruthy();
  });

  it("says who is recording a draft, and never just 'a draft' (Paul, 2026-11-20)", () => {
    mocks.meetings.current = {
      isPending: false,
      isError: false,
      data: [
        {
          id: "m-1",
          status: "draft",
          event_id: "e-1",
          created_by: "u-winston",
          posted_at: null,
          decision_count: 0,
          action_item_count: 0,
          gist: null,
          started: false,
          recording_by: "u-winston",
        },
      ],
    };
    render(<EventMinutes eventId="e-1" eventName="Recruitment Meetings" />);
    expect(screen.getByText("Winston Hewitt is recording")).toBeTruthy();
  });

  it("tells a member who is recording minutes they can't open yet (Paul, 2026-11-20)", () => {
    mocks.live.current = [
      { meeting_id: "m-1", event_id: "e-1", user_id: "u-winston" },
    ];
    render(<EventMinutes eventId="e-1" eventName="Chapter" />);
    expect(screen.getByText("Winston Hewitt is recording")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers no Write minutes when the read failed", () => {
    mocks.permissions.current = ["meetings:record"];
    mocks.meetings.current = { isPending: false, isError: true, data: [] };
    const { container } = render(
      <EventMinutes eventId="e-1" eventName="Chapter" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("holds the row's place for someone who records minutes while the read answers", () => {
    mocks.permissions.current = ["meetings:record"];
    mocks.meetings.current = { isPending: true, isError: false, data: [] };
    render(<EventMinutes eventId="e-1" eventName="Chapter" />);
    expect(screen.getByText("Checking")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Write minutes" })).toBeNull();
  });

  it("starts minutes in one tap, typed from the event's name, and opens them", async () => {
    mocks.permissions.current = ["meetings:record"];
    mocks.start.mockResolvedValue({ id: "m-9" });
    render(<EventMinutes eventId="e-1" eventName="Exec meeting" />);
    fireEvent.click(screen.getByRole("button", { name: "Write minutes" }));
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith("/meetings/m-9"),
    );
    expect(mocks.start).toHaveBeenCalledWith({
      event_id: "e-1",
      meeting_type: "exec",
    });
  });

  it("says so when someone else already started them", async () => {
    mocks.permissions.current = ["meetings:record"];
    mocks.start.mockRejectedValue({
      statusCode: 409,
      code: "meeting.already_started",
    });
    render(<EventMinutes eventId="e-1" eventName="Chapter" />);
    fireEvent.click(screen.getByRole("button", { name: "Write minutes" }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "These minutes are already started" }),
      ),
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  describe("Request minutes (#5471)", () => {
    const askable = (requested: boolean) => ({
      isLoading: false,
      data: { meeting_id: "m-7", event_id: "e-1", requested },
    });

    it("offers Request minutes on unposted minutes the member can't open, and says who gets reminded", async () => {
      mocks.request.current = askable(false);
      mocks.ask.mockResolvedValue({
        meeting_id: "m-7",
        event_id: "e-1",
        requested: true,
        pinged: true,
      });
      render(<EventMinutes eventId="e-1" eventName="Chapter" />);
      expect(screen.getByText("Not posted yet")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Request minutes" }));
      await waitFor(() => expect(mocks.ask).toHaveBeenCalledWith("m-7"));
      await waitFor(() =>
        expect(mocks.toast).toHaveBeenCalledWith({
          title: "Minutes requested",
          description: "Whoever is writing them gets a reminder.",
        }),
      );
    });

    it("says so when the day's reminder had already gone", async () => {
      mocks.request.current = askable(false);
      mocks.ask.mockResolvedValue({
        meeting_id: "m-7",
        event_id: "e-1",
        requested: true,
        pinged: false,
      });
      render(<EventMinutes eventId="e-1" eventName="Chapter" />);
      fireEvent.click(screen.getByRole("button", { name: "Request minutes" }));
      await waitFor(() =>
        expect(mocks.toast).toHaveBeenCalledWith({
          title: "Minutes requested",
          description: "They were already reminded today.",
        }),
      );
    });

    it("reads Requested once the member has asked, with nothing to press", () => {
      mocks.request.current = askable(true);
      render(<EventMinutes eventId="e-1" eventName="Chapter" />);
      expect(
        screen.getByText("Not posted yet. You asked for them."),
      ).toBeTruthy();
      const button = screen.getByRole("button", { name: "Minutes requested" });
      expect((button as HTMLButtonElement).disabled).toBe(true);
    });

    it("keeps Take notes for a note-taker, and waits for that read before offering Request", () => {
      mocks.request.current = askable(false);
      mocks.taking.current = { isPending: true, data: [] };
      const { rerender } = render(
        <EventMinutes eventId="e-1" eventName="Chapter" />,
      );
      expect(
        screen.queryByRole("button", { name: "Request minutes" }),
      ).toBeNull();
      mocks.taking.current = {
        isPending: false,
        data: [
          {
            meeting_id: "m-7",
            event_id: "e-1",
            author_name: "Eli Sorensen",
            joined: false,
            added: true,
          },
        ],
      };
      rerender(<EventMinutes eventId="e-1" eventName="Chapter" />);
      expect(screen.getByRole("link", { name: "Take notes" })).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "Request minutes" }),
      ).toBeNull();
    });

    it("offers nothing once the minutes are posted and readable", () => {
      mocks.meetings.current = {
        isPending: false,
        isError: false,
        data: [{ id: "m-7", status: "posted" }],
      };
      mocks.request.current = askable(false);
      render(<EventMinutes eventId="e-1" eventName="Chapter" />);
      expect(
        screen.queryByRole("button", { name: "Request minutes" }),
      ).toBeNull();
      expect(screen.getByRole("link", { name: "Open minutes" })).toBeTruthy();
    });
  });
});
