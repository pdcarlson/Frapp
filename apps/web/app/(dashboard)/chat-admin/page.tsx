import { ChatAdminPage } from "@/components/chat-admin/chat-admin-page";

export const metadata = { title: "Chat admin" };

/** `?channel=<id>` opens that channel's editor (the channel start's Edit channel). */
export default async function ChatAdmin({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string | string[] }>;
}) {
  const { channel } = await searchParams;
  const initialChannelId = typeof channel === "string" ? channel : null;
  return <ChatAdminPage initialChannelId={initialChannelId} />;
}
