I'll start by exploring the repo structure and finding the mutation surface.

Good — there's already optimistic code in `apps/web/lib/chat` and `use-org-config.ts`. Let me read the hooks package in full.

Notable: most chat hooks have zero consumers. Let me check mobile and the remaining hooks.

Mobile has a hand-rolled optimistic toggle pattern. Now the web consumers — starting with toggles and the chat/task/poll surfaces.

Full picture assembled. Writing the audit.

File upload returned a 403, so here it is inline (also saved at `/tmp/claude-0/-home-user-Frapp/47f3e4ca-3695-55d1-a119-7f556a321d18/scratchpad/usemutation-audit.md`).

# useMutation Audit — packages/hooks + consumers

Read-only. No files changed. **Scope:** 89 `useMutation` calls across 20 files in `packages/hooks/src/`, plus 7 app-local ones in `apps/web/lib/hooks/`.

## Headline findings

**1. Your guess was *almost* right — zero `onMutate` in `packages/hooks`, but four optimistic patterns exist elsewhere.**

| Pattern | Location | Real optimistic? | Rolls back? |
|---|---|---|---|
| `onMutate` + rollback + `onSettled` | `apps/web/lib/hooks/use-org-config.ts:123-138` | Yes — canonical TanStack | Yes (`:129`) |
| Hand-rolled `setQueryData` wrapper *around* `packages/hooks` mutations | `apps/web/components/chat/renderers/task-card.tsx:161-182` | Yes, but bypasses `onMutate` | Yes (`:175`) |
| Bespoke non-`useMutation` chat layer | `apps/web/lib/chat/chat-client.ts` | Send `:197-208`, react `:419-421` | Yes (`:441-449`) |
| Optimistic local React state | `apps/mobile/lib/use-notification-preferences-sync.ts:380` | Yes | **No** — sets a `retry` badge (`:419-423`), switch stays flipped |

Not one of the 89 hooks uses `onMutate`. Every one is `mutationFn` + `onSuccess: invalidateQueries`. The optimism, where it exists, was bolted on by the consumer.

**2. The same logical action has two paths with opposite validation profiles.** Voting on a poll:

| Path | Endpoint | Server validation |
|---|---|---|
| `polls-page.tsx:106` → `useVoteOnPoll` | `POST /v1/polls/{messageId}/vote` | Expiry vs **server clock** (`poll.service.ts:124`), invalid option index (`:130`), single-choice violation (`:136`) |
| `poll-card.tsx:112` → `actOnCard` | `POST /v1/channels/messages/{id}/actions` | **None.** Channel access only (`chat.service.ts:769`) |

`recordMessageAction` (`chat.service.ts:759-804`) does no domain checks — it doesn't verify the message is a poll, that it's open, that the option exists, or that choice mode is respected. Duplicates collapse via a unique index into a `200`. The chat-card vote is safe to make optimistic. The polls-page vote is not.

**3. One shared `isPending` freezes an entire settings tab.** `settings-page.tsx` passes the same `patchOrgConfig.isPending` into four tabs (`:591`, `:621`, `:634`, `:700`), and `settings-modules-tab.tsx:201` spreads it to every `Switch`. Toggling one module disables *all* module switches for the round-trip — while the optimistic cache write has already flipped the one you clicked.

**4. 27 mutation hooks have no consumer anywhere in the monorepo** — including 15 of the 17 in `use-chat.ts`. `apps/web` routes all chat writes through its own `lib/chat/chat-client.ts`.

**5. `apps/mobile` consumes exactly two mutation hooks** — `useUpdateUserSettings` and `useUpdateNotificationPreference`, both via `lib/use-notification-preferences-sync.ts:217-218`. Zero `useMutation` calls of its own.

## Group 1 — Toggles / switches

