/** @vitest-environment jsdom */
import { QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  useAgendaSuggestionActions,
  useAgendaSuggestions,
} from "./use-agenda-suggestions";
import { createHookWrapper } from "./test-utils";

/**
 * Suggested agenda items (#5534): the model's are asked for once, when it
 * never wrote any for the event; Add sends waiting agenda edits first and
 * puts the saved agenda into the event's read.
 */

const CHAPTER = "ch-1";
const ROW = {
  id: "s1",
  kind: "tabled",
  text: "Formal budget",
  tabled_from: {
    meeting_id: "m1",
    start_time: "2026-11-11T23:00:00.000Z",
    times: 1,
  },
  source_meeting_id: "m1",
  reason: null,
};

function wrapper(
  client: Record<string, unknown>,
  queryClient = new QueryClient(),
) {
  return {
    queryClient,
    Wrapper: createHookWrapper({ client, queryClient, chapterId: CHAPTER }),
  };
}

describe("useAgendaSuggestions (#5534)", () => {
  it("asks the model once when it never wrote this event's suggestions", async () => {
    const GET = vi.fn().mockResolvedValue({
      data: { suggestions: [ROW], generated_at: null, ai_available: true },
    });
    const POST = vi.fn().mockResolvedValue({
      data: {
        suggestions: [ROW, { ...ROW, id: "s2", kind: "ai", text: "Dues" }],
        generated_at: "2026-11-18T20:00:00.000Z",
        ai_available: true,
      },
    });
    const { Wrapper } = wrapper({ GET, POST });
    const { result } = renderHook(() => useAgendaSuggestions("evt-1"), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.suggestions).toHaveLength(2));
    expect(POST).toHaveBeenCalledTimes(1);
    expect(POST.mock.calls[0][0]).toBe(
      "/v1/events/{id}/agenda-suggestions/refresh",
    );
  });

  it("asks nothing of the model without AI, and lists the tabled ones", async () => {
    const GET = vi.fn().mockResolvedValue({
      data: { suggestions: [ROW], generated_at: null, ai_available: false },
    });
    const POST = vi.fn();
    const { Wrapper } = wrapper({ GET, POST });
    const { result } = renderHook(() => useAgendaSuggestions("evt-1"), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.suggestions).toHaveLength(1));
    expect(POST).not.toHaveBeenCalled();
  });
});

describe("useAgendaSuggestionActions (#5534)", () => {
  it("sends waiting agenda edits first, then puts the saved agenda in the event's read", async () => {
    const order: string[] = [];
    const agenda = [{ id: "s-s1", text: "Formal budget", done: false }];
    const POST = vi.fn(async () => {
      order.push("add");
      return { data: { agenda } };
    });
    const flushAgenda = vi.fn(async () => {
      order.push("flush");
    });
    const { Wrapper, queryClient } = wrapper({ POST, GET: vi.fn() });
    queryClient.setQueryData(["events", CHAPTER, "evt-1"], {
      id: "evt-1",
      agenda: [],
    });
    queryClient.setQueryData(["agenda-suggestions", CHAPTER, "evt-1"], {
      suggestions: [ROW],
      generated_at: null,
      ai_available: false,
    });
    const { result } = renderHook(
      () => useAgendaSuggestionActions("evt-1", { flushAgenda }),
      { wrapper: Wrapper },
    );
    await act(() => result.current.add("s1"));
    expect(order).toEqual(["flush", "add"]);
    expect(
      queryClient.getQueryData<{ agenda: unknown[] }>([
        "events",
        CHAPTER,
        "evt-1",
      ])?.agenda,
    ).toEqual(agenda);
    expect(
      queryClient.getQueryData<{ suggestions: unknown[] }>([
        "agenda-suggestions",
        CHAPTER,
        "evt-1",
      ])?.suggestions,
    ).toEqual([]);
  });
});
