import { describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect }));

const { default: ChatAdmin } = await import("./chat-admin/page");
const { default: DiscordImport } = await import("./discord-import/page");
const { default: Reports } = await import("./reports/page");

type Route = (props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => Promise<unknown>;

const open = (route: Route, params: Record<string, string | string[]> = {}) =>
  route({ searchParams: Promise.resolve(params) });

// The officer tools open inside Chapter settings (#3837); their old routes
// only redirect, carrying what the old link carried.
describe("old officer tool routes", () => {
  it("sends /chat-admin to the Chat page, keeping a channel", async () => {
    await expect(open(ChatAdmin)).rejects.toThrow(
      "redirect:/settings?tab=chat",
    );
    await expect(open(ChatAdmin, { channel: "c-1" })).rejects.toThrow(
      "redirect:/settings?tab=chat&channel=c-1",
    );
  });

  it("sends /discord-import there with Discord's outcome intact", async () => {
    await expect(
      open(DiscordImport, { discord: "connected", handshake: "h1" }),
    ).rejects.toThrow(
      "redirect:/settings?tab=chat&tool=discord-import&discord=connected&handshake=h1",
    );
  });

  it("sends /reports to the Reports page, and ignores an old tab", async () => {
    await expect(
      open(Reports, { tab: "roles", extra: ["a", "b"] }),
    ).rejects.toThrow("redirect:/settings?tab=reports");
  });
});
