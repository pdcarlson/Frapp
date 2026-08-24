import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// `vi.hoisted` runs before the hoisted `vi.mock` factory, so the spies exist
// when the factory wires them in.
const {
  createImport,
  setChannelMapping,
  setRoleMapping,
  startImport,
  requestUrls,
  confirmUploads,
} = vi.hoisted(() => ({
  createImport: vi.fn(),
  setChannelMapping: vi.fn(),
  setRoleMapping: vi.fn(),
  startImport: vi.fn(),
  requestUrls: vi.fn(),
  confirmUploads: vi.fn(),
}));

vi.mock("@repo/hooks", () => ({
  useCreateDiscordImport: () => ({
    mutateAsync: createImport,
    isPending: false,
  }),
  useRequestDiscordUploadUrls: () => ({
    mutateAsync: requestUrls,
    isPending: false,
  }),
  useConfirmDiscordUploads: () => ({
    mutateAsync: confirmUploads,
    isPending: false,
  }),
  useSetDiscordChannelMapping: () => ({
    mutateAsync: setChannelMapping,
    isPending: false,
  }),
  useSetDiscordRoleMapping: () => ({
    mutateAsync: setRoleMapping,
    isPending: false,
  }),
  useStartDiscordImport: () => ({ mutateAsync: startImport, isPending: false }),
  useDiscordImportFiles: () => ({ data: [] }),
  useChannels: () => ({ data: [{ id: "ch-1", name: "general" }] }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { ImportWizard } from "./import-wizard";
import { ChannelMappingStep } from "./channel-mapping-step";
import { RoleMappingStep } from "./role-mapping-step";
import { parseExportPreamble, toExportRelativePath } from "./export-preamble";

describe("ImportWizard — the consent gate", () => {
  beforeEach(() => {
    createImport.mockReset();
    createImport.mockResolvedValue({ id: "import-1" });
  });

  it("blocks Continue until the notice is acknowledged", () => {
    // The friction point. It is not enforced technically — Signet cannot see
    // someone else's Discord server — but it must be deliberate.
    render(<ImportWizard onStarted={() => {}} onCancel={() => {}} />);

    const button = screen.getByRole("button", {
      name: "Continue",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox"));
    expect(button.disabled).toBe(false);
  });

  it("creates the import with the acknowledgement, not without it", async () => {
    render(<ImportWizard onStarted={() => {}} onCancel={() => {}} />);

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(createImport).toHaveBeenCalledWith({
        consent_acknowledged: true,
      }),
    );
  });

  it("does not create an import when the box is never ticked", () => {
    render(<ImportWizard onStarted={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(createImport).not.toHaveBeenCalled();
  });

  it("shows a step counter, which is the accessible progress signal", () => {
    render(<ImportWizard onStarted={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();
  });
});

describe("ChannelMappingStep — ask, never guess", () => {
  const channels = [
    { channelId: "1", channelName: "general", category: "General" },
    { channelId: "2", channelName: "exec", category: null },
  ];

  it("starts every channel with no selection", () => {
    // chat_channels has no unique (chapter_id, name), so a same-name Signet
    // channel is not evidence of anything. Nothing may be pre-selected.
    render(
      <ChannelMappingStep
        channels={channels}
        choices={{}}
        onChange={() => {}}
      />,
    );

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.getAttribute("aria-checked")).toBe("false");
    }
  });

  it("offers merge, create and skip for each channel", () => {
    render(
      <ChannelMappingStep
        channels={channels}
        choices={{}}
        onChange={() => {}}
      />,
    );
    expect(screen.getAllByRole("radiogroup")).toHaveLength(2);
    expect(screen.getAllByRole("radio")).toHaveLength(6);
  });

  it("asks for a target when merging into an existing channel", () => {
    render(
      <ChannelMappingStep
        channels={[channels[0]!]}
        choices={{ "1": { action: "use_existing" } }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("Merge into")).toBeInTheDocument();
  });

  it("asks for a name when creating a new channel", () => {
    render(
      <ChannelMappingStep
        channels={[channels[0]!]}
        choices={{ "1": { action: "create_new" } }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("New channel name")).toBeInTheDocument();
  });
});

describe("RoleMappingStep — informational only", () => {
  const roles = [{ roleId: "r1", roleName: "President" }];

  it("defaults every Discord role to Member", () => {
    render(<RoleMappingStep roles={roles} choices={{}} onChange={() => {}} />);

    const checked = screen
      .getAllByRole("radio")
      .filter((radio) => radio.getAttribute("aria-checked") === "true");

    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveTextContent("Member");
  });

  it("says plainly that the mapping grants nothing", () => {
    render(<RoleMappingStep roles={roles} choices={{}} onChange={() => {}} />);
    expect(screen.getByText(/does not\s+grant anything/)).toBeInTheDocument();
  });

  it("explains itself when the export named no roles", () => {
    render(<RoleMappingStep roles={[]} choices={{}} onChange={() => {}} />);
    expect(screen.getByText(/No Discord roles were found/)).toBeInTheDocument();
  });
});

describe("export preamble reader", () => {
  const head = JSON.stringify({
    guild: { id: "1", name: "Tau Nu" },
    channel: {
      id: "800",
      name: "general",
      category: "General",
      topic: 'read the "messages" pinned above',
    },
    messages: [],
  });

  it("reads the header out of a truncated file", () => {
    const preamble = parseExportPreamble(
      head.slice(0, head.indexOf('"messages"') + 40),
    );
    expect(preamble?.channelId).toBe("800");
    expect(preamble?.channelName).toBe("general");
  });

  it("is not fooled by the word messages inside the channel topic", () => {
    expect(parseExportPreamble(head)?.channelName).toBe("general");
  });

  it("survives a channel literally named messages", () => {
    // The naive `indexOf('\"messages\"')` cut lands inside `\"name\":\"messages\"`,
    // the parse fails, and the channel silently vanishes from the mapping grid.
    const named = JSON.stringify({
      guild: { id: "1", name: "Tau Nu" },
      channel: { id: "801", name: "messages", category: "General" },
      messages: [],
    });

    expect(parseExportPreamble(named)?.channelId).toBe("801");
    expect(parseExportPreamble(named)?.channelName).toBe("messages");
  });

  it("returns null for a file that is not an export", () => {
    expect(parseExportPreamble('{"hello":1}')).toBeNull();
    expect(parseExportPreamble("not json")).toBeNull();
  });

  it("strips the admin's own folder name off a relative path", () => {
    // `webkitRelativePath` is prefixed with whatever the admin named the
    // folder; the manifest key has to equal the path DCE writes into the JSON.
    expect(toExportRelativePath("my export/general_Files/a.png")).toBe(
      "general_Files/a.png",
    );
    expect(toExportRelativePath("a.png")).toBe("a.png");
  });
});
