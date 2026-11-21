import { describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect }));

const { default: Geofences } = await import("./page");

const open = (params: Record<string, string>) =>
  Geofences({ searchParams: Promise.resolve(params) });

describe("/geofences", () => {
  it("sends old links to Study zones in Chapter settings", async () => {
    await expect(open({})).rejects.toThrow("redirect:/settings?tab=geofences");
  });

  it("keeps `from`, which store builds send from the setup list", async () => {
    await expect(open({ from: "app" })).rejects.toThrow(
      "redirect:/settings?tab=geofences&from=app",
    );
  });
});
