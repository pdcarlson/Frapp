/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingDraftState } from "@repo/hooks";
import {
  MEETING_DRAFT_FAILURE_COPY,
  MEETING_NOTES_COPY,
  MEETING_NOTES_MAX_LENGTH,
} from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText } from "@/test/screen-text";

/**
 * Drafting minutes from pasted notes on the phone (#4312). Nothing is sent
 * until the officer has said yes to AI, and a draft never replaces what the
 * minutes hold without asking.
 */
const hooks = vi.hoisted(() => ({
  request: vi.fn(),
  discard: vi.fn(),
  use: vi.fn(),
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useRequestMeetingDraft: () => ({
    mutateAsync: hooks.request,
    isPending: false,
  }),
  useDiscardMeetingDraft: () => ({
    mutateAsync: hooks.discard,
    isPending: false,
  }),
  useUseMeetingDraft: () => ({ mutateAsync: hooks.use, isPending: false }),
}));
const gate = vi.hoisted(() => ({ ensureConsent: vi.fn() }));
vi.mock("@/components/ai/ai-consent-sheet", () => ({
  useAiConsentGate: () => ({
    ensureConsent: gate.ensureConsent,
    consentSheet: null,
  }),
}));
const confirm = vi.hoisted(() => vi.fn());
vi.mock("@/lib/minutes/meetings-on", () => ({ confirmAlert: confirm }));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63", accentOnPrimary: "#131211" }),
}));

import { NotesDraftSheet } from "./notes-draft-sheet";

function draftState(over: Partial<MeetingDraftState> = {}): MeetingDraftState {
  return {
    status: "none",
    notes: "",
    blocked: null,
    failure: null,
    failure_message: null,
    review: { gaps: [], left_out: [] },
    ...over,
  } as MeetingDraftState;
}

const getVersion = vi.fn();
const onSettled = vi.fn();

function element(state: MeetingDraftState, hasContent = false) {
  return (
    <FrappThemeProvider>
      <NotesDraftSheet
        ref={React.createRef<never>()}
        meetingId="m1"
        eventStart="2026-11-09T23:00:00Z"
        state={state}
        hasContent={hasContent}
        getVersion={getVersion}
        onSettled={onSettled}
      />
    </FrappThemeProvider>
  );
}
function render(state: MeetingDraftState, hasContent = false) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(element(state, hasContent));
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
const field = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) => (node.type as unknown) === "BottomSheetTextInput",
  )[0];
const press = (tree: ReactTestRenderer, label: string) =>
  act(async () => button(tree, label).props.onPress());

beforeEach(() => {
  vi.clearAllMocks();
  getVersion.mockResolvedValue("v1");
  hooks.request.mockResolvedValue({});
  hooks.discard.mockResolvedValue({});
  hooks.use.mockResolvedValue({});
  gate.ensureConsent.mockResolvedValue(true);
  confirm.mockResolvedValue(true);
});

