import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { CHAT_DENSITY_STORAGE_KEY } from "@repo/chat-core/density";
import {
  resetChatDensityForTests,
  setChatDensity,
} from "@/lib/chat/chat-density";
import { ChatDensityControl } from "./chat-density-control";

describe("ChatDensityControl", () => {
  afterEach(() => {
    setChatDensity("cozy");
    window.localStorage.clear();
    resetChatDensityForTests();
  });

  it("offers both densities, cozy checked by default", () => {
    render(<ChatDensityControl />);
    expect(screen.getByRole("radio", { name: /Cozy/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Compact/ })).not.toBeChecked();
  });

  it("saves a pick on the click, with no Save button", async () => {
    render(<ChatDensityControl />);
    await userEvent.click(screen.getByRole("radio", { name: /Compact/ }));
    expect(screen.getByRole("radio", { name: /Compact/ })).toBeChecked();
    expect(window.localStorage.getItem(CHAT_DENSITY_STORAGE_KEY)).toBe(
      "compact",
    );
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  it("moves with the keyboard as one radio group", async () => {
    render(<ChatDensityControl />);
    await userEvent.tab();
    expect(screen.getByRole("radio", { name: /Cozy/ })).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: /Compact/ })).toBeChecked();
  });
});
