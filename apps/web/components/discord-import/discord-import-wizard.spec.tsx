import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// `vi.hoisted` runs before the hoisted `vi.mock` factory, so the spies exist
// when the factory wires them in.
const {
  createImport,
  setChannelMapping,
  setDiscoveredMapping,
  setRoleMapping,
  startImport,
  requestUrls,
  confirmUploads,
  discoverChannels,
  beginConnect,
  confirmConnect,
  availability,
  connection,
} = vi.hoisted(() => ({
  createImport: vi.fn(),
  setChannelMapping: vi.fn(),
  setDiscoveredMapping: vi.fn(),
  setRoleMapping: vi.fn(),
  startImport: vi.fn(),
  requestUrls: vi.fn(),
  confirmUploads: vi.fn(),
  discoverChannels: vi.fn(),
  beginConnect: vi.fn(),
  confirmConnect: vi.fn(),
  availability: { value: { available: true } as { available: boolean } },
  connection: { value: { connected: false } as {
    connected: boolean;
    guild_name?: string;
  } },
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
  // Phase 3: the bot path.
  useDiscordAvailability: () => ({ data: availability.value }),
  useDiscordConnection: () => ({
    data: connection.value,
    isPending: false,
  }),
  useBeginDiscordConnect: () => ({
    mutateAsync: beginConnect,
    isPending: false,
  }),
  useConfirmDiscordConnect: () => ({
    mutateAsync: confirmConnect,
    isPending: false,
  }),
  useDiscoverDiscordChannels: () => ({
    mutateAsync: discoverChannels,
    isPending: false,
  }),
  useSetDiscoveredChannelMapping: () => ({
    mutateAsync: setDiscoveredMapping,
    isPending: false,
  }),
  DISCORD_CONNECT_MESSAGES: {},
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { ImportWizard } from "./import-wizard";
import { SourceStep } from "./source-step";
import { ChannelMappingStep } from "./channel-mapping-step";
import { RoleMappingStep } from "./role-mapping-step";
import { parseExportPreamble, toExportRelativePath } from "./export-preamble";

/**
 * Advance the wizard past the new source step onto the consent step.
 *
 * The upload path is what almost every test below exercises, and it is
 * deliberately still reachable in one click from the first screen — the bot
 * path did not demote it.
 */
function chooseUploadPath() {
  fireEvent.click(screen.getByRole("button", { name: /Upload an export/ }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

describe("ImportWizard — choosing a path", () => {
  beforeEach(() => {
    availability.value = { available: true };
    connection.value = { connected: false };
    createImport.mockReset();
    createImport.mockResolvedValue({ id: "import-1" });
  });

  it("offers both paths, and neither is preselected", () => {
    render(<ImportWizard onStarted={() => {}} onCancel={() => {}} />);

    expect(
      screen.getByRole("button", { name: /Connect Discord/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Upload an export/ }),
    ).toBeInTheDocument();
    expect(
      (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("still offers the upload path when the bot is not configured", () => {
    // The export upload is not a fallback that switches on — it is always a
    // supported choice, and an environment with no Discord application must
    // still be able to import.
    availability.value = { available: false };
    render(<ImportWizard onStarted={() => {}} onCancel={() => {}} />);

    const upload = screen.getByRole("button", {
      name: /Upload an export/,
    }) as HTMLButtonElement;
    const bot = screen.getByRole("button", {
      name: /Connect Discord/,
    }) as HTMLButtonElement;

    expect(upload.disabled).toBe(false);
    expect(bot.disabled).toBe(true);
  });
});

describe("ImportWizard — the consent gate", () => {
  beforeEach(() => {
    availability.value = { available: true };
    connection.value = { connected: false };
    createImport.mockReset();
    createImport.mockResolvedValue({ id: "import-1" });
  });

  it("blocks Continue until the notice is acknowledged", () => {
    // The friction point. It is not enforced technically — Signet cannot see
    // someone else's Discord server — but it must be deliberate.
    render(<ImportWizard onStarted={() => {}} onCancel={() => {}} />);
    chooseUploadPath();

    const button = screen.getByRole("button", {
      name: "Continue",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox"));
    expect(button.disabled).toBe(false);
  });

  it("creates the import with the acknowledgement, not without it", async () => {
    render(<ImportWizard onStarted={() => {}} onCancel={() => {}} />);
    chooseUploadPath();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(createImport).toHaveBeenCalledWith({
        consent_acknowledged: true,
        source: "upload",
      }),
    );
  });

  it("does not create an import when the box is never ticked", () => {
    render(<ImportWizard onStarted={() => {}} onCancel={() => {}} />);
    chooseUploadPath();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(createImport).not.toHaveBeenCalled();
  });

  it("gates the BOT path on the same acknowledgement", async () => {
    // The consent step is shared verbatim. Connecting a server is not consent
    // to publish its history to the chapter, and the bot path must not become
    // the way around a friction point the upload path has.
    connection.value = { connected: true, guild_name: "Tau Nu" };
    discoverChannels.mockResolvedValue({
      channels: [],
      roles: [],
      warnings: [],
    });
    render(
      <ImportWizard
        onStarted={() => {}}
        onCancel={() => {}}
        initialSource="bot"
        initialStep="consent"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(createImport).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(createImport).toHaveBeenCalledWith({
        consent_acknowledged: true,
        source: "bot",
      }),
    );
  });

  it("shows a step counter, which is the accessible progress signal", () => {
    render(<ImportWizard onStarted={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Step 1 of 6")).toBeInTheDocument();
  });
});

describe("ImportWizard — the bot path", () => {
  beforeEach(() => {
    availability.value = { available: true };
    connection.value = { connected: true, guild_name: "Tau Nu" };
    createImport.mockReset();
    createImport.mockResolvedValue({ id: "import-1" });
    discoverChannels.mockReset();
    setDiscoveredMapping.mockReset();
    setDiscoveredMapping.mockResolvedValue([]);
  });

  function renderAtConsent() {
    render(
      <ImportWizard
        onStarted={() => {}}
        onCancel={() => {}}
        initialSource="bot"
        initialStep="consent"
      />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  }

  it("scans the server on leaving consent, and lists what it found", async () => {
    discoverChannels.mockResolvedValue({
      channels: [
        {
          discord_channel_id: "c1",
          discord_channel_name: "general",
          discord_category: "Text",
          parent_discord_channel_id: null,
        },
      ],
      roles: [{ discord_role_id: "r1", discord_role_name: "President" }],
      warnings: [],
    });

    renderAtConsent();

    await waitFor(() =>
      expect(discoverChannels).toHaveBeenCalledWith({ id: "import-1" }),
    );
    expect(await screen.findByText("#general")).toBeInTheDocument();
  });

  it("does NOT ask about threads — they follow their parent", async () => {
    // Two hundred archived threads is not a mapping step. The admin answered
    // for #general; a thread inside #general is part of #general, and the API
    // propagates the decision.
    discoverChannels.mockResolvedValue({
      channels: [
        {
          discord_channel_id: "c1",
          discord_channel_name: "general",
          discord_category: null,
          parent_discord_channel_id: null,
        },
        {
          discord_channel_id: "t1",
          discord_channel_name: "general › planning",
          discord_category: "general",
          parent_discord_channel_id: "c1",
        },
      ],
      roles: [],
      warnings: [],
    });

    renderAtConsent();

    expect(await screen.findByText("#general")).toBeInTheDocument();
    expect(screen.queryByText(/planning/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("radiogroup")).toHaveLength(1);
  });

  it("SHOWS what could not be read instead of swallowing it", async () => {
    // The commonest case is private archived threads: the bot is installed
    // read-only, and Discord gates listing those behind a permission that can
    // also delete them. An admin judging whether the migration is complete has
    // to be told.
    discoverChannels.mockResolvedValue({
      channels: [
        {
          discord_channel_id: "c1",
          discord_channel_name: "general",
          discord_category: null,
          parent_discord_channel_id: null,
        },
      ],
      roles: [],
      warnings: ['Private archived threads in #general could not be read'],
    });

    renderAtConsent();

    expect(
      await screen.findByText(/Private archived threads in #general/),
    ).toBeInTheDocument();
  });

  it("saves the mapping through the discovered-channels route", async () => {
    // A different endpoint from the upload path on purpose: this one answers a
    // set the server already discovered and refuses a channel that was not in
    // it, rather than creating the set from what a client claims.
    discoverChannels.mockResolvedValue({
      channels: [
        {
          discord_channel_id: "c1",
          discord_channel_name: "general",
          discord_category: null,
          parent_discord_channel_id: null,
        },
      ],
      roles: [],
      warnings: [],
    });

    renderAtConsent();
    await screen.findByText("#general");

    fireEvent.click(screen.getByRole("radio", { name: /Skip/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(setDiscoveredMapping).toHaveBeenCalledWith(
        expect.objectContaining({ id: "import-1" }),
      ),
    );
    expect(setChannelMapping).not.toHaveBeenCalled();
  });
});

describe("SourceStep", () => {
  it("marks the selected option for assistive technology", () => {
    render(
      <SourceStep value="upload" onChange={() => {}} botAvailable={true} />,
    );
    const upload = screen.getByRole("button", { name: /Upload an export/ });
    const bot = screen.getByRole("button", { name: /Connect Discord/ });
    expect(upload.getAttribute("aria-pressed")).toBe("true");
    expect(bot.getAttribute("aria-pressed")).toBe("false");
  });

  it("explains that the upload path still works when the bot is unavailable", () => {
    render(
      <SourceStep value={null} onChange={() => {}} botAvailable={false} />,
    );
    expect(
      screen.getByText(/Use the export upload instead/),
    ).toBeInTheDocument();
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

  // The scanner's "messages"-named-channel/category regression is pinned
  // once in packages/validation/src/discord-export.spec.ts, which this
  // wrapper delegates to — no need to duplicate it here.

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

describe("ConnectStep — confirming what the callback parked", () => {
  beforeEach(() => {
    availability.value = { available: true };
    connection.value = { connected: false };
    confirmConnect.mockReset();
    confirmConnect.mockResolvedValue({ connected: true });
  });

  it("confirms automatically when the browser returns with a handshake", async () => {
    // The admin who started this has nothing to decide — their session and the
    // parked guild already agree, and the chapter check happens server-side
    // regardless. Asking them to click again would be friction with no answer.
    render(
      <ImportWizard
        onStarted={() => {}}
        onCancel={() => {}}
        initialSource="bot"
        initialStep="connect"
        handshake="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      />,
    );

    await waitFor(() =>
      expect(confirmConnect).toHaveBeenCalledWith({
        handshake: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
    );
  });

  it("confirms exactly once, so a double render cannot spend the token twice", async () => {
    // React double-invokes effects in development. Spending the one-time token
    // twice would leave the second attempt reporting a failure over a
    // connection that actually succeeded.
    const { rerender } = render(
      <ImportWizard
        onStarted={() => {}}
        onCancel={() => {}}
        initialSource="bot"
        initialStep="connect"
        handshake="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      />,
    );
    rerender(
      <ImportWizard
        onStarted={() => {}}
        onCancel={() => {}}
        initialSource="bot"
        initialStep="connect"
        handshake="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      />,
    );

    await waitFor(() => expect(confirmConnect).toHaveBeenCalledTimes(1));
  });

  it("does NOT confirm when there is no handshake — a plain visit binds nothing", async () => {
    render(
      <ImportWizard
        onStarted={() => {}}
        onCancel={() => {}}
        initialSource="bot"
        initialStep="connect"
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Add to Server/ }),
      ).toBeInTheDocument(),
    );
    expect(confirmConnect).not.toHaveBeenCalled();
  });

  it("shows the reason in place when the confirmation is refused", async () => {
    // The commonest refusal is authorizing while a different chapter is active.
    // The admin is looking at a step that says "not connected" right after
    // authorizing, so the reason has to be in front of them, not in a toast.
    confirmConnect.mockRejectedValue(
      new Error("That Discord confirmation does not belong to this chapter."),
    );

    render(
      <ImportWizard
        onStarted={() => {}}
        onCancel={() => {}}
        initialSource="bot"
        initialStep="connect"
        handshake="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      />,
    );

    expect(
      await screen.findByText(/Could not confirm that server/),
    ).toBeInTheDocument();
  });
});