| Mutation | Definition | UI | Blocks while pending? | Optimistic? |
|---|---|---|---|---|
| `usePatchOrgConfig` | `use-org-config.ts:108` | Module/workflow switches, privacy opt-out, dues | **Yes, page-wide** — modules `:201`, workflows `:128,145`, privacy `:64`, dues `:71` | **Yes** — `onMutate:123`, rollback `:129` |
| `useUpdateNotificationPreference` | `use-notifications.ts:95` | Mobile DM-alerts / event-reminders | No disable; `categorySync` renders `pending`/`retry` (`:513-526`) | Local state only, **no rollback** |
| `useUpdateUserSettings` | `use-notifications.ts:119` | Mobile quiet hours; web profile | Mobile no; web submit disabled (`profile-panel.tsx:390`) | Mobile yes/no-rollback; web none |
| `useUpdateCustomField` | `use-custom-fields.ts:67` | Required / visible-on-profile switches | Yes — `busy` gates row (`settings-fields-tab.tsx:174,210,219`) | No |
| `useUpdateOnboarding` | `use-members.ts:126` | Onboarding dismissal | Button disabled (`profile-panel.tsx:412`) | No |

The mobile toggles flip instantly and **stay flipped on failure** — deliberate, per the comment at `use-notification-preferences-sync.ts:66-71`.

## Group 2 — Task / points actions

| Mutation | Definition | UI | Blocks while pending? | Optimistic? |
|---|---|---|---|---|
| `useUpdateTaskStatus` | `use-tasks.ts:56` | `tasks-board.tsx:197`, `task-card.tsx:213` | Card: **yes** (`:153-157` → `:208,229,250,267`). Board: **none** | Card yes; board no |
| `useConfirmTask` | `use-tasks.ts:80` | `tasks-board.tsx:219`, `task-card.tsx:254` | Same; card also guards `pointsAwarded` (`:250`) | Card yes; board no |
| `useRejectTask` | `use-tasks.ts:98` | `tasks-board.tsx:244`, `task-card.tsx:271` | Same | Card yes; board no |
| `useCreateTask` | `use-tasks.ts:35` | New-task dialog `:162` | Yes — form + submit + spinner (`:421,428,430`) | No |
| `useDeleteTask` | `use-tasks.ts:122` | `tasks-board.tsx:270` | None | No |
| `useAdjustPoints` | `use-points.ts:104` | `points-adjustment-dialog.tsx:121` | Yes (`:222-224`) | No |

The **chat card** version of a task action is optimistic and fully gated; the **board** version of the same action is neither. Same three hooks, two very different feels.

## Group 3 — Chat actions (send / react / pin)

| Action | Real implementation | Blocks? | Optimistic? |
|---|---|---|---|
| Send | `chat-client.ts:197-208` (raw POST) | No — composer clears (`composer.tsx:288`) | **Yes**, with outbox + `markFailed` retry (`cache.ts:99`) |
| React / unreact | `chat-client.ts:412-457`, `:464` | No | **Yes**, rollback on throw (`:441-449`) |
| Card action (RSVP/Vote/Done) | `chat-client.ts:512-553` | No | **No** — awaits server, then patches (`:540`) |
| Attach file | `use-chat.ts:365` + `:391` | Yes — `attachPending` (`composer.tsx:314,343`) | No |

Unconsumed: `useCreateChannel:100`, `useUpdateChannel:122`, `useDeleteChannel:152`, `useGetOrCreateDm:169`, `useCreateGroupDm:184`, `useSendMessage:201`, `useEditMessage:244`, `useDeleteMessage:268`, `usePinMessage:286`, `useUnpinMessage:304`, `useToggleReaction:322`, `useMarkChannelRead:348`, `useCreateCategory:413`, `useUpdateCategory:432`, `useDeleteCategory:458`. Note `useToggleReaction` writes the legacy `message_reactions` table; the shipped path writes `chat_message_actions` (`chat.service.ts:747-748`) — not interchangeable.

## Group 4 — Poll voting

