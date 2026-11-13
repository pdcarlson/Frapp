/**
 * What's new, in members' words: the one list behind mobile Settings → What's
 * new, web's account menu → What's new, the public changelog at
 * frapp.live/changelog (`apps/landing/app/changelog/page.tsx`), and the block
 * Paul pastes to beta testers (`npm run release-notes`).
 *
 * The changelog is public and indexed, so every line is read by people who
 * have never opened the app. The writing rules below are the whole set for an
 * entry, there and everywhere else; the landing page's own rules bind its page
 * copy, not these lines (spec/ui/landing/README.md § Section inventory).
 *
 * Newest first. Each entry is one batch of changes, dated the day its lines
 * joined this list; members get them with the next release (a store build or
 * an over-the-air update; members never see which), which carries every line
 * merged before it.
 *
 * A PR that changes what members see doesn't edit this list: it leaves its
 * line in its own file in `packages/validation/release-notes/` (that folder's
 * README owns how the lines get here), so parallel PRs never conflict on this
 * file. Rewording or removing a line already here is a direct edit, as before.
 *
 * Where a line goes: `changes` holds what reads the same on the web and on
 * the phone, `web` what is only on the web dashboard, and `phone` what is only
 * in the phone app (iPhone and Android alike; say "On Android" inside the line
 * when it is one of them). Every surface lists `changes` first, then a Web
 * and a Mobile subheading over the other two ({@link releaseNoteGroups}), so
 * a line under `web` or `phone` doesn't say "on the web" or "on your phone".
 * Entries before 2026-11-12 keep everything in `changes`, with the place
 * written into the line, and show no subheadings.
 *
 * How to write a line: say what a member can now do or will notice, the way
 * you'd tell a friend. No feature codes, issue numbers, version strings,
 * screen ids, emojis, or em dashes ({@link releaseNoteLineProblem} checks
 * what a machine can). A bit vague is fine; wrong is not, so only list what
 * is merged. One sentence a line. An entry written by hand takes five to
 * eight lines and a title naming the batch; one the fold starts holds
 * whatever was waiting, under a plain title anyone may reword.
 *
 * Mobile and the web dashboard open the newest entry by themselves once after
 * an update ({@link decideWhatsNew}; `apps/mobile/lib/whats-new.ts`,
 * `apps/web/lib/whats-new.ts`), and a phone or browser remembers how many
 * lines it showed ({@link releaseNoteVersion}). Dates are unique, so **a second release
 * on the same day appends lines to that day's entry, even past eight, and
 * never trims or merges the ones already there**: they show it again only
 * when it has more lines than they saw. Rewording a line is fine but isn't
 * news, so it shows nothing. Deploy production warns when a release ships with
 * neither a new entry nor new lines, or when the day's entry got shorter
 * (`scripts/ci/release-notes-freshness.mjs`, which reads this file as text at
 * the deployed commit, so keep `date:`, `changes: [...]`, `web: [...]` and
 * `phone: [...]` literal, one string per line). A line's count is across all
 * three lists ({@link releaseNoteLineCount}), so moving a line between them
 * is a reword, not news.
 */
export type ReleaseNote = {
  /** The day its lines joined this list, as `YYYY-MM-DD`. */
  readonly date: string;
  /** One short line that names the batch. */
  readonly title: string;
  /** Lines true on the web and on the phone alike. */
  readonly changes: readonly string[];
  /** Lines only on the web dashboard. */
  readonly web?: readonly string[];
  /** Lines only in the phone app. */
  readonly phone?: readonly string[];
};

/** Where a line applies: both surfaces, or only one. */
export type ReleaseNotePlace = "everywhere" | "web" | "phone";

/**
 * Where each place's lines live in an entry (`key`) and the subheading they
 * show under (`label`), in the order every surface lists them. Lines true on
 * both come first with no subheading; Web and Mobile follow (Paul,
 * 2026-11-12: "just 2 subheadings"). The fold script and the deploy check
 * read the keys from here.
 */
export const RELEASE_NOTE_PLACES: readonly {
  readonly place: ReleaseNotePlace;
  readonly key: "changes" | "web" | "phone";
  readonly label: string | null;
}[] = Object.freeze([
  { place: "everywhere", key: "changes", label: null },
  { place: "web", key: "web", label: "Web" },
  { place: "phone", key: "phone", label: "Mobile" },
]);

export interface ReleaseNoteGroup {
  readonly place: ReleaseNotePlace;
  /** The subheading, or `null` for the lines true on both. */
  readonly label: string | null;
  readonly lines: readonly string[];
}

/**
 * An entry's lines by place, in {@link RELEASE_NOTE_PLACES} order, leaving
 * out empty places: the one grouping behind the web dialog and page, the
 * phone's sheet and screen, the public changelog, the dev log post and the
 * pasted text. The lines true on both have no subheading; Web and Mobile
 * do. An entry from before the split is one group with no subheading.
 * `only` keeps just those places (the store text skips web-only lines).
 */
export function releaseNoteGroups(
  note: ReleaseNote,
  only?: readonly ReleaseNotePlace[],
): ReleaseNoteGroup[] {
  return RELEASE_NOTE_PLACES.filter(
    ({ place }) => !only || only.includes(place),
  )
    .map(({ place, key, label }) => ({ place, label, lines: note[key] ?? [] }))
    .filter((group) => group.lines.length > 0);
}

