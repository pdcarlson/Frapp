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

  // An icon mark (lock, DM, audit) has no text baseline, so a baseline row
  // reads the icon's bottom edge and drops the description ~4px below the
  // name. jsdom has no layout, so the guard is the alignment class itself.
  it("centers the row rather than aligning baselines", () => {
    const { container } = render(
      <ChannelHeaderTitle
        channel={{ name: "alumni", type: "PRIVATE" }}
        name="alumni"
        description="Alumni and actives keeping in touch."
      />,
    );
    const row = container.querySelector('[data-slot="channel-header-title"]')!;
    expect(row).toHaveClass("items-center");
    expect(row).not.toHaveClass("items-baseline");
  });
});
