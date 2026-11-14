import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/hooks", () => ({
  useChannels: () => ({
    data: [
      { id: "c-general", name: "general", type: "PUBLIC", archived_at: null },
      { id: "c-exec", name: "exec", type: "PRIVATE", archived_at: null },
      { id: "c-old", name: "old", type: "PUBLIC", archived_at: "2026-01-01" },
      { id: "c-dm", name: "dm", type: "DM", archived_at: null },
    ],
  }),
}));

import { SettingsBirthdayPosts } from "./settings-birthday-posts";

describe("SettingsBirthdayPosts (#4959)", () => {
  it("reads Off until a channel is picked", () => {
    render(
      <SettingsBirthdayPosts
        channelId={null}
        canManage
        isSaving={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Post in" })).toHaveTextContent(
      "Off",
    );
  });

  it("shows the picked public channel", () => {
    render(
      <SettingsBirthdayPosts
        channelId="c-general"
        canManage
        isSaving={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Post in" })).toHaveTextContent(
      "#general",
    );
  });

  it("can't be changed by a role without config access", () => {
    render(
      <SettingsBirthdayPosts
        channelId={null}
        canManage={false}
        isSaving={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Post in" })).toBeDisabled();
    expect(
      screen.getByText("Your role can't change this."),
    ).toBeInTheDocument();
  });
});
