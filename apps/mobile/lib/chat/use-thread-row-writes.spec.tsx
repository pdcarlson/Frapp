/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useThreadRowWrites } from "./use-thread-row-writes";

type ErrorInput = { title: string; description?: string };
type Ctx = { onError: (input: ErrorInput) => void };

const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
/** What the next dispatch does: resolve, report through `onError`, or reject. */
let outcome: "ok" | "report" | "reject" = "ok";
/** Holds the next dispatch open until the test reports its failure. */
let deferNext: ((report: () => void) => void) | null = null;
function dispatcher(fn: string) {
  return async (ctx: Ctx, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (deferNext) {
      const hold = deferNext;
      deferNext = null;
      await new Promise<void>((resolve) =>
        hold(() => {
          ctx.onError({ title: "Couldn't react", description: "Too slow" });
          resolve();
        }),
      );
      return;
    }
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
  closeCard: dispatcher("closeCard"),
}));
vi.mock("./use-chat-channel", async () => {
  const { MemberFacingError } = await import("@repo/hooks/error-copy");
  return {
    closeCardFailure: (kind: string) => `Couldn't close ${kind}`,
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
// The context without the outbox flush: the channel under the thread owns it.
vi.mock("./use-chat-runtime", () => ({
  useChatActionContext: () => ({ ctx: { queryClient: {}, apiClient: {} } }),
  useChatRuntime: () => {
    throw new Error("the thread must not run a second outbox flush");
  },
}));

const CHANNEL = "chan-1";
const ROOT = "root-1";

function setup(parentHeld: boolean) {
  const refreshRoot = vi.fn();
  const hook = renderHook(() =>
    useThreadRowWrites({
      channelId: CHANNEL,
      rootId: ROOT,
      parentHeld,
      refreshRoot,
    }),
  );
  return { hook, refreshRoot };
}

beforeEach(() => {
  calls.length = 0;
  outcome = "ok";
  deferNext = null;
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
      await hook.result.current.closeCard(ROOT, "signup");
      await hook.result.current.closeCard("r1", "form");
    });
    expect(calls.map(({ fn, args }) => [fn, args.threadRootId])).toEqual([
      ["react", ROOT],
      ["unreact", null],
      ["act", ROOT],
      ["edit", ROOT],
      ["delete", null],
      ["closePoll", ROOT],
      ["closeCard", null],
      ["closeCard", ROOT],
    ]);
    expect(
      calls.filter(({ fn }) => fn === "closeCard").map(({ args }) => args.kind),
    ).toEqual(["signup", "form"]);
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

  it("keeps a refused reaction and a refused vote apart, as the channel's sinks do", async () => {
    const { hook } = setup(true);
    outcome = "report";
    await act(async () => {
      await hook.result.current.act("r1", "poll_vote", { option: 0 });
    });
    expect(hook.result.current.actionError).toBe("Poll is closed");
    expect(hook.result.current.reactionError).toBeNull();
    // A reaction that lands doesn't wipe the vote's reason.
    outcome = "ok";
    await act(async () => {
      await hook.result.current.react("r1", "👍");
    });
    expect(hook.result.current.actionError).toBe("Poll is closed");
    act(() => hook.result.current.clearActionError());
    expect(hook.result.current.actionError).toBeNull();
  });

  it("drops a slow refusal that a later reaction superseded", async () => {
    const { hook } = setup(true);
    let reportLate!: () => void;
    deferNext = (report) => {
      reportLate = report;
    };
    let slow!: Promise<void>;
    act(() => {
      slow = hook.result.current.react("r1", "👍");
    });
    await act(async () => {
      await hook.result.current.react("r2", "🔥");
    });
    await act(async () => {
      reportLate();
      await slow;
    });
    expect(hook.result.current.reactionError).toBeNull();
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
