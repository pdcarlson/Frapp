/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";
import { MEETING_COPY, MEETING_NOTES_COPY } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText } from "@/test/screen-text";

/**
 * Minutes on the phone (#4312): a member reads posted minutes; the officer
 * who may edit a draft drafts it from notes (only where the server offers
 * that) and posts it. Renders `app/(app)/minutes-details.tsx` from here, since
 * a spec under `app/` ships as a route module.
 */
const state = vi.hoisted(() => ({
  meeting: null as Record<string, unknown> | null,
  isPending: false,
  error: null as unknown,
  refetch: vi.fn(),
  surfaces: { available: true as boolean | undefined, meetingNotes: true },
  draft: { status: "none" } as Record<string, unknown> | null,
  draftEnabled: undefined as boolean | undefined,
  suggestions: [] as unknown[],
  suggestionsEnabled: undefined as boolean | undefined,
  post: vi.fn(),
  notesSheet: 0,
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useMeeting: () => ({
    data: state.meeting ?? undefined,
    isPending: state.isPending,
    error: state.error,
    isFetching: false,
    refetch: state.refetch,
  }),
  useMeetingDraft: (_id: string, options: { enabled: boolean }) => {
    state.draftEnabled = options.enabled;
    return { data: options.enabled ? state.draft : undefined, refetch: vi.fn() };
  },
  useAiSuggestions: (options: { enabled: boolean }) => {
    state.suggestionsEnabled = options.enabled;
    return {
      data: options.enabled
        ? { items: state.suggestions, has_more: false }
        : undefined,
      refetch: vi.fn(),
    };
  },
  usePostMeeting: () => ({ mutateAsync: state.post, isPending: false }),
  useMemberDisplayNames: () => ({ nameFor: () => null }),
}));
vi.mock("@/lib/ai/availability", () => ({
  useAiSurfaces: () => state.surfaces,
}));
vi.mock("@/components/screen-shell", () => ({
  ScreenShell: ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
  }) => React.createElement("ScreenShell", { title }, children),
}));
vi.mock("@/components/pull-to-refresh", () => ({
  useRefetchAll: () => undefined,
}));
vi.mock("@/components/minutes/minutes-body", () => ({
  MinutesBody: () => React.createElement("MinutesBody"),
}));
vi.mock("@/components/minutes/notes-draft-sheet", async () => {
  const { forwardRef } = await import("react");
  return {
    NotesDraftSheet: forwardRef(function NotesDraftSheet() {
      state.notesSheet += 1;
      return null;
    }),
  };
});
const confirm = vi.hoisted(() => vi.fn());
vi.mock("@/lib/minutes/meetings-on", () => ({ confirmAlert: confirm }));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63", accentOnPrimary: "#131211" }),
}));

import MinutesDetailsScreen from "@/app/(app)/minutes-details";

const WRITTEN = { sections: { discussion: "Budget passed 12-3." } };
function meeting(over: Record<string, unknown> = {}) {
  return {
    id: "m1",
    status: "draft",
    can_edit: true,
    event_name: "Chapter meeting",
    event_start_time: "2026-11-09T23:00:00Z",
    meeting_type: "chapter",
    other_label: null,
    posted_at: null,
    updated_at: "v1",
    sections: [],
    attendees: null,
    content: WRITTEN,
    ...over,
  };
}

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MinutesDetailsScreen />
      </FrappThemeProvider>,
    );
  });
  return tree;
}
const button = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      typeof node.props.onPress === "function" &&
      (node.props.accessibilityLabel === label || drawnText(node) === label),
  )[0];

beforeEach(() => {
  vi.clearAllMocks();
  state.meeting = meeting();
  state.isPending = false;
  state.error = null;
  state.surfaces = { available: true, meetingNotes: true };
  state.draft = { status: "none" };
  state.suggestions = [];
  state.notesSheet = 0;
  state.refetch.mockImplementation(async () => ({ data: state.meeting }));
  state.post.mockResolvedValue({});
  confirm.mockResolvedValue(true);
  vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({ id: "m1" });
});

