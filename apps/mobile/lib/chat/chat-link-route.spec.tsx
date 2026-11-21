/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create } from "react-test-renderer";
import * as expoRouter from "expo-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChatLinkRoute from "../../app/(app)/chat";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const router = vi.mocked(expoRouter.useRouter)();

function open(params: Record<string, string>) {
  vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue(params);
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<ChatLinkRoute />);
  });
  act(() => tree.unmount());
}

beforeEach(() => {
  vi.mocked(router.replace).mockClear();
  vi.mocked(router.dismissTo).mockClear();
});

// A message's link opening the app (#3723): `/chat?channel=…&message=…`.
describe("the /chat link route", () => {
  it("opens the channel on the message, in place of itself", () => {
    open({ channel: "c1", message: "m1" });
    expect(router.replace).toHaveBeenCalledWith({
      pathname: "/chat-thread",
      params: { channelId: "c1", focusMessageId: "m1" },
    });
  });

  it("opens a channel link on the channel", () => {
    open({ channel: "c1" });
    expect(router.replace).toHaveBeenCalledWith({
      pathname: "/chat-thread",
      params: { channelId: "c1" },
    });
  });

  it("goes to Chat home for a link that names nothing", () => {
    open({});
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.dismissTo).toHaveBeenCalledWith("/");
  });
});
