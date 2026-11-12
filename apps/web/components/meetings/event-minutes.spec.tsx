import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  moduleOn: { current: true },
  meetings: { current: { isPending: false, data: [] as unknown[] } },
  permissions: { current: [] as string[] },
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
  mocks.meetings.current = { isPending: false, data: [] };
  mocks.permissions.current = [];
  mocks.start.mockReset();
  mocks.push.mockReset();
  mocks.toast.mockReset();
});

describe("EventMinutes", () => {
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
      data: [{ id: "m-1", status: "posted", event_id: "e-1" }],
    };
    render(<EventMinutes eventId="e-1" eventName="Chapter" />);
    expect(
      screen.getByRole("link", { name: "Open minutes" }).getAttribute("href"),
    ).toBe("/meetings/m-1");
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
});
