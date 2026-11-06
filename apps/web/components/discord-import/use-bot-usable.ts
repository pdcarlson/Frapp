import { useDiscordAvailability, useDiscordConnection } from "@repo/hooks";

/**
 * Whether "Connect Discord" can be offered. Availability is about STARTING a
 * connect. A chapter that is already connected can import whatever it says:
 * the import reads through the bot token and the stored guild, and fails
 * loudly on its own if the token is dead. Gating it on availability would
 * block an import the API accepts just because, say, the portal lost a
 * redirect row nobody now needs.
 */
export function useBotUsable(): boolean {
  const availability = useDiscordAvailability();
  const botConnection = useDiscordConnection();
  return (
    availability.data?.available === true ||
    botConnection.data?.connected === true
  );
}
