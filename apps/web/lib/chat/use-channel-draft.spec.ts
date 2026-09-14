/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatDraftScope } from "./chat-scope";

/**
 * Whose drafts these are (#2226). Every Dexie call this hook makes now leads
 * with a scope, and the assertions below check it is passed through rather than
 * dropped — a draft written without one, or under the wrong one, is the
 * cross-account read `offline-queue.spec.ts` tests against the real schema.
 */
const SCOPE: ChatDraftScope = { userId: "auth-alice" };

const { clearDraft, loadDraft, saveDraft, scope } = vi.hoisted(() => ({
  clearDraft: vi.fn(async () => undefined),
  loadDraft: vi.fn<
    (scope: { userId: string }, channelId: string) => Promise<string>
  >(async () => ""),  
  saveDraft: vi.fn(async () => undefined),
  scope: vi.fn<() => { userId: string } | null>(() => ({
    userId: "auth-alice",
  })),
}));
vi.mock("./offline-queue", () => ({ clearDraft, loadDraft, saveDraft }));
vi.mock("./chat-scope", () => ({ useChatDraftScope: scope }));

import { useChannelDraft } from "./use-channel-draft";

describe("useChannelDraft", () => {
  beforeEach(() => {
    clearDraft.mockClear();
    saveDraft.mockClear();
    loadDraft.mockReset();
    loadDraft.mockResolvedValue("");
    scope.mockReturnValue(SCOPE);
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
      await waitFor(() => expect(loadDraft).toHaveBeenCalledWith(SCOPE, "chan-1"));
      act(() => result.current.setDraft("for chan-1"));

      loadDraft.mockResolvedValue("saved for chan-2");
      rerender({ id: "chan-2" });

      await waitFor(() => expect(result.current.draft).toBe("saved for chan-2"));
    });
  });

  describe("what the review caught (#2176)", () => {
    it("restores this channel's saved draft when the member comes back to it", async () => {
      /*
        The guard that protects live typing must not outlive the visit. Type in
        A, go to B, come back to A: if the claim is still standing, A's restore
        is skipped and `draftState` is still holding *B's* text — so A's
        composer opens showing B's draft, and pressing Enter posts it into A.
      */
      loadDraft.mockImplementation(async (_scope, id: string) =>
        id === "chan-1" ? "for chan-1" : "for chan-2",
      );
      const { result, rerender } = renderHook(({ id }) => useChannelDraft(id), {
        initialProps: { id: "chan-1" },
      });
      await waitFor(() => expect(result.current.draft).toBe("for chan-1"));
      act(() => result.current.setDraft("typed in chan-1"));

      rerender({ id: "chan-2" });
      await waitFor(() => expect(result.current.draft).toBe("for chan-2"));
      rerender({ id: "chan-1" });

      await waitFor(() => expect(result.current.draft).toBe("for chan-1"));
    });

    it("does not resurrect a draft the member just sent", async () => {
      /*
        `loadDraft` opens IndexedDB, which on a cold load is slow enough that
        the member can type and press Enter before it answers. The send clears
        the draft and the Dexie row; a restore landing afterwards would put the
        sent message back in the composer and persist it again.
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
      act(() => result.current.setDraft("on my way"));
      rerender({ id: "chan-1" });

      await act(async () => {
        result.current.cancelPendingSave();
        await result.current.clearAfterSend();
      });
      await act(async () => {
        resolveLoad("");
      });

      expect(result.current.draft).toBe("");
      expect(saveDraft).not.toHaveBeenCalled();
    });

    it("settles against what the member typed last, not what the shell had", async () => {
      /*
        The handoff is not the end of the typing. The editor mounts as soon as
        the channel lands, and the member keeps going while Dexie is still
        answering — settling against the shell's last keystroke would delete
        everything since and move their caret.
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
      act(() => result.current.setDraft("running"));
      rerender({ id: "chan-1" });
      act(() => result.current.setDraft("running late, start without me"));

      await act(async () => {
        resolveLoad("");
      });

      expect(result.current.draft).toBe("running late, start without me");
    });

    it("keeps a saved draft the shell had no way to show", async () => {
      /*
        The shell cannot display a saved draft — it does not know the channel.
        So a member returning to a half-written message sees an empty-looking
        composer and types into it. Replacing yesterday's paragraph with one
        character, invisibly, is not a trade this can make; both survive.
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
      act(() => result.current.setDraft("x"));
      rerender({ id: "chan-1" });

      await act(async () => {
        resolveLoad("yesterday's paragraph");
      });

      expect(result.current.draft).toBe("yesterday's paragraph\nx");
    });

    it("keeps that saved draft even when the member types on after the handoff", async () => {
      /*
        The case the other two miss between them, and the one a bad fix passes.

        "keeps a saved draft the shell had no way to show" never types after the
        handoff, and "settles against what the member typed last" resolves with
        an empty body — so a restore that is silently dropped is indistinguishable
        from one that succeeded. Only typing *and* a non-empty saved draft
        together can see it. This failed while `cancelPendingSave` bumped the
        restore epoch, because `setDraft` calls it on every keystroke: the first
        character after the handoff cancelled the restore, and the debounced
        write then overwrote yesterday's draft with it.
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
      act(() => result.current.setDraft("hey"));
      rerender({ id: "chan-1" });
      act(() => result.current.setDraft("hey!"));

      await act(async () => {
        resolveLoad("See you at chapter tonight");
      });

      expect(result.current.draft).toBe("See you at chapter tonight\nhey!");
    });

    it("persists the shell's text, so a channel it cannot post to does not eat it", async () => {
      /*
        `setDraft` schedules no write while there is no channel, and a channel
        that comes back `can_post: false` renders no editor to fire another
        keystroke — so without this the text lives only in memory until the next
        channel switch drops it.
      */
      const { result, rerender } = renderHook(({ id }) => useChannelDraft(id), {
        initialProps: { id: null as string | null },
      });
      act(() => result.current.setDraft("does anyone have the recording"));
      rerender({ id: "chan-1" });

      await waitFor(() =>
        expect(saveDraft).toHaveBeenCalledWith(
          SCOPE,
          "chan-1",
          "does anyone have the recording",
        ),
      );
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
      expect(saveDraft).toHaveBeenCalledWith(SCOPE, "chan-1", "hel");
    });

    it("keeps unscoped text with its own channel, not the next one (#2226)", async () => {
      /*
        The regression an earlier revision of #2226 shipped. With a channel
        mounted but no scope yet, `setDraft` armed `typedBeforeChannel` — the
        "belongs to whichever channel we land in" flag — so switching channels
        inside that window handed one channel's sentence to another, merged it
        into that channel's saved draft, and wrote it to disk one Enter away
        from being posted to the wrong place. Same class as #1497.
      */
      scope.mockReturnValue(null);
      loadDraft.mockImplementation(async (_s, id: string) =>
        id === "chan-2" ? "chan-2's own draft" : "",
      );
      const { result, rerender } = renderHook(({ id }) => useChannelDraft(id), {
        initialProps: { id: "chan-1" as string | null },
      });

      act(() => result.current.setDraft("see you at 8"));

      // The scope arrives while the member is now looking at chan-2.
      scope.mockReturnValue(SCOPE);
      rerender({ id: "chan-2" });

      /*
        Wait on the settled state, not on `loadDraft` merely having been called:
        the restore applies a promise later, so asserting straight after the
        call races it. (That chan-1's text is briefly still on screen during the
        switch is #1497, which this hook deliberately leaves alone — the claim
        under test is what reaches disk.)
      */
      await waitFor(() => expect(result.current.draft).toBe("chan-2's own draft"));
      expect(loadDraft).toHaveBeenCalledWith(SCOPE, "chan-2");
      // chan-1's sentence must not have been merged into chan-2's draft.
      expect(saveDraft).not.toHaveBeenCalledWith(
        SCOPE,
        "chan-2",
        expect.stringContaining("see you at 8"),
      );
    });

    it("still clears a draft sent before the scope resolved (#2226)", async () => {
      /*
        Otherwise the row outlives the message that superseded it: the member
        sends, the composer empties, and the next visit to the channel restores
        a draft they already posted.
      */
      scope.mockReturnValue(null);
      const { result, rerender } = renderHook(() => useChannelDraft("chan-1"));

      await act(async () => {
        await result.current.clearAfterSend();
      });
      expect(clearDraft).not.toHaveBeenCalled();

      scope.mockReturnValue(SCOPE);
      rerender();

      await waitFor(() =>
        expect(clearDraft).toHaveBeenCalledWith(SCOPE, "chan-1"),
      );
    });

    it("saves nothing until the member's scope has resolved (#2226)", () => {
      /*
        A draft row's key is `[userId+channelId]`, so before the session
        resolves there is no key to write one under. The keystrokes stay in
        memory — the composer is still usable — and nothing reaches disk
        unattributed.
      */
      vi.useFakeTimers();
      scope.mockReturnValue(null);
      const { result } = renderHook(() => useChannelDraft("chan-1"));

      act(() => result.current.setDraft("typed before the session resolved"));
      act(() => void vi.advanceTimersByTime(400));

      expect(saveDraft).not.toHaveBeenCalled();
      expect(loadDraft).not.toHaveBeenCalled();
      // Still on screen: masking the write must not mask the text.
      expect(result.current.draft).toBe("typed before the session resolved");
    });

    it("restores the saved draft once the scope arrives", async () => {
      scope.mockReturnValue(null);
      loadDraft.mockResolvedValue("saved earlier");
      const { result, rerender } = renderHook(() => useChannelDraft("chan-1"));
      expect(loadDraft).not.toHaveBeenCalled();

      scope.mockReturnValue(SCOPE);
      rerender();

      await waitFor(() => expect(result.current.draft).toBe("saved earlier"));
      expect(loadDraft).toHaveBeenCalledWith(SCOPE, "chan-1");
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
      expect(clearDraft).toHaveBeenCalledWith(SCOPE, "chan-1");
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
