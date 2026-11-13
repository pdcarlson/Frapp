/**
 * People search in Direct messages (#4668, asked by Shawn 2026-11-12): what a
 * name typed into web's Direct messages search or the phone's Messages search
 * finds. Both run these rules.
 *
 * Two kinds of result, in this order, the way iMessage's and Instagram's
 * new-message search, Slack's DM switcher and Discord's "Find or start a
 * conversation" list them:
 *
 * 1. **Conversations** the member already has, a 1:1 DM matching on the other
 *    member's name and a group DM matching on any member's name or its title.
 * 2. **Members** they could start one with: everyone else on the roster with
 *    no conversation in the list, picked through `POST /v1/channels/dm`
 *    (get-or-create, so it also brings back a DM they hid).
 *
 * Who is offered as a member follows the member sheet's Message action (mobile
 * `start-dm.ts`, `spec/ui/mobile/screens.md` s13): never the viewer, never the
 * system actor, never a member the viewer blocked, and nobody at all until the
 * block list has been read, because a list that is still loading or failed to
 * load can be missing a block made earlier or on another device. Alumni are
 * offered like anyone else: they may post in direct conversations
 * (`spec/behavior/alumni.md`), so there is no alumni rule to apply here.
 *
 * Matching is the Find dialog's (`find-results.ts`): case-insensitive
 * substring, so "aul" finds Paul. It also ignores accents, folding and
 * splitting names as the channel member list's search does
 * (`channel-members.ts`), and ranks a name
 * that starts with the text above one with a word that does, above one that
 * only contains it; within a rank a 1:1 DM leads a group DM, then the order
 * the conversations came in holds.
 */
import { SYSTEM_SENDER_ID } from "@repo/validation";
import { foldForSearch, NAME_SEPARATORS } from "./channel-members";
import { resolveDisplayName, type DisplayNameMap } from "./display-names";

export interface DmSearchConversation {
  id: string;
  type: string;
  member_ids?: readonly string[] | null;
}

export interface DmSearchMember {
  user_id: string;
  display_name: string;
}

export interface DmSearchInput<C extends DmSearchConversation> {
  query: string;
  /**
   * The conversations to search, in the order to keep within a rank, hidden
   * ones left out: a hidden DM's member is offered as a member instead, and
   * picking them reopens it.
   */
  conversations: readonly C[];
  /** The row's title, as the list draws it (`directChannelDisplayName`). */
  titleOf: (conversation: C) => string;
  /** The chapter roster (`GET /v1/members/roster`). */
  roster: readonly DmSearchMember[];
  names: DisplayNameMap;
  viewerId: string | null;
  /** The viewer's block list ids, a floor until {@link blockListReady}. */
  blockedIds: ReadonlySet<string>;
  /** `useBlockedUserIds().status === "ready"`. */
  blockListReady: boolean;
}

export interface DmSearchResult<C> {
  conversations: C[];
  members: DmSearchMember[];
  /**
   * Members are held back because the viewer or the block list isn't known
   * yet. The caller says why under the conversations, as the member sheet's
   * Message row does, rather than reading as "nobody matches".
   */
  membersHeld: boolean;
}

/** Lowercased with accents and extra spaces taken off: "José " → "jose". */
export function normalizeDmSearchText(text: string): string {
  return foldForSearch(text).replace(/\s+/g, " ").trim();
}

/** 0 starts with it, 1 a word starts with it, 2 contains it, `null` no match. */
function rank(haystack: string, needle: string): number | null {
  const text = normalizeDmSearchText(haystack);
  const at = text.indexOf(needle);
  if (at === -1) return null;
  if (at === 0) return 0;
  let index = at;
  while (index !== -1) {
    if (NAME_SEPARATORS.test(text[index - 1] ?? "")) return 1;
    index = text.indexOf(needle, index + 1);
  }
  return 2;
}