/** Every line of an entry, whatever its place. */
export function releaseNoteLineCount(note: ReleaseNote): number {
  return RELEASE_NOTE_PLACES.reduce(
    (sum, { key }) => sum + (note[key]?.length ?? 0),
    0,
  );
}

export const RELEASE_NOTES: readonly ReleaseNote[] = Object.freeze([
  {
    date: "2026-11-13",
    title: "New in this update",
    changes: [
      "Ask Frapp now keeps the conversation going, so a follow-up question picks up where the last one left off.",
      "Asking Frapp to do something happens in the same box as asking it a question, with no Ask and Do tabs to switch between.",
      "Moving a repeating event to a new time keeps the excuses members already sent, and anyone whose meeting is no longer on the calendar gets a note to send theirs again.",
      "A task with no points and nothing to prove counts as done as soon as you mark it done.",
      "When someone submits a task you gave them, the notification says who submitted what, and tapping it opens a review with their proof up front. With several waiting, Confirm moves on to the next.",
      "Can't make it is now on a required event's chat card too, and opens the event with your excuse ready to write.",
      "Mandatory now shows only on the events that need you, as a quiet label instead of a red badge.",
      "A sign-up sheet, headcount or form you haven't answered yet now shows under Needs you on Activity until you answer it or it closes, and tapping it takes you straight to it in chat.",
      "Events and the Directory now say the same thing on the web and on your phone when a list is empty, a search finds nobody, or something fails to load, and points read the same everywhere.",
      "Chat cards are one width and check you in the same way on the web and your phone, a muted channel's mark sits right after its name, and pinned messages show a pin on both.",
      "Ask Frapp opens with questions about your own account, like your next event or your open tasks, instead of the same three examples for everyone.",
      "Weekly and monthly repeating events set up or changed from now on keep the same time of day when the clocks change for daylight saving.",
      "While Ask Frapp works, it now says what it is really doing, like which records it is reading and how many sources it found.",
      "A pinned message's pin now fills in, so it's easy to spot.",
      "A muted channel stays quiet in the channel list: its new messages no longer light a folded section's heading or keep it under Unread only, unless one mentions you. Direct messages still show.",
      "When something you save doesn't go through because the connection dropped or our server hiccuped, the error now offers Try again.",
      "You can check in to an event right from its row in Activity, on the web for events that don't need your location and on your phone for any event.",
      "Frapp AI now introduces itself once with what it can do, and one switch in Settings turns it on or off.",
      "Deleting a role no longer locks out the people who held it, since anyone left without a role keeps the chapter's everyday access.",
      "A form opened while you're offline, or when it can't reach the server, now says its answers may not be the newest.",
      "Officers can only invite people into roles at or below their own, and the invite list shows only the invites they could have sent.",
      "Notifications now show one row per conversation with how many messages it holds, and an Unread switch hides what you've already read.",
      "If your chapter has Ask Frapp on, type @Frapp and a question in any channel to ask it right there: nothing is posted and only you see the answer.",
      "Your own message now lights up for you when it mentions you, such as your own @here or @everyone.",
      "A forwarded message shows up as a card marked Forwarded, with who wrote it and when.",
      "Ask Frapp now knows who is asking, so \"me\" and \"my\" mean you, and its answers are shorter and in its own words.",
      "An answer from @Frapp in a channel can be posted for everyone there with Post for everyone here, after Frapp tells you which of its sources not everyone can open.",
      "A forward you saved with no comment now shows what was forwarded in Saved messages.",
    ],
    web: [
      "The Documents grid now shows a preview of each photo and the first page of each PDF, and the Documents and Directory grids fit more, smaller tiles on a row.",
      "In Direct messages, a search box at the top finds your conversation with someone by name, or lets you start one with anyone you haven't messaged, and the New message pencil opens it too.",
      "Service hours now opens on your own approved and pending hours and your full log, with a chapter leaderboard you can switch between this semester and all time.",
      "Officers can ask for a photo or a link as proof on a task, add up to six photos, and say what needs to change when they send a task back.",
      "When you upload a document, the Type choices are now your chapter's own list, and officers who manage documents can rename, add or remove types with Edit types.",
      "Officers can import a whole folder into Documents: Frapp suggests a folder, type and title for each file, sets aside copies and files it can't take, and imports them all once you've checked.",
      "You can now post a form in chat from the + menu, with short answer, paragraph, multiple choice, checkbox, dropdown and yes or no questions. Your answers aren't posted in the chat, and you can change them until the form closes.",
      "Pinning a channel or saving a message now fills in its pin or ribbon, so it's clear which ones are on.",
      "If an email sign-in link opens a brand-new account instead of the one you already have, you're now told so and can sign out in one step.",
      "When you post a form, Responses on its card shows a summary of the answers, each person's answers and who hasn't answered yet, and you can export them; a sign-up sheet's creator can export who signed up for what.",
      "Activity now opens with the same week ring as the phone app: how much of your week is done, your next thing to do, and the rest listed by day.",
      "Ask Frapp now lives in the chat box next to GIF, and the conversation opens over your chat instead of in a side panel.",
      "The Events calendar has Week and Day views beside Month, with each event drawn at its time and as long as it lasts, and Frapp remembers which one you use.",
      "Leaving a page halfway through a new event, a document upload or new minutes keeps what you typed, and the form picks up where you left off.",
      "While an officer's check-in screen is up, an event's chat card, page and Activity row say to point your phone's camera at the code instead of offering a Check in that can't work.",
      "Invites, new channels, backwork uploads, pledge class members, study zones and folder imports also keep what you typed when you leave, and pick up where you left off.",
      "You can clear a notification with the x that shows when you hover over it.",
      "After you link or unlink your Discord account, an open chat now shows your imported messages under the right name without a reload.",
    ],
    phone: [
      "Messages has a search box that finds your conversation with someone by name, or lets you start one with anyone you haven't messaged, and the pencil takes you straight to it.",
      "The rows on the You tab lead with coloured icons, Up next on Chat home is a card you can read at a glance, and the buttons at the top of each screen look like buttons.",
      "Cards and lists are a shade darker, so they sit more quietly on the black behind them.",
      "Chat home shows you the swipe to Messages the first time you rest on it, and the screen now gives under your finger as you swipe.",
      "Tasks can now carry photos, you can mark a task done with a photo or a link as proof, and officers can see that proof and say what needs to change when they send a task back.",
      "Private channels now show a lock in your channel list, so you can tell which ones not everyone can see.",
      "A muted channel's mark is now a crossed-out speaker, the same as on the web, so it no longer looks like the notifications bell.",
      "You can now post a form in chat from the + menu and answer it on its own page, where your answers stay private and can be changed until the form closes.",
      "The + beside the tab bar now lays its shortcuts out three to a row, and you can keep up to nine of them.",
      "Check in by pointing your phone's camera at the code on the officer's screen, and Frapp asks for your location right there if it needs it.",
      "Activity now opens with one ring that shows how much of your week is done, your next thing to do under it, and the rest listed by day.",
      "When you post a form, Responses on its card shows a summary of the answers, each person's answers and who hasn't answered yet, and you can export them as a spreadsheet; a sign-up sheet's creator can export who signed up for what.",
      "Ask Frapp has its own bar above the tabs on every tab, and it opens full screen.",
      "Signing in with an email or a Google or Apple account that has no Frapp account yet now says it made a new one, with Sign out a tap away so you can use the way you joined.",
      "The Calendar has 3 days and Day views beside Month, with each event drawn at its time and as long as it lasts, and Frapp remembers which one you use.",
      "Opening a form while you're offline no longer leaves its questions locked.",
      "Activity can now show a short note from Frapp about one of your tasks, with a suggested place to start, when your chapter has Ask on.",
      "Long-press a message to pin it for the channel or save it for yourself, and find both under Pinned messages and Saved messages in the channel's menu.",
      "Events in the Calendar list now look like they do on Activity, with an arrow that shows each one opens, and the buttons beside each section name on the chat list line up.",
      "New task, Log service hours and Upload document keep what you typed when you go back, and open on it next time.",
      "Copy message link on a message's long-press gives you a link to that message. It opens on the web, and in the app when you tap it in a Frapp message.",
      "You can clear a notification by pressing and holding it.",
      "Long-press a message and choose Mark unread to come back to it later: the channel shows as unread from that message on.",
      "Long-press a message and tap Forward to send it to another channel or a direct message, with a note of your own if you like.",
    ],
  },
  {
    date: "2026-11-12",
    title: "New in this update",
    changes: [
      "In Documents, a starred or pinned file or folder now shows a filled-in star or pin.",
      "A sticker or picture your keyboard couldn't add no longer leaves a broken box in your messages and notifications.",
      "Notifications now show who each one is from, with their picture and their name in colour, mark a mention of you with a gold @, and group by Today and Earlier on the web.",
      "Activity now has a Needs you filter, and remembers the filter you last picked.",
      "Activity now marks what's new to you with a dot until you open it.",
      "Officers who manage channels can now close any poll, and you can still close a poll you started after your role changes.",
      "Panels, cards and menus now stand apart from each other, so screens are easier to read at a glance.",
      "When someone sends several messages in a row and mentions you after you've been told about the first few, you now get a notification for that mention instead of missing it.",
      "Officers can now set a photo as the chapter's chat background even when the chapter has no #general channel.",
      "Activity rows now show the face of who sent them, and anything closing within a day says how long is left, like \"closes in 2 hours\".",
      "Deleting a chat message now also removes it from everyone's notifications, and editing one updates the text there.",
      "Officers can fix a member's name or graduation year from the menu on their profile.",
      "Profiles read like a contact card now: add your phone number and members can call or text you from your profile, and a chapter's extra fields sit under More details.",
      "When you make an event, Who's coming now lists every role with Required, Optional or Not invited beside it and says the whole plan in one line, and on your phone it closes with Done back to your event.",
      "Text boxes, dropdowns, switches and outlined buttons now have a clearer edge, so they are easier to spot.",
      "Every member can now add events to the chapter calendar and upload backwork, while making an event required or worth points stays with the officers who manage events.",
      "Chat names someone who just joined as soon as they start typing or posting, instead of \"Member\" and a code, and the typing line never says \"Someone\".",
      "Event and task cards in chat now say when the same way on the web and your phone, and a task in progress or done shows its own colour instead of your chapter's.",
      "Approved service hours now show how many points they earned, like 3 points, instead of only saying points were awarded.",
      "You can now post a sign-up sheet in chat from the + menu, with named slots and a limit on each, and everyone sees who signed up for what.",
      "The Directory can now show members as a grid of faces as well as a list, and it remembers which one you picked.",
      "The Member role is now Everyone, which nobody has to assign, and officers can ping the whole chapter with @everyone.",
      "Repeating events can now meet on more than one day a week, every few weeks, or on a set weekday of the month, and end on a date or after a number of meetings.",
      "Documents can now show your files as a grid of tiles as well as a list, and it remembers which one you picked.",
      "Officers can now write up meeting minutes from an event, and members are told when they're posted.",
      "Your points total and the leaderboard now update right after you check in, have service hours approved, or finish a study session, and on your phone the chat event card shows when you are already checked in.",
      "Officers can now edit a task from its card in chat and in Activity, not only from the Tasks page.",
      "Taking back a reaction now sticks, so it no longer comes back after you reload.",
      "Tasks can now show as a list or as a grid of cards, and it remembers which one you picked.",
      "You can now put your chapter's events and your tasks on Apple Calendar, Google Calendar or Outlook from the Events page, and they stay up to date.",
      "Sign-up sheets in chat now read like a poll, with one tap per slot, a bar showing how full it is, and who took it named underneath.",
      "Activity now opens with how your semester is going: your points and rank, the required events you made, your service hours, and this week's study time.",
      "Officers can now type @here in chat to notify only the people in a channel who are online right now.",
      "When an officer shows the check-in code from their phone, you check in by scanning it from within about 100 yards, and the event card's Check in button asks you to scan instead.",
      "Officers can set goals for points, service hours and study hours in Chapter settings, for everyone or per role, and each member sees a bar toward theirs on Activity and Study hours.",
      "What's new now lists what changed on the web and on your phone under their own Web and Mobile headings.",
      "The emoji picker on the web opens faster, and on both the web and your phone it starts with the emoji you used last.",
      "A sign-up sheet in chat can now be a quick headcount, where people answer Going or Can't make it and add a short note, and any sign-up can end at a set time or be closed early by whoever posted it, on the web and on your phone.",
      "If a required event clashes with something, tap Can't make it on the event to send an excuse, and whoever runs it can approve or decline it right there.",
      "Officers can now make groups like Third floor or Live-ins on the web, and anyone can @mention a group or a tier to reach everyone in it.",
      "Study sessions on your phone have a focus timer (25 minutes on, a short break) and a switch to keep the screen on while you study.",
      "Study hours on your phone now says how far you are from each study zone before you start, and picks the one you're in.",
      "You can now send GIFs in chat: click GIF beside the emoji button on the web, or tap GIF in the + menu on your phone.",
    ],
    web: [
      "Officers can now confirm a finished task or approve service hours straight from its row on the Activity page.",
      "Closing the slash command list with Escape no longer leaves a stray slash behind that posts as a message.",
      "A task, service hours or points you add from chat now show up right away on the Tasks, Service and Points pages.",
      "Direct messages now list your newest conversation first with its last line, and a New message button starts one from the Directory.",
      "Direct messages have their own place: open them from the new row under Chat, with a count of unread conversations, and the Channels list keeps just the chapter's channels.",
      "A thread's card now shows the latest reply, with who sent it.",
      "A thread opens beside the chat on a wide screen, so you can keep reading and writing in the channel while you reply.",
      "A Backwork download now saves the file under its own name, and a Documents or Backwork file with brackets or an ampersand in its name keeps that name when saved.",
      "In Documents, an older photo saved without its file type now opens in the viewer, the way the File type filter already sorts it.",
      "Officers can start a new channel from the + beside a category in the chat list, and deleting a channel now asks you to type its name first.",
      "Officers now set permissions by tier in Chapter settings, flipping switches grouped by feature instead of working through one big grid.",
      "Date fields no longer ask for the year: type a day like Friday or November 14, or click to pick one from a calendar.",
      "A role inside a tier can now follow its tier or be switched on or off on its own, and officers can view Frapp as any role before handing it out.",
      "A Backwork department code typed in any case, like math for MATH, now files the upload under the department you already have.",
      "Settings now lets you set chat to Mentions and DMs only for the whole chapter, and a channel's notification menu shows which level is your default.",
      "An Add a time button under a task's due date now sets the time it's due, and an × takes it off.",
      "Officers now draw study zones on a map, as a circle around a building or a traced outline, right inside Chapter settings.",
      "Chat admin, Discord import and Reports now open right inside Chapter settings, so you never lose your place.",
      "A message you send now always shows up at the bottom of the chat, and a down arrow takes you back to the newest messages after you scroll up.",
      "A member's profile and Invite members now open right inside the Directory instead of sliding over the whole screen.",
      "When you start minutes for a meeting that isn't on the calendar, you can type the day it met in words, like yesterday or Nov 4.",
      "Study zones list as one plain line each, saying what a session there earns, with Turn off and Delete in a menu.",
      "Changing or deleting a repeating event now asks whether you mean just that one or every upcoming one, as it already does on your phone.",
      "Upload document and New minutes now open right inside Documents and Meetings instead of sliding over the whole screen.",
      "An Activity item, a pledge class's member list and Create a channel in Chat admin now open right inside their page instead of sliding over the whole screen.",
      "Your profile now shows your points, service hours, pledge class and number, as it does on your phone.",
      "Upload and Clean up professors and departments in Backwork now open right inside the page instead of sliding over the whole screen.",
      "The study zone map now shows buildings, streets and building names clearly, so you can find the right building without squinting.",
      "Notifications now open as a list under the bell instead of a panel sliding over the whole screen.",
      "Tasks can now carry a photo of the job, the person doing it can add a photo when they mark it done, and an officer can require one before it counts.",
    ],
    phone: [
      "Officers who manage roles can now set a member's pledge class and number from their profile.",
      "On Android, opening the app no longer clears your unread notifications from your phone's notification shade, and on both phones a notification you've read in the app now leaves the shade.",
      "Swipe left on Chat to open your messages, or keep using the button at the top right.",
      "A message with a thread now shows a card with who replied, how many replies are new to you, and the latest reply.",
      "You can now confirm a finished task or approve service hours straight from its Activity row, without opening it first.",
      "Messages inside a thread now show their reactions, polls and other cards, and a long-press lets you react, edit or delete there.",
      "Channels with new messages usually open with their messages already there, and swiping back no longer shows a pale strip at the edge of the screen.",
      "A sign-in that doesn't work now says why in plain words, and an email you never confirmed gets a button to send the confirmation again.",
      "An open thread's header now shows the message it started from and who wrote it, instead of just \"Thread\".",
      "Officers can now start a new channel from the + beside a heading in Chat, edit a channel from its long-press menu, and drag channels into order on the new Arrange channels screen.",
      "Tap any line of your profile to change it.",
      "Officers can now change what each tier and role can do from More, Chapter settings, which also holds the chapter accent and chat background.",
      "Officers can now choose who can see and post in a channel, and move whole categories.",
      "Swiping to Messages from Chat no longer also opens the channel your finger started on.",
      "Activity is now its own tab, Events is now called Calendar, and your task board opens from Activity.",
      "A message you send no longer sometimes stays in the box afterward, ready to be sent twice.",
      "The Directory now shows each member's status and custom status line, and its search has a search icon.",
      "Your profile, status and settings now live together on a You tab with your photo, and the notifications bell is back beside Messages.",
      "Coming back to the app after a while no longer fills your screens with sign-in errors: what was already loaded stays put while the app quietly refreshes your sign-in.",
    ],
  },
  {
    date: "2026-11-11",
    title:
      "Activity, polls with more than one choice, and a Settings page of your own",
    changes: [
      "A new Activity page, on the web and on your phone, gathers what's waiting on you in one place: polls to vote on, tasks to finish or confirm, hours to approve, and events you can check in to, with your next two weeks of events and what you made below.",
      "Sign-up forms, sheets, and booking links posted in chat show up in Activity too, where you can mark one done or hide it, and on the web officers can leave a channel out of Activity.",
      "A poll can now allow more than one choice.",
      "On the web, your own settings, like quiet hours, notifications, and how chat looks, have their own Settings page on your account menu, and the chapter's settings are now called Chapter settings.",
      "The Directory sorts by order number and filters by pledge class, on the web and on your phone, where profiles now show a member's class and you can also filter by role, graduation year, and status.",
      "You're now notified when someone replies to one of your messages, and officers who are told when someone joins the chapter can now turn that notification off.",
      "On your phone, you can set chat to Mentions and DMs only for the whole chapter at once, see who's online and their status in a channel's member list and on profiles, and open a thread straight from its reply notification.",
      "On the web you can paste an image straight into a message, on Android the message box now sits right on top of the keyboard, and on your phone Events shows a repeating event as one row, lists the next two weeks by day, and remembers whether you last used the list or the calendar.",
      "On the web, creating, editing, or opening an event now happens right in the Events page beside chat, so you can keep reading the conversation while you fill it in.",
      "Events now have types like Chapter meeting, Philanthropy, and Social, and picking one fills in its points and whether everyone has to come.",
      "New photos in chat now hold their place while they load, so the messages around them stay put.",
      "The calendar now shows your tasks on their due dates, and the tasks you've handed out with how many are done.",
      "On your phone, a message being deleted no longer stops the long-press menu or the emoji picker from opening for the rest of that chat.",
      "Activity now lists only polls that are still open, keeps closed ones under Archived polls, and no longer lists the files you uploaded, which are still in Documents and Backwork.",
      "On the web, officers can choose which tiers and roles can see each channel and which can post in it, and a channel follows its category's choice until you change it.",
      "On the web, chat open beside another page has its own X to close it, the same as the page beside it.",
      "In Documents you can now filter to pinned or starred files, together with search and the other filters, on the web and on your phone.",
      "A flag on a message, like Important or FYI, now sits on the same line as the sender's name and time, on the web and on your phone.",
      "On the web, the polls, events, tasks, service hours and points you start from the + beside the message box now open right in that card above it, and anything you typed is kept if you click away.",
      "Officers can now edit a task after it's made: its title, who it's for, when it's due and its points, plus adding or removing its subtasks.",
      "Tasks can now be due at a time of day, like Friday at 5 PM, and can carry a checklist of steps the assignee ticks off as they go.",
      "On the web, a message with a thread now shows a card with who replied, how many replies are new to you, and a line joining it to the message.",
      "On the web, officer-only entries like Chapter settings no longer flash in the sidebar for a moment after you reload.",
      "Mark a sent message Important, Funny, Hype and more, and a channel now shows a strip at the top until you've seen each Important message in it.",
      "Sign-up links in Activity now show the form's, sheet's, or booking page's own name, with what kind of link it is underneath, so they no longer all look alike.",
      "Officers can now only change roles ranked below their own and only hand out permissions they hold themselves, so nobody can promote themselves.",
      "Chat now says who is typing, clears it as soon as their message arrives, and no longer nudges the conversation up and down while people type.",
      "Editing a message on the web keeps its mentions as highlighted names, and typing @ while editing opens the same member list as a new message. On your phone, editing a message that ends in a mention no longer pops the member list open. On the web, pasted lines no longer gain blank lines between them, and typing ** or a dash at the start of a line sends exactly what you typed.",
      "Opening an invite link on your phone now offers to open it in the Frapp app, so you only sign in once.",
      "On your phone, the web dashboard now points you to the Frapp app, and you can close the suggestion for good.",
      "Removing someone from the chapter is now in the menu at the top of their profile instead of a big red button, and only officers who rank above them see it.",
    ],
  },
  {
    date: "2026-11-10",
    title: "Chat beside your tools, threads, and status on your phone",
    changes: [
      "You can now set your status from your phone too, not only on the web.",
      "On your phone, Documents search finds more and forgives typos, you can sort the list, and you can delete a file if your role allows it.",
      "Documents can be filtered by file type on your phone and on the web, and on your phone also by who added a file and when.",
      "A notification you read on one device is read on your others, and opening a page clears the notifications that point to it.",
      "On the web, chat search narrows down by who sent a message, where, when, and what it has in it, and long filters in the Directory, Backwork, and Documents can be searched.",
      "On the web, Points, Billing, and Reports export as CSV, Excel, or a copy ready to paste into Google Sheets, wherever your role lets you export.",
      "On the web, a task's due date takes just a month and a day with no year to set, and an event shows you your own check-in.",
      "Text across the app is brighter and easier to read, and on the web what's new now opens on its own once after an update.",
      "On the web, on a wide enough screen, chat now stays open beside Events, Tasks, Points, and your other pages: Chat in the menu opens or closes it, clicking the open page's name again closes that page, and you can drag the line between them to give either side more room.",
      "With chat and a page open side by side, the menu slims down to icons when space is tight, and Events, Tasks, Points, Documents, and Backwork rearrange to fit, with a simpler Events calendar that lists the day you pick under the month.",
      "Reply to a message in a thread, on the web and on your phone: Start thread opens one, the message shows how many replies it has, and Follow keeps you posted on new ones.",
      "Chat can show messages as bubbles, yours on the right and everyone else's on the left, and you can give any channel its own look on this device from its menu under Display.",
      "People without a profile photo now get colored initials, in their role's color when their role has one, and a color of their own otherwise.",
      "Mentioning someone whose name has a space, like a first and last name, now mentions and notifies them as written.",
      "If your role lets you close polls, a new poll can be set to stay open until you close it.",
      "On the web, Events has one Filter button, remembers whether you last used the list or the calendar, and shows a repeating event as one row.",
      "On the web, officers who manage roles can set up pledge classes in Settings and give each member a class and an order number.",
      "On your phone, a channel you have a chat notification for shows as unread as soon as you open the app, before the latest counts arrive.",
      "Chats can have a background, a built-in look or a photo, which officers with the right role set on the web for one channel or as the chapter's default, and you see it on your phone too.",
      "Whoever creates a channel, or an officer who manages channels, can make it Always formal when creating it on the web, or later from its menu under Display, and then everyone sees it in the Cozy layout and can't switch that channel to Compact or Bubbles.",
      "When you join a chapter, you now pick how chat looks, Cozy, Compact, or Bubbles, as part of setting up on the web or your phone, and you can change it anytime.",
    ],
  },
  {
    date: "2026-11-09",
    title: "Easier check-in, live unread counts, and what's new on your phone",
    changes: [
      "On your phone, what's new now opens on its own once after an update, so you don't have to go looking for it.",
      "Check-in opens 10 minutes before an event starts and then shows you're in, with your points, and hosts get Host check-in right on the event.",
      "Unread counts and your Messages list stay in step across your phone and computer, the app catches up the moment you come back to it, and reading a chat clears its notifications.",
      "You can post in the channels your chapter brought over from Discord, unless they were read-only there.",
      "Edit and Reply open the keyboard straight away, with room for a long message, and closing a sheet you opened from another sheet takes you back to the first.",
      "Handing over the presidency no longer locks the old president out, and changing roles asks first if it would take away someone's access.",
      "Only officers who can do something about it are pinged when someone new joins, and Add to calendar is gone until calendar sync arrives.",
      "On the web, an invite sent to your email shows up when you sign in, ready to join in one tap, and signing in with Google or Apple tells you if it just made a new account.",
      "On the web, Chat in the menu lights up as soon as a new message arrives, whatever page you're on, and getting back to your channel list is easier: a bigger back button, Esc, or your browser's Back.",
      "On your phone, the + beside the message box opens Photo, Poll, Event, Task, and Service hours, whichever of them your role allows, so you can start one from a chat.",
      "On the web, one + in the message box attaches a file or opens a form for a Poll, Event, Task, Service hours, or Points, whichever of them your role allows, with no command to type.",
      "Whoever started a poll in chat can close it early, and on the web polls now live only in chat, so the separate Polls page is gone.",
      "On the web, click someone's name, photo, or mention in a chat to open their profile.",
      "On the web, set a status from your account menu: Do Not Disturb, which also quiets your notifications, Invisible, or a short line of your own that others see by your name.",
      "On the web, a document opens full screen instead of downloading, and you can search, sort, and filter Documents by who added a file and when.",
      "On the web, a Backwork course can have a name and nicknames, so searching Calc 1 finds Calculus I.",
      "On your phone, officers who invite members can now do it by email, and an invite that was emailed to you is waiting when you sign in.",
      "A photo or file sent in chat now says so in its notification instead of arriving blank.",
      "On the web, opening a channel stays on the newest message while photos load, and whoever approves service hours sees how many points each entry will award.",
      "On the web, signing up tells you to check your email, a wrong password says so, and the join page takes you back to a chapter you're already in.",
      "Only Frapp posts in the chapter audit channel now, so it stays a clean record.",
    ],
  },
  {
    date: "2026-11-07",
    title: "Faster photos, a new message menu, and calmer notifications",
    changes: [
      "Photos send right away. Pick several at once, watch them go out, and they load faster the next time you scroll past.",
      "Press and hold a message for a new menu: react with any emoji, mention the person, copy the text, or report and block.",
      "Tap someone's name or photo in a chat to open their profile, and profile photos now show up across the app.",
      "Notifications from the same chat stack together and go away once you've read the chat.",
      "Unread counts are more accurate, and messages that mention you stand out. You can also @ a whole role.",
      "The chat home is cleaner: one line per channel, with direct messages one tap away.",
      "You can swipe back from any screen, and officers can edit or delete an event from their phone.",
      "New members get a short tour and are asked for their name and photo when they join.",
    ],
  },
]);

