import { selectChannels, type ChannelSummary } from "@/lib/chat/channel-list";

/**
 * Channels s03 lists as "you have been added to".
 *
 * Default seed is `#general`, `#announcements`, `#chapter-audit` (PUBLIC) and
 * `#alumni` (ROLE_GATED). Member-facing copy names only the public ones
 * (`spec/behavior/onboarding.md`). The list is whatever `GET /v1/channels`
 * actually returned — Canvas draws an `#events` row that is not a default
 * channel, so it is omitted unless the chapter really has one.
 */
export function selectJoinedPublicChannels(data: unknown): ChannelSummary[] {
  return selectChannels(data).filter((channel) => channel.type === "PUBLIC");
}

export function displayChannelLabel(name: string): string {
  const trimmed = name.trim();
  if (trimmed.startsWith("#")) return trimmed;
  return `#${trimmed}`;
}
