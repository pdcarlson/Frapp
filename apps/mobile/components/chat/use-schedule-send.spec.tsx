/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduledMessage } from "@repo/hooks";
import type { MentionPick } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#CB9FFF" }),
}));

const mutateAsync = vi.fn();
const listFor = vi.fn();
const rows: { current: ScheduledMessage[] } = { current: [] };

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useScheduledMessages: (channelId: string | null) => {
    listFor(channelId);
    return { data: channelId ? rows.current : undefined, isPending: false };
  },
  useScheduleMessage: () => ({ mutateAsync }),
  useSendScheduledMessageNow: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteScheduledMessage: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateScheduledMessage: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ScheduleSendSheet } from "./schedule-send-sheet";
import { useScheduleSend } from "./use-schedule-send";

/**
 * The thread's half of scheduling (#4956): what the sheet is handed, what
 * the request carries, and what happens to the draft.
 */

type Props = Parameters<typeof useScheduleSend>[0];
type Result = ReturnType<typeof useScheduleSend>;

const JANE: MentionPick = { user_id: "u-jane", label: "Jane" };

function Harness(props: Props & { onResult: (result: Result) => void }) {
  const { onResult, ...input } = props;
  const result = useScheduleSend(input);
  onResult(result);
  return <>{result.sheets}</>;
}

function setup(overrides: Partial<Props> = {}) {
  const out: { current: Result | null } = { current: null };
  const props: Props = {
    channelId: "general",
    canSchedule: true,
    showList: true,
    draft: "@Jane chapter is at 8",
    refusal: null,
    picksFor: vi.fn(() => [JANE]),
    setDraft: vi.fn(),
    restoreDraftFor: vi.fn(),
    ...overrides,
  };
  let tree!: ReactTestRenderer;
  const draw = (next: Props) => (
    <FrappThemeProvider>
      <Harness
        {...next}
        onResult={(result) => {
          out.current = result;
        }}
      />
    </FrappThemeProvider>
  );
  act(() => {
    tree = create(draw(props), {
      createNodeMock: (element) =>
        (element.type as unknown) === "BottomSheetModal"
          ? { present: vi.fn(), dismiss: vi.fn() }
          : null,
    });
  });
  const rerender = (next: Partial<Props>) =>
    act(() => tree.update(draw({ ...props, ...next })));
  const sheet = () => tree.root.findByType(ScheduleSendSheet);
  return { out, props, tree, rerender, sheet };
}

beforeEach(() => {
  mutateAsync.mockReset();
  listFor.mockClear();
  rows.current = [];
});

