/**
 * The words for a refused API call, shared by every client (principles.md
 * P2.3, writing.md §3): `@repo/hooks`' `errorCopy` reads a thrown error with
 * it on web and mobile, and `@repo/chat-core` words its chat refusals with it.
 *
 * Pure strings in, strings out, so a package without the SDK can use it. The
 * rule it holds: a server sentence reaches a member only through this file,
 * rewritten in the chapter's words. Anything the API says that isn't listed
 * here was written for a developer, and the caller's own sentence or the
 * status's stands in for it.
 */
import { moduleRefusalFromServerMessage } from "./module-refusal";
import { subscriptionRefusalFromServerMessage } from "./subscription";

/** The default "what next" when nothing more specific is known. */
export const TRY_AGAIN = "Try again in a moment.";

export const OFFLINE_COPY =
  "Couldn't reach Frapp. Check your connection and try again.";
const MODULE_OFF =
  "That part of Frapp is turned off for your chapter right now. An officer can turn it back on.";
const SUBSCRIPTION_LAPSED =
  "Your chapter's subscription isn't active, so this can't be saved. An officer can sort this out for the chapter.";

/** What a status alone says, for the statuses that mean the same everywhere. */
export const STATUS_ERROR_COPY: Readonly<Record<number, string>> = {
  401: "You've been signed out. Sign in again and retry.",
  403: "Your role can't do this. Ask an officer if you need it.",
  404: "It may have been deleted. Refresh and try again.",
  410: "This is no longer available.",
  413: "That file is too large.",
  // writing.md § Rate limited (global); chat-core's RATE_LIMITED_COPY.
  429: "Too many requests in a short time. Wait a minute, then try again.",
};

/**
 * What a refusal itself says, in the chapter's words, or `null`: a code the
 * API names, a guard sentence the shared matchers read (module off,
 * subscription lapsed), or a sentence in {@link SERVER_MESSAGE_COPY}.
 */
export function refusalCopy(refusal: {
  status?: number;
  code?: string | null;
  message?: string | null;
}): string | null {
  const byCode = copyForErrorCode(refusal.code ?? null);
  if (byCode) return byCode;
  const { status, message } = refusal;
  if (!message) return null;
  if (status === 403 && moduleRefusalFromServerMessage(message)) {
    return MODULE_OFF;
  }
  if (status === 403 && subscriptionRefusalFromServerMessage(message)) {
    return SUBSCRIPTION_LAPSED;
  }
  return copyForServerMessage(message);
}

export function copyForErrorCode(code: string | null): string | null {
  if (!code) return null;
  if (code === "chapter.module.disabled") return MODULE_OFF;
  if (code.startsWith("chapter.subscription.")) return SUBSCRIPTION_LAPSED;
  if (code.startsWith("chapter.context.")) {
    return "Your chapter changed in another tab. Refresh and try again.";
  }
  if (code === "service_entry.receipt_required") {
    return "Add a photo of your proof, then submit.";
  }
  if (code === "task.proof_required") {
    return "This task needs proof to show it's done. Add it, then mark it done.";
  }
  if (code === "task.resubmit_needs_change") {
    return "This task was sent back. Add proof or reply to the officer, then mark it done.";
  }
  // Refused in the browser, never by the API: the web client turns writes
  // away while an officer views the app as a role (#4072).
  if (code === "client.role_preview") {
    return "You're viewing as a role. Exit the preview to make changes.";
  }
  if (code === "legal.acceptance_required") {
    return "Accept the Terms and Privacy Policy to continue.";
  }
  if (code === "ai.consent.required") {
    return "Turn on AI for your account in Settings to use this.";
  }
  if (code === "ai.chapter_off") {
    return "Your chapter's president hasn't turned this on.";
  }
  if (code === "ai.consent.stale_sheet") {
    return "What AI uses has changed since you opened this. Read it again, then answer.";
  }
  if (code === "ai.settings.president_only") {
    return "Only your chapter's president can turn AI features on or off.";
  }
  return null;
}

/**
 * Server sentences that carry a reason the member can act on, keyed by the
 * exact text the API throws (`apps/api/src`), rewritten in the chapter's
 * words. A key here that the API no longer throws costs nothing but a dead
 * line; a refusal missing from here falls back to its status, which is
 * vaguer but never wrong.
 */