| Mutation | Definition | UI | Blocks? | Optimistic? |
|---|---|---|---|---|
| `useVote` / `useVoteOnPoll` | `use-polls.ts:98`, alias `:126` | `polls-page.tsx:106` | Yes — button disabled + spinner (`:225-232`) | No |
| `useRemoveVote` | `use-polls.ts:128` | `polls-page.tsx:127` | Yes (`:216`) | No |
| `useCreatePoll` | `use-polls.ts:68` | — no consumer — | — | — |
| (chat card vote) | `chat-client.ts:512` | `poll-card.tsx:110-113` | Only `!canVote` (`:135`); expiry on **client clock** (`:105-107`) | No |

## Group 5 — Event RSVP / attendance

| Mutation | Definition | UI | Blocks? | Optimistic? |
|---|---|---|---|---|
| `useCheckIn` | `use-attendance.ts:23` | `event-card.tsx:173` | Yes (`:169` → `:228`); button hidden outside client-computed window (`:164-168,224`) | No |
| `useUpdateAttendanceStatus` | `use-attendance.ts:41` | `attendance-panel.tsx:200` | **No** — the `Select` (`:374-399`) has no `disabled` binding | No |
| `useAutoAbsent` | `use-attendance.ts:72` | `attendance-panel.tsx:225` | Yes (`:315-319`) | No |
| `useCreateEvent` / `useUpdateEvent` | `use-events.ts:55` / `:82` | `event-editor-dialog.tsx:205,216` | Yes — `isSubmitting` (`:79` → `:415`) | No |
| `useDeleteEvent` | `use-events.ts:118` | `event-detail-sheet.tsx:109` | Yes (`:173`) | No |

`attendance-panel` is the weakest surface here: the `Select` shows the new value instantly, has no pending affordance, and silently snaps back on failure when the invalidation lands.

## Group 6 — Payments

| Mutation | Definition | UI | Blocks? | Optimistic? |
|---|---|---|---|---|
| `usePayInvoice` | `use-invoices.ts:136` | `pay-invoice-dialog.tsx` | Yes — local `submitting` (`:94,149`) | No — deliberate (`use-invoices.ts:124-135`) |
| `useAwaitInvoicePaid` | `use-invoices.ts:164` | `pay-invoice-dialog.tsx:123` | Yes — holds through 8 × 1500 ms | No, by design (`:150-163`) |
| `useTransitionInvoiceStatus` | `use-invoices.ts:194` | `invoice-admin-card.tsx:184` | Partial — create form gated (`:383`), transition not | No |
| `useCreateInvoice` | `use-invoices.ts:72` | `invoice-admin-card.tsx:150` | Yes (`:390-393`) | No |
| `useCreatePortal` | `use-billing.ts:38` | `settings-page.tsx:566` | Yes (`:566-568`) | No |
| `useUpdateInvoice` / `useCreateCheckout` | `use-invoices.ts:94` / `use-billing.ts:21` | — no consumer — | — | — |

The comment at `use-invoices.ts:150-163` is the clearest statement of intent in the codebase: a successful `confirmPayment` means the money moved, not that the row settled. **Leave this group alone.**

## Server-confirmation risk

**Real validation — outcome unpredictable client-side:**

