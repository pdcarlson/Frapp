import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChannelStart } from "./channel-start";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const GENERAL = {
  id: "chan-1",
  name: "general",
  type: "PUBLIC" as const,
  description: "The whole chapter.",
};

describe("ChannelStart", () => {
  it("welcomes the member to the channel and repeats its description", () => {
    render(<ChannelStart channel={GENERAL} displayName="general" />);

    expect(
      screen.getByRole("heading", { name: "Welcome to #general" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("This is the start of #general."),
    ).toBeInTheDocument();
    expect(screen.getByText("The whole chapter.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("gives an officer Edit channel, opening Chat admin on this channel", () => {
    render(<ChannelStart channel={GENERAL} displayName="general" canEdit />);

    expect(screen.getByRole("link", { name: "Edit channel" })).toHaveAttribute(
      "href",
      "/chat-admin?channel=chan-1",
    );
  });

  it("asks an officer for a description the channel lacks", () => {
    render(
      <ChannelStart
        channel={{ ...GENERAL, description: "  " }}
        displayName="general"
        canEdit
      />,
    );

    expect(
      screen.getByRole("link", { name: "Add a description" }),
    ).toBeInTheDocument();
  });

  it("never offers Chat admin on a direct message", () => {
    render(
      <ChannelStart
        channel={{ id: "dm-1", name: "dm-a-b", type: "DM" }}
        displayName="Sam Lee"
        canEdit
      />,
    );

    expect(
      screen.getByText("This is the start of your conversation with Sam Lee."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
