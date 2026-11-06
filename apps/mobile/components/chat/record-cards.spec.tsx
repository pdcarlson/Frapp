/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import type {
  HoursPayload,
  PointsPayload,
  SystemAuditPayload,
} from "@repo/chat-core/cards";
import { SYSTEM_SENDER_ID } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText } from "@/test/screen-text";

/**
 * The mobile record cards (#3383): points, service hours, announcement and
 * audit. None of them writes anything; the hours card is the one that reads
 * (its entry's live review status). The row spec
 * (`thread-message-row.spec.tsx`) covers which kind draws which card; these
 * cases cover what each card says.
 */

const OWNER = "owner-1";
const OFFICER = "officer-1";

const state = vi.hoisted(() => ({
  /** `undefined`: the permissions read hasn't answered (loading, or failed). */
  permissions: [] as string[] | undefined,
  live: undefined as unknown,
  entryIds: [] as string[],
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useMyPermissions: () => ({
    data: state.permissions ? { permissions: state.permissions } : undefined,
  }),
  // The real hook is disabled on an empty id, so an empty id reads nothing.
  useServiceEntry: (id: string) => {
    state.entryIds.push(id);
    return { data: id ? state.live : undefined };
  },
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#C49A3A",
    accentPrimary: "#C49A3A",
    accentOnPrimary: "#2B2009",
    accentSubtle: "#251A33",
    accentBorder: "#5C3E8A",
    logoUrl: null,
    chapterName: null,
  }),
}));

import { signetDarkTokens } from "@repo/theme/signet";
import { AnnouncementCard } from "./announcement-card";
import { AuditGlyph, PointsGlyph } from "./card-glyphs";
import { HoursCard } from "./hours-card";
import { PointsCard } from "./points-card";
import { SystemAuditLine } from "./system-audit-card";

const tokens = signetDarkTokens;

function message(kind: string, payload: unknown): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "chan-1",
    sender_id: OWNER,
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
    content: "the server's sentence",
    kind,
    payload,
    reply_to_id: null,
    is_pinned: false,
    pinned_at: null,
    edited_at: null,
    is_deleted: false,
    created_at: "2026-11-04T18:00:00.000Z",
    client_message_id: "client-1",
    attachment_count: 0,
    sender_blocked: false,
    _blockEvaluated: true,
    reactions: {},
    actions: [],
    _status: "confirmed",
  } as unknown as ChatMessage;
}

const frame = (kind: string, payload: unknown, viewerId = OWNER) => ({
  message: message(kind, payload),
  viewerId,
  isConfirmed: true,
  onRetry: vi.fn(),
  onDiscard: vi.fn(),
  onReact: vi.fn(),
  onUnreact: vi.fn(),
  onOpenActions: vi.fn(),
});

function mount(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{element}</FrappThemeProvider>);
  });
  return tree;
}

const allText = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((node) => (node.type as unknown) === "Text")
    .map(drawnText)
    .join(" | ");

/** The `Text` that draws exactly this string. */
function textNode(tree: ReactTestRenderer, text: string) {
  return tree.root.find(
    (node) => (node.type as unknown) === "Text" && drawnText(node) === text,
  );
}

/** A style prop flattened, the way React Native would apply it. */
function flatStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flatStyle));
  }
  return style && typeof style === "object"
    ? (style as Record<string, unknown>)
    : {};
}

beforeEach(() => {
  // Every member role carries members:view, which the entry route requires.
  state.permissions = ["members:view"];
  state.live = undefined;
  state.entryIds = [];
});

