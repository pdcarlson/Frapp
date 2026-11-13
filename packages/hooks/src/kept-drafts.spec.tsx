// @vitest-environment jsdom
import React from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createFrappClient } from "@repo/api-sdk";
import { FrappClientProvider } from "./use-frapp-client";
import {
  dropAllKeptDrafts,
  hasKeptDraft,
  readKeptDraft,
  readKeptPanel,
  useKeptDraftKeys,
  useKeptFormDraft,
  useKeptPanel,
  writeKeptDraft,
  writeKeptPanel,
} from "./kept-drafts";

const client = createFrappClient({ baseUrl: "http://localhost" });

function inChapter(chapterId: string, userId = "user-1") {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <FrappClientProvider
        client={client}
        chapterId={chapterId}
        userId={userId}
      >
        {children}
      </FrappClientProvider>
    );
  };
}

afterEach(() => dropAllKeptDrafts());

describe("kept drafts (#4593)", () => {
  it("keeps a chapter's draft out of another chapter's form", () => {
    const a = renderHook(() => useKeptDraftKeys(), {
      wrapper: inChapter("chapter-a"),
    }).result.current;
    const b = renderHook(() => useKeptDraftKeys(), {
      wrapper: inChapter("chapter-b"),
    }).result.current;
    const otherUser = renderHook(() => useKeptDraftKeys(), {
      wrapper: inChapter("chapter-a", "user-2"),
    }).result.current;
    writeKeptDraft(a.draft("event-create"), { name: "Rush" });
    expect(hasKeptDraft(a.draft("event-create"))).toBe(true);
    expect(hasKeptDraft(b.draft("event-create"))).toBe(false);
    // Nor out of the same chapter for another account on the same tab.
    expect(hasKeptDraft(otherUser.draft("event-create"))).toBe(false);
  });

  it("holds a draft out of the store while a save runs, and puts it back if it fails", () => {
    const wrapper = inChapter("chapter-a");
    const key = renderHook(() => useKeptDraftKeys(), { wrapper }).result
      .current.draft("note");
    const form = renderHook(
      ({ value }: { value: { text: string } }) =>
        useKeptFormDraft("note", true, value),
      { wrapper, initialProps: { value: { text: "" } } },
    );
    act(() => {
      form.result.current.take();
    });
    form.rerender({ value: { text: "" } });
    form.rerender({ value: { text: "Hi" } });
    act(() => form.result.current.hold());
    expect(hasKeptDraft(key)).toBe(false);
    act(() => form.result.current.release());
    expect(readKeptDraft(key)).toEqual({ text: "Hi" });
  });

  it("keeps an edited form, and nothing for one left as it opened", () => {
    const wrapper = inChapter("chapter-a");
    const key = renderHook(() => useKeptDraftKeys(), { wrapper }).result
      .current.draft("note");
    const form = renderHook(
      ({ value }: { value: { text: string } }) => {
        const kept = useKeptFormDraft("note", true, value);
        return kept;
      },
      { wrapper, initialProps: { value: { text: "" } } },
    );
    act(() => {
      form.result.current.take();
    });
    form.rerender({ value: { text: "" } });
    expect(hasKeptDraft(key)).toBe(false);
    form.rerender({ value: { text: "Hi" } });
    expect(readKeptDraft(key)).toEqual({ text: "Hi" });
    // Back to how it opened: nothing worth keeping.
    form.rerender({ value: { text: "" } });
    expect(hasKeptDraft(key)).toBe(false);
  });

  it("drops everything on sign-out or a chapter switch", () => {
    writeKeptDraft("k", { a: 1 });
    writeKeptPanel("p", true);
    dropAllKeptDrafts();
    expect(hasKeptDraft("k")).toBe(false);
    expect(readKeptPanel("p")).toBeUndefined();
  });

  it("reopens a page's panel only while its form holds a draft, and when ready", () => {
    const wrapper = inChapter("chapter-a");
    const keys = renderHook(() => useKeptDraftKeys(), { wrapper }).result
      .current;
    const page = (ready: boolean) => {
      let opened = false;
      const view = renderHook(
        ({ ready: isReady }: { ready: boolean }) =>
          useKeptPanel({
            page: "meetings",
            form: "minutes-start",
            open: opened,
            setOpen: (next) => {
              opened = next;
            },
            ready: isReady,
          }),
        { wrapper, initialProps: { ready } },
      );
      return { view, opened: () => opened };
    };

    writeKeptPanel(keys.panel("meetings"), true);
    expect(page(true).opened()).toBe(false);

    writeKeptPanel(keys.panel("meetings"), true);
    writeKeptDraft(keys.draft("minutes-start"), { name: "Exec" });
    const waiting = page(false);
    expect(waiting.opened()).toBe(false);
    // Still marked while it waits.
    expect(readKeptPanel(keys.panel("meetings"))).toBe(true);
    waiting.view.rerender({ ready: true });
    expect(waiting.opened()).toBe(true);
  });
});