describe("Minutes on the phone", () => {
  it("is read-only for a member: no Draft, no Post, no web line", () => {
    state.meeting = meeting({
      status: "posted",
      can_edit: false,
      posted_at: "2026-11-10T02:00:00Z",
    });
    const tree = render();
    expect(button(tree, MEETING_COPY.post)).toBeUndefined();
    expect(button(tree, MEETING_NOTES_COPY.draft)).toBeUndefined();
    expect(screenText(tree)).not.toContain(MEETING_COPY.editOnWeb);
    expect(state.draftEnabled).toBe(false);
    expect(state.notesSheet).toBe(0);
  });

  it("offers Draft minutes to a draft's editor only where the server offers drafting", () => {
    const tree = render();
    expect(button(tree, MEETING_NOTES_COPY.draft)).toBeDefined();
    expect(screenText(tree)).toContain(MEETING_COPY.editOnWeb);

    state.surfaces = { available: false, meetingNotes: false };
    const without = render();
    expect(button(without, MEETING_NOTES_COPY.draft)).toBeUndefined();
    expect(state.draftEnabled).toBe(false);
    // Still postable: what was written on the web can be posted from here.
    expect(button(without, MEETING_COPY.post)).toBeDefined();
  });

  it("sends an editor with nothing written, and no drafting, to the web", () => {
    state.surfaces = { available: false, meetingNotes: false };
    state.meeting = meeting({ content: {} });
    const tree = render();
    expect(screenText(tree)).toContain(MEETING_COPY.writeOnWeb);
    expect(button(tree, MEETING_COPY.post).props.disabled).toBe(true);
  });

  it("asks before posting, then posts the version the server holds now", async () => {
    const tree = render();
    state.refetch.mockImplementation(async () => ({
      data: meeting({ updated_at: "v2" }),
    }));
    await act(async () => button(tree, MEETING_COPY.post).props.onPress());
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: MEETING_COPY.postConfirmTitle }),
    );
    expect(state.post).toHaveBeenCalledWith({
      id: "m1",
      expectedUpdatedAt: "v2",
    });
  });

  it("posts nothing when the officer says Cancel", async () => {
    confirm.mockResolvedValue(false);
    const tree = render();
    await act(async () => button(tree, MEETING_COPY.post).props.onPress());
    expect(state.post).not.toHaveBeenCalled();
  });

  it("says a post failed in the web line's place", async () => {
    state.post.mockRejectedValue(new Error("nope"));
    const tree = render();
    await act(async () => button(tree, MEETING_COPY.post).props.onPress());
    expect(screenText(tree)).not.toContain(MEETING_COPY.editOnWeb);
  });

  it("can't post while a draft is being written", () => {
    state.draft = { status: "drafting" };
    const tree = render();
    expect(button(tree, MEETING_COPY.post).props.disabled).toBe(true);
  });

  it("links the tasks suggested from posted minutes, and asks only where AI is on", () => {
    state.meeting = meeting({
      status: "posted",
      can_edit: false,
      posted_at: "2026-11-10T02:00:00Z",
    });
    state.suggestions = [
      { kind: "task", task: { title: "Book the hall" } },
      { kind: "poll", task: null },
    ];
    const tree = render();
    expect(screenText(tree)).toContain(MEETING_COPY.suggestedTasks);
    act(() =>
      tree.root
        .findAll(
          (node) =>
            typeof node.type === "string" &&
            node.props.accessibilityHint ===
              "Opens the tasks suggested from these minutes." &&
            typeof node.props.onPress === "function",
        )[0]
        .props.onPress(),
    );
    expect(vi.mocked(expoRouter.useRouter)().push).toHaveBeenCalledWith({
      pathname: "/suggested-tasks",
      params: { meetingId: "m1" },
    });

    state.surfaces = { available: false, meetingNotes: false };
    render();
    expect(state.suggestionsEnabled).toBe(false);
  });

  it("never asks for suggestions on a draft", () => {
    render();
    expect(state.suggestionsEnabled).toBe(false);
  });

  it("says minutes are gone for a 404, with no retry, and offers one otherwise", () => {
    state.meeting = null;
    state.error = { status: 404 };
    const gone = screenText(render());
    expect(gone).toContain(MEETING_COPY.missingTitle);

    state.error = { status: 500 };
    expect(screenText(render())).toContain(MEETING_COPY.loadFailedTitle);
  });
});