describe("PointsCard", () => {
  const GRANT: PointsPayload = {
    actor_user_id: OFFICER,
    actor_name: "Alice",
    recipient_user_id: OWNER,
    recipient_name: "Bob",
    amount: 5,
    category: "MANUAL",
    reason: "Ran the philanthropy table",
    transaction_id: "txn-1",
    created_at: "2026-11-04T18:00:00.000Z",
  };

  it("states a grant in the success hue", () => {
    const tree = mount(
      <PointsCard {...frame("points", GRANT)} payload={GRANT} />,
    );
    expect(allText(tree)).toContain("Alice granted +5 points to Bob");
    expect(allText(tree)).toContain("“Ran the philanthropy table”");
    expect(flatStyle(textNode(tree, " +5 points").props.style).color).toBe(
      tokens.color.semantic.success,
    );
  });

  it("states a deduction in the destructive hue, with the typographic minus", () => {
    const fine = { ...GRANT, amount: -2, category: "FINE" as const };
    const tree = mount(<PointsCard {...frame("points", fine)} payload={fine} />);
    expect(allText(tree)).toContain("Alice deducted −2 points from Bob");
    expect(flatStyle(textNode(tree, " −2 points").props.style).color).toBe(
      tokens.color.semantic.destructive,
    );
  });

  // foundations.md §6 "Where the accent goes" (2026-11-05): a card's kind
  // label is a label, so its eyebrow is neutral, glyph and label alike.
  it("draws its eyebrow glyph and label muted, never in the chapter accent", () => {
    const tree = mount(
      <PointsCard {...frame("points", GRANT)} payload={GRANT} />,
    );
    const glyph = tree.root.findByType(PointsGlyph);
    expect(glyph.props.focused).toBe(false);
    expect(glyph.props.muted).toBe(tokens.color.text.mutedForeground);
    expect(glyph.props.accent).not.toBe("#C49A3A");
    expect(flatStyle(textNode(tree, "Points").props.style).color).toBe(
      tokens.color.text.mutedForeground,
    );
  });

  it("draws no empty quotes for a blank reason", () => {
    const bare = { ...GRANT, reason: "  " };
    const tree = mount(<PointsCard {...frame("points", bare)} payload={bare} />);
    expect(allText(tree)).not.toContain("“");
  });
});

describe("HoursCard", () => {
  const HOURS: HoursPayload = {
    entry_id: "entry-1",
    user_id: OWNER,
    user_name: "Casey Lin",
    duration_minutes: 90,
    description: "Food bank shift",
    date: "2026-11-04",
    status: "PENDING",
    created_at: "2026-11-04T18:00:00.000Z",
  };
  const render = (viewerId: string) =>
    mount(<HoursCard {...frame("hours", HOURS, viewerId)} payload={HOURS} />);

  it("says who logged how long, on which day, and what for", () => {
    const text = allText(render(OWNER));
    expect(text).toContain("Casey Lin logged 1h 30m on Nov 4, 2026");
    expect(text).toContain("“Food bank shift”");
  });

  it("draws no badge before the entry is read, never the snapshot's Pending", () => {
    const text = allText(render(OWNER));
    expect(state.entryIds).toContain("entry-1");
    expect(text).not.toContain("Pending review");
  });

  it("draws the live review status for the member who logged it", () => {
    state.live = { id: "entry-1", status: "APPROVED" };
    const tree = render(OWNER);
    expect(allText(tree)).toContain("Approved");
    expect(flatStyle(textNode(tree, "Approved").props.style).color).toBe(
      tokens.color.semantic.success,
    );
  });

  it("draws a rejection in the destructive hue, its text AA-lifted", () => {
    state.live = { id: "entry-1", status: "REJECTED" };
    const tree = render(OWNER);
    expect(flatStyle(textNode(tree, "Rejected").props.style).color).toBe(
      tokens.color.semantic.destructiveText,
    );
  });

  it("draws no empty quotes for a blank description", () => {
    const bare = { ...HOURS, description: "  " };
    const tree = mount(
      <HoursCard {...frame("hours", bare)} payload={bare} />,
    );
    expect(allText(tree)).not.toContain("“");
  });

  it("reads it for a service:approve holder too", () => {
    state.permissions = ["members:view", "service:approve"];
    state.live = { id: "entry-1", status: "PENDING" };
    const tree = render(OFFICER);
    expect(state.entryIds).toEqual(["entry-1"]);
    expect(flatStyle(textNode(tree, "Pending review").props.style).color).toBe(
      tokens.color.semantic.warning,
    );
  });

  it("asks nothing for anyone else, who would get a 403, and draws no badge", () => {
    state.live = { id: "entry-1", status: "REJECTED" };
    const text = allText(render(OFFICER));
    expect(state.entryIds.every((id) => id === "")).toBe(true);
    expect(text).not.toContain("Rejected");
  });

  it("asks nothing without members:view, which the route requires first", () => {
    state.permissions = ["service:approve"];
    state.live = { id: "entry-1", status: "APPROVED" };
    const text = allText(render(OWNER));
    expect(state.entryIds.every((id) => id === "")).toBe(true);
    expect(text).not.toContain("Approved");
  });

  it("lets only the member who logged it ask while the permissions read hasn't answered", () => {
    state.permissions = undefined;
    state.live = { id: "entry-1", status: "APPROVED" };
    expect(allText(render(OWNER))).toContain("Approved");
    state.entryIds = [];
    render(OFFICER);
    expect(state.entryIds.every((id) => id === "")).toBe(true);
  });

  it("never reads an empty viewer as the owner of an entry with no member id", () => {
    const orphan = { ...HOURS, user_id: "" };
    mount(<HoursCard {...frame("hours", orphan, "")} payload={orphan} />);
    expect(state.entryIds.every((id) => id === "")).toBe(true);
  });
});

