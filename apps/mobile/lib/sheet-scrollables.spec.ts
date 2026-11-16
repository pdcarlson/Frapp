import { describe, expect, it, vi } from "vitest";

import { guardScrollHandler } from "./sheet-scrollables";

type Context = Record<string, unknown>;
type Payload = { contentOffset: { y: number } };

describe("guardScrollHandler (FRAPP-MOBILE-10)", () => {
  it("drops the event a handler's own scrollTo delivers while it runs", () => {
    // The library's lock calls scrollTo, and on the new architecture scrollTo
    // delivers its scroll event synchronously, inside the call. Unguarded,
    // that re-enters the handler without end.
    const context: Context = {};
    let guardedOnScroll: (payload: Payload, context: Context) => void = () =>
      undefined;
    const library = vi.fn((_payload: Payload, ctx: Context) => {
      guardedOnScroll({ contentOffset: { y: 0 } }, ctx);
    });
    guardedOnScroll = guardScrollHandler(library as never) as never;

    guardedOnScroll({ contentOffset: { y: 40 } }, context);

    expect(library).toHaveBeenCalledTimes(1);
  });

  it("passes every separate event through, and resets after a throw", () => {
    const context: Context = {};
    const library = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("boom");
      })
      .mockImplementation(() => undefined);
    const guarded = guardScrollHandler(library as never) as unknown as (
      payload: Payload,
      context: Context,
    ) => void;

    expect(() => guarded({ contentOffset: { y: 1 } }, context)).toThrow("boom");
    guarded({ contentOffset: { y: 2 } }, context);
    guarded({ contentOffset: { y: 3 } }, context);

    expect(library).toHaveBeenCalledTimes(3);
    expect(library).toHaveBeenLastCalledWith(
      { contentOffset: { y: 3 } },
      context,
    );
  });

  it("leaves a handler the library does not provide undefined", () => {
    expect(guardScrollHandler(undefined)).toBeUndefined();
  });
});
