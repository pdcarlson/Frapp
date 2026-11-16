import { describe, it, expect } from "vitest";
import { channelAccessOptionsState } from "./channel-access-field";

/**
 * The one reading of the options read that the channel page and the create
 * sheet both pass to `ChannelAccessField`.
 */
describe("channelAccessOptionsState", () => {
  const base = { isError: false, isPending: false, fetchStatus: "idle" };

  it("is ready once the options are cached, whatever the fetch is doing", () => {
    expect(channelAccessOptionsState({ ...base, data: [] })).toBe("ready");
    expect(
      channelAccessOptionsState({
        ...base,
        data: [],
        isError: true,
        fetchStatus: "paused",
      }),
    ).toBe("ready");
  });

  it("is loading while an uncached read is in flight", () => {
    expect(
      channelAccessOptionsState({
        ...base,
        data: undefined,
        isPending: true,
        fetchStatus: "fetching",
      }),
    ).toBe("loading");
  });

  it("is error when an uncached read failed", () => {
    expect(
      channelAccessOptionsState({ ...base, data: undefined, isError: true }),
    ).toBe("error");
  });

  it("is error, not loading, when an uncached read paused", () => {
    expect(
      channelAccessOptionsState({
        ...base,
        data: undefined,
        isPending: true,
        fetchStatus: "paused",
      }),
    ).toBe("error");
  });
});