export const SERVER_MESSAGE_COPY: Readonly<Record<string, string>> = {
  // A chat sign-up sheet's claim on a slot that filled first (#3926,
  // `ChatReactionService.claimSignupSlots`, 409). Already in a member's words.
  "That slot is full. Someone took the last spot just before you.":
    "That slot is full. Someone took the last spot just before you.",
  // Sign-up headcounts and closing (#3926 step 2). A card a member is still
  // drawing open may have closed a moment ago, so say so: a retry can't work.
  "Sign-ups are closed": "Sign-ups for this have closed.",
  "Sign-ups are already closed": "Sign-ups for this have closed.",
  "Cannot close a deleted sign-up": "That sign-up was deleted.",
  "A headcount takes one answer": "Pick one answer: Going or Can’t make it.",
  "Only the sign-up’s creator or a member who manages channels can close it":
    "Only the person who posted this, or an officer who manages channels, can close it.",
  // Form cards (#3926 step 3). A form a member has open may have closed a
  // moment ago; the other refusals are checked again in the form before it
  // sends, so they reach a member only from an out-of-date client.
  "This form is closed": "This form has closed, so answers can’t be changed.",
  "This form is already closed": "This form has already closed.",
  "Cannot close a deleted form": "That form was deleted.",
  "Only the form’s creator or a member who manages channels can close it":
    "Only the person who posted this, or an officer who manages channels, can close it.",
  "Answer every required question": "Answer every question marked required.",
  // Check-in and study
  "Already checked in for this event": "You're already checked in.",
  "This event has an invalid check-in area; an officer needs to redraw it":
    "This event's check-in zone needs fixing. Ask an officer to redraw it.",
  "You need to be at the event to check in":
    "You need to be at the event to check in.",
  "Location is outside the geofence":
    "You're outside the zone. Move inside it and try again.",
  "Geofence is not active":
    "This zone is turned off. An officer can turn it back on.",
  "You already have an active study session. Stop it before starting a new one.":
    "You already have a study session running. Stop it before starting a new one.",
  "Alumni members cannot record study hours in this chapter":
    "Alumni can't record study hours.",
  "Alumni members cannot check in to chapter events":
    "Alumni can't check in to chapter events.",
  "That check-in code is not valid for this event, or it has expired":
    "That code is wrong or has expired. Ask the host for the current one.",
  "You are not eligible to check in for this event":
    "This event isn't open to you.",
  "Check-in is only allowed during the event time window":
    "You can only check in while the event is on.",
  "This event checks you in by location — use the Frapp mobile app to check in.":
    "This event checks you in by location. Open Frapp on your phone to check in.",
  // Check-in near the QR screen (#4532). The keys are the API's sentences
  // and stay as they are for older builds; the words changed on 2026-11-13,
  // when the code became a link the phone's own camera opens.
  "Scan the code on the check-in screen with the Frapp app to check in":
    "Point your phone's camera at the code on the officer's screen to check in.",
  "This check-in needs your location. Allow location for Frapp and scan again.":
    "This check-in needs your location. Allow location for Frapp and try again.",
  "You need to be near the check-in screen to check in":
    "You need to be near the officer's screen to check in.",
  "Cannot mark auto-absent before the grace period ends":
    "Wait until the grace period ends to mark absences.",
  // Chat
  "You do not have access to this channel":
    "You don't have access to this channel.",
  "You can only edit your own messages": "You can only edit your own messages.",
  "You can only delete your own messages unless you have channels:manage permission":
    "You can only delete your own messages.",
  "This message has been deleted and can no longer be reported":
    "That message was deleted.",
  "A message needs content or at least one attachment":
    "Write a message or attach a file.",
  "A private channel must keep at least one member of the chapter. Delete the channel instead.":
    "A private channel needs at least one member. Delete the channel instead.",
  "Imported messages cannot be edited":
    "Messages brought over from Discord can't be edited.",
  "Cannot edit a deleted message": "That message was deleted.",
  "The reported message no longer exists": "That message was deleted.",
  "Message is already pinned": "That message is already pinned.",
  "Message is not pinned": "That message isn't pinned.",
  "Poll has expired": "This poll has closed.",
  "Poll is already closed": "This poll has closed.",
  "Cannot close a deleted poll": "That poll was deleted.",
  "Only the poll creator or a member who manages channels can close it":
    "Only the person who started this poll, or an officer who manages channels, can close it.",
  "Duplicate attachment": "That file is already attached.",
  "You cannot block yourself": "You can't block yourself.",
  "This account cannot be blocked": "This account can't be blocked.",
  "This report is no longer open": "Someone already handled this report.",
  // Roles and members
  "Role name already exists in this chapter":
    "A role with that name already exists. Pick another name.",
  "A custom field with this key already exists in this chapter":
    "A field with that name already exists. Pick another name.",
  "Cannot delete system roles": "Built-in roles can't be deleted.",
  "Core roles cannot be deleted": "Built-in roles can't be deleted.",
  "Already a member of this chapter": "That person is already in the chapter.",
  "Assignee must be a member of the chapter":
    "Pick someone who's in the chapter.",
  "Target member is not in this chapter":
    "That person isn't in the chapter anymore.",
  "You are no longer a member of this chapter.":
    "You're no longer in this chapter.",
  "You are not a member of this chapter": "You're not in this chapter.",
  "Not a member of this chapter": "You're not in this chapter.",
  "You are not a member of the requested chapter.":
    "You're not in this chapter.",
  "Cannot transfer presidency to the current President":
    "They're already the president.",
  "Only the current President can transfer presidency":
    "Only the president can hand off the presidency.",
  "This chapter no longer needs a new President — someone else already claimed it":
    "Someone already claimed the presidency.",
  "Only a member holding the chapter's next-highest-ranked role can claim the presidency":
    "Only the next officer in line can claim the presidency.",
  "A rollover has already been performed this calendar month":
    "The semester was already rolled over this month.",
  // Points and hours
  "Admins cannot adjust their own points":
    "You can't adjust your own points. Ask another officer.",
  "Reason is required for point adjustments": "Add a reason for the change.",
  "Points already awarded for this entry":
    "Points were already given for these hours.",
  "Only PENDING entries can be approved": "These hours were already reviewed.",
  "Only PENDING entries can be rejected": "These hours were already reviewed.",
  "Only PENDING entries can be deleted": "Reviewed hours can't be withdrawn.",
  "Admins cannot approve their own service entries":
    "You can't approve your own hours. Ask another officer.",
  "You can only delete your own service entries":
    "You can only withdraw your own hours.",
  "Service entry approval failed — entry is no longer eligible or points were already awarded":
    "These hours were already reviewed.",
  // Tasks and events
  "Only completed tasks can be rejected":
    "Only a task marked done can be sent back.",
  "Cannot reject a task that has already been confirmed and points awarded":
    "This task was already confirmed, so it can't be sent back.",
  "Task must be marked COMPLETED by assignee before confirmation":
    "The task has to be marked done before you confirm it.",
  "Task confirmation failed — task is no longer eligible or points were already awarded":
    "This task was already confirmed.",
  "Points have already been awarded for this task":
    "Points were already given for this task.",
  "Admins cannot confirm their own task completions":
    "You can't confirm your own task. Ask another officer.",
  "Only the assignee or an admin can update task status":
    "Only the person it's assigned to can change this task.",
  "Coordinates must form a polygon with at least 3 points":
    "Draw the zone with at least three corners.",
  "check_in_zone must have at least 3 points, or be empty to clear it":
    "Draw the zone with at least three corners.",
  "Event times are invalid": "The event has to end after it starts.",
  "end_time must be after start_time": "The event has to end after it starts.",
  "start_date must not be after end_date":
    "The end date has to be on or after the start date.",
  "due_date must be a valid date": "Pick a valid due date.",
  // Files
  "File extension is not allowed": "That file type isn't supported.",
  "That upload has already been filed": "That file was already added.",
  "A file with the same hash already exists in this chapter":
    "That file is already uploaded.",
  "Invalid content type. Only images are allowed.": "Pick an image file.",
  "Invalid file extension. Only image files are allowed.":
    "Pick an image file.",
  "Folder name must not be empty": "Give the folder a name.",
  "Cannot merge a department into itself":
    "Pick a different department to merge into.",
  "Cannot merge a professor into itself":
    "Pick a different professor to merge into.",
  // Invites
  "Invite has already been used":
    "This invite has already been used. Ask an officer for a new one.",
  "Invite already used":
    "This invite has already been used. Ask an officer for a new one.",
  "Invite expired": "This invite has expired. Ask an officer for a new one.",
  "Invite not found":
    "This invite doesn't work anymore. Ask an officer for a new one.",
};

