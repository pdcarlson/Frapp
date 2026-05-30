# AI Features

Frapp's AI features (Q&A, summarization, drafting) are built on **authoritative sources only**. The chapter chat is **not** part of the AI corpus in v1 — the design intentionally trades cross-conversation synthesis for confidence in every answer.

## Corpus scope

The AI surface reads from these sources, and only these sources:

| Source                                              | Notes                                                                                  |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Meeting minutes and transcripts                     | Stored with `meeting_type` metadata so the summarizer can vary tone (see [`meetings.md`](meetings.md)). |
| Uploaded chapter documents                          | Bylaws, policies, calendars from Chapter Docs ([`chapter-docs.md`](chapter-docs.md)).  |
| Structured chapter data                             | Officer roster, events, dues amounts, contacts — already in the system database.        |
| Formal announcements                                | `#announcements` channel messages (officer-posted, all-read, see [`chat/README.md`](chat/README.md#announcements)). |

## Explicit non-goals (v1)

- **Casual chat is excluded.** General channels, committee channels, role-gated channels, and topic channels are not indexed for AI retrieval. Trading off cross-conversation search to keep every answer grounded in authoritative content is the explicit v1 product call.
- **DMs are excluded.** Direct messages and group DMs are never part of the AI corpus, regardless of channel-level settings.
- **No "Canon" data model.** Structured chapter data already serves as canon (the dues amount is a field; the officer roster is a table); the AI defers to it. No additional "chapter facts" surface is introduced in v1.

A v2+ revisit of chat-as-corpus may happen after observing what real chapters wish they could ask. The architecture should not preclude it (see [`spec/architecture/README.md`](../architecture/README.md) AI corpus section), but no v1 work depends on it.

## Citation requirement

Every AI answer must cite the underlying source inline — author or document title, date, and link to the source. This is both an honesty guarantee and the safety valve: when the AI gets it wrong, the user can see the citation and discount the answer.

The model is also prompted to surface conflicts ("I see two different answers — the November dues notice says $225, the September one said $200") rather than synthesize them away, and to say "I don't know" when the corpus is silent.

## Vault-aware AI

Documents in the [vault](vault.md) (encrypted risk / standards content) are NOT in the AI corpus by default. Surfacing vault content via AI requires an additional explicit consent flow per chapter and is deferred to v2+.

## Pricing

AI usage is bundled into the paid tier with a monthly allowance; overage is at-cost passthrough. See [`billing.md`](billing.md) for the allowance + overage rules.