function bestRank(haystacks: readonly string[], needle: string): number | null {
  let best: number | null = null;
  for (const haystack of haystacks) {
    const r = rank(haystack, needle);
    if (r !== null && (best === null || r < best)) best = r;
  }
  return best;
}

export function searchDirectMessages<C extends DmSearchConversation>({
  query,
  conversations,
  titleOf,
  roster,
  names,
  viewerId,
  blockedIds,
  blockListReady,
}: DmSearchInput<C>): DmSearchResult<C> {
  const needle = normalizeDmSearchText(query);
  if (!needle) {
    return { conversations: [...conversations], members: [], membersHeld: false };
  }

  const ranked: Array<{ conversation: C; rank: number; index: number }> = [];
  conversations.forEach((conversation, index) => {
    // Members' names only once the viewer is known: until then the viewer's
    // own name can't be told apart, and would match every conversation.
    const others =
      viewerId === null
        ? []
        : (conversation.member_ids ?? []).filter((id) => id !== viewerId);
    const haystacks = [
      titleOf(conversation),
      ...others
        .map((id) => resolveDisplayName(names, id))
        .filter((name): name is string => name !== null),
    ];
    const r = bestRank(haystacks, needle);
    if (r !== null) ranked.push({ conversation, rank: r, index });
  });
  // At an equal rank a 1:1 DM leads a group: typing a name is looking for
  // that person, and their own thread is the likelier answer.
  const groupRank = (row: { conversation: C }) =>
    row.conversation.type === "DM" ? 0 : 1;
  ranked.sort(
    (a, b) =>
      a.rank - b.rank || groupRank(a) - groupRank(b) || a.index - b.index,
  );

  if (viewerId === null || !blockListReady) {
    return {
      conversations: ranked.map((row) => row.conversation),
      members: [],
      membersHeld: true,
    };
  }

  // A member the list already holds a 1:1 DM with is found as that row.
  const inList = new Set<string>();
  for (const conversation of conversations) {
    if (conversation.type !== "DM") continue;
    const others = (conversation.member_ids ?? []).filter(
      (id) => id !== viewerId,
    );
    if (others.length === 1) inList.add(others[0]!);
  }

  const members: Array<{ member: DmSearchMember; rank: number }> = [];
  const seen = new Set<string>();
  for (const member of roster) {
    const id = member.user_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (id === viewerId || id === SYSTEM_SENDER_ID) continue;
    if (blockedIds.has(id) || inList.has(id)) continue;
    const r = rank(member.display_name ?? "", needle);
    if (r !== null) members.push({ member, rank: r });
  }
  members.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.member.display_name.localeCompare(b.member.display_name),
  );

  return {
    conversations: ranked.map((row) => row.conversation),
    members: members.map((row) => row.member),
    membersHeld: false,
  };
}

/** The field's placeholder on both clients: Discord's words for the same field. */
export const DM_SEARCH_PLACEHOLDER = "Find or start a conversation";

/** The heading over members with no conversation yet. */
export const DM_SEARCH_MEMBERS_HEADING = "Start a conversation";

export const DM_SEARCH_CONVERSATIONS_HEADING = "Conversations";

export function dmSearchNoMatches(query: string): string {
  return `No one in your chapter matches “${query.trim()}”.`;
}

/** Under the conversations while members are held ({@link DmSearchResult.membersHeld}). */
export const DM_SEARCH_CHECKING_BLOCK_LIST =
  "Checking your block list before listing other members.";
export const DM_SEARCH_BLOCK_LIST_FAILED =
  "Couldn't check your block list, so other members aren't listed.";
/** Under the conversations when the roster couldn't be read, with Try again. */
export const DM_SEARCH_ROSTER_FAILED =
  "Couldn't load your chapter's members, so only your conversations are listed.";

/**
 * The channel id out of a `POST /v1/channels/dm` response, or `null` when the
 * body has none, so a caller reports a failure instead of opening a thread
 * with no id. Every door that opens a DM by member reads it here, on web and
 * the phone.
 */
export function dmChannelIdOf(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const id = (data as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}