/** Server sentences with a value in the middle, matched by shape. */
const SERVER_MESSAGE_PATTERNS: ReadonlyArray<
  readonly [RegExp, (match: RegExpMatchArray) => string]
> = [
  [
    /^File extension\b.*\bnot allowed/i,
    () => "That file type isn't supported.",
  ],
  [
    /^Content type ".*" is not allowed$/,
    () => "That file type isn't supported.",
  ],
  [
    /^File exceeds the (.+) upload limit$/,
    (m) => `That file is over the ${m[1]} limit.`,
  ],
  [
    /^A folder named ".*" already exists$/,
    () => "A folder with that name already exists.",
  ],
  [
    /^Maximum of \d+ pinned messages per channel/,
    () =>
      "This channel has as many pins as it can hold. Unpin an older message first.",
  ],
  [
    /^Group DMs require (\d+) to (\d+) members$/,
    (m) => `A group message needs ${m[1]} to ${m[2]} people.`,
  ],
  [
    /^Poll must have between (\d+) and (\d+) options$/,
    (m) => `A poll needs between ${m[1]} and ${m[2]} options.`,
  ],
];

export function copyForServerMessage(message: string): string | null {
  const exact = SERVER_MESSAGE_COPY[message.trim()];
  if (exact) return exact;
  for (const [pattern, write] of SERVER_MESSAGE_PATTERNS) {
    const match = message.match(pattern);
    if (match) return write(match);
  }
  return null;
}
