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
  useKeptDraftKeys,
  useKeptFormDraft,
  useKeptPanelOpen,
  writeKeptDraft,
  writeKeptPanel,
} from "./kept-drafts";

const client = createFrappClient({ baseUrl: "http://localhost" });

function inChapter(chapterId: string) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <FrappClientProvider client={client} chapterId={chapterId}>
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
    writeKeptDraft(a.draft("event-create"), { name: "Rush" });
    expect(hasKeptDraft(a.draft("event-create"))).toBe(true);
    expect(hasKeptDraft(b.draft("event-create"))).toBe(false);
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
  });

  it("reopens a page's panel only while its form holds a draft", () => {
    const wrapper = inChapter("chapter-a");
    const keys = renderHook(() => useKeptDraftKeys(), { wrapper }).result
      .current;
    writeKeptPanel(keys.panel("meetings"), true);
    expect(
      renderHook(() => useKeptPanelOpen("meetings", "minutes-start"), {
        wrapper,
      }).result.current[0],
    ).toBe(false);

    writeKeptPanel(keys.panel("meetings"), true);
    writeKeptDraft(keys.draft("minutes-start"), { name: "Exec" });
    const page = renderHook(
      () => useKeptPanelOpen("meetings", "minutes-start"),
      { wrapper },
    );
    expect(page.result.current[0]).toBe(true);
    act(() => page.result.current[1](false));
    page.unmount();
    expect(
      renderHook(() => useKeptPanelOpen("meetings", "minutes-start"), {
        wrapper,
      }).result.current[0],
    ).toBe(false);
  });
});
