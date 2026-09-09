import { describe, expect, it, vi } from "vitest";
import {
  deregisterStoredPushToken,
  registerCurrentPushToken,
  sessionOwnsPushRegistration,
} from "./push-token-lifecycle";
import type { PushTokenRow } from "./push-registration";

function deps(initial: PushTokenRow | null = null) {
  const stored = { current: initial };
  const register = vi.fn(async (body: { token: string }) => ({
    id: `row-${body.token}`,
    token: body.token,
  }));
  const remove = vi.fn<(id: string) => Promise<void>>(async () => undefined);
  const warn = vi.fn();
  return {
    stored,
    register,
    remove,
    warn,
    getToken: vi.fn(async () => "ExponentPushToken[new]"),
    isCancelled: vi.fn(() => false),
    readStored: async () => stored.current,
    writeStored: async (row: PushTokenRow) => {
      stored.current = row;
    },
    clearStored: async () => {
      stored.current = null;
    },
  };
}

describe("sessionOwnsPushRegistration", () => {
  it("is true only on the authenticated edge the sign-out race documents", () => {
    expect(sessionOwnsPushRegistration(true, "authenticated")).toBe(true);
    expect(sessionOwnsPushRegistration(true, "unauthenticated")).toBe(false);
    expect(sessionOwnsPushRegistration(false, "authenticated")).toBe(false);
    expect(sessionOwnsPushRegistration(false, "hydrating")).toBe(false);
    expect(sessionOwnsPushRegistration(false, "unauthenticated")).toBe(false);
  });
});

describe("registerCurrentPushToken", () => {
  it("skips a re-register when the stored row already matches", async () => {
    const d = deps({
      id: "row-ExponentPushToken[new]",
      token: "ExponentPushToken[new]",
    });
    await registerCurrentPushToken(d);
    expect(d.register).not.toHaveBeenCalled();
    expect(d.remove).not.toHaveBeenCalled();
  });

  it("POSTs a first token and does not DELETE", async () => {
    const d = deps(null);
    await registerCurrentPushToken(d);
    expect(d.register).toHaveBeenCalledWith({ token: "ExponentPushToken[new]" });
    expect(d.stored.current).toEqual({
      id: "row-ExponentPushToken[new]",
      token: "ExponentPushToken[new]",
    });
    expect(d.remove).not.toHaveBeenCalled();
  });

  it("POSTs the rotated token then DELETEs the superseded row", async () => {
    const d = deps({ id: "row-old", token: "ExponentPushToken[old]" });
    const order: string[] = [];
    d.register.mockImplementation(async (body) => {
      order.push("post");
      return { id: "row-new", token: body.token };
    });
    d.remove.mockImplementation(async (id) => {
      order.push(`delete:${id}`);
    });

    await registerCurrentPushToken(d);

    expect(d.register).toHaveBeenCalledWith({ token: "ExponentPushToken[new]" });
    expect(d.remove).toHaveBeenCalledWith("row-old");
    expect(d.stored.current).toEqual({
      id: "row-new",
      token: "ExponentPushToken[new]",
    });
    expect(order).toEqual(["post", "delete:row-old"]);
  });

  it("does not POST when cancelled before the token resolves", async () => {
    const d = deps(null);
    d.isCancelled.mockReturnValue(true);
    await registerCurrentPushToken(d);
    expect(d.register).not.toHaveBeenCalled();
  });

  it("does not persist or DELETE when cancelled after POST", async () => {
    const d = deps({ id: "row-old", token: "ExponentPushToken[old]" });
    d.isCancelled
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    await registerCurrentPushToken(d);
    expect(d.register).toHaveBeenCalled();
    expect(d.stored.current).toEqual({
      id: "row-old",
      token: "ExponentPushToken[old]",
    });
    expect(d.remove).not.toHaveBeenCalled();
  });

  it("does not DELETE the new row when POST returns the same id", async () => {
    const d = deps({ id: "row-same", token: "ExponentPushToken[old]" });
    d.register.mockResolvedValue({
      id: "row-same",
      token: "ExponentPushToken[new]",
    });
    await registerCurrentPushToken(d);
    expect(d.remove).not.toHaveBeenCalled();
  });

  it("warns and keeps the old row when POST throws", async () => {
    const d = deps({ id: "row-old", token: "ExponentPushToken[old]" });
    d.register.mockRejectedValue(new Error("network"));
    await registerCurrentPushToken(d);
    expect(d.stored.current).toEqual({
      id: "row-old",
      token: "ExponentPushToken[old]",
    });
    expect(d.remove).not.toHaveBeenCalled();
    expect(d.warn).toHaveBeenCalled();
  });
});

describe("deregisterStoredPushToken", () => {
  it("DELETEs then clears", async () => {
    const d = deps({ id: "row-1", token: "ExponentPushToken[abc]" });
    const order: string[] = [];
    d.remove.mockImplementation(async () => {
      order.push("delete");
    });
    const originalClear = d.clearStored;
    d.clearStored = async () => {
      order.push("clear");
      await originalClear();
    };
    await deregisterStoredPushToken(d);
    expect(order).toEqual(["delete", "clear"]);
    expect(d.stored.current).toBeNull();
  });

  it("clears storage when there is no row id to DELETE", async () => {
    const d = deps({ id: null, token: "ExponentPushToken[abc]" });
    await deregisterStoredPushToken(d);
    expect(d.remove).not.toHaveBeenCalled();
    expect(d.stored.current).toBeNull();
  });

  it("does nothing when cancelled before the stored read settles into a DELETE", async () => {
    const d = deps({ id: "row-1", token: "ExponentPushToken[abc]" });
    d.isCancelled.mockReturnValue(true);
    await deregisterStoredPushToken(d);
    expect(d.remove).not.toHaveBeenCalled();
    expect(d.stored.current).toEqual({
      id: "row-1",
      token: "ExponentPushToken[abc]",
    });
  });
});
