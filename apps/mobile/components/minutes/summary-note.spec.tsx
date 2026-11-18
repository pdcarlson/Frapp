/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEETING_COPY } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText } from "@/test/screen-text";

/**
 * The phone's note where the chapter doesn't draft from notes (#5288): what is
 * typed is the minutes' Summary, saved once typing rests against the version
 * it was typed over, never overwriting someone else's newer save.
 */
const hooks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useUpdateMeeting: () => ({ mutateAsync: hooks.update, isPending: false }),
}));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63", accentOnPrimary: "#131211" }),
}));

import {
  SUMMARY_AUTOSAVE_MS,
  SummaryNote,
  type SummaryNoteHandle,
} from "./summary-note";

function minutes(summary: string, updatedAt: string) {
  return {
    id: "m1",
    updated_at: updatedAt,
    content: { summary },
  } as never;
}

const reload = vi.fn();
let note: React.RefObject<SummaryNoteHandle | null>;
function render(summary = "", updatedAt = "v1") {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <SummaryNote
          ref={note}
          meeting={minutes(summary, updatedAt)}
          reload={reload}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}
const field = (tree: ReactTestRenderer) =>
  tree.root.findAll((node) => (node.type as unknown) === "TextInput")[0];
const pressable = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (node) =>
      typeof node.props.onPress === "function" && drawnText(node) === label,
  )[0];

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  note = React.createRef<SummaryNoteHandle>();
  hooks.update.mockImplementation(
    async ({ body }: { body: { content: { summary: string } } }) =>
      minutes(body.content.summary, "v2"),
  );
});
afterEach(() => {
  vi.useRealTimers();
});

describe("SummaryNote", () => {
  it("saves the Summary once typing rests, against the version it was typed over", async () => {
    const tree = render();
    act(() => field(tree).props.onChangeText("Dues are 82% in.  "));
    await act(async () => vi.advanceTimersByTime(SUMMARY_AUTOSAVE_MS - 1));
    expect(hooks.update).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(hooks.update).toHaveBeenCalledWith({
      id: "m1",
      body: {
        expected_updated_at: "v1",
        content: { summary: "Dues are 82% in." },
      },
    });
    expect(screenText(tree)).toContain(MEETING_COPY.restOnWeb);
  });

  it("answers the version to post, saving what is still waiting first", async () => {
    const tree = render("Old", "v1");
    act(() => field(tree).props.onChangeText("Old, then more"));
    let version: string | null = null;
    await act(async () => {
      version = (await note.current?.flush()) ?? null;
    });
    expect(hooks.update).toHaveBeenCalledTimes(1);
    expect(version).toBe("v2");
    // Nothing new since: no second save, the same version.
    await act(async () => {
      version = (await note.current?.flush()) ?? null;
    });
    expect(hooks.update).toHaveBeenCalledTimes(1);
    expect(version).toBe("v2");
  });

  it("keeps the typing and offers their version when someone saved since", async () => {
    hooks.update.mockRejectedValue({ code: "meeting.stale" });
    const tree = render("Mine", "v1");
    act(() => field(tree).props.onChangeText("Mine, edited"));
    await act(async () => vi.advanceTimersByTime(SUMMARY_AUTOSAVE_MS));
    expect(field(tree).props.value).toBe("Mine, edited");
    expect(screenText(tree)).toContain(MEETING_COPY.stale);
    // Stale: nothing more is saved, and nothing is posted over theirs.
    let version: string | null = "x";
    await act(async () => {
      version = (await note.current?.flush()) ?? null;
    });
    expect(version).toBeNull();
    expect(hooks.update).toHaveBeenCalledTimes(1);

    reload.mockResolvedValue(minutes("Theirs", "v3"));
    await act(async () =>
      pressable(tree, MEETING_COPY.loadTheirs).props.onPress(),
    );
    expect(field(tree).props.value).toBe("Theirs");
    expect(screenText(tree)).not.toContain(MEETING_COPY.stale);
  });

  it("says a save didn't land, and tries again on the next keystroke", async () => {
    hooks.update.mockRejectedValueOnce(new Error("offline"));
    const tree = render();
    act(() => field(tree).props.onChangeText("First"));
    await act(async () => vi.advanceTimersByTime(SUMMARY_AUTOSAVE_MS));
    expect(screenText(tree)).toContain(MEETING_COPY.saveFailed);
    act(() => field(tree).props.onChangeText("First line"));
    await act(async () => vi.advanceTimersByTime(SUMMARY_AUTOSAVE_MS));
    expect(hooks.update).toHaveBeenCalledTimes(2);
    expect(screenText(tree)).not.toContain(MEETING_COPY.saveFailed);
  });

  it("sends what is still waiting when the screen closes", async () => {
    const tree = render();
    act(() => field(tree).props.onChangeText("Last line"));
    await act(async () => tree.unmount());
    expect(hooks.update).toHaveBeenCalledWith({
      id: "m1",
      body: { expected_updated_at: "v1", content: { summary: "Last line" } },
    });
  });

  it("shows a newer version when nothing is waiting, and saves over that one", async () => {
    const tree = render("Mine", "2026-11-17T20:00:00Z");
    act(() => {
      tree.update(
        <FrappThemeProvider>
          <SummaryNote
            ref={note}
            meeting={minutes("Theirs", "2026-11-17T21:00:00Z")}
            reload={reload}
          />
        </FrappThemeProvider>,
      );
    });
    expect(field(tree).props.value).toBe("Theirs");
    act(() => field(tree).props.onChangeText("Theirs, and mine"));
    await act(async () => vi.advanceTimersByTime(SUMMARY_AUTOSAVE_MS));
    expect(hooks.update).toHaveBeenCalledWith({
      id: "m1",
      body: {
        expected_updated_at: "2026-11-17T21:00:00Z",
        content: { summary: "Theirs, and mine" },
      },
    });
  });
});
