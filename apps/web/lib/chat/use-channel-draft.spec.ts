/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { clearDraft, loadDraft, saveDraft } = vi.hoisted(() => ({
  clearDraft: vi.fn(async () => undefined),
  loadDraft: vi.fn<(channelId: string) => Promise<string>>(async () => ""),
  saveDraft: vi.fn(async () => undefined),
}));
vi.mock("./offline-queue", () => ({ clearDraft, loadDraft, saveDraft }));

import { useChannelDraft } from "./use-channel-draft";

describe("useChannelDraft", () => {
  beforeEach(() => {
    clearDraft.mockClear();
    saveDraft.mockClear();
    loadDraft.mockReset();
    loadDraft.mockResolvedValue("");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("the composer shell handoff (#2176)", () => {
    it("keeps what the member types before any channel exists", () => {
      // `ComposerShell` renders before `GET /v1/channels` resolves, so this is
      // the ordinary case during a cold load, not an edge one.
      const { result } = renderHook(({ id }) => useChannelDraft(id), {
        initialProps: { id: null as string | null },
      });

      act(() => result.current.setDraft("typed while waiting"));

      // Masked, because no channel owns it yet — but not lost.
      expect(result.current.draft).toBe("");
    });

    it("hands that text to the first channel to arrive, in the same render", async () => {
      /*
        The render that supplies the channel id is the render that mounts
        `<Composer>`, and `useEditor` builds its document exactly once from
        `draft`. A handoff that took one render longer would build an empty
        editor and have to correct it afterwards, which is a visible flicker and
        a lost caret.
      */
      const { result, rerender } = renderHook(({ id }) => useChannelDraft(id), {
        initialProps: { id: null as string | null },
      });
      act(() => result.current.setDraft("typed while waiting"));

      rerender({ id: "chan-1" });

      expect(result.current.draft).toBe("typed while waiting");
    });

    it("does not let the persisted draft overwrite it a moment later", async () => {
      /*
        The regression this exists for. `loadDraft` is asynchronous and a
        first-time member has nothing saved, so it answers with the empty string
        a few milliseconds after the channel lands — and before this guard that
        answer wiped whatever had been typed into the shell.
      */
      let resolveLoad: (body: string) => void = () => {};
      loadDraft.mockReturnValue(
        new Promise<string>((resolve) => {
          resolveLoad = resolve;
        }),
      );
      const { result, rerender } = renderHook(({ id }) => useChannelDraft(id), {
        initialProps: { id: null as string | null },
      });
      act(() => result.current.setDraft("typed while waiting"));
      rerender({ id: "chan-1" });

      await act(async () => {
        resolveLoad("");
      });

      expect(result.current.draft).toBe("typed while waiting");
    });

    it("still restores a persisted draft when the member typed nothing", async () => {
      // The guard must be narrow: it protects live typing, not every load.
      loadDraft.mockResolvedValue("saved earlier");
      const { result } = renderHook(() => useChannelDraft("chan-1"));

      await waitFor(() => expect(result.current.draft).toBe("saved earlier"));
    });

    it("restores the next channel's saved draft after typing in this one", async () => {
      // The guard is keyed on the channel, not on "has typed at all" — a switch
      // must still get its own saved text.
      const { result, rerender } = renderHook(({ id }) => useChannelDraft(id), {
        initialProps: { id: "chan-1" },
      });
      await waitFor(() => expect(loadDraft).toHaveBeenCalledWith("chan-1"));
      act(() => result.current.setDraft("for chan-1"));

      loadDraft.mockResolvedValue("saved for chan-2");
      rerender({ id: "chan-2" });

      await waitFor(() => expect(result.current.draft).toBe("saved for chan-2"));
    });
  });

  describe("persistence", () => {
    it("debounces the write rather than saving every keystroke", () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useChannelDraft("chan-1"));

      act(() => result.current.setDraft("h"));
      act(() => result.current.setDraft("he"));
      act(() => result.current.setDraft("hel"));
      expect(saveDraft).not.toHaveBeenCalled();

      act(() => void vi.advanceTimersByTime(400));
      expect(saveDraft).toHaveBeenCalledTimes(1);
      expect(saveDraft).toHaveBeenCalledWith("chan-1", "hel");
    });

    it("saves nothing while there is no channel to save it under", () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useChannelDraft(null));

      act(() => result.current.setDraft("typed while waiting"));
      act(() => void vi.advanceTimersByTime(400));

      expect(saveDraft).not.toHaveBeenCalled();
    });

    it("drops a scheduled write on demand, so a send cannot be undone by it", () => {
      // A save queued from the last keystroke would otherwise land after the
      // send cleared the draft and restore text that has already been posted.
      vi.useFakeTimers();
      const { result } = renderHook(() => useChannelDraft("chan-1"));
      act(() => result.current.setDraft("about to send"));

      act(() => result.current.cancelPendingSave());
      act(() => void vi.advanceTimersByTime(400));

      expect(saveDraft).not.toHaveBeenCalled();
    });

    it("empties the draft and the table once a send commits", async () => {
      const { result } = renderHook(() => useChannelDraft("chan-1"));
      act(() => result.current.setDraft("sent"));

      await act(async () => {
        await result.current.clearAfterSend();
      });

      expect(result.current.draft).toBe("");
      expect(clearDraft).toHaveBeenCalledWith("chan-1");
    });

    it("does not reject a send that already posted when the table throws (#1718)", async () => {
      clearDraft.mockRejectedValueOnce(new Error("quota"));
      const { result } = renderHook(() => useChannelDraft("chan-1"));

      await act(async () => {
        await expect(result.current.clearAfterSend()).resolves.toBeUndefined();
      });

      expect(result.current.draft).toBe("");
    });

    it("degrades to an empty draft when the table cannot be read", async () => {
      // IndexedDB throws in private mode and under quota pressure. A composer
      // that cannot open is worse than one that opens empty.
      vi.spyOn(console, "warn").mockImplementation(() => {});
      loadDraft.mockRejectedValue(new Error("blocked"));
      const { result } = renderHook(() => useChannelDraft("chan-1"));

      await waitFor(() => expect(console.warn).toHaveBeenCalled());
      expect(result.current.draft).toBe("");
    });
  });
});