/**
 * Which version of an entry a phone has shown: its date and how many lines it
 * had, as `date#lines`. Lines appended later (a second release the same day)
 * make a newer version; rewording one doesn't.
 */
// Pictographic emoji, the product's "no emojis in the UI" rule.
const EMOJI = /\p{Extended_Pictographic}/u;
// Leaks members should never read: issue/PR numbers, versions, Signet.
const INTERNALS = /#\d|\bv?\d+\.\d+\.\d+\b|signet|\bPR\b|\bOTA\b|\bAPI\b/i;

/**
 * What's wrong with one line (or a title) by the writing rules a machine can
 * check, or `null`. The one copy of those rules: this file's spec runs it on
 * every entry, and `scripts/release-notes-fold.mjs` on every waiting line, so
 * a bad line fails in the PR that adds it. frapp.live/changelog renders these,
 * and landing copy takes no em dashes (spec/ui/landing/README.md § Marketing
 * copy rules).
 */
export function releaseNoteLineProblem(line: string): string | null {
  if (line.trim() === "") return "is empty";
  if (/[\r\n]/.test(line.trim())) return "has more than one line; write one sentence";
  if (EMOJI.test(line)) return "has an emoji";
  if (INTERNALS.test(line))
    return "names an issue number, a version or an internal term";
  if (line.includes("\u2014")) return "has an em dash";
  return null;
}

