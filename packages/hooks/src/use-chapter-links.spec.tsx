import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useChapterLinkPicker } from "./invite-role-choices";
import { useChapterLinks, useCreateChapterLink } from "./use-invites";
import { createHookWrapper } from "./test-utils";

/**
 * Chapter links per role (#5633): what the hooks send and read, and the
 * picker state both apps' sections share.
 */

const wrapperFor = (client: unknown) =>
  createHookWrapper({ client, chapterId: "chapter-1" });

const LINK = {
  id: "link-1",
  token: "token-1",
  role: "Brother",
  email: null,
  status: "pending" as const,
  expires_at: "2026-11-26T12:00:00.000Z",
  used_at: null,
  revoked_at: null,
  created_at: "2026-11-19T12:00:00.000Z",
  reusable: true,
};

const CHOICES = [
  { id: "r-everyone", name: "Everyone", label: "No role" },
  { id: "r-brother", name: "Brother", label: "Brother" },
  { id: "r-pledge", name: "Pledge", label: "Pledge" },
];

describe("useChapterLinks / useCreateChapterLink (#5633)", () => {
  it("reads every link and the role a link with none named gets", async () => {
    const GET = vi.fn().mockResolvedValue({
      data: { link: LINK, links: [LINK], default_role: "Brother" },
      error: undefined,
    });
    const { result } = renderHook(() => useChapterLinks(), {
      wrapper: wrapperFor({ GET }),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      links: [LINK],
      defaultRole: "Brother",
    });
  });

  it("sends the role the officer picked", async () => {
    const POST = vi.fn().mockResolvedValue({ data: LINK, error: undefined });
    const { result } = renderHook(() => useCreateChapterLink(), {
      wrapper: wrapperFor({ POST }),
    });
    await act(() => result.current.mutateAsync({ role: "Pledge" }));
    expect(POST).toHaveBeenCalledWith("/v1/invites/chapter-link", {
      body: { role: "Pledge" },
    });
  });
});

describe("useChapterLinkPicker (#5633)", () => {
  it("starts on the API's default role over the client's guess", () => {
    const { result } = renderHook(() =>
      useChapterLinkPicker(
        { links: [], defaultRole: "Brother" },
        { choices: CHOICES, defaultRole: "Everyone" },
      ),
    );
    expect(result.current.newRole).toBe("Brother");
    expect(result.current.replaces).toBe(false);
  });

  it("falls back to the client's default when the API's isn't offered", () => {
    const { result } = renderHook(() =>
      useChapterLinkPicker(
        { links: [], defaultRole: "Vice President" },
        { choices: CHOICES, defaultRole: "Everyone" },
      ),
    );
    expect(result.current.newRole).toBe("Everyone");
  });

  it("replaces a role's link, expired or not, and keeps a pick", () => {
    const { result } = renderHook(() =>
      useChapterLinkPicker(
        {
          links: [
            LINK,
            { ...LINK, id: "link-2", role: "Pledge", status: "expired" },
          ],
          defaultRole: "Everyone",
        },
        { choices: CHOICES, defaultRole: "Everyone" },
      ),
    );
    expect(result.current.replaces).toBe(false);
    act(() => result.current.pick("Pledge"));
    expect(result.current.newRole).toBe("Pledge");
    expect(result.current.replaces).toBe(true);
    expect(result.current.label("Everyone")).toBe("No role");
  });

  it("can't remake a link whose role is no longer offered", () => {
    const { result } = renderHook(() =>
      useChapterLinkPicker(undefined, { choices: CHOICES }),
    );
    expect(result.current.canRemake("Brother")).toBe(true);
    expect(result.current.canRemake("Rush chair")).toBe(false);
  });
});
