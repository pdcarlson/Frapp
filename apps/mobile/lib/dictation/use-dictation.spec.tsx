/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DictationHandlers } from "./speech";

const speech = vi.hoisted(() => ({
  available: true,
  granted: true,
  handlers: null as DictationHandlers | null,
  started: 0,
  begin: true,
  finish: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("./speech", () => ({
  isDictationAvailable: () => speech.available,
  requestDictationPermission: async () => speech.granted,
  startDictation: (handlers: DictationHandlers) => {
    speech.handlers = handlers;
    speech.started += 1;
    if (!speech.begin) {
      handlers.onFailure("unavailable");
      return null;
    }
    return { finish: speech.finish, cancel: speech.cancel };
  },
}));

vi.mock("../haptics", () => ({ selectionHaptic: vi.fn() }));

import {
  DICTATION_LEVEL_SAMPLES,
  DICTATION_MAX_SECONDS,
  fit,
  useDictation,
  type UseDictationOptions,
} from "./use-dictation";

function setup(
  clean = vi.fn<UseDictationOptions["clean"]>(
    async (text: string) => `Tidy: ${text}`,
  ),
  room = 1000,
) {
  const onText = vi.fn();
  let renders = 0;
  const view = renderHook(() => {
    renders += 1;
    return useDictation({ clean, onText, room });
  });
  return { ...view, clean, onText, renders: () => renders };
}

async function listen(view: ReturnType<typeof setup>) {
  act(() => view.result.current.start());
  await waitFor(() => expect(view.result.current.phase).toBe("listening"));
}

beforeEach(() => {
  speech.available = true;
  speech.granted = true;
  speech.handlers = null;
  speech.started = 0;
  speech.begin = true;
  speech.finish.mockReset();
  speech.cancel.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDictation", () => {
  it("is unavailable where the phone has no recogniser, and then never starts", () => {
    speech.available = false;
    const view = setup();
    expect(view.result.current.available).toBe(false);
    act(() => view.result.current.start());
    expect(speech.started).toBe(0);
  });

  it("shows words and level while listening, then hands the tidied words to the field", async () => {
    const view = setup();
    await listen(view);

    act(() => {
      speech.handlers!.onWords("so um the bid dinner");
      speech.handlers!.onLevel(0.4);
      speech.handlers!.onLevel(0.9);
    });
    expect(view.result.current.live.get().words).toBe("so um the bid dinner");
    expect(view.result.current.live.get().levels).toEqual([0.4, 0.9]);

    act(() => view.result.current.finish());
    expect(speech.finish).toHaveBeenCalled();

    act(() => speech.handlers!.onEnd("so um the bid dinner moved"));
    expect(view.result.current.phase).toBe("cleaning");
    await waitFor(() => expect(view.result.current.phase).toBe("idle"));
    expect(view.clean).toHaveBeenCalledWith(
      "so um the bid dinner moved",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(view.onText).toHaveBeenCalledWith(
      "Tidy: so um the bid dinner moved",
      "so um the bid dinner moved",
    );
    expect(view.result.current.live.get().words).toBe("");
  });

  it("keeps the words as heard when the cleanup gives nothing back or throws", async () => {
    for (const clean of [
      vi.fn<UseDictationOptions["clean"]>(async () => null),
      vi.fn<UseDictationOptions["clean"]>(async () => {
        throw new Error("offline");
      }),
    ]) {
      const view = setup(clean);
      await listen(view);
      act(() => speech.handlers!.onEnd(" move it to Friday "));
      await waitFor(() => expect(view.onText).toHaveBeenCalled());
      expect(view.onText).toHaveBeenCalledWith(
        "move it to Friday",
        "move it to Friday",
      );
      view.unmount();
    }
  });

  it("keeps only the newest level samples", async () => {
    const view = setup();
    await listen(view);
    act(() => {
      for (let i = 0; i < DICTATION_LEVEL_SAMPLES + 5; i += 1) {
        speech.handlers!.onLevel(i / 100);
      }
    });
    expect(view.result.current.live.get().levels).toHaveLength(DICTATION_LEVEL_SAMPLES);
    expect(view.result.current.live.get().levels.at(-1)).toBe(
      (DICTATION_LEVEL_SAMPLES + 4) / 100,
    );
  });

  it("says nothing was heard when the session ends empty", async () => {
    const view = setup();
    await listen(view);
    act(() => speech.handlers!.onEnd("  "));
    expect(view.result.current.phase).toBe("idle");
    expect(view.result.current.notice).toBe("no-speech");
    expect(view.clean).not.toHaveBeenCalled();
  });

  it("reports a refused permission without starting", async () => {
    speech.granted = false;
    const view = setup();
    act(() => view.result.current.start());
    await waitFor(() => expect(view.result.current.notice).toBe("denied"));
    expect(speech.started).toBe(0);
    act(() => view.result.current.dismiss());
    expect(view.result.current.notice).toBeNull();
  });

  it("reports a recogniser that won't start", async () => {
    speech.begin = false;
    const view = setup();
    act(() => view.result.current.start());
    await waitFor(() =>
      expect(view.result.current.notice).toBe("unavailable"),
    );
    expect(view.result.current.phase).toBe("idle");
  });

  it("drops everything on cancel, including a cleanup still running", async () => {
    let signal: AbortSignal | undefined;
    const clean = vi.fn<UseDictationOptions["clean"]>(
      (_text: string, options: { signal: AbortSignal }) =>
        new Promise<string | null>((resolve) => {
          signal = options.signal;
          setTimeout(() => resolve("too late"), 10);
        }),
    );
    const view = setup(clean);
    await listen(view);
    act(() => speech.handlers!.onEnd("never mind"));
    act(() => view.result.current.cancel());
    expect(signal?.aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(view.onText).not.toHaveBeenCalled();
    expect(view.result.current.phase).toBe("idle");
  });

  it("cancels the recogniser when the screen goes away", async () => {
    const view = setup();
    await listen(view);
    view.unmount();
    expect(speech.cancel).toHaveBeenCalled();
  });

  it("stops itself after the longest dictation", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const view = setup();
    await listen(view);
    act(() => {
      vi.advanceTimersByTime(DICTATION_MAX_SECONDS * 1000);
    });
    expect(view.result.current.live.get().seconds).toBe(DICTATION_MAX_SECONDS);
    expect(speech.finish).toHaveBeenCalled();
  });

  it("keeps level samples out of the host's renders", async () => {
    const view = setup();
    await listen(view);
    const before = view.renders();
    act(() => {
      for (let i = 0; i < 20; i += 1) speech.handlers!.onLevel(0.5);
      speech.handlers!.onWords("so the bid dinner");
    });
    expect(view.renders()).toBe(before);
  });

  it("stops listening once the words fill the field's room", async () => {
    const view = setup(undefined, 20);
    await listen(view);
    act(() => speech.handlers!.onWords("short"));
    expect(speech.finish).not.toHaveBeenCalled();
    act(() => speech.handlers!.onWords("this is now longer than twenty"));
    expect(speech.finish).toHaveBeenCalled();
  });

  it("cuts words past the room at a word boundary and says so", async () => {
    const view = setup(
      vi.fn<UseDictationOptions["clean"]>(async (text) => text),
      20,
    );
    await listen(view);
    act(() => speech.handlers!.onEnd("remind the rush chairs about formal"));
    await waitFor(() => expect(view.onText).toHaveBeenCalled());
    expect(view.clean).toHaveBeenCalledWith(
      "remind the rush",
      expect.anything(),
    );
    expect(view.onText).toHaveBeenCalledWith(
      "remind the rush",
      "remind the rush",
    );
    expect(view.result.current.notice).toBe("full");
  });

  it("keeps the words as heard when the tidied ones would overflow the room", async () => {
    const view = setup(
      vi.fn<UseDictationOptions["clean"]>(async () => "a much longer tidy text"),
      12,
    );
    await listen(view);
    act(() => speech.handlers!.onEnd("short words"));
    await waitFor(() => expect(view.onText).toHaveBeenCalled());
    expect(view.onText).toHaveBeenCalledWith("short words", "short words");
  });

  it("clears its notice on cancel, so a closed sheet reopens clean", async () => {
    const view = setup();
    await listen(view);
    act(() => speech.handlers!.onEnd(""));
    expect(view.result.current.notice).toBe("no-speech");
    act(() => view.result.current.cancel());
    expect(view.result.current.notice).toBeNull();
  });
});

describe("fit", () => {
  it("leaves words that fit alone, and cuts the rest at a word", () => {
    expect(fit(" hello there ", 20)).toEqual({
      text: "hello there",
      clipped: false,
    });
    expect(fit("hello there friend", 13)).toEqual({
      text: "hello there",
      clipped: true,
    });
    expect(fit("supercalifragilistic", 5)).toEqual({
      text: "super",
      clipped: true,
    });
    expect(fit("anything", 0)).toEqual({ text: "", clipped: true });
  });
});