export function releaseNoteVersion(note: ReleaseNote): string {
  return `${note.date}#${releaseNoteLineCount(note)}`;
}

export interface ReleaseNoteVersion {
  readonly date: string;
  readonly lines: number;
}

/** A stored {@link releaseNoteVersion}, read back. An unreadable count is 0. */
export function parseReleaseNoteVersion(version: string): ReleaseNoteVersion {
  const [date = "", lines = ""] = version.split("#");
  const count = Number.parseInt(lines, 10);
  return { date, lines: Number.isFinite(count) ? count : 0 };
}

/**
 * Whether `candidate` is news to someone who has seen `seen`: a later day, or
 * the same day with more lines.
 */
export function isNewerReleaseNoteVersion(
  candidate: ReleaseNoteVersion,
  seen: ReleaseNoteVersion,
): boolean {
  return (
    candidate.date > seen.date ||
    (candidate.date === seen.date && candidate.lines > seen.lines)
  );
}

/**
 * The shape of a stored {@link releaseNoteVersion}, for the API to refuse
 * anything else before it lands on the account.
 */
export const RELEASE_NOTE_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}#\d{1,4}$/;

/**
 * Whether another of the member's devices has already shown the newest entry
 * (#4043): `accountSeen` is the version the account records, or `null` when
 * none does yet, or `undefined` when it couldn't be read (offline). Only a
 * known version at or past the newest entry counts; anything else leaves the
 * device to its own marker, which is how it worked before.
 *
 * A device whose own {@link decideWhatsNew} would open the notes checks this
 * first: when it holds, the notes stay closed and the device's What's new
 * entry carries a mark until it is opened there.
 */
