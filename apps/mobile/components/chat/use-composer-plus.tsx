import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Alert, Keyboard } from "react-native";
import { useFocusEffect } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  useCurrentChapter,
  gifToSend,
  useGifAvailability,
  useMyPermissions,
  type GifResult,
} from "@repo/hooks";
import { can, isModuleEnabled } from "@repo/validation";
import {
  plusMenuForms,
  plusMenuModel,
  type PlusMenuCommand,
  type PlusMenuModuleStatus,
} from "@repo/chat-core/plus-menu";
import {
  eventCardOutcomeCopy,
  type DispatchResult,
} from "@repo/chat-core/dispatch";
import { ComposerPlusSheet } from "@/components/chat/composer-plus-sheet";
import { NewPollSheet } from "@/components/chat/new-poll-sheet";
import { GifPickerSheet } from "@/components/chat/gif-picker-sheet";
import { NewSignupSheet } from "@/components/chat/new-signup-sheet";
import { NewFormSheet } from "@/components/chat/new-form-sheet";
import {
  NewEventSheet,
  type EventCreatedOutcome,
} from "@/components/events/new-event-sheet";
import { NewTaskSheet } from "@/components/tasks/new-task-sheet";
import { LogHoursSheet } from "@/components/service-hours/log-hours-sheet";
import { SheetBoundary } from "@/components/quick-actions/quick-actions-host";
import { CHAT_PHOTO_LIMIT } from "@/lib/chat/attachment-upload";
import type { UseChatChannelResult } from "@/lib/chat/use-chat-channel";

/**
 * The forms the phone's + offers, in the menu's order. Points waits for a
 * phone form (#3865).
 */
const PHONE_PLUS_COMMANDS = [
  "poll",
  "signup",
  "form",
  "event",
  "task",
  "hours",
] as const;

type ChannelForm = "event" | "task" | "hours";

const NO_FORMS: ReadonlySet<ChannelForm> = new Set();

/** What each form's posted-but-not-quite outcome is called in its alert. */
const OUTCOME_TITLES: Record<
  "poll" | "signup" | "form" | "task" | "hours",
  { posted: string; unconfirmed: string }
> = {
  poll: { posted: "Poll posted", unconfirmed: "Couldn't confirm the poll" },
  signup: {
    posted: "Sign-up sheet posted",
    unconfirmed: "Couldn't confirm the sign-up sheet",
  },
  form: { posted: "Form posted", unconfirmed: "Couldn't confirm the form" },
  task: { posted: "Task created", unconfirmed: "Couldn't confirm the task" },
  hours: { posted: "Hours logged", unconfirmed: "Couldn't confirm the hours" },
};

/**
 * Says what a form's post carries beyond "it's in the thread": a lost answer
 * (`unconfirmed`, which may or may not have written), or a write whose card
 * didn't post. A plain success says nothing; the card is the confirmation.
 * An alert, not a passing line: neither route dedupes, so the member has to
 * read this before trying again.
 */
export function presentPostOutcome(
  form: "poll" | "signup" | "form" | "task" | "hours",
  result: { warning?: string; unconfirmed?: boolean },
  alert: typeof Alert.alert = Alert.alert,
): void {
  if (!result.warning) return;
  const titles = OUTCOME_TITLES[form];
  alert(
    result.unconfirmed ? titles.unconfirmed : titles.posted,
    result.warning,
  );
}

/** Says where an event's card went when it isn't in the thread, in web's words. */
export function presentEventOutcome(
  outcome: EventCreatedOutcome,
  alert: typeof Alert.alert = Alert.alert,
): void {
  const copy = eventCardOutcomeCopy(outcome.name, outcome);
  if (copy) alert("Event created", copy);
}

/**
 * Where the chapter read stands, for the rows that need a module: a cached
 * answer wins; with none, offline says reconnect, a read in flight says
 * loading, and anything else couldn't be checked.
 */
export function plusModuleStatus(read: {
  hasData: boolean;
  fetchStatus: "fetching" | "paused" | "idle";
  offline: boolean;
}): PlusMenuModuleStatus {
  if (read.hasData) return "ready";
  if (read.offline || read.fetchStatus === "paused") return "offline";
  return read.fetchStatus === "fetching" ? "loading" : "error";
}

/**
 * The chat thread's **+** (#3865): the sheet, and the forms its rows open,
 * each posting its card into the channel it was opened from.
 *
 * Every form is keyed per channel, so a draft kept by a swipe never posts
 * into another channel, and all of them close on blur like the member list.
 * Event, Task and Service hours mount on first use, as the quick actions'
 * do, since each reads its own data.
 */
