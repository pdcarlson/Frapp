import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  section: null as string | null,
  chapter: undefined as { name?: string } | undefined,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === "section" ? mocks.section : null),
  }),
}));
vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => ({ data: mocks.chapter }),
}));
// Each section has its own spec; here they are named stand-ins, so this file
// is about which one the page mounts.
vi.mock("@/components/personal-settings/quiet-hours-section", () => ({
  QuietHoursSection: () => <p>quiet hours section</p>,
}));
vi.mock("@/components/personal-settings/chapter-alerts-section", () => ({
  ChapterAlertsSection: () => <p>chapter alerts section</p>,
}));
vi.mock("@/components/personal-settings/account-section", () => ({
  AccountSection: () => <p>account section</p>,
}));
vi.mock("@/components/profile/blocked-members-card", () => ({
  BlockedMembersCard: () => <p>blocked members section</p>,
}));
vi.mock("@/components/profile/discord-history-card", () => ({
  DiscordHistoryCard: () => <p>discord history section</p>,
}));

import { PersonalSettingsPage } from "./personal-settings-page";
import {
  PERSONAL_SETTINGS_SECTIONS,
  personalSettingsHref,
  resolvePersonalSettingsSection,
} from "./personal-settings-sections";

const rail = () => screen.getByRole("navigation", { name: "Settings" });

describe("PersonalSettingsPage (#3856)", () => {
  beforeEach(() => {
    mocks.section = null;
    mocks.chapter = { name: "Beta Theta Omega" };
  });

  it("groups the rail by what a setting belongs to, the chapter group by name", () => {
    render(<PersonalSettingsPage />);

    expect(within(rail()).getByText("My account")).toBeInTheDocument();
    expect(within(rail()).getByText("In Beta Theta Omega")).toBeInTheDocument();
    expect(
      within(rail())
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "Notifications",
      "Appearance and chat",
      "Account",
      "Chapter alerts",
      "Blocked members",
      "Discord history",
    ]);
  });

  it("names the chapter group in general terms until the chapter is known", () => {
    mocks.chapter = undefined;
    render(<PersonalSettingsPage />);
    expect(within(rail()).getByText("In your chapter")).toBeInTheDocument();
  });

  it("opens on Notifications and marks it as the current page", () => {
    render(<PersonalSettingsPage />);

    expect(screen.getByText("quiet hours section")).toBeInTheDocument();
    const current = within(rail()).getByRole("link", { current: "page" });
    expect(current).toHaveTextContent("Notifications");
    expect(current).toHaveAttribute("href", "/preferences");
  });

  it.each([
    ["account", "account section"],
    ["alerts", "chapter alerts section"],
    ["blocked", "blocked members section"],
    ["discord", "discord history section"],
  ])("mounts only the section `?section=%s` names", (section, text) => {
    mocks.section = section;
    render(<PersonalSettingsPage />);

    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByText("quiet hours section")).not.toBeInTheDocument();
    expect(
      within(rail()).getByRole("link", { current: "page" }),
    ).toHaveAttribute("href", `/preferences?section=${section}`);
  });

  it("offers Cozy and Compact under Appearance and chat (#2252)", () => {
    mocks.section = "appearance";
    render(<PersonalSettingsPage />);

    expect(
      screen.getByRole("heading", { name: "Chat density" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /cozy/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /compact/i })).toBeInTheDocument();
  });

  it("falls back to Notifications for a section it does not have", () => {
    mocks.section = "constructor";
    render(<PersonalSettingsPage />);
    expect(screen.getByText("quiet hours section")).toBeInTheDocument();
  });
});

describe("personal settings sections", () => {
  it("gives every section its own address, the default the bare path", () => {
    expect(
      PERSONAL_SETTINGS_SECTIONS.map((s) => personalSettingsHref(s.value)),
    ).toEqual([
      "/preferences",
      "/preferences?section=appearance",
      "/preferences?section=account",
      "/preferences?section=alerts",
      "/preferences?section=blocked",
      "/preferences?section=discord",
    ]);
  });

  it("resolves an unknown or missing section to the default", () => {
    expect(resolvePersonalSettingsSection(null)).toBe("notifications");
    expect(resolvePersonalSettingsSection("nope")).toBe("notifications");
    expect(resolvePersonalSettingsSection("discord")).toBe("discord");
  });
});
