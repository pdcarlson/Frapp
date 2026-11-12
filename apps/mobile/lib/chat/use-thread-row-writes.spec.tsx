/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useThreadRowWrites } from "./use-thread-row-writes";

type ErrorInput = { title: string; description?: string };
type Ctx = { onError: (input: ErrorInput) => void };

const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
/** What the next dispatch does: resolve, report through `onError`, or reject. */
let outcome: "ok" | "report" | "reject" = "ok";
function dispatcher(fn: string) {
  return async (ctx: Ctx, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (outcome === "report") {
      ctx.onError({ title: "Couldn't react", description: "Poll is closed" });
    }
    if (outcome === "reject") {
      ctx.onError({ title: "Couldn't edit", description: "Too late to edit" });
      throw new Error("refused");
    }
  };
}
vi.mock("@repo/chat-core/chat-client", () => ({
  react: dispatcher("react"),
  unreact: dispatcher("unreact"),
  actOnCard: dispatcher("act"),
  editMessage: dispatcher("edit"),
  deleteMessage: dispatcher("delete"),
  closePoll: dispatcher("closePoll"),
}));
vi.mock("./use-chat-channel", async () => {
  const { MemberFacingError } = await import("@repo/hooks/error-copy");
  return {
    // The channel hook's own wording helper, as it is.
    withFailureMessage: async (
      run: (onError: (input: ErrorInput) => void) => Promise<void>,
      fallback: string,
    ) => {
      let described: string | null = null;
      try {
        await run((input) => {
          described = input.description ?? input.title;
        });
      } catch {
        throw new MemberFacingError(described ?? fallback);
      }
    },
  };
});
vi.mock("./use-chat-runtime", () => ({
  useChatRuntime: () => ({ ctx: { queryClient: {}, apiClient: {} } }),
}));

const CHANNEL = "chan-1";
const ROOT = "root-1";

function setup(parentHeld: boolean) {
  const refreshRoot = vi.fn();
  const hook = renderHook(() =>
    useThreadRowWrites({ channelId: CHANNEL, rootId: ROOT, parentHeld, refreshRoot }),
  );
  return { hook, refreshRoot };
}

beforeEach(() => {
  calls.length = 0;
  outcome = "ok";
});

/** The open thread's writes on the phone (#4297, slice 5), web's #4034 rule. */
describe("useThreadRowWrites", () => {
  it("sends a reply's writes to the thread's cache and the parent's to the channel's", async () => {
    const { hook } = setup(true);
    await act(async () => {
      await hook.result.current.react("r1", "👍");
      await hook.result.current.unreact(ROOT, "👍");
      await hook.result.current.act("r1", "poll_vote", { option: 1 });
      await hook.result.current.edit("r1", "fixed");
      await hook.result.current.remove(ROOT);
      await hook.result.current.closePoll("r1");
    });
    expect(calls.map(({ fn, args }) => [fn, args.threadRootId])).toEqual([
      ["react", ROOT],
      ["unreact", null],
      ["act", ROOT],
      ["edit", ROOT],
      ["delete", null],
      ["closePoll", ROOT],
    ]);
    expect(calls.every(({ args }) => args.channelId === CHANNEL)).toBe(true);
  });

  it("reads the parent again after a write to it the channel's cache doesn't hold", async () => {
    const { hook, refreshRoot } = setup(false);
    await act(async () => {
      await hook.result.current.react("r1", "👍");
    });
    expect(refreshRoot).not.toHaveBeenCalled();
    await act(async () => {
      await hook.result.current.react(ROOT, "👍");
    });
    expect(refreshRoot).toHaveBeenCalledTimes(1);
    // A failed write too: the read is cheap, and says what the server kept.
    outcome = "reject";
    await act(async () => {
      await expect(hook.result.current.edit(ROOT, "x")).rejects.toThrow();
    });
    expect(refreshRoot).toHaveBeenCalledTimes(2);
  });

  it("never re-reads a parent the channel holds: its realtime keeps it current", async () => {
    const { hook, refreshRoot } = setup(true);
    await act(async () => {
      await hook.result.current.react(ROOT, "👍");
    });
    expect(refreshRoot).not.toHaveBeenCalled();
  });

  it("holds a refused reaction or vote for the screen to say, and clears it on the next", async () => {
    const { hook } = setup(true);
    outcome = "report";
    await act(async () => {
      await hook.result.current.act("r1", "poll_vote", { option: 0 });
    });
    expect(hook.result.current.rowError).toBe("Poll is closed");
    outcome = "ok";
    await act(async () => {
      await hook.result.current.react("r1", "👍");
    });
    expect(hook.result.current.rowError).toBeNull();
  });

  it("rejects a refused edit with the member-facing reason, so the edit keeps its text", async () => {
    const { hook } = setup(true);
    outcome = "reject";
    await act(async () => {
      await expect(hook.result.current.edit("r1", "late")).rejects.toThrow(
        "Too late to edit",
      );
    });
  });
});
