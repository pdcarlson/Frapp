import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const meeting = vi.hoisted(() => ({
  current: { data: undefined as { event_name: string } | undefined },
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useMeeting: () => meeting.current,
}));

import { FromMinutesRow } from "./task-panel";

describe("FromMinutesRow (#5562)", () => {
  beforeEach(() => {
    meeting.current = { data: undefined };
  });

  it("names the minutes as the meeting is called now, and links them by id", () => {
    meeting.current = { data: { event_name: "Leadership Meeting" } };
    render(
      <dl>
        <FromMinutesRow meetingId="m-1" />
      </dl>,
    );
    const link = screen.getByRole("link", { name: "Leadership Meeting" });
    expect(link.getAttribute("href")).toBe("/meetings/m-1");
    expect(screen.getByText("Minutes")).toBeTruthy();
  });

  it("shows nothing to someone who can't read those minutes", () => {
    const { container } = render(
      <dl>
        <FromMinutesRow meetingId="m-1" />
      </dl>,
    );
    expect(container.textContent).toBe("");
  });
});