export function useComposerPlus({
  channelId,
  channel,
  replying,
  offline,
  onPhoto,
}: {
  channelId: string | null | undefined;
  channel: Pick<
    UseChatChannelResult,
    | "sendPoll"
    | "sendSignup"
    | "sendForm"
    | "postTask"
    | "postHours"
    | "trackEventCard"
    | "photos"
    | "sendGif"
  >;
  /** A reply is staged (the + isn't offered while editing at all). */
  replying: boolean;
  offline: boolean;
  /** Opens the photo library. */
  onPhoto: () => void;
}): { openPlus: () => void; sheets: ReactNode } {
  const permissionsQuery = useMyPermissions();
  const chapterQuery = useCurrentChapter();
  const granted = permissionsQuery.data?.permissions;
  // A read paused offline before it ever landed can't answer either, and
  // stays `pending` rather than erroring, so it counts as failed here (web's
  // rule in `chat-shell.tsx`).
  const permissionsFailed =
    permissionsQuery.isError ||
    (permissionsQuery.fetchStatus === "paused" && !granted);
  const enabledModules = chapterQuery.data?.enabled_modules;
  const model = useMemo(
    () =>
      plusMenuModel({
        forms: plusMenuForms(
          PHONE_PLUS_COMMANDS,
          Array.isArray(granted) ? granted : undefined,
          permissionsFailed,
        ),
        moduleStatus: plusModuleStatus({
          hasData: chapterQuery.data !== undefined,
          fetchStatus: chapterQuery.fetchStatus,
          offline,
        }),
        isModuleEnabled: (key) => isModuleEnabled(enabledModules, key),
        replying,
        attachmentNoun: "photo",
        attachmentsStaged: channel.photos.length,
        attachmentLimit: CHAT_PHOTO_LIMIT,
        offline,
        roleRetryHint: "Close this and try again.",
      }),
    [
      granted,
      permissionsFailed,
      chapterQuery.data,
      chapterQuery.fetchStatus,
      enabledModules,
      replying,
      channel.photos.length,
      offline,
    ],
  );

  const plusRef = useRef<BottomSheetModal>(null);
  const gifRef = useRef<BottomSheetModal>(null);
  // GIFs (#4631): the row shows only once the server says search is set up.
  const gifs = useGifAvailability();
  const pollRef = useRef<BottomSheetModal>(null);
  const signupRef = useRef<BottomSheetModal>(null);
  const newFormRef = useRef<BottomSheetModal>(null);
  const eventRef = useRef<BottomSheetModal>(null);
  const taskRef = useRef<BottomSheetModal>(null);
  const hoursRef = useRef<BottomSheetModal>(null);
  const formRefs: Record<
    ChannelForm,
    RefObject<BottomSheetModal | null>
  > = useMemo(() => ({ event: eventRef, task: taskRef, hours: hoursRef }), []);

  const [mounted, setMounted] = useState<{
    channelId: string | null | undefined;
    keys: ReadonlySet<ChannelForm>;
  }>({ channelId, keys: NO_FORMS });
  const mountedForms =
    mounted.channelId === channelId ? mounted.keys : NO_FORMS;
  const pendingForm = useRef<ChannelForm | null>(null);
  // The forms' clock, re-read each time one opens, as the quick actions do.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const key = pendingForm.current;
    if (!key || !mountedForms.has(key)) return;
    pendingForm.current = null;
    formRefs[key].current?.present();
  }, [mountedForms, formRefs]);

  const dropForm = useCallback(
    (key: ChannelForm) =>
      setMounted((prev) => {
        const keys = new Set(prev.keys);
        keys.delete(key);
        return { channelId: prev.channelId, keys };
      }),
    [],
  );

  const openForm = useCallback(
    (command: PlusMenuCommand) => {
      Keyboard.dismiss();
      if (command === "poll") {
        pollRef.current?.present();
        return;
      }
      if (command === "signup") {
        signupRef.current?.present();
        return;
      }
      if (command === "form") {
        newFormRef.current?.present();
        return;
      }
      // Points isn't on the phone's + yet, so `PHONE_PLUS_COMMANDS` never
      // offers it.
      if (command === "points") return;
      setNow(new Date());
      if (mountedForms.has(command)) {
        formRefs[command].current?.present();
        return;
      }
      pendingForm.current = command;
      setMounted((prev) => ({
        channelId,
        keys: new Set(prev.channelId === channelId ? prev.keys : NO_FORMS).add(
          command,
        ),
      }));
    },
    [channelId, mountedForms, formRefs],
  );

  const openPlus = useCallback(() => {
    Keyboard.dismiss();
    plusRef.current?.present();
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!channelId) return;
      return () => {
        for (const ref of [
          plusRef,
          gifRef,
          pollRef,
          signupRef,
          newFormRef,
          eventRef,
          taskRef,
          hoursRef,
        ]) {
          ref.current?.dismiss();
        }
      };
    }, [channelId]),
  );

  const {
    sendPoll,
    sendSignup,
    sendForm,
    postTask,
    postHours,
    trackEventCard,
    sendGif,
  } = channel;
  const openGif = useCallback(() => {
    Keyboard.dismiss();
    gifRef.current?.present();
  }, []);
  const pickGif = useCallback(
    (gif: GifResult) => {
      void sendGif(gifToSend(gif, gifs.provider)).then((result) => {
        if (!result.ok) Alert.alert("Couldn't send the GIF", result.error);
      });
    },
    [sendGif, gifs.provider],
  );
  const postSignupHere = useCallback(
    async (signup: Parameters<typeof sendSignup>[0]) => {
      const result = await sendSignup(signup);
      if (result.ok) presentPostOutcome("signup", result);
      return result;
    },
    [sendSignup],
  );
  const postFormHere = useCallback(
    async (form: Parameters<typeof sendForm>[0]) => {
      const result = await sendForm(form);
      if (result.ok) presentPostOutcome("form", result);
      return result;
    },
    [sendForm],
  );
  const postPollHere = useCallback(
    async (poll: Parameters<typeof sendPoll>[0]) => {
      const result = await sendPoll(poll);
      if (result.ok) presentPostOutcome("poll", result);
      return result;
    },
    [sendPoll],
  );
  const onTaskPosted = useCallback(
    (result: DispatchResult) => presentPostOutcome("task", result),
    [],
  );
  const onHoursPosted = useCallback(
    (result: DispatchResult) => presentPostOutcome("hours", result),
    [],
  );
  const eventChat = useMemo(
    () =>
      channelId && trackEventCard
        ? { channelId, trackCard: trackEventCard }
        : undefined,
    [channelId, trackEventCard],
  );

  const key = channelId ?? "none";
  const sheets = (
    <>
      <ComposerPlusSheet
        ref={plusRef}
        model={model}
        // Photos upload live, with no outbox behind them, so they wait for a
        // connection; the connection pill says so.
        photoDisabledReason={offline ? "Reconnect first" : null}
        onPhoto={onPhoto}
        // Search needs the network; a reply goes with typed text, as the
        // forms' rows say.
        onGif={gifs.available ? openGif : undefined}
        gifDisabledReason={
          offline ? "Reconnect first" : replying ? "Not while replying" : null
        }
        onOpenForm={openForm}
      />
      {gifs.available ? (
        <GifPickerSheet
          key={`gif-${key}`}
          ref={gifRef}
          provider={gifs.provider}
          onPick={pickGif}
        />
      ) : null}
      <NewPollSheet
        key={`poll-${key}`}
        ref={pollRef}
        onPost={postPollHere}
        canCloseEarly={can("polls:create", granted)}
      />
      <NewSignupSheet
        key={`signup-${key}`}
        ref={signupRef}
        onPost={postSignupHere}
      />
      <NewFormSheet
        key={`form-${key}`}
        ref={newFormRef}
        onPost={postFormHere}
      />
      {mountedForms.has("event") && eventChat ? (
        <SheetBoundary key={`event-${key}`} onError={() => dropForm("event")}>
          <NewEventSheet
            ref={eventRef}
            now={now}
            chat={eventChat}
            onCreated={presentEventOutcome}
          />
        </SheetBoundary>
      ) : null}
      {mountedForms.has("task") ? (
        <SheetBoundary key={`task-${key}`} onError={() => dropForm("task")}>
          <NewTaskSheet
            ref={taskRef}
            now={now}
            postToChannel={postTask}
            onPosted={onTaskPosted}
          />
        </SheetBoundary>
      ) : null}
      {mountedForms.has("hours") ? (
        <SheetBoundary key={`hours-${key}`} onError={() => dropForm("hours")}>
          <LogHoursSheet
            ref={hoursRef}
            now={now}
            postToChannel={postHours}
            onPosted={onHoursPosted}
          />
        </SheetBoundary>
      ) : null}
    </>
  );

  return { openPlus, sheets };
}