describe("AnnouncementCard", () => {
  it("draws the text through the message markdown", () => {
    const tree = mount(
      <AnnouncementCard
        {...frame("announcement", null)}
        body="Chapter at **8**, formal dress"
      />,
    );
    const text = allText(tree);
    expect(text).toContain("Announcement");
    expect(text).toContain("Chapter at 8, formal dress");
    expect(text).not.toContain("**");
  });

  it("puts its links and the message actions on one accessible header", () => {
    const props = frame("announcement", null);
    const tree = mount(
      <AnnouncementCard {...props} body="RSVP at https://example.com/rsvp" />,
    );
    const host = tree.root.find(
      (node) =>
        (node.type as unknown) === "View" &&
        Array.isArray(node.props.accessibilityActions),
    );
    const names = (
      host.props.accessibilityActions as { name: string; label?: string }[]
    ).map((action) => action.label ?? action.name);
    expect(names.some((name) => name.startsWith("Open "))).toBe(true);
    act(() =>
      host.props.onAccessibilityAction({
        nativeEvent: { actionName: "longpress" },
      }),
    );
    expect(props.onOpenActions).toHaveBeenCalled();
  });
});

describe("SystemAuditLine", () => {
  const AUDIT: SystemAuditPayload = {
    action: "chapter_profile_updated",
    actor_user_id: OFFICER,
    diff: { accent_color: { from: "#C9A56F", to: "#7A2B8C" } },
  };
  const nameFor = (id: string) => (id === OFFICER ? "Alice" : null);
  const render = (payload: SystemAuditPayload) => {
    const { message: row, onReact, onUnreact, onOpenActions } = frame(
      "system_audit",
      payload,
    );
    return mount(
      <SystemAuditLine
        message={row}
        payload={payload}
        viewerId={OWNER}
        nameFor={nameFor}
        startsRun
        onReact={onReact}
        onUnreact={onUnreact}
        onOpenActions={onOpenActions}
      />,
    );
  };

  it("reads as a sentence: the actor, the action in words, the fields it touched", () => {
    const text = allText(render(AUDIT));
    expect(text).toContain("Alice ");
    expect(text).toContain("updated the chapter profile");
    expect(text).toContain(" · accent color");
    // Never the raw key, and no card chrome: no eyebrow, no mono.
    expect(text).not.toContain("chapter_profile_updated");
    expect(text).not.toContain("Audit");
  });

  it("names the system actor Frapp and an unknown member by the fallback", () => {
    expect(allText(render({ ...AUDIT, actor_user_id: SYSTEM_SENDER_ID }))).toContain(
      "Frapp ",
    );
    expect(
      allText(render({ ...AUDIT, actor_user_id: "9f8e7d6c-0000" })),
    ).toContain("Member 9f8e7d");
  });

  it("draws no actor for a system-originated row, and no detail when nothing changed", () => {
    const text = allText(render({ ...AUDIT, actor_user_id: null, diff: {} }));
    expect(text).not.toContain("Alice");
    expect(text).not.toContain(" · ");
  });

  it("draws the shield in the muted tone, never the chapter accent", () => {
    const glyph = render(AUDIT).root.findByType(AuditGlyph);
    expect(glyph.props.focused).toBe(false);
    expect(glyph.props.muted).toBe(tokens.color.text.muted);
    expect(glyph.props.accent).toBe(tokens.color.text.muted);
  });
});
