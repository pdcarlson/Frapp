# Predictions

Status: **intent, not built** ([#5133](https://github.com/frapplive/Frapp/issues/5133)). Nothing below exists in code yet; each rule is what the build has to meet.

Members stake house points on the outcome of a chapter question ("Will at least 90% of members check in at chapter on Sunday?", "Who wins the IM football final?") and watch a live chance move as people stake, the way Kalshi, Polymarket and Manifold show a price as a percent. The person who settles the question picks the answer once it is known, and the points staked on the losing answers go to the members who staked on the winning one.

**Decided by Paul, 2026-11-16:** the stake is house points, the same ledger as attendance, tasks and fines (decision card in his project thread, chosen over a separate play-chip balance and over no stake). Predictions therefore move the leaderboard and anything a chapter reads from it.

**Recommended, pending Paul (#5133):** a chat card plus one Predictions list; a question naming a member opens only once that member agrees. The sections below assume both.

No real money, ever: points can't be bought or cashed out, and nothing in the app pays a prize for them. Real-money event contracts are regulated (Kalshi is a CFTC-registered exchange) or offshore, and a cash stake would be gambling under most state laws and most chapter risk policies.

## The pool: predictions never create or destroy points

Because the stake is house points, a market must be **zero-sum**: the points paid out equal the points staked. A market maker that pays from a subsidy (the LMSR the first proposal used, with play chips) would mint points the chapter never awarded, so it is not used here.

- Each answer has a **pool**: the sum of stakes on it. A yes/no question has two answers; a multiple-choice question has 2 to 10, exactly one of which wins.
- **The chance shown for an answer is its share of all staked points**, rounded to a whole percent. It moves with every stake, which is what members watch.
- **Before anyone stakes**, the card shows "No one's in yet" and no percent. A creator's opening guess is not shown as a chance, since no points stand behind it.
- **What a winning stake pays** is fixed at settlement, not at staking: `stake × total pool ÷ winning pool`. The stake sheet shows "Pays about N if Yes right now" and says it changes as others stake.
- **Payouts are whole points.** Each winner gets the floor of their share; the leftover points (fewer than the number of winners) go one each to the winners with the largest fractional remainders, ties broken by earliest stake, so the payouts add up to the pool exactly.
- **Stakes are final.** A member can add to a stake, including on a second answer, but cannot withdraw before the close. Withdrawal would let someone push the chance up and pull out at the last minute.

## Who can stake, and how much

- **Spendable balance** is the member's points total for the current semester window (the same figure the leaderboard's "this semester" shows). A stake larger than that is refused; a stake never takes a balance below zero.
- **Per-market cap:** a member's total stake on one market is capped at `chapter_points_config.prediction_max_stake`, default **25**, set by the same `chapter-config:manage` holders who set the other points limits ([`points.md`](points.md) § Anti-Fraud). Points carry standing, so the default is small next to a typical event award.
- **Neither the creator nor the settler can stake** on the market (the Kalshi insider rule at chapter scale). Barring only the settler would let a creator stake and have a friend settle. Whoever creates a market settles it unless they name another member when creating it.
- **A member named in a question can't stake on it.** "Will Jake pass orgo?" is Jake's to agree to, not his to bet on.
- **Alumni can't stake.** A payout earns points without an officer signing off, which alumni can't do ([`alumni.md`](alumni.md)), even though they can vote on a poll card. They can read cards and the list.

## Ledger rows

Every movement is a `point_transactions` row, under a new category `PREDICTION`, so the core invariant (no balance column, balance is a sum) and every existing anti-fraud rule apply unchanged.

| Moment | Row | `metadata` |
| --- | --- | --- |
| Stake | `-stake` for the staker | `market_id`, `answer_id` |
| Payout | `+payout` for each winner | `market_id`, `answer_id`, `kind: "payout"` |
| Refund (void, or nobody on the winner) | `+stake` back to each staker | `market_id`, `kind: "refund"` |
| Re-settle after a question | inverse rows for the earlier payouts, then the new payouts | `market_id`, `kind: "correction"` |

- **A stake is idempotent** on `client_message_id`, as `POST /v1/points/adjust` is: a replay returns the original row and a reused key for a different stake is refused with 409.
- **Stake and pool update commit together**, in one transaction that first locks the staker (a transaction-scoped lock keyed on chapter and member) and then the market row, always in that order. The member lock keeps two stakes on different markets from both passing the balance check; the market lock keeps two members from both reading a stale pool or passing the cap.
- Payouts are not anomaly-flagged: `metadata.flagged` is written only by manual adjustments, and a payout is bounded by the pool, which the cap bounds.

## Lifecycle

1. **Open.** Anyone holding `predictions:create` (on the default Member role, as `polls:create` is) makes a market in a channel they can post in, with a question, answers, a written settle rule ("Yes if the chapter event on Sunday, November 22 shows at least 90% of active members checked in") and a close time.
2. **Waiting for a named member.** A question naming a member stays closed to stakes until that member taps Agree; Decline removes it. A member is named by @mention in the question; an officer can also mark a question as naming someone the creator didn't mention.
3. **Closed.** At the close time staking stops. The card says "Waiting to settle".
4. **Settled.** The settler picks the winning answer and may add a note ("We raised $4,210"). They may also set **when the answer became known**; stakes made after that moment are refunded before payout, so nobody stakes on a sure thing.
5. **Question window.** For 24 hours any member who staked can tap "Question this" with a note. A questioned result waits for a member holding `predictions:manage` (on exec roles) to confirm it or re-settle it.
6. **Paid.** After the window, or once a question is resolved, payouts are written and the card shows the result and the biggest winners.

**Void** is open to the settler before payout and to `predictions:manage` at any point. It refunds every stake. A market whose winning answer has no stakes is refunded the same way. After payout, only `predictions:manage` can void or re-settle, and either one writes correction rows: the inverse of each earlier payout, then the refunds or new payouts.

**Deleting the card** is not open to its sender or to `channels:manage` once anyone has staked: the message's Delete is replaced by Void for `predictions:manage`, which voids first and then removes the card. Otherwise deleting a losing card would hand its creator a free refund.

## Where it lives

- **Chat card** (`kind: "prediction"`), created with `/predict` or the composer's +, beside polls and sign-up sheets. The card shows the question, the leading chance, a small chart of the chance over time, one button per answer for a yes/no question (Yes 62, No 38) and the total staked. Unlike a poll card, **the pools are computed on the server** and pushed to clients as an aggregate, because the payout math must be authoritative.
- **Predictions list** on web and phone: Open, Yours, Settled, and Leaders (the members whose predictions earned the most points this semester). One compact row per market with its leading chance.
- **Market page:** chance, chart (1 day, 1 week, all), the settle rule, and who staked on which answer. Stakes are named, since being right in front of the chapter is the point.

## Notifications

- When a market a member staked on pays out: "You called it: +12 points" or "Sunday's chapter question settled: No".
- To the settler when the close time passes.
- To a named member when a question names them.
- No push for other members' stakes.

## Module and permissions

- A `predictions` module, **off by default**, turned on in Chapter settings, Modules. Turning it off freezes staking and creating, keeps cards readable, and never strands points: open markets can still be settled or voided by `predictions:manage`.
- New permissions: `predictions:create` (Member), `predictions:manage` (exec roles).
- Reporting a card works as it does for any chat message; `predictions:manage` removing a market voids and refunds it.

## Edge cases

- **Semester rollover with open markets:** stakes were taken from the old semester; payouts land when they land and count in the semester they are written. The settler is reminded before rollover.
- **A member leaves the chapter with an open stake:** their open stakes are refunded as they are removed, while the ledger still accepts writes for them, so no stake in an open market belongs to a non-member. A correction after payout skips a winner who has since left: the points rules refuse a write to a non-member, so those points stay with them.
- **Deleted card:** deleting the chat message voids the market first.
- **Blocked creator:** in chat the card follows chat's block rule like any message from that member (a tombstone with Unblock). In the Predictions list the row keeps its chances and the viewer's own stake and loses its question text, so a member never loses track of points they staked.
- **Module off before settle:** see Module above.

## Not in scope for the first build

Selling a stake back, markets that resolve to a number or a date, and comments on the market page (the chat thread already holds the banter).
