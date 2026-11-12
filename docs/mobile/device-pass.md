# The 15-minute device pass

The short, ordered pass that clears the real-device checks merged PRs left open. It is what
[#808](https://github.com/pdcarlson/Frapp/issues/808) runs now. The full row-by-row script is
still [`interaction-smoke-checklist.md`](interaction-smoke-checklist.md); this page picks the rows
that only a phone can settle and that real use hasn't settled already, and puts them in the order
you walk the app.

Built 2026-11-12 from the 127 PRs merged since 2026-11-04 that say they owe a device check, plus
#808's own rows. The [automated flows](#what-the-automated-flows-cover) cover the navigation rows
before you pick up a phone.

## Before you start

- **The builds.** Run it on the **0.12.0** store builds (TestFlight and the Play internal track).
  `app.json` moved to 0.12.0 when #4472 merged (2026-11-12 16:21Z), so the 0.11.0 builds stopped
  receiving over-the-air updates then and miss everything merged after it (#4514, #4516, #4519,
  #4526 and more).
- **Two phones and a laptop.** The iPhone and the Android phone, both signed in as you on
  production, and `app.frapp.live` open on the laptop as the "other member" for the photo row.
- **One brother on standby** for the push row: he @mentions you when you ask.
- **What you write down.** A row that fails gets a one-line note (what you saw). Everything else
  passes by silence. Post the result as one comment on #808.

Rows marked **iPhone** or **Android** run on that phone only. The rest run on both.

## 1. Launch (1 minute)

| # | Phone | Do | Expect | From |
|---|---|---|---|---|
| 1 | Both | Open the app after the update | What's new opens by itself once. Close it, force-quit, reopen: it doesn't open again | #3809, #4131 |
| 2 | Both | More, Settings, About | Reads 0.12.0. Note the build number in your #808 comment | #808 |

## 2. Chat home (2 minutes)

| # | Phone | Do | Expect | From |
|---|---|---|---|---|
| 3 | iPhone | Swipe left on Chat home, then back | Messages slides in and out. Scrolling the list up and down never opens it | #4448 |
| 4 | Both | Long-press a channel, then one near the bottom of the list | A haptic, and the channel actions menu opens by your finger, not off screen. Android back closes it | #3636, #3523 |
| 5 | Both | Arrange channels, drag one channel down, then back | A haptic on pickup, the row follows your finger, the order holds after you leave and come back | #4479 |

## 3. In a channel (4 minutes)

| # | Phone | Do | Expect | From |
|---|---|---|---|---|
| 6 | iPhone | In #general, tap the message box so the keyboard is up, then long-press a message | The keyboard closes and the menu opens fully above the chat | #4211 |
| 7 | Android | With Gboard's suggestion strip showing: tap the message box, type two lines, open the emoji panel and go back, then drag the chat down | The box sits directly on top of the keyboard every time, grows upward, and returns above the navigation bar when the keyboard goes | #4081, smoke checklist § 8 |
| 8 | iPhone | Pick three photos, one of them taken with the camera, and send before they finish | Each shows at once with a thumbnail and settles. On the laptop each arrives blurred first, then sharp, and the chat doesn't jump | #3675, #3681, #4261, #808 row 6 |
| 9 | Both | Open a photo, pinch in, drag it from near the left edge, close it, then swipe back slowly from the edge (Android: back) | The drag pans the photo. With the viewer closed, the swipe goes to the channel list with no pale strip at the left edge | #3588, #4465 |
| 10 | Both | Open a thread from a reply-count line, then long-press a reply in it | The header names the parent message. The reply gets the same long-press sheet a channel message does | #4444, #4455, #4466 |
| 11 | Both | Long-press a message, flag it Important, then clear the flag | The tint and caption appear and go. Report and Block are in the menu (don't send either) | #4195, #3724 |
| 12 | Both | Tap a member's name, then ⋯, then Edit roles, and close Edit roles with a swipe down | The ⋯ sits beside the X (and never on your own profile). Closing Edit roles lands back on the member sheet, not on the chat | #3729, #4345, #3798 |

## 4. Making things (3 minutes)

| # | Phone | Do | Expect | From |
|---|---|---|---|---|
| 13 | Both | +, New event: an end time after midnight, Repeat weekly with an end date, Who's coming then Done. Create it, open it, delete it | The wheels scroll in one-minute steps, Done closes the role list, the event shows with its repeat, and it deletes | #3663, #4516, #4483, #3668 |
| 14 | Both | +, New task: a due date with a time and one subtask. Create it, edit its title, delete it | The time picker opens natively, the subtask is listed, and the edit saves | #4287, #4319 |

## 5. Around the app (3 minutes)

| # | Phone | Do | Expect | From |
|---|---|---|---|---|
| 15 | Both | Events: switch to Calendar, force-quit, reopen Events, then pull down | It reopens on Calendar, and the pull refreshes | #3882, #3516 |
| 16 | Both | Documents: upload a camera photo, then switch List and Grid, then delete it | The sheet closes at once and the "Uploading…" row turns into the document within a few seconds, not 30 | #3674, #4519, #3962 |
| 17 | Both | Directory: switch to Grid, filter by a role | The grid holds faces and names. The filter narrows it | #4509, #4130 |
| 18 | Both | A channel's ⋯, Edit channel, Who can see. Then Chapter settings, any module, Who can | Each sheet opens over the one before and closes back to it. On the iPhone, swipe back from Chapter settings works | #4526, #4502 |
| 19 | Both | Profile: change your photo, then put the old one back | The new photo shows on Profile and on your chat messages without a restart | #808 row 8, #4486 |
| 20 | Both | Settings: switch chat density, open a channel, then switch it back | The open channel redraws in the new density | #3640 |

## 6. Offline and push (2 minutes)

| # | Phone | Do | Expect | From |
|---|---|---|---|---|
| 21 | Both | Turn on airplane mode, send a message, turn it off | A small "Offline" pill fades in and nothing on screen moves. The message waits in gray and sends on its own when you reconnect | smoke checklist § 4 |
| 22 | Both | Settings, Push notifications. If it's off, turn it on. Note the time | The OS prompt, or the OS settings app if it asked before. Note the time in your comment so the token row can be checked | #3452, #3635 |
| 23 | Both | Force-quit the app and lock the phone. Ask your brother to @mention you in #general | The push arrives naming him and the message. Tapping it opens #general | #808 row 5, #3657 |

## 7. Sign out and back in (1 minute)

| # | Phone | Do | Expect | From |
|---|---|---|---|---|
| 24 | Android | Settings, Sign out, Continue with email, tap the password field | The field and Sign in sit above the keyboard. Android back returns to the first view without leaving the app | #4208, #808 row 2 |
| 25 | Android | Sign back in | Straight to the chat, with no chapter picker | smoke checklist § 1 |

## What the pass leaves out, and why

These were owed device checks too. Each is settled elsewhere, so it's not on the pass:

- **Sign-in with Google and Apple on production, account deletion, event check-in, chat reactions,
  and chat on-screen timing.** Real use already proved them on production by 2026-11-12: Google
  sign-ins through 2026-11-12, an Apple sign-in on 2026-11-07, three deleted accounts, 130 check-ins
  from 24 members in two weeks, 40 reactions, and Sentry `ui.load.initial_display` spans from both
  iOS and Android (#4350).
- **The meeting recorder** (#4430 device check 1). It sits behind `AI_ENABLED`, which is off. It
  joins the pass when AI is turned on.
- **VoiceOver and TalkBack** (#3388, #3447, #3449, #2641). They need their own accessibility
  sitting; fifteen minutes of screen reader work alongside everything else would do neither well.
- **Two-device races** (#4234 deleting a message while its menu is open, #3755 unread order across
  devices). They need a second person with the app, so they wait for a tester session.

## What the automated flows cover

`apps/mobile/.maestro/` holds Maestro flows that run on an Android emulator and an iOS simulator
in Expo Workflows, against staging, with no phone in hand. How to run them is in
[`testing.md` § Automated flows](testing.md#automated-flows-maestro). They check the parts of this
pass that a script can see:

- Password sign-in reaches Chat home.
- Every tab opens, and each More row that every member sees (Activity, Service hours, Documents,
  Directory, Settings) opens its screen and comes back through its back row. This is the smoke
  checklist's dead-end rule ("if a control looks interactive, it must do something") on the main
  routes.
- A message sends in #general and its long-press menu offers Copy text.
- The + opens and closes the quick-actions panel.
- On Android: airplane mode shows the Offline pill, a message sent offline waits, and it sends on
  reconnect (row 21).

They can't see haptics, the keyboard's real height, photo quality, native pickers' feel, or a push,
which is why the rows above stay with you.
