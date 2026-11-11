import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

const putSignedUpload = vi.hoisted(() => vi.fn());
vi.mock("./put-signed-upload", async (importActual) => ({
  ...(await importActual<typeof import("./put-signed-upload")>()),
  putSignedUpload,
}));

import { SignedUploadError } from "./put-signed-upload";
import {
  CHAT_BACKGROUND_FAILURE_COPY,
  canSetChannelBackground,
  chatBackgroundErrorCopy,
  useRequestChatBackgroundPhotoUrl,
  useSetChannelBackground,
  useSetChapterChatBackground,
} from "./use-chat-background";
import { FrappClientProvider } from "./use-frapp-client";

const ok = (data: unknown) => ({
  data,
  error: undefined,
  response: { ok: true, status: 200 },
});

function wrapper(client: unknown) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      client={
        client as ReturnType<typeof import("@repo/api-sdk").createFrappClient>
      }
      chapterId="chapter-1"
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  return Wrapper;
}

/**
 * Chat backgrounds (#3973, #4031): the shared rule for who sees the channel
 * picker, and the two ways a photo reaches a set (bytes on web, an
 * already-uploaded path on mobile).
 */
describe("chat background hooks", () => {
  beforeEach(() => putSignedUpload.mockReset());

  it("offers a channel's background to channels:manage only, never on a DM, the audit log or an archived channel", () => {
    const manage = ["channels:manage"];
    expect(canSetChannelBackground({ type: "PUBLIC" }, manage)).toBe(true);
    expect(canSetChannelBackground({ type: "PUBLIC" }, ["*"])).toBe(true);
    expect(canSetChannelBackground({ type: "PUBLIC" }, [])).toBe(false);
    expect(canSetChannelBackground({ type: "PUBLIC" }, null)).toBe(false);
    expect(canSetChannelBackground({ type: "DM" }, manage)).toBe(false);
    expect(canSetChannelBackground({ type: "GROUP_DM" }, manage)).toBe(false);
    expect(
      canSetChannelBackground({ type: "PUBLIC", is_audit_log: true }, manage),
    ).toBe(false);
    expect(
      canSetChannelBackground(
        { type: "PUBLIC", archived_at: "2026-11-01T00:00:00Z" },
        manage,
      ),
    ).toBe(false);
  });

  it("saves a path the caller already uploaded, minting nothing", async () => {
    const client = {
      POST: vi.fn(),
      PUT: vi.fn().mockResolvedValue(ok({ background: "photo" })),
    };
    const { result } = renderHook(() => useSetChannelBackground(), {
      wrapper: wrapper(client),
    });
    await act(() =>
      result.current.mutateAsync({
        channelId: "c-1",
        background: "photo",
        storagePath: "chapter-1/bg.jpg",
      }),
    );
    expect(client.POST).not.toHaveBeenCalled();
    expect(putSignedUpload).not.toHaveBeenCalled();
    expect(client.PUT).toHaveBeenCalledWith(
      "/v1/chat-backgrounds/channels/{id}",
      {
        params: { path: { id: "c-1" } },
        body: { background: "photo", storage_path: "chapter-1/bg.jpg" },
      },
    );
  });

  it("still uploads the bytes it is handed (web), on the default's own route", async () => {
    const client = {
      POST: vi
        .fn()
        .mockResolvedValue(
          ok({ upload_url: "https://signed", storage_path: "chapter-1/d.jpg" }),
        ),
      PUT: vi.fn().mockResolvedValue(ok({ background: "photo" })),
    };
    const { result } = renderHook(() => useSetChapterChatBackground(), {
      wrapper: wrapper(client),
    });
    const body = new Blob(["x"]);
    await act(() =>
      result.current.mutateAsync({
        background: "photo",
        photo: { body, filename: "d.jpg", contentType: "image/jpeg" },
      }),
    );
    expect(client.POST).toHaveBeenCalledWith(
      "/v1/chat-backgrounds/default/photo-url",
      { body: { filename: "d.jpg", content_type: "image/jpeg" } },
    );
    expect(putSignedUpload).toHaveBeenCalledWith({
      signedUrl: "https://signed",
      body,
      contentType: "image/jpeg",
      describeRejection: expect.any(Function),
    });
    expect(client.PUT).toHaveBeenCalledWith("/v1/chat-backgrounds/default", {
      body: { background: "photo", storage_path: "chapter-1/d.jpg" },
    });
  });

  it("mints a photo URL on the route for its scope", async () => {
    const client = {
      POST: vi
        .fn()
        .mockResolvedValue(ok({ upload_url: "u", storage_path: "p" })),
    };
    const { result } = renderHook(() => useRequestChatBackgroundPhotoUrl(), {
      wrapper: wrapper(client),
    });
    const ticket = await act(() =>
      result.current.mutateAsync({
        scope: "channel",
        filename: "a.png",
        contentType: "image/png",
      }),
    );
    expect(ticket).toEqual({ upload_url: "u", storage_path: "p" });
    expect(client.POST).toHaveBeenCalledWith(
      "/v1/chat-backgrounds/channels/photo-url",
      { body: { filename: "a.png", content_type: "image/png" } },
    );
  });
  // #4262: every failure on the way to a photo background read "Try again in
  // a moment", so nobody could tell which step broke or why.
  describe("says which step failed (#4262)", () => {
    const failed = (status: number, message?: string) => ({
      data: undefined,
      error: message ? { statusCode: status, message } : undefined,
      response: { ok: false, status },
    });
    const photo = {
      body: new Blob(["x"]),
      filename: "d.jpg",
      contentType: "image/jpeg",
    };

    async function failureOf(client: unknown, args: object) {
      const { result } = renderHook(() => useSetChapterChatBackground(), {
        wrapper: wrapper(client),
      });
      let caught: unknown;
      await act(async () => {
        await result.current
          .mutateAsync(args as never)
          .catch((error: unknown) => {
            caught = error;
          });
      });
      return chatBackgroundErrorCopy(caught);
    }

    it("rethrows the API's own error, so its status still reaches Sentry", async () => {
      const client = { PUT: vi.fn().mockResolvedValue(failed(500, "boom")) };
      const { result } = renderHook(() => useSetChapterChatBackground(), {
        wrapper: wrapper(client),
      });
      let caught: unknown;
      await act(async () => {
        await result.current
          .mutateAsync({ background: "letters" })
          .catch((error: unknown) => {
            caught = error;
          });
      });
      expect(caught).toMatchObject({ statusCode: 500, message: "boom" });
    });

    it("names minting the upload when that 5xxs", async () => {
      const client = {
        POST: vi.fn().mockResolvedValue(failed(500)),
        PUT: vi.fn(),
      };
      expect(await failureOf(client, { background: "photo", photo })).toBe(
        CHAT_BACKGROUND_FAILURE_COPY.prepare,
      );
      expect(client.PUT).not.toHaveBeenCalled();
    });

    it("names saving the uploaded photo when that 5xxs", async () => {
      const client = {
        POST: vi
          .fn()
          .mockResolvedValue(ok({ upload_url: "u", storage_path: "p" })),
        PUT: vi.fn().mockResolvedValue(failed(500)),
      };
      expect(await failureOf(client, { background: "photo", photo })).toBe(
        CHAT_BACKGROUND_FAILURE_COPY.savePhoto,
      );
    });

    it("names saving a channel's photo when that 5xxs (the channel menu)", async () => {
      const client = {
        POST: vi
          .fn()
          .mockResolvedValue(ok({ upload_url: "u", storage_path: "p" })),
        PUT: vi.fn().mockResolvedValue(failed(500)),
      };
      const { result } = renderHook(() => useSetChannelBackground(), {
        wrapper: wrapper(client),
      });
      let caught: unknown;
      await act(async () => {
        await result.current
          .mutateAsync({ channelId: "ch-1", background: "photo", photo })
          .catch((error: unknown) => {
            caught = error;
          });
      });
      expect(client.POST).toHaveBeenCalledWith(
        "/v1/chat-backgrounds/channels/photo-url",
        expect.anything(),
      );
      expect(chatBackgroundErrorCopy(caught)).toBe(
        CHAT_BACKGROUND_FAILURE_COPY.savePhoto,
      );
    });

    it("names saving a built-in when that 5xxs", async () => {
      const client = { PUT: vi.fn().mockResolvedValue(failed(503)) };
      expect(await failureOf(client, { background: "letters" })).toBe(
        CHAT_BACKGROUND_FAILURE_COPY.save,
      );
    });

    it("shows the reason when the API gives one it knows", async () => {
      const client = {
        POST: vi
          .fn()
          .mockResolvedValue(ok({ upload_url: "u", storage_path: "p" })),
        PUT: vi
          .fn()
          .mockResolvedValue(
            failed(
              400,
              "The chapter needs a default or #general channel to announce a photo background in",
            ),
          ),
      };
      expect(await failureOf(client, { background: "photo", photo })).toMatch(
        /no #general or default channel/,
      );
    });

    it("keeps a refused upload's own sentence", async () => {
      putSignedUpload.mockImplementationOnce(
        async (input?: { describeRejection?: (status: number) => string }) => {
          throw new SignedUploadError(
            400,
            input?.describeRejection?.(400) ?? "no describeRejection",
          );
        },
      );
      const client = {
        POST: vi
          .fn()
          .mockResolvedValue(ok({ upload_url: "u", storage_path: "p" })),
        PUT: vi.fn(),
      };
      expect(await failureOf(client, { background: "photo", photo })).toBe(
        CHAT_BACKGROUND_FAILURE_COPY.upload,
      );
    });
  });
});