describe("useScheduleSend", () => {
  it("hands the sheet the draft, its refusal and the moment it opened", () => {
    const { out, sheet } = setup({
      refusal: "Replies can't be scheduled yet.",
    });
    const before = Date.now();
    act(() => out.current!.openSchedule!());
    expect(sheet().props.preview).toBe("@Jane chapter is at 8");
    expect(sheet().props.refusal).toBe("Replies can't be scheduled yet.");
    expect(sheet().props.openedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("schedules the draft with its picks, clearing it on the tap", async () => {
    mutateAsync.mockResolvedValue({});
    const { out, props, sheet } = setup();
    act(() => out.current!.openSchedule!());
    const at = new Date(Date.now() + 3_600_000);
    await act(() => sheet().props.onSchedule(at));
    expect(props.setDraft).toHaveBeenCalledWith("");
    expect(mutateAsync).toHaveBeenCalledWith({
      channelId: "general",
      content: "@Jane chapter is at 8",
      sendAt: at,
      mentionPicks: [JANE],
      attachments: [],
      replyToId: null,
    });
  });

  it("schedules uploaded photos and the reply, clearing them once scheduled (#4971)", async () => {
    mutateAsync.mockResolvedValue({});
    const onScheduled = vi.fn();
    const photo = {
      storagePath: "chapters/c/chat/general/a/IMG_1.jpg",
      filename: "IMG_1.jpg",
      contentType: "image/jpeg",
      width: 4,
      height: 3,
    };
    const { out, sheet } = setup({
      draft: "",
      photos: [{ key: "p1", attachment: photo }],
      replyToId: "m-1",
      onScheduled,
    });
    act(() => out.current!.openSchedule!());
    expect(sheet().props.preview).toBe("1 photo");
    const at = new Date(Date.now() + 3_600_000);
    await act(() => sheet().props.onSchedule(at));
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "",
        replyToId: "m-1",
        attachments: [
          expect.objectContaining({
            storage_path: photo.storagePath,
            filename: "IMG_1.jpg",
            content_type: "image/jpeg",
            width: 4,
            height: 3,
          }),
        ],
      }),
    );
    expect(onScheduled).toHaveBeenCalledWith({
      channelId: "general",
      photoKeys: ["p1"],
      replyToId: "m-1",
    });
  });

  it("leaves the photos and the reply when the API refuses it (#4971)", async () => {
    mutateAsync.mockRejectedValue(new Error("refused"));
    const onScheduled = vi.fn();
    const { out, sheet } = setup({ replyToId: "m-1", onScheduled });
    act(() => out.current!.openSchedule!());
    await act(() =>
      sheet()
        .props.onSchedule(new Date(Date.now() + 3_600_000))
        .catch(() => {}),
    );
    expect(onScheduled).not.toHaveBeenCalled();
  });

  it("puts the draft back when the API refuses it", async () => {
    let reject!: (error: Error) => void;
    mutateAsync.mockReturnValue(
      new Promise((_, no) => {
        reject = no;
      }),
    );
    const { out, props, sheet, rerender } = setup();
    act(() => out.current!.openSchedule!());
    let pending!: Promise<void>;
    act(() => {
      pending = sheet().props.onSchedule(new Date());
    });
    expect(props.setDraft).toHaveBeenCalledWith("");
    // The composer now shows the cleared draft.
    rerender({ draft: "" });
    await act(async () => {
      reject(new Error("refused"));
      await pending.catch(() => {});
    });
    expect(vi.mocked(props.setDraft).mock.calls).toEqual([
      [""],
      ["@Jane chapter is at 8"],
    ]);
    expect(props.restoreDraftFor).not.toHaveBeenCalled();
  });

  it("puts a refused draft back into its own channel after a switch", async () => {
    let reject!: (error: Error) => void;
    mutateAsync.mockReturnValue(
      new Promise((_, no) => {
        reject = no;
      }),
    );
    const { out, props, sheet, rerender } = setup();
    act(() => out.current!.openSchedule!());
    let pending!: Promise<void>;
    act(() => {
      pending = sheet().props.onSchedule(new Date());
    });
    rerender({ channelId: "dues", draft: "" });
    await act(async () => {
      reject(new Error("refused"));
      await pending.catch(() => {});
    });
    expect(props.restoreDraftFor).toHaveBeenCalledWith(
      "general",
      "@Jane chapter is at 8",
    );
    expect(props.setDraft).toHaveBeenCalledTimes(1);
  });

  it("keeps the list where the member can no longer post", () => {
    rows.current = [
      {
        id: "s1",
        channel_id: "general",
        content: "Dues Friday",
        mention_picks: null,
        attachments: [],
        reply_to_id: null,
        thread_root_id: null,
        send_at: new Date().toISOString(),
        status: "failed",
        failure_reason: "no_access",
        created_at: "",
        updated_at: "",
      },
    ];
    const { out } = setup({ canSchedule: false });
    expect(out.current!.openSchedule).toBeUndefined();
    expect(out.current!.scheduled).toMatchObject({
      label: "1 scheduled message",
      failed: 1,
    });
  });

  it("reads no list where there is none to show", () => {
    const { out } = setup({ showList: false });
    expect(listFor).toHaveBeenLastCalledWith(null);
    expect(out.current!.scheduled).toBeNull();
  });
});
