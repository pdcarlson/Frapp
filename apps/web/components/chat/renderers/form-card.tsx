"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { EYEBROW, MESSAGE_CARD } from "../chip";
import {
  FormFillDialog,
  useOpenForm,
  useSyncOpenForm,
} from "../form-fill-dialog";
import type { ChatMessage } from "@repo/chat-core/types";
import {
  CLOSE_FORM_LABEL,
  canCloseForm,
  fetchOwnFormResponse,
  formAnsweredState,
  formCardAction,
  formDeadlineLine,
  formQuestionCountLine,
  formResponseKey,
  isFormClosed,
  readFormPayload,
} from "@repo/chat-core/forms";
import {
  VIEW_RESPONSES_LABEL,
  isFormCreator,
} from "@repo/chat-core/form-responses";
import {
  useFrappClient,
  useMyPermissions,
  useNow,
  type NameResolver,
} from "@repo/hooks";
import { FormResponsesDialog } from "../form-responses-dialog";
import { can } from "@repo/validation";

interface FormCardProps {
  message: ChatMessage;
  /** Known, never `null`: see `MessageRendererProps.viewerId`. */
  viewerId: string;
  /** The row's roster lookup, for the names in the creator's responses. */
  nameFor: NameResolver;
  /** A pending optimistic row has no form to answer yet. */
  isConfirmed: boolean;
  /**
   * Close form, offered to the card's creator or a `channels:manage` holder
   * (`canCloseForm`). The caller confirms first (`ChatShell`).
   */
  onCloseCard?: (messageId: string, kind: "form") => void;
}

/**
 * A form card (`kind: "form"`, #3926 step 3): the form's title, how many
 * questions it asks, when it closes, and one button that opens the full-page
 * form (`FormFillDialog`): Fill out, or Edit your answers once the viewer has
 * sent theirs, marked done. Answers are never on the card; whether the viewer
 * has answered is their own read of the form-response route. Reading and the
 * words are `@repo/chat-core/forms`, shared with the phone's card.
 *
 * The member who posted it also gets **Responses** (#3926 step 4), which
 * opens everyone's answers (`FormResponsesDialog`); no one else does, as the
 * API decides.
 */
export function FormCard({
  message,
  viewerId,
  nameFor,
  isConfirmed,
  onCloseCard,
}: FormCardProps) {
  const payload = useMemo(() => readFormPayload(message), [message]);
  const apiClient = useFrappClient();
  const now = useNow();
  const canManageChannels = can(
    "channels:manage",
    useMyPermissions().data?.permissions,
  );
  const openInHost = useOpenForm();
  useSyncOpenForm(message);
  // Only outside the chat shell, which hosts the form for every card.
  const [openHere, setOpenHere] = useState(false);
  const [responsesOpen, setResponsesOpen] = useState(false);
  const own = useQuery({
    queryKey: formResponseKey(message.id),
    queryFn: () => fetchOwnFormResponse(apiClient, message.id),
    enabled: isConfirmed && !!payload,
    staleTime: 60_000,
  });

  if (!payload) {
    return (
      <div className="mt-1 rounded-lg border border-border bg-card p-4 text-base text-muted-foreground">
        Malformed form · {message.content}
      </div>
    );
  }

  const closed = isFormClosed(payload, now);
  const action = formCardAction(formAnsweredState(own.data), closed);
  const deadline = formDeadlineLine(payload, now);
  const showClose =
    !!onCloseCard &&
    canCloseForm(message, payload, viewerId, now, canManageChannels);
  const open = () => {
    if (openInHost) openInHost(message);
    else setOpenHere(true);
  };

  return (
    <Card
      className={cn(MESSAGE_CARD, "w-full min-w-[min(20rem,100%)] max-w-md")}
    >
      <p className={cn(EYEBROW, "text-muted-foreground")}>Form</p>
      <div className="mt-2 text-base font-bold">{payload.title}</div>
      {payload.description ? (
        <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-caption text-muted-foreground">
          {payload.description}
        </p>
      ) : null}
      <p className="mt-2 text-caption text-muted-foreground">
        {formQuestionCountLine(payload)}
        {deadline ? ` · ${deadline}` : ""}
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={action.done ? "secondary" : "default"}
            disabled={!isConfirmed}
            onClick={open}
          >
            {action.done ? (
              <Check className="h-4 w-4" aria-hidden="true" />
            ) : null}
            {action.label}
          </Button>
          {isFormCreator(message, viewerId) ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!isConfirmed}
              onClick={() => setResponsesOpen(true)}
            >
              {VIEW_RESPONSES_LABEL}
            </Button>
          ) : null}
        </div>
        {showClose ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto px-0"
            onClick={() => onCloseCard?.(message.id, "form")}
          >
            {CLOSE_FORM_LABEL}
          </Button>
        ) : null}
      </div>
      <FormResponsesDialog
        message={responsesOpen ? message : null}
        nameFor={nameFor}
        onOpenChange={setResponsesOpen}
      />
      {openInHost ? null : (
        <FormFillDialog
          message={openHere ? message : null}
          onOpenChange={setOpenHere}
        />
      )}
    </Card>
  );
}