export function accountHasSeenNewest(
  notes: readonly ReleaseNote[],
  accountSeen: string | null | undefined,
): boolean {
  const newest = notes[0];
  if (!newest || typeof accountSeen !== "string") return false;
  return !isLaterReleaseNoteVersion(releaseNoteVersion(newest), accountSeen);
}

/**
 * Whether the stored version `candidate` is news to someone who has seen
 * `seen` (`null`: nothing yet), by {@link isNewerReleaseNoteVersion}. The one
 * forward-only test behind the account's version (the API), the web's marker,
 * and {@link accountHasSeenNewest}.
 */
export function isLaterReleaseNoteVersion(
  candidate: string,
  seen: string | null,
): boolean {
  return (
    seen === null ||
    isNewerReleaseNoteVersion(
      parseReleaseNoteVersion(candidate),
      parseReleaseNoteVersion(seen),
    )
  );
}

export interface WhatsNewDecision {
  /** The entries to show, newest first; empty shows nothing. */
  readonly show: readonly ReleaseNote[];
  /** The version to store as seen, or `null` to leave the marker alone. */
  readonly record: string | null;
}

/**
 * Whether What's new opens by itself, and with which entries: the one rule
 * behind the phone's sheet (`apps/mobile/lib/whats-new.ts`) and the web
 * dashboard's dialog (`apps/web/lib/whats-new.ts`). Each surface keeps its own
 * marker and says what `tourDue` and `existingInstall` mean there.
 *
 * `notes` is {@link RELEASE_NOTES} (newest first); dates are `YYYY-MM-DD`, so
 * they compare as strings. `seen` is a stored {@link releaseNoteVersion}, or
 * `null` when this device has no marker.
 *
 * - A marker at or past the newest entry shows nothing and records nothing.
 *   That covers a rollback too, to an earlier day or to a shorter version of
 *   the same day's entry.
 * - `tourDue` (a first-run tour owns this visit), or no marker on a device or
 *   account that wasn't here before the newest entry (`existingInstall`
 *   false), records the newest entry without showing it: old news to them.
 * - No marker but `existingInstall` shows the newest entry only; what they
 *   saw before is unknown.
 * - Otherwise it shows every entry newer than the marker, and that day's
 *   entry itself when lines were added to it since.
 */
