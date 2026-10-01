import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
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
  channelsQuery,
  myPermissions,
  rolesFail,
  permissionsFail,
  catalogStale,
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
  myPermissions: { value: ["*"] as string[] },
  rolesFail: { value: false },
  // "error": no permissions ever loaded; "stale": a refetch failed but the
  // last answer is kept, as TanStack Query v5 does.
  permissionsFail: { value: null as null | "error" | "stale" },
  // A catalog refetch that failed with the last answer kept.
  catalogStale: { value: false },
  channelsQuery: {
    value: {
      data: [{ id: "ch-1", name: "general", type: "PUBLIC" }] as unknown,
      isPending: false,
      isError: false,
      refetch: (() => Promise.resolve()) as () => Promise<unknown>,
    },
  },
  connection: {
    value: { connected: false } as {
      connected: boolean;
      guild_name?: string;
    },
  },
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
  useChannels: () => channelsQuery.value,
  usePermissionsCatalog: () => ({
    data: [
      { key: "CHAPTER_CONFIG_MANAGE", permission: "chapter-config:manage" },
      { key: "MEMBERS_VIEW", permission: "members:view" },
    ],
    isPending: false,
    isError: catalogStale.value,
  }),
  useRoles: () =>
    rolesFail.value
      ? { data: undefined, isError: true, refetch: () => Promise.resolve() }
      : {
          data: [
            {
              id: "role-president",
              name: "President",
              system_key: "PRESIDENT",
              permissions: ["*"],
            },
            {
              id: "role-treasurer",
              name: "Treasurer",
              system_key: "TREASURER",
              permissions: ["chapter-config:manage"],
            },
            {
              id: "role-secretary",
              name: "Secretary",
              system_key: "SECRETARY",
              permissions: [],
            },
            {
              id: "role-cabinet",
              name: "Cabinet",
              system_key: null,
              permissions: ["cabinet:read"],
            },
          ],
          isError: false,
          refetch: () => Promise.resolve(),
        },
  useMyPermissions: () => ({
    data:
      permissionsFail.value === "error"
        ? undefined
        : { permissions: myPermissions.value },
    isError: permissionsFail.value !== null,
    refetch: () => Promise.resolve(),
  }),
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
import { ConnectStep } from "./connect-step";
import { ChannelMappingStep } from "./channel-mapping-step";
import { defaultChoices, mappingIssues } from "./mapping-issues";
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

  // The dashboard shell's <main> holds the page; a second would be a second
  // main landmark in a screen reader's list (#2500).
  it("draws no main landmark of its own", () => {
    render(<ImportWizard onStarted={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole("main")).toBeNull();
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

  it("still lets an already-connected chapter take the bot path while connecting is withdrawn", () => {
    // Availability is about starting a connect. The import itself reads
    // through the stored guild, and the API accepts it.
    availability.value = { available: false };
    connection.value = { connected: true, guild_name: "Tau Nu" };
    render(<ImportWizard onStarted={() => {}} onCancel={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /Connect Discord/ }));
    expect(
      (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("will not continue to Connect once the bot is withdrawn, even if it was picked", () => {
    // The choice outlives the card greying out. An admin who picked the bot,
    // went on, and came Back after the API withdrew it must not be sent
    // straight back to a connect that cannot work.
    availability.value = { available: false };
    render(
      <ImportWizard
        onStarted={() => {}}
        onCancel={() => {}}
        initialSource="bot"
      />,
    );
    expect(
      (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
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
    // The friction point. It is not enforced technically — Frapp cannot see
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
    // Before a path is chosen it counts the upload path's five steps; the
    // bot path adds the role step, which only it has (#2818).
    render(<ImportWizard onStarted={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();
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
    setRoleMapping.mockReset();
    setRoleMapping.mockResolvedValue({});
    myPermissions.value = ["*"];
    rolesFail.value = false;
    permissionsFail.value = null;
    channelsQuery.value = {
      data: [{ id: "ch-1", name: "general", type: "PUBLIC" }],
      isPending: false,
      isError: false,
      refetch: () => Promise.resolve(),
    };
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

  /**
   * Consent, then the role step (which comes first, #2818, and whose
   * defaults are already an answer), then the channels.
   */
  async function renderAtChannels() {
    renderAtConsent();
    await screen.findByRole("heading", { name: "Map the roles" });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Map the channels" });
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

    await renderAtChannels();

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

    await renderAtChannels();

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
      warnings: ["Private archived threads in #general could not be read"],
    });

    await renderAtChannels();

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
          discord_channel_name: "random",
          discord_category: null,
          parent_discord_channel_id: null,
          readable: true,
          private_in_discord: false,
        },
      ],
      roles: [],
      warnings: [],
    });

    await renderAtChannels();
    // No clashes and nothing private: the defaults are already an answer, so
    // Continue works with zero per-channel clicks (#2787).
    await screen.findByText(/Nothing needs attention/);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(setDiscoveredMapping).toHaveBeenCalledWith({
        id: "import-1",
        channels: [
          expect.objectContaining({
            discord_channel_id: "c1",
            mapping_action: "create_new",
            new_channel_name: "random",
            new_channel_visibility: "chapter",
          }),
        ],
      }),
    );
    expect(setChannelMapping).not.toHaveBeenCalled();
  });

  it("holds Continue on a channel that was private in Discord until its visibility is chosen", async () => {
    discoverChannels.mockResolvedValue({
      channels: [
        {
          discord_channel_id: "c9",
          discord_channel_name: "cabinet",
          discord_category: "Exec",
          parent_discord_channel_id: null,
          readable: true,
          private_in_discord: true,
        },
      ],
      roles: [],
      warnings: [],
    });

    await renderAtChannels();
    await screen.findAllByText(/#cabinet was private in Discord/);
    const continueButton = screen.getByRole("button", { name: "Continue" });
    expect((continueButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Who can read it"), {
      target: { value: "restricted" },
    });
    fireEvent.click(screen.getByLabelText(/chapter-config:manage/));
    await waitFor(() =>
      expect((continueButton as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(continueButton);

    await waitFor(() =>
      expect(setDiscoveredMapping).toHaveBeenCalledWith({
        id: "import-1",
        channels: [
          expect.objectContaining({
            new_channel_visibility: "restricted",
            new_channel_required_permissions: ["chapter-config:manage"],
          }),
        ],
      }),
    );
  });

  it("asks about a public channel that holds a private thread, because the thread lands in it", async () => {
    discoverChannels.mockResolvedValue({
      channels: [
        {
          discord_channel_id: "c1",
          discord_channel_name: "general",
          discord_category: null,
          parent_discord_channel_id: null,
          readable: true,
          private_in_discord: false,
        },
        {
          discord_channel_id: "t1",
          discord_channel_name: "general › bids",
          discord_category: "general",
          parent_discord_channel_id: "c1",
          readable: true,
          private_in_discord: true,
        },
      ],
      roles: [],
      warnings: [],
    });

    await renderAtChannels();
    expect(
      await screen.findByRole("button", {
        name: /#general holds 1 private thread in Discord/,
      }),
    ).toBeInTheDocument();
    expect(
      (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("keeps what the admin decided across a re-scan while its channel is unchanged", async () => {
    const scan = {
      channels: [
        {
          discord_channel_id: "c1",
          discord_channel_name: "memes",
          discord_category: null,
          parent_discord_channel_id: null,
          readable: true,
          private_in_discord: false,
        },
        {
          discord_channel_id: "c2",
          discord_channel_name: "exec",
          discord_category: null,
          parent_discord_channel_id: null,
          readable: false,
          private_in_discord: true,
        },
      ],
      roles: [],
      warnings: [],
    };
    discoverChannels.mockResolvedValue(scan);

    await renderAtChannels();
    await screen.findByText(/Nothing needs attention/);
    // The "No category" group has nothing to fix, so it starts closed.
    fireEvent.click(screen.getByRole("button", { name: /^No category/ }));
    fireEvent.change(screen.getByLabelText("New channel name"), {
      target: { value: "dank-memes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Scan again" }));

    await waitFor(() => expect(discoverChannels).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("New channel name") as HTMLInputElement).value,
      ).toBe("dank-memes"),
    );
  });

  function scanOneChannel() {
    discoverChannels.mockResolvedValue({
      channels: [
        {
          discord_channel_id: "c1",
          discord_channel_name: "general",
          discord_category: null,
          parent_discord_channel_id: null,
          readable: true,
          private_in_discord: false,
        },
      ],
      roles: [],
      warnings: [],
    });
  }
  const continueDisabled = () =>
    (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement)
      .disabled;

  it("holds Continue while the existing channels are still loading, since a clash cannot be ruled out yet", async () => {
    channelsQuery.value = {
      data: undefined,
      isPending: true,
      isError: false,
      refetch: () => Promise.resolve(),
    };
    scanOneChannel();
    await renderAtChannels();
    expect(
      await screen.findByText(/Checking the new names against your existing/),
    ).toBeInTheDocument();
    expect(continueDisabled()).toBe(true);
  });

  it("offers to retry, in place, when the existing channels could not be loaded", async () => {
    const refetch = vi.fn(() => Promise.resolve());
    channelsQuery.value = {
      data: undefined,
      isPending: false,
      isError: true,
      refetch,
    };
    scanOneChannel();
    await renderAtChannels();
    expect(
      await screen.findByText(/could not load your existing channels/),
    ).toBeInTheDocument();
    expect(continueDisabled()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps checking against the list it has when only a later refetch failed", async () => {
    // A failed background refetch keeps its data (TanStack Query v5), and the
    // names were already checked against it.
    channelsQuery.value = {
      data: [{ id: "ch-1", name: "general", type: "PUBLIC" }],
      isPending: false,
      isError: true,
      refetch: () => Promise.resolve(),
    };
    scanOneChannel();
    await renderAtChannels();
    // #general merges into the loaded list's #general (#2856), which only
    // the loaded list could have said; nothing asks to load it again.
    expect(
      await screen.findByText(/Nothing needs attention/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/could not load your existing channels/),
    ).not.toBeInTheDocument();
  });

  it("merges a public channel into the like-named Frapp channel by default (#2856)", async () => {
    scanOneChannel();
    await renderAtChannels();
    await screen.findByText(/Nothing needs attention/);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(setDiscoveredMapping).toHaveBeenCalledWith({
        id: "import-1",
        channels: [
          expect.objectContaining({
            discord_channel_id: "c1",
            mapping_action: "use_existing",
            target_channel_id: "ch-1",
          }),
        ],
      }),
    );
  });

  describe("the date cutoff (#2858)", () => {
    async function renderAtReview() {
      startImport.mockReset();
      startImport.mockResolvedValue({});
      scanOneChannel();
      await renderAtChannels();
      await screen.findByText(/Nothing needs attention/);
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      await screen.findByRole("heading", { name: "Review and import" });
    }
    const since = () =>
      screen.getByLabelText("Import messages from") as HTMLInputElement;

    it("imports all history when the date is left empty", async () => {
      await renderAtReview();
      expect(since().value).toBe("");
      fireEvent.click(screen.getByRole("button", { name: "Start import" }));
      await waitFor(() =>
        expect(startImport).toHaveBeenCalledWith({ id: "import-1" }),
      );
    });

    it("sends the chosen day as the viewer's own midnight", async () => {
      // Pinned away from UTC, or local and UTC midnight are the same instant
      // and a regression to UTC parsing would still pass (CI runs in UTC).
      vi.stubEnv("TZ", "America/Denver");
      try {
        await renderAtReview();
        fireEvent.change(since(), { target: { value: "2024-06-01" } });
        expect(
          screen.getByText(
            /Older messages, and their attachments, are left out/,
          ),
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Start import" }));
        await waitFor(() =>
          expect(startImport).toHaveBeenCalledWith({
            id: "import-1",
            // Midnight in Denver, UTC−6 in June.
            messagesAfter: "2024-06-01T06:00:00.000Z",
          }),
        );
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("holds Start on a date in the future", async () => {
      await renderAtReview();
      const nextYear = new Date().getFullYear() + 1;
      fireEvent.change(since(), { target: { value: `${nextYear}-01-01` } });
      expect(screen.getByText(/Choose a date in the past/)).toBeInTheDocument();
      expect(
        (
          screen.getByRole("button", {
            name: "Start import",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
    });
  });

  it("never offers a DM or group DM to merge into, or counts one as a clash (#2856)", async () => {
    channelsQuery.value = {
      data: [
        { id: "ch-1", name: "general", type: "PUBLIC" },
        { id: "gdm-1", name: "officers", type: "GROUP_DM" },
        { id: "dm-1", name: "dm-a-b", type: "DM" },
      ],
      isPending: false,
      isError: false,
      refetch: () => Promise.resolve(),
    };
    discoverChannels.mockResolvedValue({
      channels: [
        {
          discord_channel_id: "c1",
          discord_channel_name: "general",
          discord_category: null,
          parent_discord_channel_id: null,
          readable: true,
          private_in_discord: false,
        },
        {
          discord_channel_id: "c2",
          discord_channel_name: "officers",
          discord_category: null,
          parent_discord_channel_id: null,
          readable: true,
          private_in_discord: false,
        },
      ],
      roles: [],
      warnings: [],
    });
    await renderAtChannels();
    // #officers is not merged into the group DM of that name, and a new
    // #officers does not clash with it.
    await screen.findByText(/Nothing needs attention/);
    fireEvent.click(screen.getByRole("button", { name: /^No category/ }));
    const picker = screen.getByLabelText("Merge into") as HTMLSelectElement;
    expect([...picker.options].map((option) => option.textContent)).toEqual([
      "Pick a channel…",
      "#general",
    ]);
  });

  it("keeps a private like-named channel as a new one and asks about the clash (#2856)", async () => {
    discoverChannels.mockResolvedValue({
      channels: [
        {
          discord_channel_id: "c1",
          discord_channel_name: "general",
          discord_category: null,
          parent_discord_channel_id: null,
          readable: true,
          private_in_discord: true,
        },
      ],
      roles: [],
      warnings: [],
    });
    await renderAtChannels();
    expect(
      await screen.findAllByText(/#general already exists in Frapp/),
    ).not.toHaveLength(0);
    expect(continueDisabled()).toBe(true);
  });

  it("never merges a row later, once the Frapp channels were loaded when it was staged (#2856)", async () => {
    // Loaded, with nothing named #general: #general starts as a new channel.
    channelsQuery.value = {
      data: [],
      isPending: false,
      isError: false,
      refetch: () => Promise.resolve(),
    };
    scanOneChannel();
    // A new element each time, or React skips the re-render and the hook is
    // never asked again.
    const wizard = () => (
      <ImportWizard
        onCancel={() => undefined}
        onStarted={() => undefined}
        initialSource="bot"
        initialStep="consent"
      />
    );
    const { rerender } = render(wizard());
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Map the roles" });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText(/Nothing needs attention/);

    // A refetch brings a #general. The row was decided already, so it stays
    // a new channel, and the clash is asked about instead of merged silently.
    channelsQuery.value = {
      data: [{ id: "ch-1", name: "general", type: "PUBLIC" }],
      isPending: false,
      isError: false,
      refetch: () => Promise.resolve(),
    };
    rerender(wizard());
    expect(
      (await screen.findAllByText(/#general already exists in Frapp/)).length,
    ).toBeGreaterThan(0);
  });

  it("merges once the Frapp channels load, when the scan beat them (#2856)", async () => {
    channelsQuery.value = {
      data: undefined,
      isPending: true,
      isError: false,
      refetch: () => Promise.resolve(),
    };
    scanOneChannel();
    const { rerender } = render(
      <ImportWizard
        onCancel={() => undefined}
        onStarted={() => undefined}
        initialSource="bot"
        initialStep="consent"
      />,
    );
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Map the roles" });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Map the channels" });

    channelsQuery.value = {
      data: [{ id: "ch-1", name: "general", type: "PUBLIC" }],
      isPending: false,
      isError: false,
      refetch: () => Promise.resolve(),
    };
    rerender(
      <ImportWizard
        onCancel={() => undefined}
        onStarted={() => undefined}
        initialSource="bot"
        initialStep="consent"
      />,
    );
    expect(
      await screen.findByText(/Nothing needs attention/),
    ).toBeInTheDocument();
  });

  it("re-asks after a re-scan instead of trusting what the last scan defaulted", async () => {
    const row = (
      id: string,
      name: string,
      readable: boolean,
      isPrivate: boolean,
    ) => ({
      discord_channel_id: id,
      discord_channel_name: name,
      discord_category: "Brothers",
      parent_discord_channel_id: null,
      readable,
      private_in_discord: isPrivate,
    });
    discoverChannels
      .mockResolvedValueOnce({
        channels: [
          row("c1", "rush", true, false),
          row("c2", "exec", false, true),
        ],
        roles: [],
        warnings: [],
      })
      .mockResolvedValueOnce({
        // The admin gave the bot a role: #exec is readable now, and #rush has
        // been made private in Discord since the first scan.
        channels: [
          row("c1", "rush", true, true),
          row("c2", "exec", true, true),
        ],
        roles: [],
        warnings: [],
      });

    await renderAtChannels();
    await screen.findByText(/Nothing needs attention/);
    fireEvent.click(screen.getByRole("button", { name: "Scan again" }));

    expect(
      await screen.findByRole("button", {
        name: /#rush was private in Discord/,
      }),
    ).toBeInTheDocument();
    // #exec is no longer the skip it was forced into; it is asked about.
    expect(
      screen.getByRole("button", { name: /#exec was private in Discord/ }),
    ).toBeInTheDocument();
    expect(
      (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  describe("roles gate the private channels (#2818)", () => {
    const privateRow = (id: string, name: string, readers: string[]) => ({
      discord_channel_id: id,
      discord_channel_name: name,
      discord_category: "Officers",
      parent_discord_channel_id: null,
      readable: true,
      private_in_discord: true,
      discord_reader_role_ids: readers,
    });
    const scanWithRoles = () =>
      discoverChannels.mockResolvedValue({
        channels: [
          privateRow("c1", "exec", ["r-treasurer", "r-rush"]),
          privateRow("c2", "rush", ["r-rush"]),
        ],
        roles: [
          { discord_role_id: "r-treasurer", discord_role_name: "treasurer" },
          {
            discord_role_id: "r-rs",
            discord_role_name: "Recording Secretary",
          },
          { discord_role_id: "r-rush", discord_role_name: "Rush Chair" },
          { discord_role_id: "r-gamer", discord_role_name: "Gamers" },
        ],
        warnings: [],
      });
    const becomes = (roleName: string) =>
      screen
        .getByText(roleName, { selector: "span" })
        .closest("div.rounded-md")
        ?.querySelector("select") as HTMLSelectElement;

    it("asks about roles before channels, defaulting by name, then a close match, then a new role", async () => {
      scanWithRoles();
      renderAtConsent();
      await screen.findByRole("heading", { name: "Map the roles" });

      expect(becomes("treasurer").value).toBe("role-treasurer");
      expect(becomes("Recording Secretary").value).toBe("role-secretary");
      // Matches nothing: a new role, whether or not it read a private
      // channel (#2855), because a role classifies people either way.
      expect(becomes("Rush Chair").value).toBe("__new__");
      expect(becomes("Gamers").value).toBe("__new__");
      expect(
        screen
          .getAllByLabelText("New role name")
          .map((input) => (input as HTMLInputElement).value),
      ).toEqual(["Rush Chair", "Gamers"]);

      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      await waitFor(() =>
        expect(setRoleMapping).toHaveBeenCalledWith({
          id: "import-1",
          roles: [
            {
              discord_role_id: "r-treasurer",
              discord_role_name: "treasurer",
              action: "existing",
              frapp_role_id: "role-treasurer",
              new_role_name: undefined,
            },
            {
              discord_role_id: "r-rs",
              discord_role_name: "Recording Secretary",
              action: "existing",
              frapp_role_id: "role-secretary",
              new_role_name: undefined,
            },
            {
              discord_role_id: "r-rush",
              discord_role_name: "Rush Chair",
              action: "new",
              frapp_role_id: undefined,
              new_role_name: "Rush Chair",
            },
            {
              discord_role_id: "r-gamer",
              discord_role_name: "Gamers",
              action: "new",
              frapp_role_id: undefined,
              new_role_name: "Gamers",
            },
          ],
        }),
      );
      expect(
        await screen.findByRole("heading", { name: "Map the channels" }),
      ).toBeInTheDocument();
    });

    it("starts a private channel as Same as Discord, names who reads it, and sends no permissions", async () => {
      scanWithRoles();
      await renderAtChannels();
      await screen.findByText(/Nothing needs attention/);
      fireEvent.click(screen.getByRole("button", { name: /^Officers/ }));
      expect(
        screen.getByText("Readable by Treasurer, Rush Chair (new)."),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      await waitFor(() => expect(setDiscoveredMapping).toHaveBeenCalled());
      const { channels } = setDiscoveredMapping.mock.calls[0]![0] as {
        channels: Record<string, unknown>[];
      };
      expect(channels[0]).toMatchObject({
        discord_channel_id: "c1",
        new_channel_visibility: "discord",
        new_channel_required_permissions: undefined,
      });
      // Review says what starting will do to roles.
      expect(await screen.findByText(/New roles:/)).toBeInTheDocument();
    });

    it("saves the roles again just before the channels, which are resolved through them", async () => {
      scanWithRoles();
      await renderAtChannels();
      await screen.findByText(/Nothing needs attention/);
      setRoleMapping.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      await waitFor(() => expect(setDiscoveredMapping).toHaveBeenCalled());
      expect(setRoleMapping).toHaveBeenCalledTimes(1);
      expect(setRoleMapping.mock.invocationCallOrder[0]).toBeLessThan(
        setDiscoveredMapping.mock.invocationCallOrder[0]!,
      );
    });

    it("asks who can read a private channel once every role that could read it is ignored", async () => {
      scanWithRoles();
      renderAtConsent();
      await screen.findByRole("heading", { name: "Map the roles" });
      fireEvent.change(becomes("Rush Chair"), {
        target: { value: "__ignore__" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      await screen.findByRole("heading", { name: "Map the channels" });

      // #exec keeps Treasurer, so it stays Same as Discord, narrower than
      // Discord, and says who it leaves out; #rush has no mapped reader left
      // and needs a choice. (Its group is open already: it has an issue.)
      expect(
        await screen.findByText(
          "Readable by Treasurer. Left out, because they are set to Ignore: Rush Chair.",
        ),
      ).toBeInTheDocument();
      expect(
        await screen.findByRole("button", {
          name: /#rush was private in Discord, and none of the roles/,
        }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /#exec was private/ }),
      ).not.toBeInTheDocument();
      expect(
        (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    });

    it("still lets the import go on, every role on Ignore, when the chapter's roles cannot be loaded", async () => {
      // GET /v1/roles needs members:view, which channels:manage does not
      // imply; an all-Ignore mapping needs no roles to map to.
      rolesFail.value = true;
      scanWithRoles();
      renderAtConsent();
      await screen.findByRole("heading", { name: "Map the roles" });
      expect(
        screen.getByText(/could not load your chapter.s roles/),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      await waitFor(() => expect(setRoleMapping).toHaveBeenCalled());
      const { roles } = setRoleMapping.mock.calls[0]![0] as {
        roles: { action: string }[];
      };
      expect(roles.every((role) => role.action === "ignore")).toBe(true);
    });

    it("holds every role on Ignore, and saves exactly that, when the viewer's permissions cannot be loaded", async () => {
      permissionsFail.value = "error";
      scanWithRoles();
      renderAtConsent();
      await screen.findByRole("heading", { name: "Map the roles" });
      expect(
        screen.getByText(/could not load your chapter.s roles/),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      await waitFor(() => expect(setRoleMapping).toHaveBeenCalled());
      const { roles } = setRoleMapping.mock.calls[0]![0] as {
        roles: { action: string }[];
      };
      expect(roles.every((role) => role.action === "ignore")).toBe(true);
    });

    it("keeps using the last permissions answer when only a refetch failed", async () => {
      permissionsFail.value = "stale";
      scanWithRoles();
      renderAtConsent();
      await screen.findByRole("heading", { name: "Map the roles" });
      expect(
        screen.queryByText(/could not load your chapter.s roles/),
      ).not.toBeInTheDocument();
      expect(becomes("treasurer").value).toBe("role-treasurer");
    });

    it("keeps every role on Ignore for a viewer who cannot manage roles", async () => {
      myPermissions.value = ["channels:manage"];
      scanWithRoles();
      renderAtConsent();
      await screen.findByRole("heading", { name: "Map the roles" });
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      await waitFor(() => expect(setRoleMapping).toHaveBeenCalled());
      const { roles } = setRoleMapping.mock.calls[0]![0] as {
        roles: { action: string }[];
      };
      expect(roles.map((role) => role.action)).toEqual([
        "ignore",
        "ignore",
        "ignore",
        "ignore",
      ]);
    });
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

describe("ChannelMappingStep — defaults, groups, and what still needs deciding (#2787)", () => {
  const channels = [
    {
      channelId: "1",
      channelName: "announcements",
      category: "General",
      readable: true,
      privateInDiscord: false,
    },
    {
      channelId: "2",
      channelName: "memes",
      category: "General",
      readable: true,
      privateInDiscord: false,
    },
    {
      channelId: "3",
      channelName: "cabinet",
      category: "Exec",
      readable: true,
      privateInDiscord: true,
    },
    {
      channelId: "4",
      channelName: "jboard",
      category: "Exec",
      readable: false,
      privateInDiscord: true,
    },
  ];

  function renderStep(
    overrides: Partial<Parameters<typeof ChannelMappingStep>[0]> = {},
  ) {
    const onChange = vi.fn();
    const onRescan = vi.fn();
    const choices = overrides.choices ?? defaultChoices(channels);
    render(
      <ChannelMappingStep
        channels={channels}
        choices={choices}
        onChange={onChange}
        issues={mappingIssues(channels, choices, ["general"])}
        knowsPrivacy
        onRescan={onRescan}
        {...overrides}
      />,
    );
    return { onChange, onRescan };
  }

  it("groups channels by Discord category, and opens only the group that needs something", () => {
    renderStep();
    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("Exec")).toBeInTheDocument();
    // Exec's #cabinet was private and has no visibility yet: it is open.
    expect(screen.getByLabelText("Who can read it")).toBeInTheDocument();
    // General has nothing to fix: summarised, not listed.
    expect(screen.queryByText("#announcements")).not.toBeInTheDocument();
  });

  it("lists what blocks Continue, and jumping to one opens its row, scrolls to it and focuses it", async () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    renderStep();
    const panel = screen.getByRole("region", { name: "Needs attention" });
    expect(panel).toHaveTextContent("Needs attention (1)");
    // Collapse the group first: it opened itself because it has an issue.
    fireEvent.click(screen.getByRole("button", { name: /^Exec/ }));
    expect(screen.queryByText("#cabinet")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /#cabinet was private in Discord/ }),
    );
    expect(screen.getByText("#cabinet")).toBeInTheDocument();
    const row = document.getElementById("discord-channel-3");
    await waitFor(() =>
      expect(row?.contains(document.activeElement)).toBe(true),
    );
    expect(scroll.mock.contexts).toContain(row);
    scroll.mockRestore();
  });

  it("keeps a group that opened itself open once its last issue is fixed, so the row being edited stays put", () => {
    const onChange = vi.fn();
    const props = {
      channels,
      onChange,
      knowsPrivacy: true,
    };
    const unresolved = defaultChoices(channels);
    const { rerender } = render(
      <ChannelMappingStep
        {...props}
        choices={unresolved}
        issues={mappingIssues(channels, unresolved, [])}
      />,
    );
    expect(screen.getByText("#cabinet")).toBeInTheDocument();
    // The admin answers #cabinet in place: Exec has nothing left to fix.
    const resolved = {
      ...unresolved,
      "3": { ...unresolved["3"]!, visibility: "chapter" as const },
    };
    rerender(
      <ChannelMappingStep
        {...props}
        choices={resolved}
        issues={mappingIssues(channels, resolved, [])}
      />,
    );
    expect(screen.getByText("#cabinet")).toBeInTheDocument();
  });

  it("collapses the groups a bulk answer settles, so an answered export is not left fully expanded", () => {
    // An export says nothing about privacy, so every row starts with a
    // question and every group opens itself.
    const exported = channels
      .filter((channel) => channel.readable !== false)
      .map(({ channelId, channelName, category }) => ({
        channelId,
        channelName,
        category,
      }));
    function Harness() {
      const [choices, setChoices] = useState(() => defaultChoices(exported));
      return (
        <ChannelMappingStep
          channels={exported}
          choices={choices}
          onChange={setChoices}
          issues={mappingIssues(exported, choices, [])}
          knowsPrivacy={false}
        />
      );
    }
    render(<Harness />);
    expect(screen.getByText("#announcements")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Who can read every new channel"), {
      target: { value: "chapter" },
    });
    expect(screen.getByText(/Nothing needs attention/)).toBeInTheDocument();
    expect(screen.queryByText("#announcements")).not.toBeInTheDocument();
  });

  it("ticks a bulk permission only while every new channel in scope holds it, on the same open panel", () => {
    const restricted = {
      ...defaultChoices(channels),
      "3": {
        action: "create_new" as const,
        newName: "cabinet",
        visibility: "restricted" as const,
        requiredPermissions: ["chapter-config:manage"],
      },
    };
    const step = (
      choices: Parameters<typeof ChannelMappingStep>[0]["choices"],
    ) => (
      <ChannelMappingStep
        channels={channels}
        choices={choices}
        onChange={vi.fn()}
        issues={mappingIssues(channels, choices, [])}
        knowsPrivacy
      />
    );
    const { rerender } = render(step(restricted));
    fireEvent.change(
      screen.getByLabelText("Who can read the new channels in Exec"),
      { target: { value: "restricted" } },
    );
    const box = () =>
      screen.getByLabelText(/chapter-config:manage/) as HTMLInputElement;
    expect(box().checked).toBe(true);

    // Another control (the server-level one, or a row) makes the channel
    // whole-chapter while this panel stays open: the tick must go with it.
    rerender(
      step({
        ...restricted,
        "3": { ...restricted["3"], visibility: "chapter" as const },
      }),
    );
    expect(box().checked).toBe(false);
  });

  it("restricts every new channel in a category at once, and nothing outside it", () => {
    const { onChange } = renderStep();
    fireEvent.change(
      screen.getByLabelText("Who can read the new channels in Exec"),
      { target: { value: "restricted" } },
    );
    fireEvent.click(screen.getByLabelText(/chapter-config:manage/));
    const next = onChange.mock.calls.at(-1)![0] as Record<
      string,
      { action: string; visibility?: string; requiredPermissions?: string[] }
    >;
    expect(next["3"]).toMatchObject({
      visibility: "restricted",
      requiredPermissions: ["chapter-config:manage"],
    });
    expect(next["4"]).toEqual({ action: "skip" });
    expect(next["1"]!.visibility).toBe("chapter");
  });

  it("sets who can read every new channel in the server at once", () => {
    const { onChange } = renderStep();
    fireEvent.change(screen.getByLabelText("Who can read every new channel"), {
      target: { value: "chapter" },
    });
    const next = onChange.mock.calls.at(-1)![0] as Record<
      string,
      { action: string; visibility?: string }
    >;
    expect(next["3"]).toMatchObject({
      action: "create_new",
      visibility: "chapter",
    });
    expect(next["4"]).toEqual({ action: "skip" });
    expect(mappingIssues(channels, next as never, [])).toEqual([]);
  });

  it("skips a whole category in one click, and nothing outside it", () => {
    const { onChange } = renderStep();
    const skipButtons = screen.getAllByRole("button", { name: "Skip all" });
    // [0] is the global bar; group buttons follow in category order.
    fireEvent.click(skipButtons[1]!);
    const next = onChange.mock.calls[0]![0] as Record<
      string,
      { action: string }
    >;
    expect(next["1"]!.action).toBe("skip");
    expect(next["2"]!.action).toBe("skip");
    expect(next["3"]!.action).toBe("create_new");
  });

  it("never offers an unreadable channel for import, and says how to fix it", () => {
    const { onChange, onRescan } = renderStep();
    fireEvent.click(screen.getByRole("button", { name: "Import all as new" }));
    const next = onChange.mock.calls[0]![0] as Record<
      string,
      { action: string }
    >;
    expect(next["4"]!.action).toBe("skip");
    expect(screen.getByText("Frapp can't read these (1)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Scan again" }));
    expect(onRescan).toHaveBeenCalledTimes(1);
  });

  it("asks for the permissions when a channel is restricted, naming who holds them", () => {
    const choices = {
      ...defaultChoices(channels),
      "3": {
        action: "create_new" as const,
        newName: "cabinet",
        visibility: "restricted" as const,
        requiredPermissions: [],
      },
    };
    renderStep({ choices });
    expect(screen.getByText("chapter-config:manage")).toBeInTheDocument();
    expect(screen.getByText("Treasurer")).toBeInTheDocument();
    // A role's custom permission is offered even though the catalog lacks it.
    expect(screen.getByText("cabinet:read")).toBeInTheDocument();
  });

  it("keeps the permission grid through a failed catalog refresh", () => {
    catalogStale.value = true;
    try {
      const choices = {
        ...defaultChoices(channels),
        "3": {
          action: "create_new" as const,
          newName: "cabinet",
          visibility: "restricted" as const,
          requiredPermissions: [],
        },
      };
      renderStep({ choices });
      expect(screen.getByText("chapter-config:manage")).toBeInTheDocument();
      expect(
        screen.queryByText(/Couldn.t load the permission catalog/),
      ).toBeNull();
    } finally {
      catalogStale.value = false;
    }
  });

  it("warns on the upload path that an export does not say what was private", () => {
    renderStep({ knowsPrivacy: false, onRescan: undefined });
    expect(
      screen.getByText(/An export does not say which channels were private/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Scan again" }),
    ).not.toBeInTheDocument();
  });

  it("asks for a target when merging into an existing channel", () => {
    const choices = {
      ...defaultChoices(channels),
      "3": { action: "use_existing" as const },
    };
    renderStep({ choices });
    expect(screen.getByLabelText("Merge into")).toBeInTheDocument();
  });
});

describe("RoleMappingStep — Discord roles become Frapp roles (#2818)", () => {
  const frappRoles = [
    { id: "role-secretary", name: "Secretary", system_key: "SECRETARY" },
  ];

  it("says that nobody is put into a role", () => {
    render(
      <RoleMappingStep
        roles={[{ roleId: "r1", roleName: "Recording Secretary" }]}
        choices={{ r1: { action: "existing", roleId: "role-secretary" } }}
        matches={{ r1: "close" }}
        privateReads={new Map([["r1", 2]])}
        frappRoles={frappRoles}
        issues={[]}
        lock={null}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/Nobody is put into a role/)).toBeInTheDocument();
    // A guess is labelled as one, so the admin gives it a second look.
    expect(screen.getByText("Close match")).toBeInTheDocument();
    expect(
      screen.getByText("Could read 2 private channels"),
    ).toBeInTheDocument();
  });

  it("asks for the new role's name, and reports what blocks it in place", () => {
    const onChange = vi.fn();
    render(
      <RoleMappingStep
        roles={[{ roleId: "r1", roleName: "Rush Chair" }]}
        choices={{ r1: { action: "new", name: "" } }}
        matches={{}}
        privateReads={new Map()}
        frappRoles={frappRoles}
        issues={[
          { roleId: "r1", message: "Name the new role for Rush Chair." },
        ]}
        lock={null}
        onChange={onChange}
      />,
    );
    expect(
      screen.getByText("Name the new role for Rush Chair."),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("New role name"), {
      target: { value: "Rush" },
    });
    expect(onChange).toHaveBeenCalledWith("r1", {
      action: "new",
      name: "Rush",
    });
  });

  it("locks every role on Ignore, and says why, for a viewer who cannot manage roles", () => {
    render(
      <RoleMappingStep
        roles={[{ roleId: "r1", roleName: "Exec" }]}
        choices={{ r1: { action: "ignore" } }}
        matches={{}}
        privateReads={new Map()}
        frappRoles={frappRoles}
        issues={[]}
        lock={{ reason: "permission" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("Becomes")).toBeDisabled();
    expect(
      screen.getByText(/needs permission to manage roles/),
    ).toBeInTheDocument();
  });
});

describe("RoleMappingStep — when roles cannot be loaded (#2818)", () => {
  it("holds every role on Ignore, says why, and offers a retry", () => {
    const retry = vi.fn();
    render(
      <RoleMappingStep
        roles={[{ roleId: "r1", roleName: "Exec" }]}
        choices={{ r1: { action: "ignore" } }}
        matches={{}}
        privateReads={new Map()}
        frappRoles={[]}
        issues={[]}
        lock={{ reason: "unavailable", retry }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("Becomes")).toBeDisabled();
    expect(
      screen.getByText(/could not load your chapter.s roles/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
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

  it("does not confirm again when Back and Continue bring the step back", async () => {
    // The step unmounts on Back, and the one Continue mounts is fresh; the
    // token is one-time, so a second confirm can only be refused.
    connection.value = { connected: true, guild_name: "Tau Nu" };
    render(
      <ImportWizard
        onStarted={() => {}}
        onCancel={() => {}}
        initialSource="bot"
        initialStep="connect"
        handshake="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      />,
    );
    await waitFor(() => expect(confirmConnect).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByText(/Tau Nu/)).toBeInTheDocument());
    expect(confirmConnect).toHaveBeenCalledTimes(1);
  });

  it("withdraws Add to Server, with a reason, once the API has switched Connect off", async () => {
    // The API re-reads Discord before every connect, so it can withdraw the
    // flow while this step is open. A button that can only fail again is a
    // dead end; say why and point at the path that works.
    availability.value = { available: false };
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
        screen.getByText(/Connecting Discord is not available here right now/),
      ).toBeInTheDocument(),
    );
    expect(
      (
        screen.getByRole("button", {
          name: /Add to Server/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("keeps a connected chapter moving, and says why it cannot switch servers, while connecting is withdrawn", async () => {
    availability.value = { available: false };
    connection.value = { connected: true, guild_name: "Tau Nu" };
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
        screen.getByText(/Connecting a different server is not available/),
      ).toBeInTheDocument(),
    );
    expect(
      (
        screen.getByRole("button", {
          name: /Connect a different server/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    // Still moving: the only thing between it and Continue is saying the bot
    // has been given access to the channels.
    fireEvent.click(screen.getByRole("checkbox"));
    expect(
      (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("keeps the channel-access answer when the admin goes Back from consent", async () => {
    connection.value = { connected: true, guild_name: "Tau Nu" };
    render(
      <ImportWizard
        onStarted={() => {}}
        onCancel={() => {}}
        initialSource="bot"
        initialStep="connect"
      />,
    );
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: /given the Frapp bot a role that can see the channels/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      (
        (await screen.findByRole("checkbox", {
          name: /given the Frapp bot a role that can see the channels/,
        })) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });

  it("asks for the bot to be given channel access before the scan, and holds Continue until it has", async () => {
    connection.value = { connected: true, guild_name: "Tau Nu" };
    const onConnected = vi.fn();
    function Harness() {
      const [accessGiven, setAccessGiven] = useState(false);
      return (
        <ConnectStep
          onConnected={onConnected}
          accessGiven={accessGiven}
          onAccessGivenChange={setAccessGiven}
        />
      );
    }
    render(<Harness />);
    expect(
      await screen.findByText(
        /Give the bot access to the channels you want to import/,
      ),
    ).toBeInTheDocument();
    const next = screen.getByRole("button", { name: "Continue" });
    expect((next as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(next);
    expect(onConnected).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /given the Frapp bot a role that can see the channels/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onConnected).toHaveBeenCalledTimes(1);
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
