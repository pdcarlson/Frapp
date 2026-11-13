# The device pass

The short, ordered pass that clears the real-device checks merged PRs left open. It is what
[#808](https://github.com/pdcarlson/Frapp/issues/808) runs now. The full row-by-row script is
still [`interaction-smoke-checklist.md`](interaction-smoke-checklist.md); this page picks the rows
that only a phone can settle and that real use hasn't settled already, and puts them in the order
you walk the app.

Built 2026-11-12 from the 127 PRs merged since 2026-11-04 that say they owe a device check, plus
#808's own rows. The [automated flows](#what-the-automated-flows-cover) cover the navigation rows
before you pick up a phone.

## Before you start

- **The builds.** Run it on the **0.13.0** store builds (TestFlight and the Play internal track),
  which come from the first **Deploy production** run with a mobile build after #4763 merged.
  `app.json` moved to 0.13.0 with #4763 (2026-11-13), so the 0.12.0 builds (iOS 21, Android 13)
  stop receiving over-the-air updates then and miss everything merged after it. Before that,
  `app.json` moved to 0.12.0 when #4472 merged (2026-11-12 16:21Z), which is why 0.11.0 builds
  miss rows 13 (#4516), 16 (#4519) and 19 (#4526).
- **Two phones and a laptop.** The iPhone and the Android phone, both signed in as you on
  production, and `app.frapp.live` open on the laptop as the "other member" for the photo row.
- **One brother on standby** for the push row: he @mentions you when you ask.
- **What you write down.** A row that fails gets a one-line note (what you saw). Everything else
  passes by silence. Post the result as one comment on #808.

Rows marked **iPhone** or **Android** run on that phone only. The rest run on both. A row runs on
one phone when what it checks is shared JavaScript with nothing native under it; that is what
keeps the pass short: the section times add to about twenty-one minutes, with both phones side by
side.

The [automated flows](#what-the-automated-flows-cover) haven't had their first run yet (they need
the smoke account set up first), so row 18 still walks the You rows by hand.

## 1. Launch (1 minute)

| # | Phone | Do | Expect | From |
|---|---|---|---|---|
| 1 | Both | Open the app after the update | What's new opens by itself once. Close it, force-quit, reopen: it doesn't open again | #3809, #4131 |
| 2 | Both | Before opening the app: TestFlight (iPhone) or the Play Store's internal-testing listing (Android) | The installed build is 0.13.0. Note its build number in your #808 comment. The app itself has no About row | #808 |

## 2. Chat home (2 minutes)

| # | Phone | Do | Expect | From |
|---|---|---|---|---|
| 3 | Both | Open Chat home and leave it alone for two seconds. Then swipe left slowly, and back (Android: back) | The first time only, the screen slides a little to the left by itself with `Swipe left for Messages` and settles back; nothing else on the screen moves. Under your finger the screen gives a little and shows the edge of Messages, and Messages slides in on release. Scrolling the list up and down never opens it | #4448, #4610 |
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
| 12 | Both | Tap a member's name. Look at the ⋯, then tap Edit in the Roles block, and close the role editor with a swipe down | The ⋯ sits beside the X (and never on your own profile). Closing the role editor lands back on the member sheet, not on the chat | #3729, #4345, #3798 |

## 4. Making things (3 minutes)

| # | Phone | Do | Expect | From |
|---|---|---|---|---|
| 13 | Both | +, New event: an end time after midnight, Repeat weekly with an end date, Who's coming then Done. Create it, open it, delete it | The wheels scroll in one-minute steps, Done closes the role list, the event shows with its repeat, and it deletes | #3663, #4516, #4483, #3668 |
| 14 | Both | +, New task: a due date with a time and one subtask. Create it, edit its title, delete it | The time picker opens natively, the subtask is listed, and the edit saves | #4287, #4319 |

## 5. Around the app (4 minutes)

| # | Phone | Do | Expect | From |
|---|---|---|---|---|
| 15 | iPhone | Events: switch to Calendar, force-quit, reopen Events, then pull down | It reopens on Calendar, and the pull refreshes | #3882, #3516 |
| 16 | Both | Documents: upload a camera photo, then switch List and Grid, then delete it | The sheet closes at once and the "Uploading…" row turns into the document within a few seconds, not 30 | #3674, #4519, #3962 |
| 17 | iPhone | Directory: switch to Grid, filter by a role | The grid holds faces and names. The filter narrows it | #4509, #4130 |
| 18 | iPhone | You: open each row, and leave each by its back row | Every row opens its page, and nothing on the page is a dead end (a control that looks tappable does something) | smoke checklist §§ 2-3 |
| 19 | iPhone | A channel's ⋯, Edit channel, Who can see. Then Chapter settings, any module, Who can | Each sheet opens over the one before and closes back to it. On the iPhone, swipe back from Chapter settings works | #4526, #4502 |
| 20 | Both | You: change your photo, then put the old one back | The new photo shows at the top of You, on the You tab itself and on your chat messages without a restart | #808 row 8, #4486 |
| 21 | iPhone | Settings: switch chat density, open a channel, then switch it back. Then change the quiet-hours end time, leave Settings, come back, and set it back | The open channel redraws in the new density. The new end time is still there when you come back | #3640, #808 row 14 |

## 6. Offline and push (2 minutes)

| # | Phone | Do | Expect | From |
|---|---|---|---|---|
| 22 | Both | Turn on airplane mode, send a message, turn it off | A small "Offline" pill fades in and nothing on screen moves. The message waits in gray and sends on its own when you reconnect | smoke checklist § 4 |
| 23 | Both | Settings, Push notifications. If it's off, turn it on. Note the time | The OS prompt, or the OS settings app if it asked before. Note the time in your comment so the token row can be checked | #808 row 5, #2617, #3452, #3635 |
| 24 | Both | Force-quit the app and lock the phone. Ask your brother to @mention you in #general | The push arrives naming him and the message. Tapping it opens #general | #808 row 5 |

## 7. Sign out and back in (1 minute)

| # | Phone | Do | Expect | From |
|---|---|---|---|---|
| 25 | Android | Settings, Sign out, Continue with email, tap the password field | The field and Sign in sit above the keyboard. Android back returns to the first view without leaving the app | #4208, #808 row 2 |
| 26 | Android | Sign back in | Straight to the chat, with no chapter picker | smoke checklist § 1 |

## 8. Check-in link and Scan code (4 minutes)

| # | Phone | Do | Expect | From |
|---|---|---|---|---|
| 27 | Android | On the iPhone, open an event that is happening now and show its check-in code. On the Android phone, open the same event in Frapp, tap Check myself in, then Scan code (a member without host rights sees Scan code on the event itself). Choose Don't allow, tap Allow camera, and allow it this time. Point it at the code | Android asks again after the first no; the viewport comes up, reads the code, and checks you in | #4942 |
| 28 | Android | Point the Android phone's own camera app at the same code and tap the link it offers | Frapp opens on the check-in and says "You're already checked in" (row 27), not a browser page with Open in Frapp | #4763 |
| 29 | iPhone | On the Android phone, start a second event that's happening now and show its code. On the iPhone, open it, tap Check myself in, then Scan code, and choose Don't Allow. Tap Open Settings and turn on Camera for Frapp. iOS restarts Frapp when a permission changes, so open the event again and tap Check myself in, then Scan code | After the restart the viewport comes up with no prompt, reads the code, and checks you in | #4942 |

## What the pass leaves out, and why

These were owed device checks too. Each is settled elsewhere, so it's not on the pass:

- **Sign-in with Google and Apple on production, account deletion, event check-in (QR and zone),
  chat reactions, and chat on-screen timing** (#808 rows 3, 4, 9, 10, 12). Real use already proved
  them on production builds up to 0.11.0, by 2026-11-12: Google sign-ins through 2026-11-12, an
  Apple sign-in on 2026-11-07, three deleted accounts, 130 check-ins from 24 members in two weeks,
  and 40 reactions (all counted in `frapp-prod`'s auth, check-in and reaction tables on
  2026-11-12), and Sentry `ui.load.initial_display` spans from both iOS and Android (#4350). If
  0.12.0 or a later version changes one of these flows natively, it rejoins the pass. 0.13.0
  does: Android's camera opens a check-in code's link in the app, and Scan code is back in the app
  (#4763), so check-in rejoins it.
- **The Xcode version** (#808 row 1, #2477). It's in the EAS build log's "Spin up build
  environment" section, not on a phone.
- **An expired attachment link** (#808 row 7). It needs an attachment older than its signed
  link's lifetime, so it waits for a tester session; the unit tests cover the broken-image state.
- **The chapter accent and mark** (#808 row 13). Every screen of the pass shows them; note it if
  they look wrong. FIJI chapters never show Greek letters.
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
- Every tab opens, and each You row that every member sees (Service hours, Directory,
  Settings) opens its screen and comes back through its back row; on iOS, the edge swipe from
  Settings does the same, and on Android the back button. This is the smoke checklist's dead-end
  rule ("if a control looks interactive, it must do something") on the main routes, and row 18
  once the flows have run green.
- A message sends in #general without a retry control, and its long-press menu's Copy text reads
  Copied and closes.
- The + opens and closes the quick-actions panel.
- On Android: airplane mode shows the Offline pill, a message sent offline waits, and it sends on
  reconnect (row 22).

They can't see haptics, the keyboard's real height, photo quality, native pickers' feel, or a push,
which is why the rows above stay with you.
