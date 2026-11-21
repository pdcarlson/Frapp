/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useReadReceiptsSetting } from "./read-receipts";
import { CHANNEL_LATEST_MESSAGES_KEY } from "./use-chat";
import { userSettingsKey } from "./use-notifications";
import { createHookWrapper, createTestQueryClient } from "./test-utils";

const SETTINGS = {
  quiet_hours_start: null,
  quiet_hours_end: null,
  quiet_hours_tz: null,
  theme: "system",
  status: "online",
  status_expires_at: null,
  custom_status: null,
  custom_status_expires_at: null,
  read_receipts: true,
};

function setup(client: Record<string, unknown>) {
  const queryClient = createTestQueryClient();
  const wrapper = createHookWrapper({
    client,
    queryClient,
    chapterId: "chapter-1",
    displayName: "ReadReceiptsHookWrapper",
  });
  return {
    queryClient,
    ...renderHook(() => useReadReceiptsSetting(), { wrapper }),
  };
}

/** The Read receipts switch (#5519). */
describe("useReadReceiptsSetting", () => {
  it("is on, and not ready, until settings answer, then reads the member's choice", async () => {
    let answer!: (value: unknown) => void;
    const get = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    const { result } = setup({ GET: get });
    expect(result.current.enabled).toBe(true);
    expect(result.current.ready).toBe(false);

    act(() =>
      answer({ data: { ...SETTINGS, read_receipts: false }, error: undefined }),
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.enabled).toBe(false);
  });

  it("saves the switch, shows it at once, and re-reads the Messages previews", async () => {
    // A server that keeps what it was sent, so the re-read after the save
    // answers with it.
    let stored = SETTINGS;
    const get = vi.fn(async () => ({ data: stored, error: undefined }));
    const patch = vi.fn(async (_path: string, { body }: { body: object }) => {
      stored = { ...stored, ...body };
      return { data: stored, error: undefined };
    });
    const { result, queryClient } = setup({ GET: get, PATCH: patch });
    await waitFor(() => expect(result.current.ready).toBe(true));
    queryClient.setQueryData(CHANNEL_LATEST_MESSAGES_KEY, []);

    act(() => result.current.setEnabled(false));

    // Optimistic: the switch moves with the write (`useUpdateUserSettings`).
    await waitFor(() =>
      expect(
        (queryClient.getQueryData(userSettingsKey) as typeof SETTINGS)
          .read_receipts,
      ).toBe(false),
    );
    await waitFor(() =>
      expect(
        queryClient.getQueryState(CHANNEL_LATEST_MESSAGES_KEY)?.isInvalidated,
      ).toBe(true),
    );
    expect(patch).toHaveBeenCalledWith("/v1/settings", {
      body: { read_receipts: false },
    });
  });

  // A member often leaves Settings before the save answers: the previews are
  // still re-read once it lands (a per-call onSettled would be skipped).
  it("re-reads the previews even when the screen that saved has gone", async () => {
    let answer!: (value: unknown) => void;
    const get = vi.fn().mockResolvedValue({ data: SETTINGS, error: undefined });
    const patch = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    const { result, queryClient, unmount } = setup({ GET: get, PATCH: patch });
    await waitFor(() => expect(result.current.ready).toBe(true));
    queryClient.setQueryData(CHANNEL_LATEST_MESSAGES_KEY, []);

    act(() => result.current.setEnabled(false));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    unmount();
    await act(async () => {
      answer({ data: { ...SETTINGS, read_receipts: false }, error: undefined });
    });

    await waitFor(() =>
      expect(
        queryClient.getQueryState(CHANNEL_LATEST_MESSAGES_KEY)?.isInvalidated,
      ).toBe(true),
    );
  });

  it("reports a failed save", async () => {
    const get = vi.fn().mockResolvedValue({ data: SETTINGS, error: undefined });
    const patch = vi
      .fn()
      .mockResolvedValue({ data: undefined, error: new Error("down") });
    const { result } = setup({ GET: get, PATCH: patch });
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.setEnabled(false));
    await waitFor(() => expect(result.current.failed).toBe(true));
    // Rolled back to what the server last said.
    expect(result.current.enabled).toBe(true);
  });
});
