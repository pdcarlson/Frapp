import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChannelHeaderTitle } from "./channel-header-title";

describe("ChannelHeaderTitle", () => {
  it("draws the name as the heading and the description after it", () => {
    render(
      <ChannelHeaderTitle
        channel={{ name: "alumni", type: "PRIVATE" }}
        name="alumni"
        description="Alumni and actives keeping in touch."
      />,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "alumni" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Alumni and actives keeping in touch."),
    ).toBeInTheDocument();
  });

  it("draws no dot without a description", () => {
    const { container } = render(
      <ChannelHeaderTitle
        channel={{ name: "dm-a-b", type: "DM" }}
        name="Jordan Reyes"
        description={null}
      />,
    );
    expect(container).not.toHaveTextContent("•");
  });

  // An icon mark (the lock, DM, audit) has no text baseline, so a baseline row
  // reads the icon's bottom edge: the description drops ~4px below the name,
  // and inside the heading the name would sit off the icon's middle. jsdom has
  // no layout, so the guard is the alignment class on both flex rows, for each
  // kind of mark, the typed `#` included.
  it.each([
    ["a private channel", { name: "alumni", type: "PRIVATE" }, "alumni"],
    ["a role-gated channel", { name: "exec", type: "ROLE_GATED" }, "exec"],
    ["a public channel", { name: "general", type: "PUBLIC" }, "general"],
    ["a DM", { name: "dm-a-b", type: "DM" }, "Jordan Reyes"],
    [
      "the audit channel",
      { name: "chapter-audit", type: "PUBLIC" },
      "chapter-audit",
    ],
  ] as const)(
    "centers %s rather than aligning baselines",
    (_, channel, name) => {
      const { container } = render(
        <ChannelHeaderTitle
          channel={channel}
          name={name}
          description="A description."
        />,
      );
      const row = container.querySelector(
        '[data-slot="channel-header-title"]',
      )!;
      const heading = screen.getByRole("heading", { level: 2 });
      for (const flexRow of [row, heading]) {
        expect(flexRow).toHaveClass("items-center");
        expect(flexRow).not.toHaveClass("items-baseline");
      }
    },
  );
});
