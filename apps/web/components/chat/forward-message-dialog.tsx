"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { randomClientId } from "@repo/api-sdk";
import type { ForwardTarget } from "@repo/chat-core/forward";
import {
  useChannels,
  useForwardMessage,
  useMemberDisplayNames,
} from "@repo/hooks";
import {
  FORWARD_COMMENT_PLACEHOLDER,
  FORWARD_DONE_ANNOUNCEMENT,
  FORWARD_NO_DESTINATIONS,
  FORWARD_NO_MATCHES,
  FORWARD_SEARCH_PLACEHOLDER,
  FORWARD_SEND_LABEL,
  FORWARD_SHEET_TITLE,
  filterForwardDestinations,
  forwardDestinations,
  forwardFailureBody,
  type ForwardableChannel,
} from "@repo/hooks/forward-destinations";
import { CHAT_MESSAGE_CONTENT_MAX_LENGTH } from "@repo/validation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FOCUS_RING_OFFSET_HAS_VISIBLE } from "@/components/ui/focus";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/lib/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ForwardedCard } from "./forwarded-card";

/**
 * Forward to (#4907, `spec/behavior/chat/README.md` § Forward), web's half of
 * the phone's Forward sheet: pick one channel or DM the viewer can post in,
 * add a message if they like, and Send. Discord's desktop Forward and Slack's
 * Share message are both a dialog over the chat with a search, the
 * conversations, the message being passed on and a field for your own words;
 * this is that, one destination at a time as the phone does.
 *
 * The conversations, the search and the failure wording are
 * `@repo/hooks/forward-destinations`', the phone's own, so both pickers offer
 * the same places (postable only, no hidden DMs, no audit log) and say the
 * same things.
 *
 * Keyed by the caller on the message, so another message opens a fresh form.
 * It can't be closed while the request is out, as the report dialog can't:
 * closing would drop the answer, and a failure would reach no one. One
 * idempotency key is kept per draft (the destination and comment), so Send
 * again after a lost response answers the forward already made.
 *
 * The new row reaches the destination's timeline over Realtime like any post,
 * the open channel's included; success closes the dialog and says Forwarded.
 */
export function ForwardMessageDialog({
  target,
  nameFor,
  viewerId,
  onClose,
}: {
  target: ForwardTarget | null;
  nameFor: (userId: string) => string | null;
  viewerId: string | null;
  onClose: () => void;
}) {
  const forward = useForwardMessage();
  const channelsQuery = useChannels();
  const { byId: names } = useMemberDisplayNames();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [destination, setDestination] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const draftKey = useRef<string | null>(null);
  const listLabelId = useId();
  const commentId = useId();

  const destinations = useMemo(
    () =>
      forwardDestinations(
        Array.isArray(channelsQuery.data)
          ? (channelsQuery.data as ForwardableChannel[])
          : [],
        viewerId,
        names,
      ),
    [channelsQuery.data, viewerId, names],
  );
  const shown = useMemo(
    () => filterForwardDestinations(destinations, query),
    [destinations, query],
  );

  const sending = forward.isPending;
  const empty = channelsQuery.isPending
    ? null
    : destinations.length === 0
      ? FORWARD_NO_DESTINATIONS
      : shown.length === 0
        ? FORWARD_NO_MATCHES
        : null;

  async function send() {
    if (!target || !destination || sending) return;
    setFailure(null);
    draftKey.current ??= randomClientId();
    try {
      await forward.mutateAsync({
        messageId: target.messageId,
        channelId: destination,
        content: comment,
        clientMessageId: draftKey.current,
      });
      toast({ title: FORWARD_DONE_ANNOUNCEMENT });
      onClose();
    } catch (error) {
      setFailure(forwardFailureBody(error));
    }
  }

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !sending) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <form
          className="flex min-w-0 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <DialogHeader>
            <DialogTitle>{FORWARD_SHEET_TITLE}</DialogTitle>
            <DialogDescription className="sr-only">
              Pick a channel or direct message to forward this message to.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={FORWARD_SEARCH_PLACEHOLDER}
            aria-label={FORWARD_SEARCH_PLACEHOLDER}
            autoComplete="off"
            disabled={sending}
            // Enter here searches; it never sends. In the form, it would
            // submit to whatever is picked, which the search may have hidden.
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
          />
          <div className="max-h-64 min-h-0 overflow-y-auto">
            {empty ? (
              <p className="px-2 py-1 text-sm text-muted-foreground">{empty}</p>
            ) : null}
            {shown.length > 0 ? (
              <div
                role="radiogroup"
                aria-labelledby={listLabelId}
                className="flex flex-col"
              >
                <span id={listLabelId} className="sr-only">
                  Conversations
                </span>
                {shown.map((row) => {
                  const selected = row.id === destination;
                  return (
                    <label
                      key={row.id}
                      data-testid={`forward-destination-${row.id}`}
                      className={cn(
                        "flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-2 text-sm",
                        "hover:bg-card-hover pointer-coarse:min-h-11",
                        // The hidden radio's focus, drawn on its row.
                        FOCUS_RING_OFFSET_HAS_VISIBLE,
                        selected && "bg-card-hover",
                      )}
                    >
                      <input
                        type="radio"
                        name="forward-destination"
                        value={row.id}
                        checked={selected}
                        disabled={sending}
                        onChange={() => {
                          draftKey.current = null;
                          setDestination(row.id);
                        }}
                        className="sr-only"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {row.label}
                      </span>
                      {selected ? (
                        <Check
                          className="h-4 w-4 text-accent-text"
                          aria-hidden="true"
                        />
                      ) : null}
                    </label>
                  );
                })}
              </div>
            ) : null}
          </div>
          {target ? (
            <ForwardedCard
              forwarded={target.preview}
              hidden={target.hidden}
              nameFor={nameFor}
              viewerId={viewerId}
              className="mt-0"
            />
          ) : null}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={commentId} className="sr-only">
              {FORWARD_COMMENT_PLACEHOLDER}
            </label>
            <Textarea
              id={commentId}
              value={comment}
              onChange={(event) => {
                draftKey.current = null;
                setComment(event.target.value);
              }}
              placeholder={FORWARD_COMMENT_PLACEHOLDER}
              maxLength={CHAT_MESSAGE_CONTENT_MAX_LENGTH}
              disabled={sending}
              className="min-h-[72px] resize-none"
            />
          </div>
          {failure ? (
            <p role="alert" className="text-sm text-destructive-text">
              {failure}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={sending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!destination || sending}>
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              {FORWARD_SEND_LABEL}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
