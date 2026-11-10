"use client";

import {
  errorCopy,
  useChapterChatBackground,
  useSetChapterChatBackground,
} from "@repo/hooks";
import { CHAPTER_PROFILE_PERMISSIONS } from "@repo/validation";
import { Can } from "@/components/shared/can";
import { SectionLabel } from "@/components/shared/section-label";
import { useChapterLetters } from "@/components/chat/chat-background";
import { ChatBackgroundPicker } from "@/components/chat/chat-background-picker";

/**
 * The chapter's default chat background (#3973): every channel without its own
 * background shows this one, and DMs stay plain. Set by whoever edits the
 * chapter profile (`CHAPTER_PROFILE_PERMISSIONS`, as the logo is); a channel's
 * own background is set from that channel's menu by `channels:manage`.
 */
export function ChatBackgroundDefaultCard() {
  return (
    <Can allOf={CHAPTER_PROFILE_PERMISSIONS}>
      <DefaultBackgroundSection />
    </Can>
  );
}

function DefaultBackgroundSection() {
  const current = useChapterChatBackground();
  const setDefault = useSetChapterChatBackground();
  const letters = useChapterLetters();
  return (
    <section aria-labelledby="ca-background-label" className="space-y-2">
      <SectionLabel id="ca-background-label">
        Default chat background
      </SectionLabel>
      <p className="text-sm text-muted-foreground">
        Every channel shows this unless it has its own, set from that
        channel&apos;s menu. DMs stay plain.
      </p>
      <div className="max-w-md rounded-lg border border-border">
        <ChatBackgroundPicker
          value={current.data?.background ?? "plain"}
          allowInherit={false}
          letters={letters}
          saving={setDefault.isPending}
          error={setDefault.error ? errorCopy(setDefault.error) : null}
          onPick={(pick) => {
            if (pick.background === null) return;
            setDefault.mutate({
              background: pick.background,
              photo: pick.photo
                ? {
                    body: pick.photo,
                    filename: pick.photo.name,
                    contentType: pick.photo.type,
                  }
                : undefined,
            });
          }}
        />
      </div>
    </section>
  );
}