describe("NotesDraftSheet", () => {
  it("checks the notes when Draft is pressed, not while they are typed", async () => {
    const tree = render(draftState());
    expect(screenText(tree)).toContain(MEETING_NOTES_COPY.idle);
    await press(tree, MEETING_NOTES_COPY.draft);
    expect(screenText(tree)).toContain(MEETING_NOTES_COPY.empty);
    expect(hooks.request).not.toHaveBeenCalled();

    const long = "x".repeat(MEETING_NOTES_MAX_LENGTH + 1);
    act(() => field(tree).props.onChangeText(long));
    // Typing clears the last problem and raises none of its own.
    expect(screenText(tree)).toContain(MEETING_NOTES_COPY.idle);
    await press(tree, MEETING_NOTES_COPY.draft);
    expect(screenText(tree)).toContain(
      MEETING_NOTES_COPY.tooLong(MEETING_NOTES_MAX_LENGTH, long.length),
    );
    expect(hooks.request).not.toHaveBeenCalled();
  });

  it("sends the notes against the version read just now, with the meeting's local day", async () => {
    const tree = render(draftState());
    act(() => field(tree).props.onChangeText("  Budget passed 12-3.  "));
    await press(tree, MEETING_NOTES_COPY.draft);
    expect(confirm).not.toHaveBeenCalled();
    expect(hooks.request).toHaveBeenCalledWith({
      id: "m1",
      body: {
        notes: "Budget passed 12-3.",
        expected_updated_at: "v1",
        meeting_date: expect.stringMatching(/^2026-11-(09|10)$/),
      },
    });
  });

  it("asks for AI consent first, and a No sends nothing and keeps the notes", async () => {
    gate.ensureConsent.mockResolvedValue(false);
    const tree = render(draftState({ blocked: "consent_required" } as never));
    expect(screenText(tree)).toContain(
      MEETING_DRAFT_FAILURE_COPY.consent_required,
    );
    act(() => field(tree).props.onChangeText("Notes"));
    await press(tree, MEETING_NOTES_COPY.draft);
    expect(gate.ensureConsent).toHaveBeenCalledTimes(1);
    expect(hooks.request).not.toHaveBeenCalled();
    expect(field(tree).props.value).toBe("Notes");
  });

  it("stops saying consent is missing once the member has said yes", async () => {
    confirm.mockResolvedValue(false);
    const tree = render(draftState({ blocked: "consent_required" } as never), true);
    act(() => field(tree).props.onChangeText("Notes"));
    // Yes on the sheet, then Cancel on "replace what's written?".
    await press(tree, MEETING_NOTES_COPY.draft);
    expect(screenText(tree)).not.toContain(
      MEETING_DRAFT_FAILURE_COPY.consent_required,
    );
    // And the next press doesn't ask again.
    await press(tree, MEETING_NOTES_COPY.draft);
    expect(gate.ensureConsent).toHaveBeenCalledTimes(1);
  });

  it("asks on the next press after the server says consent is missing", async () => {
    hooks.request.mockRejectedValueOnce({ code: "ai.consent.required" });
    const tree = render(draftState());
    act(() => field(tree).props.onChangeText("Notes"));
    await press(tree, MEETING_NOTES_COPY.draft);
    expect(gate.ensureConsent).not.toHaveBeenCalled();
    await press(tree, MEETING_NOTES_COPY.draft);
    expect(gate.ensureConsent).toHaveBeenCalledTimes(1);
    expect(hooks.request).toHaveBeenCalledTimes(2);
  });

  it("says it couldn't check consent rather than treating a failed read as No", async () => {
    gate.ensureConsent.mockRejectedValue(new Error("offline"));
    const tree = render(draftState({ blocked: "consent_required" } as never));
    act(() => field(tree).props.onChangeText("Notes"));
    await press(tree, MEETING_NOTES_COPY.draft);
    expect(screenText(tree)).toContain(MEETING_NOTES_COPY.consentCheckFailed);
  });

  it("asks before a draft replaces what the minutes hold", async () => {
    confirm.mockResolvedValue(false);
    const tree = render(draftState(), true);
    act(() => field(tree).props.onChangeText("Notes"));
    await press(tree, MEETING_NOTES_COPY.draft);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: MEETING_NOTES_COPY.replaceTitle }),
    );
    expect(hooks.request).not.toHaveBeenCalled();
  });

  it("doesn't draft on a guess when the minutes' version can't be read", async () => {
    getVersion.mockResolvedValue(null);
    const tree = render(draftState());
    act(() => field(tree).props.onChangeText("Notes"));
    await press(tree, MEETING_NOTES_COPY.draft);
    expect(hooks.request).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain(MEETING_NOTES_COPY.startFailed);
  });

  it("locks the notes while a draft is written, and Stop keeps them", async () => {
    const tree = render(draftState({ status: "drafting", notes: "Notes" }));
    expect(screenText(tree)).toContain(MEETING_NOTES_COPY.drafting);
    expect(field(tree).props.editable).toBe(false);
    await press(tree, MEETING_NOTES_COPY.stop);
    expect(hooks.discard).toHaveBeenCalledWith({ id: "m1", keepNotes: true });
  });

  it("puts a waiting draft in on Use draft, against the fresh version", async () => {
    const tree = render(draftState({ status: "ready", notes: "Notes" }));
    expect(screenText(tree)).toContain(MEETING_NOTES_COPY.waiting);
    await press(tree, MEETING_NOTES_COPY.useDraft);
    expect(hooks.use).toHaveBeenCalledWith({
      id: "m1",
      expectedUpdatedAt: "v1",
    });
  });

  it("tells the minutes behind it to read again once a draft stops being written", () => {
    const tree = render(draftState({ status: "drafting", notes: "Notes" }));
    expect(onSettled).not.toHaveBeenCalled();
    act(() => tree.update(element(draftState({ status: "applied" }))));
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("says why a draft failed in the server's words", () => {
    const tree = render(
      draftState({
        status: "failed",
        failure: "over_cap",
        failure_message: "Your chapter has used this month's AI allowance.",
      } as never),
    );
    expect(screenText(tree)).toContain(
      "Your chapter has used this month's AI allowance.",
    );
  });
});
