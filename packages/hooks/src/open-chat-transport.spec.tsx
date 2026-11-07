import { act, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RealtimeTransportStatus } from "@repo/validation";
import {
  resetOpenChatTransportForTests,
  useOpenChatTransport,
  useReportOpenChatTransport,
} from "./open-chat-transport";

function Reporter({ status }: { status: RealtimeTransportStatus | null }) {
  useReportOpenChatTransport(status);
  return null;
}

afterEach(() => {
  act(() => resetOpenChatTransportForTests());
});

describe("open chat transport", () => {
  it("is null with no chat open", () => {
    const { result } = renderHook(() => useOpenChatTransport());
    expect(result.current).toBeNull();
  });

  it("follows the open chat's status and clears when it unmounts", () => {
    const { result } = renderHook(() => useOpenChatTransport());
    const chat = render(<Reporter status="reconnecting" />);
    expect(result.current).toBe("reconnecting");

    chat.rerender(<Reporter status="polling" />);
    expect(result.current).toBe("polling");

    chat.unmount();
    expect(result.current).toBeNull();
  });
});
