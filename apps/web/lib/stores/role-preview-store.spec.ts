import { describe, expect, it } from "vitest";
import { errorCopy } from "@repo/hooks/error-copy";
import {
  activePreview,
  isPreviewBlockedWrite,
  ROLE_PREVIEW_REFUSAL_CODE,
  type RolePreview,
} from "@/lib/stores/role-preview-store";

const API = "https://api.frapp.live";

describe("writes during View as a role (#4072)", () => {
  it("lets reads through", () => {
    expect(isPreviewBlockedWrite("GET", `${API}/v1/events`)).toBe(false);
  });

  it("refuses what the officer does", () => {
    expect(isPreviewBlockedWrite("POST", `${API}/v1/events`)).toBe(true);
    expect(
      isPreviewBlockedWrite("POST", `${API}/v1/channels/abc/messages`),
    ).toBe(true);
    expect(isPreviewBlockedWrite("PATCH", `${API}/v1/roles/r1`)).toBe(true);
    expect(isPreviewBlockedWrite("DELETE", `${API}/v1/tasks/t1`)).toBe(true);
  });

  it("lets the app's own read markers through", () => {
    for (const path of [
      "/v1/channels/abc/read",
      "/v1/activity/reads",
      "/v1/activity/unread-since",
      "/v1/notifications/read",
      "/v1/notifications/n1/read",
      "/v1/push-tokens",
      "/v1/users/me/whats-new",
    ]) {
      expect(isPreviewBlockedWrite("POST", `${API}${path}`)).toBe(false);
    }
  });

  it("words the refusal for the officer", () => {
    expect(
      errorCopy({ statusCode: 403, code: ROLE_PREVIEW_REFUSAL_CODE }),
    ).toBe("You're viewing as a role. Exit the preview to make changes.");
  });

  it("belongs to the chapter it started in", () => {
    const preview: RolePreview = {
      chapterId: "c1",
      roleId: "r",
      roleName: "Brothers",
      permissions: [],
      returnTo: "/settings",
    };
    expect(activePreview(preview, "c1")).toBe(preview);
    expect(activePreview(preview, "c2")).toBeNull();
  });
});
