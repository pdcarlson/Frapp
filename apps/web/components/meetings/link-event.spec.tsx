import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ link: vi.fn() }));

vi.mock("@repo/hooks", () => ({
  useEvents: () => ({ data: [] }),
  useMeetings: () => ({ data: [] }),
  useRoles: () => ({ data: [] }),
  useLinkMeetingEvent: () => ({ mutateAsync: mocks.link, isPending: false }),
}));

const { LinkEventPanel } = await import("./link-event");

/**
 * Link a meeting's Add it to the calendar makes the meeting from a name and
 * a day (`meetings.md` § Linking a meeting later).
 */
describe("LinkEventPanel", () => {
  it.each(["", "Minutes"])(
    "makes the event from a name and a day, the times optional (name %j reads as blank)",
    async (meetingName) => {
      mocks.link.mockReset().mockResolvedValue({});
      render(
        <LinkEventPanel
          meetingId="m-1"
          meetingName={meetingName}
          onLinked={() => {}}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Link a meeting" }));
      fireEvent.click(
        screen.getByRole("button", { name: "Add it to the calendar" }),
      );
      fireEvent.change(screen.getByLabelText("When did it meet?"), {
        target: { value: "yesterday" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Link a meeting" }));
      await vi.waitFor(() => expect(mocks.link).toHaveBeenCalledTimes(1));
      const body = mocks.link.mock.calls[0]![0].body;
      // Not the placeholder "Minutes" no-meeting minutes go by.
      expect(body.new_event.name).toBe("Chapter meeting");
      const start = new Date(body.new_event.start_time);
      expect(start.getHours()).toBe(19);
      expect(Date.parse(body.new_event.end_time) - start.getTime()).toBe(
        3_600_000,
      );
    },
  );
});
