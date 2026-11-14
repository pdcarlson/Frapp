import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const channels = vi.hoisted(() => ({
  current: {
    data: undefined as unknown[] | undefined,
    isError: false,
  },
}));

vi.mock("@repo/hooks", () => ({
  useChannels: () => channels.current,
}));

import {
  offersBirthdayPosts,
  SettingsBirthdayPosts,
} from "./settings-birthday-posts";

const LIST = [
  { id: "c-general", name: "general", type: "PUBLIC", archived_at: null },
  { id: "c-exec", name: "exec", type: "PRIVATE", archived_at: null },
  { id: "c-old", name: "old", type: "PUBLIC", archived_at: "2026-01-01" },
  { id: "c-dm", name: "dm", type: "DM", archived_at: null },
  {
    id: "c-audit",
    name: "chapter-audit",
    type: "PUBLIC",
    archived_at: null,
    is_audit_log: true,
  },
];

function renderPicker(
  props: Partial<Parameters<typeof SettingsBirthdayPosts>[0]> = {},
) {
  const onChange = vi.fn();
  render(
    <SettingsBirthdayPosts
      channelId={null}
      canManage
      isSaving={false}
      onChange={onChange}
      {...props}
    />,
  );
  return {
    onChange,
    picker: screen.getByRole("combobox", { name: "Post in" }),
  };
}

describe("SettingsBirthdayPosts (#4959)", () => {
  beforeEach(() => {
    channels.current = { data: LIST, isError: false };
  });

  it("offers Off and the public, live channels only, never the audit feed", async () => {
    const { picker } = renderPicker();
    expect(picker).toHaveTextContent("Off");

    await userEvent.click(picker);
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Off", "#general"]);
    expect(LIST.filter(offersBirthdayPosts).map((c) => c.id)).toEqual([
      "c-general",
    ]);
  });

  it("saves the picked channel", async () => {
    const { picker, onChange } = renderPicker();
    await userEvent.click(picker);
    await userEvent.click(screen.getByRole("option", { name: "#general" }));
    expect(onChange).toHaveBeenLastCalledWith("c-general");
  });

  it("saves null for Off", async () => {
    const { picker, onChange } = renderPicker({ channelId: "c-general" });
    await userEvent.click(picker);
    await userEvent.click(screen.getByRole("option", { name: "Off" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("says a saved channel that can't take posts any more is paused", () => {
    const { picker } = renderPicker({ channelId: "c-exec" });
    expect(picker).toHaveTextContent("#exec (paused)");
    expect(screen.getByText(/^Paused:/)).toBeInTheDocument();
  });

  it("waits for the channel list instead of calling a saved one unknown", () => {
    channels.current = { data: undefined, isError: false };
    const { picker } = renderPicker({ channelId: "c-general" });
    expect(picker).toBeDisabled();
    expect(picker).not.toHaveTextContent("paused");
  });

  it("says so when the channel list can't load", () => {
    channels.current = { data: undefined, isError: true };
    renderPicker({ channelId: "c-general" });
    expect(screen.getByText(/Couldn't load the channels/)).toBeInTheDocument();
  });

  it("can't be changed by a role without config access", () => {
    const { picker } = renderPicker({ canManage: false });
    expect(picker).toBeDisabled();
    expect(
      screen.getByText("Your role can't change this."),
    ).toBeInTheDocument();
  });
});
