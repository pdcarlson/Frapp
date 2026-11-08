import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cardFilledContainers } from "@/tests/card-surfaces";
import { networkMock } from "@/tests/network";

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
  connectionRead,
  confirmPending,
  mockOffline,
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
  // The connection read's state, over a settled one, for its async states.
  connectionRead: { value: {} as Record<string, unknown> },
  // A confirm in flight.
  confirmPending: { value: false },
  mockOffline: { value: false },
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
  // The chapter already has a "Secret" group, spelled its own way.
  useCategories: () => ({ data: [{ id: "g-1", name: "secret" }] }),
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
    refetch: () => Promise.resolve(),
    ...connectionRead.value,
  }),
  useBeginDiscordConnect: () => ({
    mutateAsync: beginConnect,
    isPending: false,
  }),
  useConfirmDiscordConnect: () => ({
    mutateAsync: confirmConnect,
    isPending: confirmPending.value,
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

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock("@/lib/providers/network-provider", () => networkMock(mockOffline));

import { ImportWizard } from "./import-wizard";
import { SourceStep } from "./source-step";
import { ConnectStep } from "./connect-step";
import { DISCORD_NOTICE } from "./consent-step";
import { ChannelMappingStep } from "./channel-mapping-step";
import {
  defaultChoices,
  mappingIssues,
  type ChannelChoice,
} from "./mapping-issues";
import { RoleMappingStep } from "./role-mapping-step";
import { ReviewStep } from "./review-step";
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

/** Picks an option from one of the app's dropdowns (a Radix select). */
async function choose(trigger: HTMLElement, option: string) {
  const user = userEvent.setup();
  await user.click(trigger);
  await user.click(await screen.findByRole("option", { name: option }));
}

/** Opens every folded pile on the role step, so each row is on screen. */
function openRolePiles() {
  for (const pile of screen.queryAllByRole("button", { expanded: false })) {
    if (
      /^(Open private channels|Match your roles|Open no private channel)/.test(
        pile.textContent ?? "",
      )
    ) {
      fireEvent.click(pile);
    }
  }
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

  it("hands the officer the notice to post, and copying it is not consent", async () => {
    // The step used to describe a notice and leave the officer to write it.
    // Copying is the means, not the answer: the box still gates Continue.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<ImportWizard onStarted={() => {}} onCancel={() => {}} />);
    chooseUploadPath();

    expect(screen.getByText(DISCORD_NOTICE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(DISCORD_NOTICE));
    expect(
      await screen.findByRole("button", { name: "Message copied" }),
    ).toBeInTheDocument();
    expect(
      (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
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
    // Counted on the category its channel is in instead.
    expect(
      screen.getByRole("button", { name: /^No category/ }).textContent,
    ).toMatch(/1 channel · 1 thread · /);
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

  it("says once, on the channel step's own card, which channels Frapp cannot read", async () => {
    discoverChannels.mockResolvedValue({
      channels: [
        {
          discord_channel_id: "c1",
          discord_channel_name: "general",
          discord_category: null,
          parent_discord_channel_id: null,
          readable: true,
        },
        {
          discord_channel_id: "c2",
          discord_channel_name: "vault",
          discord_category: null,
          parent_discord_channel_id: null,
          readable: false,
        },
      ],
      roles: [],
      warnings: [
        "Frapp cannot read 1 channel(s) (#vault): Discord hides them from the bot.",
        "Private archived threads in #general could not be read",
      ],
    });

    await renderAtChannels();

    expect(
      await screen.findByText("Frapp can't read these (1)"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Frapp cannot read 1 channel/)).toBeNull();
    // Every other warning still shows.
    expect(
      screen.getByText(/Private archived threads in #general/),
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

  it("sends imported channels postable, read-only only where Discord made them so, and says which (#3697)", async () => {
    discoverChannels.mockResolvedValue({
      channels: [
        {
          discord_channel_id: "c1",
          discord_channel_name: "academics",
          discord_category: null,
          parent_discord_channel_id: null,
          readable: true,
          private_in_discord: false,
          read_only_in_discord: false,
        },
        {
          discord_channel_id: "c2",
          discord_channel_name: "announcements",
          discord_category: null,
          parent_discord_channel_id: null,
          readable: true,
          private_in_discord: false,
          read_only_in_discord: true,
        },
      ],
      roles: [],
      warnings: [],
    });

    await renderAtChannels();
    await screen.findByText(/Nothing needs attention/);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(setDiscoveredMapping).toHaveBeenCalled());
    const { channels } = setDiscoveredMapping.mock.calls[0]![0] as {
      channels: {
        discord_channel_id: string;
        new_channel_is_read_only?: boolean;
      }[];
    };
    expect(
      channels.map((row) => [
        row.discord_channel_id,
        row.new_channel_is_read_only,
      ]),
    ).toEqual([
      ["c1", false],
      ["c2", true],
    ]);
    fireEvent.click(
      await screen.findByRole("button", { name: /^1 read-only channel/ }),
    );
    expect(screen.getByText("#announcements")).toBeInTheDocument();
  });

  it("keeps Discord's categories as channel groups only when asked, and only the ones still ticked", async () => {
    discoverChannels.mockResolvedValue({
      channels: [
        {
          discord_channel_id: "c1",
          discord_channel_name: "random",
          discord_category: "Generic",
          discord_category_position: 2,
          parent_discord_channel_id: null,
          readable: true,
          private_in_discord: false,
        },
        {
          discord_channel_id: "c2",
          discord_channel_name: "vault",
          discord_category: "Secret",
          discord_category_position: 5,
          parent_discord_channel_id: null,
          readable: true,
          private_in_discord: false,
        },
        // Merges into the chapter's #general by default, so it stays put.
        {
          discord_channel_id: "c3",
          discord_channel_name: "general",
          discord_category: "Generic",
          discord_category_position: 2,
          parent_discord_channel_id: null,
          readable: true,
          private_in_discord: false,
        },
      ],
      roles: [],
      warnings: [],
    });

    await renderAtChannels();
    await screen.findByText(/Nothing needs attention/);

    const keep = screen.getByRole("switch", {
      name: /Keep Discord.s categories/,
    });
    // Off until the admin turns it on, and no per-category choice until then.
    expect(keep).not.toBeChecked();
    expect(
      screen.queryByRole("checkbox", { name: /as a category/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Every member sees category names/)).toBeVisible();

    // The preview lists the new channels; the merge stays where it is.
    const preview = () =>
      within(screen.getByRole("region", { name: "What chat will look like" }))
        .getAllByRole("list")
        .map((list) => [
          list.getAttribute("aria-label"),
          within(list)
            .getAllByRole("listitem")
            .map((item) => item.textContent),
        ]);
    expect(preview()).toEqual([["Channels", ["#random", "#vault"]]]);

    fireEvent.click(keep);
    // Secret joins the chapter's own "secret", which comes before any group
    // the import makes, under the chapter's spelling.
    expect(preview()).toEqual([
      ["secret", ["#vault"]],
      ["Generic", ["#random"]],
    ]);
    const secret = screen.getByRole("checkbox", {
      name: "Keep Secret as a category",
    });
    expect(secret).toBeChecked();
    fireEvent.click(secret);
    expect(preview()).toEqual([
      ["Channels", ["#vault"]],
      ["Generic", ["#random"]],
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(setDiscoveredMapping).toHaveBeenCalled());
    const { channels } = setDiscoveredMapping.mock.calls[0]![0] as {
      channels: { discord_channel_id: string; new_channel_group?: string }[];
    };
    expect(
      channels.map((row) => [row.discord_channel_id, row.new_channel_group]),
    ).toEqual([
      ["c1", "Generic"],
      ["c2", undefined],
      ["c3", undefined],
    ]);
    fireEvent.click(
      await screen.findByRole("button", { name: /^1 sidebar category/ }),
    );
    expect(screen.getByText("Generic")).toBeInTheDocument();
  });

  it("asks about like-named channels once keeping categories would send them to different ones", async () => {
    const rush = (id: string, category: string) => ({
      discord_channel_id: id,
      discord_channel_name: "rush",
      discord_category: category,
      parent_discord_channel_id: null,
      readable: true,
      private_in_discord: false,
    });
    discoverChannels.mockResolvedValue({
      channels: [rush("c1", "Actives"), rush("c2", "Alumni")],
      roles: [],
      warnings: [],
    });

    await renderAtChannels();
    // Off: both land in one #rush, as before.
    await screen.findByText(/Nothing needs attention/);

    fireEvent.click(
      screen.getByRole("switch", { name: /Keep Discord.s categories/ }),
    );

    expect(
      (await screen.findAllByText(/which category they go into/)).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
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

    await choose(screen.getByLabelText("Who can read it"), "Restricted");
    fireEvent.click(screen.getByLabelText(/Change chapter settings/));
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
    const preset = (name: string) =>
      fireEvent.click(screen.getByRole("radio", { name }));
    const startButton = () =>
      screen.getByRole("button", { name: "Start import" }) as HTMLButtonElement;

    it("imports all history by default, with no date box", async () => {
      await renderAtReview();
      expect(screen.getByRole("radio", { name: "Everything" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(screen.queryByLabelText("Import messages from")).toBeNull();
      expect(
        screen.getByText("The server's whole history comes over."),
      ).toBeInTheDocument();
      fireEvent.click(startButton());
      await waitFor(() =>
        expect(startImport).toHaveBeenCalledWith({ id: "import-1" }),
      );
    });

    it("sends a preset as the viewer's own midnight that many years back", async () => {
      vi.stubEnv("TZ", "America/Denver");
      try {
        await renderAtReview();
        preset("Last year");
        const start = new Date();
        start.setFullYear(start.getFullYear() - 1);
        start.setHours(0, 0, 0, 0);
        expect(
          screen.getByText(/Messages before .* are left out\./),
        ).toBeInTheDocument();
        fireEvent.click(startButton());
        await waitFor(() =>
          expect(startImport).toHaveBeenCalledWith({
            id: "import-1",
            messagesAfter: start.toISOString(),
          }),
        );
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("sends the chosen day as the viewer's own midnight", async () => {
      // Pinned away from UTC, or local and UTC midnight are the same instant
      // and a regression to UTC parsing would still pass (CI runs in UTC).
      vi.stubEnv("TZ", "America/Denver");
      try {
        await renderAtReview();
        preset("Pick a date");
        fireEvent.change(since(), { target: { value: "2024-06-01" } });
        expect(
          screen.getByText("Messages before Jun 1, 2024 are left out."),
        ).toBeInTheDocument();
        fireEvent.click(startButton());
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

    it("holds Start on Pick a date until a date is picked", async () => {
      await renderAtReview();
      preset("Pick a date");
      expect(
        screen.getByText("Pick a date, or choose Everything."),
      ).toBeInTheDocument();
      expect(startButton().disabled).toBe(true);
    });

    it("holds Start on a date in the future", async () => {
      await renderAtReview();
      preset("Pick a date");
      const nextYear = new Date().getFullYear() + 1;
      fireEvent.change(since(), { target: { value: `${nextYear}-01-01` } });
      expect(
        screen.getByText("Pick a date in the past, or choose Everything."),
      ).toBeInTheDocument();
      expect(startButton().disabled).toBe(true);
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
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Merge into"));
    expect(
      (await screen.findAllByRole("option")).map(
        (option) => option.textContent,
      ),
    ).toEqual(["#general"]);
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
    // What a role's dropdown reads, its piles opened first.
    const becomes = (roleName: string) => {
      openRolePiles();
      return screen.getByRole("combobox", { name: `${roleName} becomes` });
    };

    it("asks about roles before channels, defaulting by name, then a close match, then a new role", async () => {
      scanWithRoles();
      renderAtConsent();
      await screen.findByRole("heading", { name: "Map the roles" });

      // The roles that open private channels come first, and open; the
      // matched and the rest are folded.
      expect(
        screen.getByRole("button", { name: /^Open private channels/ }),
      ).toHaveAttribute("aria-expanded", "true");
      expect(
        screen.getByRole("button", { name: /^Match your roles/ }),
      ).toHaveAttribute("aria-expanded", "false");
      expect(
        screen.getByRole("button", { name: /^Open no private channel/ }),
      ).toHaveAttribute("aria-expanded", "false");

      expect(becomes("treasurer")).toHaveTextContent("Treasurer");
      expect(becomes("Recording Secretary")).toHaveTextContent("Secretary");
      // Matches nothing: a new role, whether or not it read a private
      // channel (#2855), because a role classifies people either way.
      expect(becomes("Rush Chair")).toHaveTextContent("New role");
      expect(becomes("Gamers")).toHaveTextContent("New role");

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
      expect(
        await screen.findByRole("button", { name: /^Creating 2 roles/ }),
      ).toBeInTheDocument();
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
      await choose(becomes("Rush Chair"), "Skip");
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      await screen.findByRole("heading", { name: "Map the channels" });

      // #exec keeps Treasurer, so it stays Same as Discord, narrower than
      // Discord, and says who it leaves out; #rush has no mapped reader left
      // and needs a choice. (Its group is open already: it has an issue.)
      expect(
        await screen.findByText(
          "Readable by Treasurer. Left out, because they are set to Skip: Rush Chair.",
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

    it("still lets the import go on, every role on Skip, when the chapter's roles cannot be loaded", async () => {
      // GET /v1/roles needs members:view, which channels:manage does not
      // imply; an all-Skip mapping needs no roles to map to.
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

    it("holds every role on Skip, and saves exactly that, when the viewer's permissions cannot be loaded", async () => {
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
      expect(becomes("treasurer")).toHaveTextContent("Treasurer");
    });

    it("keeps every role on Skip for a viewer who cannot manage roles", async () => {
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

  it("offers to keep a Discord category named like the no-category heading, apart from channels in none", () => {
    const named = [
      {
        channelId: "a",
        channelName: "loose",
        category: null,
        readable: true,
        privateInDiscord: false,
      },
      {
        channelId: "b",
        channelName: "odd",
        category: "No category",
        readable: true,
        privateInDiscord: false,
      },
    ];
    const choices = defaultChoices(named);
    render(
      <ChannelMappingStep
        channels={named}
        choices={choices}
        onChange={vi.fn()}
        issues={mappingIssues(named, choices, [])}
        knowsPrivacy
        sidebarGroups={{ keep: true, dropped: new Set() }}
        onSidebarGroups={vi.fn()}
      />,
    );
    // Two sections, and only the real category can be kept.
    expect(
      screen.getAllByRole("checkbox", { name: /as a category/ }),
    ).toHaveLength(1);
    expect(
      screen.getByRole("checkbox", { name: "Keep No category as a category" }),
    ).toBeChecked();
  });

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

  it("collapses the groups a bulk answer settles, so an answered export is not left fully expanded", async () => {
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
    await choose(
      screen.getByLabelText("Who can read every new channel"),
      "Whole chapter",
    );
    expect(screen.getByText(/Nothing needs attention/)).toBeInTheDocument();
    expect(screen.queryByText("#announcements")).not.toBeInTheDocument();
  });

  it("ticks a bulk permission only while every new channel in scope holds it, and shows what they hold", () => {
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
    const exec = () =>
      screen.getByLabelText("Who can read the new channels in Exec");
    // Every new channel in Exec is restricted, so the control says so; its
    // grid opens on picking Restricted, with the shared permission ticked.
    expect(exec()).toHaveTextContent("Restricted");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Permissions for the new channels in Exec",
      }),
    );
    expect(
      (screen.getByLabelText(/Change chapter settings/) as HTMLInputElement)
        .checked,
    ).toBe(true);

    // Another control (the server-level one, or a row) makes the channel
    // whole-chapter: the control follows, and no grid claims a restriction.
    rerender(
      step({
        ...restricted,
        "3": { ...restricted["3"], visibility: "chapter" as const },
      }),
    );
    expect(exec()).toHaveTextContent("Whole chapter");
    expect(screen.queryByLabelText(/Change chapter settings/)).toBeNull();
  });

  it("restricts every new channel in a category at once, and nothing outside it", async () => {
    function Harness() {
      const [choices, setChoices] = useState(() => defaultChoices(channels));
      return (
        <ChannelMappingStep
          channels={channels}
          choices={choices}
          onChange={(next) => {
            onChange(next);
            setChoices(next);
          }}
          issues={mappingIssues(channels, choices, [])}
          knowsPrivacy
        />
      );
    }
    const onChange = vi.fn();
    render(<Harness />);
    await choose(
      screen.getByLabelText("Who can read the new channels in Exec"),
      "Restricted",
    );
    // It sticks, and the grid opens to say who. The category's grid comes
    // first; #cabinet's own opens below it, since it now needs an answer.
    expect(
      screen.getByLabelText("Who can read the new channels in Exec"),
    ).toHaveTextContent("Restricted");
    fireEvent.click(screen.getAllByLabelText(/Change chapter settings/)[0]!);
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

  it("sets who can read every new channel in the server at once", async () => {
    const { onChange } = renderStep();
    // #cabinet's readers are unknown, so it has no answer yet and the
    // channels do not all agree.
    expect(
      screen.getByLabelText("Who can read every new channel"),
    ).toHaveTextContent("Mixed");
    await choose(
      screen.getByLabelText("Who can read every new channel"),
      "Whole chapter",
    );
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

  it("reads Same as Discord on the defaults, and Mixed once one channel differs", () => {
    const known = channels.map((channel) =>
      channel.channelId === "3"
        ? { ...channel, readerRoleIds: ["r-exec"] }
        : channel,
    );
    const readersOf = (channel: { channelId: string }) =>
      channel.channelId === "3" ? { roles: ["Cabinet"], ignored: [] } : null;
    const choices = defaultChoices(known);
    choices["3"] = { ...choices["3"]!, visibility: "discord" };
    const props = {
      channels: known,
      onChange: vi.fn(),
      knowsPrivacy: true,
      readersOf,
    };
    const { rerender } = render(
      <ChannelMappingStep
        {...props}
        choices={choices}
        issues={mappingIssues(known, choices, [], readersOf)}
      />,
    );
    const server = () =>
      screen.getByLabelText("Who can read every new channel");
    expect(server()).toHaveTextContent("Same as Discord");

    const restricted = {
      ...choices,
      "1": {
        ...choices["1"]!,
        visibility: "restricted" as const,
        requiredPermissions: ["members:view"],
      },
    };
    rerender(
      <ChannelMappingStep
        {...props}
        choices={restricted}
        issues={mappingIssues(known, restricted, [], readersOf)}
      />,
    );
    expect(server()).toHaveTextContent("Mixed");
  });

  it("goes back to Mixed after a pick made from Mixed, once a channel differs", async () => {
    const onChange = vi.fn();
    const props = {
      channels,
      onChange,
      knowsPrivacy: true,
      readersOf: () => null,
    };
    const restrictOne = (choices: Record<string, ChannelChoice>) => ({
      ...choices,
      "1": {
        ...choices["1"]!,
        visibility: "restricted" as const,
        requiredPermissions: ["members:view"],
      },
    });
    const mixed = restrictOne(defaultChoices(channels));
    const { rerender } = render(
      <ChannelMappingStep
        {...props}
        choices={mixed}
        issues={mappingIssues(channels, mixed, [], () => null)}
      />,
    );
    const server = () =>
      screen.getByLabelText("Who can read every new channel");
    expect(server()).toHaveTextContent("Mixed");

    await choose(server(), "Whole chapter");
    const picked = onChange.mock.calls.at(-1)![0] as Record<
      string,
      ChannelChoice
    >;
    rerender(
      <ChannelMappingStep
        {...props}
        choices={picked}
        issues={mappingIssues(channels, picked, [], () => null)}
      />,
    );
    expect(server()).toHaveTextContent("Whole chapter");

    const again = restrictOne(picked);
    rerender(
      <ChannelMappingStep
        {...props}
        choices={again}
        issues={mappingIssues(channels, again, [], () => null)}
      />,
    );
    expect(server()).toHaveTextContent("Mixed");
  });

  it("keeps a channel's own permissions when the server picks Restricted", async () => {
    const onChange = vi.fn();
    const choices = {
      ...defaultChoices(channels),
      "1": {
        ...defaultChoices(channels)["1"]!,
        visibility: "restricted" as const,
        requiredPermissions: ["billing:manage"],
      },
    };
    render(
      <ChannelMappingStep
        channels={channels}
        onChange={onChange}
        knowsPrivacy
        readersOf={() => null}
        choices={choices}
        issues={mappingIssues(channels, choices, [], () => null)}
      />,
    );
    await choose(
      screen.getByLabelText("Who can read every new channel"),
      "Restricted",
    );
    const next = onChange.mock.calls.at(-1)![0] as Record<
      string,
      ChannelChoice
    >;
    expect(next["1"]!.requiredPermissions).toEqual(["billing:manage"]);
    for (const [id, choice] of Object.entries(next)) {
      if (choice.action === "create_new") {
        expect([id, choice.visibility]).toEqual([id, "restricted"]);
      }
    }
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
    expect(screen.getByText("Change chapter settings")).toBeInTheDocument();
    expect(screen.getByText("Treasurer")).toBeInTheDocument();
    // A role's custom permission is offered even though the catalog lacks it.
    expect(screen.getByText("Read cabinet")).toBeInTheDocument();
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
      expect(screen.getByText("Change chapter settings")).toBeInTheDocument();
      expect(
        screen.queryByText(/Couldn.t load the permission list/),
      ).toBeNull();
    } finally {
      catalogStale.value = false;
    }
  });

  it("warns on the upload path that an export does not say what was private", () => {
    renderStep({ knowsPrivacy: false, onRescan: undefined });
    expect(
      screen.getByText(/An export doesn.t say which channels were private/),
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
    expect(screen.getByText(/Nobody is added to a role/)).toBeInTheDocument();
    openRolePiles();
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
    // The name is a problem, so its pile and its name box open by themselves.
    expect(
      screen.getByText("Name the new role for Rush Chair."),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("New role name for Rush Chair"), {
      target: { value: "Rush" },
    });
    expect(onChange).toHaveBeenCalledWith("r1", {
      action: "new",
      name: "Rush",
    });
  });

  it("sorts roles into piles by what they do, opening only the ones that open channels", () => {
    render(
      <RoleMappingStep
        roles={[
          { roleId: "r1", roleName: "Gym" },
          { roleId: "r2", roleName: "Cabinet" },
          { roleId: "r3", roleName: "Recording Secretary" },
          { roleId: "r4", roleName: "Mod Assist" },
        ]}
        choices={{
          r1: { action: "new", name: "Gym" },
          r2: { action: "new", name: "Cabinet" },
          r3: { action: "existing", roleId: "role-secretary" },
          r4: { action: "new", name: "Mod Assist" },
        }}
        matches={{ r3: "close" }}
        privateReads={
          new Map([
            ["r2", 14],
            ["r3", 8],
            ["r4", 31],
          ])
        }
        frappRoles={frappRoles}
        issues={[]}
        lock={null}
        onChange={() => {}}
      />,
    );
    // Most channels first, in the open pile; the others are folded.
    const open = screen.getByRole("list");
    expect(
      within(open)
        .getAllByRole("combobox")
        .map((box) => box.getAttribute("aria-label")),
    ).toEqual(["Mod Assist becomes", "Cabinet becomes"]);
    expect(
      screen.getByRole("button", { name: /^Match your roles/ }),
    ).toHaveTextContent("1 close match to check");
    expect(
      screen.queryByRole("combobox", { name: "Gym becomes" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a role in its pile while it is changed", () => {
    render(
      <RoleMappingStep
        roles={[
          { roleId: "r1", roleName: "Treasurer" },
          { roleId: "r2", roleName: "Cabinet" },
        ]}
        choices={{
          // Was matched to Treasurer; the admin has just set it to Skip.
          r1: { action: "ignore" },
          r2: { action: "new", name: "Cabinet" },
        }}
        matches={{}}
        startingMatches={{ r1: "same-name" }}
        privateReads={new Map([["r2", 3]])}
        frappRoles={frappRoles}
        issues={[]}
        lock={null}
        onChange={() => {}}
      />,
    );
    const pile = screen.getByRole("button", { name: /^Match your roles/ });
    fireEvent.click(pile);
    const body = document.getElementById(pile.getAttribute("aria-controls")!)!;
    expect(
      within(body).getByRole("combobox", { name: "Treasurer becomes" }),
    ).toHaveTextContent("Skip");
  });

  it("opens a pile on a problem and shows its row, past the limit too", () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      roleId: `r${index}`,
      roleName: `Role ${index}`,
    }));
    render(
      <RoleMappingStep
        roles={many}
        choices={Object.fromEntries(
          many.map((role) => [
            role.roleId,
            { action: "new" as const, name: role.roleName },
          ]),
        )}
        matches={{}}
        privateReads={new Map()}
        frappRoles={frappRoles}
        issues={[
          { roleId: "r19", message: "A role named Role 19 already exists." },
        ]}
        lock={null}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: /^Open no private channel/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("combobox", { name: "Role 19 becomes" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("A role named Role 19 already exists."),
    ).toBeInTheDocument();
    // The rest of the overflow stays folded.
    expect(
      screen.queryByRole("combobox", { name: "Role 18 becomes" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show 4 more" }),
    ).toBeInTheDocument();
  });

  it("acts on every ticked role at once, and on a whole pile", () => {
    const onChange = vi.fn();
    render(
      <RoleMappingStep
        roles={[
          { roleId: "r1", roleName: "Monkey Tree" },
          { roleId: "r2", roleName: "Stonk Trader" },
          { roleId: "r3", roleName: "Cabinet" },
          { roleId: "r4", roleName: "Muted" },
          { roleId: "r5", roleName: "Minecraft" },
        ]}
        choices={{
          r1: { action: "new", name: "Monkey Tree" },
          r2: { action: "new", name: "Stonk Trader" },
          r3: { action: "new", name: "Cabinet" },
          r4: { action: "new", name: "Muted" },
          r5: { action: "new", name: "Minecraft" },
        }}
        matches={{}}
        privateReads={
          new Map([
            ["r1", 1],
            ["r2", 1],
            ["r3", 14],
          ])
        }
        frappRoles={frappRoles}
        issues={[]}
        lock={null}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("Select Monkey Tree"));
    fireEvent.click(screen.getByLabelText("Select Stonk Trader"));
    const bar = screen.getByRole("region", { name: "Selected roles" });
    expect(bar).toHaveTextContent("2 selected");
    fireEvent.click(within(bar).getByRole("button", { name: "Skip" }));
    expect(onChange.mock.calls).toEqual([
      ["r1", { action: "ignore" }],
      ["r2", { action: "ignore" }],
    ]);
    // The selection clears, so the bar goes.
    expect(
      screen.queryByRole("region", { name: "Selected roles" }),
    ).not.toBeInTheDocument();

    onChange.mockClear();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Skip every role in Open no private channel",
      }),
    );
    expect(onChange.mock.calls).toEqual([
      ["r4", { action: "ignore" }],
      ["r5", { action: "ignore" }],
    ]);
  });

  it("locks every role on Skip, and says why, for a viewer who cannot manage roles", () => {
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
    openRolePiles();
    expect(
      screen.getByRole("combobox", { name: "Exec becomes" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/needs permission to manage roles/),
    ).toBeInTheDocument();
  });
});

describe("RoleMappingStep — when roles cannot be loaded (#2818)", () => {
  it("holds every role on Skip, says why, and offers a retry", () => {
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
    openRolePiles();
    expect(
      screen.getByRole("combobox", { name: "Exec becomes" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/could not load your chapter.s roles/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("ReviewStep — a summary you can scan", () => {
  const channels = [
    { channelId: "1", channelName: "general", category: null },
    {
      channelId: "2",
      channelName: "cabinet",
      category: null,
      privateInDiscord: true,
    },
    { channelId: "3", channelName: "memes", category: null },
    { channelId: "4", channelName: "links", category: null },
    { channelId: "5", channelName: "vault", category: null, readable: false },
    { channelId: "6", channelName: "old-news", category: null },
    {
      channelId: "7",
      channelName: "exec",
      category: null,
      privateInDiscord: true,
    },
  ];
  const roles = Array.from({ length: 30 }, (_, index) => ({
    roleId: `r${index}`,
    roleName: `Role ${index}`,
  }));

  it("leads with counts, folds the lists, and notes only what differs", () => {
    render(
      <ReviewStep
        staged={
          {
            channels,
            roles,
            guildName: null,
            exportCount: 0,
            mediaCount: 0,
            resumedCount: 0,
          } as never
        }
        serverName="Phi Gamma Delta"
        source="bot"
        channelChoices={{
          "1": { action: "use_existing", targetChannelId: "ch-1" },
          "2": {
            action: "create_new",
            newName: "cabinet",
            visibility: "discord",
          },
          "3": {
            action: "create_new",
            newName: "memes",
            visibility: "chapter",
          },
          "4": {
            action: "create_new",
            newName: "resources",
            visibility: "chapter",
          },
          "5": { action: "skip" },
          "6": { action: "skip" },
          // Private in Discord, opened to everyone: the one note that warns.
          "7": {
            action: "create_new",
            newName: "exec",
            visibility: "chapter",
          },
        }}
        roles={roles}
        roleChoices={Object.fromEntries(
          roles.map((role) => [
            role.roleId,
            { action: "new" as const, name: role.roleName },
          ]),
        )}
        readersOf={() => null}
      />,
    );
    expect(
      screen.getByText(/Phi Gamma Delta, read by the Frapp bot/),
    ).toBeInTheDocument();

    // Importing is open, one line per channel, a note only where it differs.
    const importing = screen.getByRole("button", {
      name: /^Importing 5 channels/,
    });
    expect(importing).toHaveAttribute("aria-expanded", "true");
    expect(importing).toHaveTextContent("1 private · 1 merged");
    expect(screen.getByText("into #general")).toBeInTheDocument();
    expect(screen.getByText("from #links")).toBeInTheDocument();
    expect(screen.getByText("whole chapter")).toBeInTheDocument();
    expect(screen.queryByText(/same as Discord/)).toBeNull();

    // Skipped and roles are counts until opened.
    expect(
      screen.getByRole("button", { name: /^Skipping 2/ }),
    ).toHaveTextContent("1 Frapp can\u2019t read");
    expect(screen.queryByText("#old-news")).toBeNull();
    const created = screen.getByRole("button", { name: /^Creating 30 roles/ });
    expect(screen.queryByText("Role 0")).toBeNull();
    fireEvent.click(created);
    expect(screen.getByText("Role 0")).toBeInTheDocument();
    // A long list shows its first two dozen, and the rest on request.
    expect(screen.queryByText("Role 29")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all 30" }));
    expect(screen.getByText("Role 29")).toBeInTheDocument();
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

describe("ConnectStep — its async states, on the page surface (#2500)", () => {
  beforeEach(() => {
    availability.value = { available: true };
    connection.value = { connected: false };
  });
  afterEach(() => {
    connectionRead.value = {};
    confirmPending.value = false;
    mockOffline.value = false;
  });

  function renderConnect() {
    return render(
      <ImportWizard
        onStarted={() => {}}
        onCancel={() => {}}
        initialSource="bot"
        initialStep="connect"
      />,
    );
  }

  it("says the connection could not be checked, naming it, with Retry", () => {
    connectionRead.value = { data: undefined, isError: true };
    const { container } = renderConnect();

    expect(
      screen.getByText("Couldn't check the Discord connection"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Unable to load data")).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(cardFilledContainers(container)).toEqual([]);
  });

  it("says it can't check offline, rather than checking for ever", () => {
    connectionRead.value = {
      data: undefined,
      isPending: true,
      fetchStatus: "paused",
    };
    const { container } = renderConnect();

    expect(screen.getByText("Can't check Discord offline")).toBeInTheDocument();
    expect(screen.queryByText(/Checking whether Discord/)).toBeNull();
    expect(cardFilledContainers(container)).toEqual([]);
  });

  // Offline, a read either pauses or (the API unreachable, a page restored
  // offline) fails; both are offline, not a failure to check.
  it("says it can't check offline when the read failed while offline", () => {
    mockOffline.value = true;
    connectionRead.value = { data: undefined, isError: true };
    renderConnect();

    expect(screen.getByText("Can't check Discord offline")).toBeInTheDocument();
    expect(
      screen.queryByText("Couldn't check the Discord connection"),
    ).toBeNull();
  });

  it("keeps the last answer through a refetch that fails", () => {
    connection.value = { connected: true, guild_name: "Tau Nu" };
    connectionRead.value = { isError: true };
    renderConnect();

    expect(screen.getByText(/Connected to Tau Nu/)).toBeInTheDocument();
    expect(
      screen.queryByText("Couldn't check the Discord connection"),
    ).toBeNull();
    // And says it is the last answer: the bot may have been removed since.
    expect(
      screen
        .getByText(
          "Couldn't recheck the Discord connection. This is the last answer that loaded.",
        )
        .closest('[role="status"]'),
    ).not.toBeNull();
  });

  it("says a 'not connected' answer is the last that loaded, too", () => {
    // The bot may have been added since; the pitch to add it is then stale.
    connectionRead.value = { isError: true };
    renderConnect();

    expect(
      screen.getByRole("button", { name: /Add to Server/ }),
    ).toBeInTheDocument();
    expect(
      screen
        .getByText(
          "Couldn't recheck the Discord connection. This is the last answer that loaded.",
        )
        .closest('[role="status"]'),
    ).not.toBeNull();
  });

  it("announces the confirm while it runs", () => {
    confirmPending.value = true;
    const { container } = renderConnect();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Confirming your Discord server…",
    );
    expect(cardFilledContainers(container)).toEqual([]);
  });

  it("announces the check while it runs", () => {
    connectionRead.value = {
      data: undefined,
      isPending: true,
      fetchStatus: "fetching",
    };
    const { container } = renderConnect();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking whether Discord is connected…",
    );
    expect(cardFilledContainers(container)).toEqual([]);
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
    // token was spent, so a second confirm could only be refused.
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

  // The API answers a spent, expired or other chapter's token with one 400.
  // Anything else (a 503 while Discord is withdrawn, a request that never
  // arrived) returned before it touched the token, which can still connect.
  it.each([
    { refusal: "a 400, which spent it", error: { statusCode: 400 }, calls: 1 },
    { refusal: "a 503, which did not", error: { statusCode: 503 }, calls: 2 },
    {
      refusal: "a request that never arrived",
      error: new TypeError("Failed to fetch"),
      calls: 2,
    },
  ])(
    "after $refusal, Back and Continue leave $calls confirm(s) in all",
    async ({ error, calls }) => {
      confirmConnect.mockRejectedValueOnce(error);
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
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Back" })).toBeEnabled(),
      );

      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      await waitFor(() => expect(confirmConnect).toHaveBeenCalledTimes(calls));
      // Settled: no third attempt follows.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(confirmConnect).toHaveBeenCalledTimes(calls);
    },
  );

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
          confirmError={null}
          onConfirmErrorChange={() => {}}
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

  it("still shows why the confirmation was refused after Back and Continue", async () => {
    // A refused token is not sent again, so the step that comes back has to
    // be told the reason rather than learn it from a second refusal.
    confirmConnect.mockRejectedValueOnce(
      Object.assign(
        new Error("That Discord confirmation does not belong to this chapter."),
        { statusCode: 400 },
      ),
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
      await screen.findByText(/does not belong to this chapter/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText(/does not belong to this chapter/),
    ).toBeInTheDocument();
    expect(confirmConnect).toHaveBeenCalledTimes(1);
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
