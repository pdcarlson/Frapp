import { cookies } from "next/headers";
import { ChatPage } from "@/components/chat/chat-page";
import {
  CHAT_MEMBERS_HIDDEN_COOKIE,
  parseMembersHidden,
} from "@/lib/chat/members-panel";

export const metadata = {
  title: "Chat",
};

/**
 * Reads the member list's remembered state here, on the server, so the column
 * is right on first paint (`lib/chat/members-panel.ts`). The segment is
 * already dynamic: the dashboard layout reads the nav-collapse cookie.
 */
export default async function Chat() {
  const cookieStore = await cookies();
  return (
    <ChatPage
      defaultMembersHidden={parseMembersHidden(
        cookieStore.get(CHAT_MEMBERS_HIDDEN_COOKIE)?.value,
      )}
    />
  );
}
