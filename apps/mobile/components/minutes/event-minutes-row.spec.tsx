/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRouter } from "expo-router";
import { MEETING_COPY, MEETING_ENTRY_COPY } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * An event's way into its minutes on the phone (#4312). The phone has no
 * section editor, so Write minutes is offered only where minutes can be
 * drafted from notes; otherwise it would leave an empty draft behind.
 */
const state = vi.hoisted(() => ({
  on: true,
  meetings: [] as { id: string; status: string }[],
  isSuccess: true,
  permissions: ["meetings:record"] as string[],
  canDraft: true,
  start: vi.fn(),
  refetch: vi.fn(),
  enabled: undefined as boolean | undefined,
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useMeetings: (options: { enabled: boolean }) => {
    state.enabled = options.enabled;
    return {
      data: state.meetings,
      isSuccess: state.isSuccess,
      refetch: state.refetch,
    };
  },
  usePermissionList: () => state.permissions,
  useStartMeeting: () => ({ mutateAsync: state.start, isPending: false }),
}));
vi.mock("@/lib/minutes/meetings-on", () => ({
  useMeetingsOn: () => state.on,
}));
vi.mock("@/lib/ai/availability", () => ({
  useAiSurfaces: () => ({ meetingNotes: state.canDraft }),
}));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63" }),
}));

import { EventMinutesRow } from "./event-minutes-row";

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <EventMinutesRow eventId="e1" eventName="Chapter meeting" />
      </FrappThemeProvider>,
    );
  });
  return tree;
}
const rows = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      typeof node.type === "string" && typeof node.props.onPress === "function",
  );

beforeEach(() => {
  vi.clearAllMocks();
  state.on = true;
  state.meetings = [];
  state.isSuccess = true;
  state.permissions = ["meetings:record"];
  state.canDraft = true;
});

describe("EventMinutesRow", () => {
  it("draws nothing, and reads nothing, with the meetings module off", () => {
    state.on = false;
    state.meetings = [{ id: "m1", status: "posted" }];
    expect(render().toJSON()).toBeNull();
    expect(state.enabled).toBe(false);
  });

  it("draws nothing until the read answers, so a failed read offers no Write", () => {
    state.isSuccess = false;
    expect(render().toJSON()).toBeNull();
  });

  it.each([
    ["posted", MEETING_ENTRY_COPY.posted],
    ["draft", MEETING_COPY.draftBadge],
  ])("opens %s minutes the viewer may read", (status, value) => {
    state.permissions = [];
    state.meetings = [{ id: "m1", status }];
    const tree = render();
    expect(screenText(tree)).toContain(MEETING_ENTRY_COPY.label);
    expect(screenText(tree)).toContain(value);
    act(() => rows(tree)[0].props.onPress());
    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith({
      pathname: "/minutes-details",
      params: { id: "m1" },
    });
  });

  it("offers nothing to a member when there are no minutes", () => {
    state.permissions = [];
    expect(render().toJSON()).toBeNull();
  });

  it("offers no Write minutes where the phone has nothing to write them with", () => {
    state.canDraft = false;
    expect(render().toJSON()).toBeNull();
  });

  it("starts minutes in one tap for an officer who can draft, and opens them", async () => {
    state.start.mockResolvedValue({ id: "m9" });
    const tree = render();
    expect(screenText(tree)).toContain(MEETING_ENTRY_COPY.write);
    await act(async () => rows(tree)[0].props.onPress());
    expect(state.start).toHaveBeenCalledWith(
      expect.objectContaining({ event_id: "e1" }),
    );
    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith({
      pathname: "/minutes-details",
      params: { id: "m9" },
    });
  });

  it("says someone else already started them, and reads again", async () => {
    state.start.mockRejectedValue({ code: "meeting.already_started" });
    const tree = render();
    await act(async () => rows(tree)[0].props.onPress());
    expect(state.refetch).toHaveBeenCalled();
    expect(screenText(tree)).toContain(MEETING_ENTRY_COPY.alreadyStartedBody);
    expect(vi.mocked(useRouter)().push).not.toHaveBeenCalled();
  });
});