| Mutation | Rejection the client can't foresee |
|---|---|
| `useCheckIn` | Window vs **server clock** (`attendance.service.ts:59`); role ineligibility (`:80`); alumni block (`:94`); `Conflict` if already checked in (`:104,126`). `event-card.tsx:164-168` mirrors the rule on the *client* clock — skew and the grace boundary are where it diverges |
| `useVote` / `useVoteOnPoll` | Expiry vs server clock (`poll.service.ts:124`); invalid index (`:130`); single-choice violation (`:136`) |
| `useConfirmTask` | Must be `COMPLETED` (`task.service.ts:268`); already awarded (`:274`); atomic RPC loss to a concurrent confirm (`:290`) |
| `useRejectTask` | Only `COMPLETED` rejectable (`:323`); already-awarded block (`:326`) |
| `useUpdateTaskStatus` | Transition machine (`:248`); assignee-or-admin (`:230`) |
| `useAdjustPoints` | Self-adjustment forbidden (`points.service.ts:216`); **50/hour rate limit** (`:225`) — invisible to the client |
| `usePayInvoice` | Ownership (`financial-invoice.service.ts:266`); OPEN re-checked *after* the Stripe round-trip (`:269`); concurrent-intent `Conflict` (`:284,321`); Stripe unavailable (`:328`) |
| `useAwaitInvoicePaid` | Inherently indeterminate — resolves `false` on webhook lag |
| `useTransitionInvoiceStatus` | Status-machine rejections (`:189,206`) |
| `useUpdateUserSettings` | IANA zone rejected in the DTO (`notification.dto.spec.ts:30`) |
| `useCreateTask` | Assignee must be a chapter member (`task.service.ts:117`) |
| `useRedeemInvite`, `useSemesterRollover`, `useTransferPresidency` | Multi-step server state transitions |

**Effectively always accepted — safe to make optimistic:**

| Mutation | Why |
|---|---|
| Chat card actions (`actOnCard` → `recordMessageAction`) | `chat.service.ts:769` checks channel access; nothing else. Covers **chat poll vote, RSVP, Done** |
| `react` / `unreact` | Same endpoint; duplicates collapse to `200` (`:751-753`) |
| `useMarkNotificationRead` | Ownership only (`notification.service.ts:272`) |
| `useUpdateNotificationPreference` | Membership only (`:343`) |
| `usePatchOrgConfig` | Chapter-exists (`chapter-config.service.ts:128`) + zod shape. Already optimistic |
| `useMarkChannelRead` | Plain upsert (`chat.service.ts:808-815`). Unconsumed |
| `useUpdateAttendanceStatus` | Admin-gated, but no state machine — any of the four statuses is accepted |

## Unconsumed mutation hooks (27)

`use-chat.ts` — the 15 listed above. `use-polls.ts:68`. `use-chapters.ts:67,173,187,208`. `use-user.ts:41`. `use-backwork.ts:126,143`. `use-notifications.ts:53,64`. `use-invoices.ts:94`. `use-billing.ts:21`.

The push-token pair (`useRegisterPushToken`, `useRemovePushToken`) is worth a second look — mobile registers no push token anywhere, so remote notifications may not be wired end to end.

## Remaining mutations (complete coverage)

All follow the same shape — `mutationFn` + `onSuccess: invalidateQueries`, disabled-button-plus-spinner, no optimism: `use-roles.ts:38,59,89,107` (`roles-page.tsx:461,467,544,589`) · `use-members.ts:76,107,126` · `use-documents.ts:37,50,70` · `use-invites.ts:21,37,53,73` · `use-chapters.ts:103,130,147` · `use-service-entries.ts:37,59,73,87,114` · `use-user.ts:19` · `use-backwork.ts:74,87` · `use-reports.ts:89,116,139,155` · `use-study.ts:32,55,87,104,125,144,164,182` · `use-semesters.ts:19` · `use-custom-roles.ts:51,72,100` · `use-custom-fields.ts:46,95`.

`useStudyHeartbeat` (`use-study.ts:125`) is the one mutation with no UI affordance — it fires on a timer, and `study-page.tsx:219` holds the callables in a ref specifically to avoid re-rendering on `isPending`.

## Where full-surface `LoadingState` appears

All nine gate an initial **query**, not a mutation — no mutation in either app blanks its surface: `tasks-board.tsx:288`, `attendance-panel.tsx:244`, `roles-page.tsx:246`, `settings-page.tsx:186,368`, `study-page.tsx:424`, `profile-panel.tsx:85`, `settings-fields-tab.tsx:88`, `settings-roles-tab.tsx:367`, `polls-page.tsx:355`.

The dominant mutation-pending idiom is **disabled control + inline `Loader2` spinner**, applied inconsistently — thorough in dialogs and forms, absent on `tasks-board` row actions and the `attendance-panel` status `Select`.