export function decideWhatsNew(input: {
  notes: readonly ReleaseNote[];
  seen: string | null;
  tourDue: boolean;
  existingInstall: boolean;
}): WhatsNewDecision {
  const { notes, seen, tourDue, existingInstall } = input;
  const newest = notes[0];
  if (!newest) return { show: [], record: null };
  const newestVersion = releaseNoteVersion(newest);
  const marker = seen === null ? null : parseReleaseNoteVersion(seen);
  const versionOf = (note: ReleaseNote) => ({
    date: note.date,
    lines: releaseNoteLineCount(note),
  });
  if (marker !== null && !isNewerReleaseNoteVersion(versionOf(newest), marker)) {
    return { show: [], record: null };
  }
  if (tourDue || (marker === null && !existingInstall)) {
    return { show: [], record: newestVersion };
  }
  const show =
    marker === null
      ? [newest]
      : notes.filter((note) => isNewerReleaseNoteVersion(versionOf(note), marker));
  return { show, record: newestVersion };
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * `"2026-11-07"` → `"November 7, 2026"`. Written out per the product's date
 * rule (no "Nov 7"), and computed from the string itself so it reads the same
 * day in every time zone and on every JavaScript engine.
 */
export function formatReleaseNoteDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  if (!match || !month) return date;
  return `${month} ${Number(match[3])}, ${match[1]}`;
}

