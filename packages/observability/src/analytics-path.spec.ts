import { describe, expect, it } from "vitest";
import {
  analyticsRouteTemplate,
  pathOnlyAnalyticsPath,
} from "./analytics-path";

describe("pathOnlyAnalyticsPath", () => {
  it("keeps an origin-form path and drops query, fragment, and authority", () => {
    expect(pathOnlyAnalyticsPath("/privacy")).toBe("/privacy");
    expect(pathOnlyAnalyticsPath("/join?token=invite-token-secret")).toBe(
      "/join",
    );
    expect(pathOnlyAnalyticsPath("/join#frag")).toBe("/join");
    expect(
      pathOnlyAnalyticsPath(
        "https://frapp.live/join?token=invite-token-secret&email=a@b.c",
      ),
    ).toBe("/join");
  });

  it("rejects values that are not a path after stripping", () => {
    expect(pathOnlyAnalyticsPath("")).toBeUndefined();
    expect(pathOnlyAnalyticsPath("mailto:a@b.c")).toBeUndefined();
    expect(pathOnlyAnalyticsPath("not-a-path")).toBeUndefined();
  });
});

describe("analyticsRouteTemplate", () => {
  const UUID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

  it("keeps a route that names a screen as it is", () => {
    expect(analyticsRouteTemplate("/")).toBe("/");
    expect(analyticsRouteTemplate("/chat")).toBe("/chat");
    expect(analyticsRouteTemplate("/chat-thread")).toBe("/chat-thread");
    expect(analyticsRouteTemplate("/service-hours")).toBe("/service-hours");
    expect(analyticsRouteTemplate("/chat-admin")).toBe("/chat-admin");
  });

  it("drops the query and host, where today's ids ride", () => {
    expect(analyticsRouteTemplate(`/chat?channel=${UUID}&message=m1`)).toBe(
      "/chat",
    );
    expect(analyticsRouteTemplate("https://app.frapp.live/join?token=t")).toBe(
      "/join",
    );
  });

  it("replaces a segment that names a record with [id]", () => {
    expect(analyticsRouteTemplate(`/events/${UUID}`)).toBe("/events/[id]");
    expect(analyticsRouteTemplate(`/chat/${UUID}/thread/${UUID}`)).toBe(
      "/chat/[id]/thread/[id]",
    );
    expect(analyticsRouteTemplate("/members/12345")).toBe("/members/[id]");
    expect(analyticsRouteTemplate(`/x/${"a".repeat(64)}`)).toBe("/x/[id]");
    expect(analyticsRouteTemplate("/invite/k9Qz_2xV-7mPq4LrT8sWn")).toBe(
      "/invite/[id]",
    );
  });

  it("is undefined when nothing safe remains", () => {
    expect(analyticsRouteTemplate("")).toBeUndefined();
    expect(analyticsRouteTemplate("not-a-path")).toBeUndefined();
  });
});
