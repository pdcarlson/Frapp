/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEETING_NOTE_TAKERS_COPY } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * A note-taker's own notes on the phone (#4935): saved as they are typed,
 * sent on closing when a save is still waiting, and leaving removes them.
 */
const hooks = vi.hoisted(() => ({
  save: vi.fn(),
  remove: vi.fn(),
  state: null as unknown,
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useMeetingNotes: () => ({ data: hooks.state, isPending: false }),
  useSaveMeetingNotes: () => ({ mutateAsync: hooks.save, isPending: false }),
  useRemoveMeetingNoteTaker: () => ({
    mutateAsync: hooks.remove,
    isPending: false,
  }),
  useCurrentUser: () => ({ data: { id: "u-sam" } }),
}));
const confirm = vi.hoisted(() => vi.fn());
vi.mock("@/lib/minutes/meetings-on", () => ({ confirmAlert: confirm }));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63", accentOnPrimary: "#131211" }),
}));

import { NoteTakerSheet } from "./note-taker-sheet";

const STATE = {
  meeting: {
    id: "m1",
    event_id: "e1",
    event_name: "Chapter Meeting",
    event_start_time: "2026-11-11T19:00:00Z",
    meeting_type: "chapter",
    author_name: "Eli Sorensen",
  },
  role: "note_taker",
  mine: { notes: "first line", updated_at: null, held: null },
  takers: [],
  others_count: 1,
  can_add: false,
  joined: true,
};

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <NoteTakerSheet ref={React.createRef<never>()} meetingId="m1" />
      </FrappThemeProvider>,
    );
  });
  return tree;
}
const field = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) => (node.type as unknown) === "BottomSheetTextInput",
  )[0];

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  hooks.state = STATE;
  hooks.save.mockResolvedValue(STATE);
  hooks.remove.mockResolvedValue("m1");
  confirm.mockResolvedValue(true);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("NoteTakerSheet", () => {
  it("shows only the member's own notes and who writes the minutes", () => {
    const tree = render();
    expect(field(tree).props.value).toBe("first line");
    expect(screenText(tree)).toContain(
      MEETING_NOTE_TAKERS_COPY.noteTakerHint("Eli Sorensen"),
    );
  });

  it("saves a pause after typing stops", async () => {
    const tree = render();
    act(() => field(tree).props.onChangeText("first line\nvote 21-6"));
    expect(hooks.save).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(hooks.save).toHaveBeenCalledWith({
      id: "m1",
      notes: "first line\nvote 21-6",
    });
  });

  it("sends a waiting save when the sheet closes", () => {
    const tree = render();
    act(() => field(tree).props.onChangeText("typed just now"));
    act(() => tree.unmount());
    expect(hooks.save).toHaveBeenCalledWith({
      id: "m1",
      notes: "typed just now",
    });
  });
});