/**
 * A plain-text block for a text message or group chat: the title, then one
 * dash line per change, the Web and Mobile ones under their subheadings
 * ({@link releaseNoteGroups}; `only` keeps just those places, as
 * {@link releaseNoteStoreText} keeps the phone's).
 */
export function releaseNoteText(
  note: ReleaseNote,
  only?: readonly ReleaseNotePlace[],
): string {
  const groups = releaseNoteGroups(note, only).flatMap((group) => [
    "",
    ...(group.label ? [group.label] : []),
    ...group.lines.map((change) => `- ${change}`),
  ]);
  return [
    `What's new in Frapp (${formatReleaseNoteDate(note.date)})`,
    "",
    note.title,
    ...groups,
  ].join("\n");
}

/** The places a phone tester can see: the lines for both and the Mobile ones. */
const PHONE_PLACES: readonly ReleaseNotePlace[] = ["everywhere", "phone"];

/**
 * The block for TestFlight's "What to Test" and Play's release notes, which
 * only phone testers read: {@link releaseNoteText} without the web-only
 * lines. With `limit` (Play takes 500 characters), as many whole lines as
 * fit, in the order the block lists them.
 */
export function releaseNoteStoreText(note: ReleaseNote, limit?: number): string {
  const full = releaseNoteText(note, PHONE_PLACES);
  if (limit === undefined || full.length <= limit) return full;
  let short: ReleaseNote = { ...note, changes: [], web: [], phone: [] };
  for (const group of releaseNoteGroups(note, PHONE_PLACES)) {
    const key = group.place === "phone" ? "phone" : "changes";
    for (const line of group.lines) {
      const next = { ...short, [key]: [...(short[key] ?? []), line] };
      if (releaseNoteText(next, PHONE_PLACES).length > limit) {
        return releaseNoteText(short, PHONE_PLACES);
      }
      short = next;
    }
  }
  return releaseNoteText(short, PHONE_PLACES);
}
