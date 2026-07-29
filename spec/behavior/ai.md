# AI Features

Frapp's AI features (Q&A, summarization, drafting) are built on **authoritative sources only**. The chapter chat is **not** part of the AI corpus in v1 — the design intentionally trades cross-conversation synthesis for confidence in every answer.

## Corpus scope

The AI surface reads from these sources, and only these sources. They divide into two access paths:
**documents are retrieved** from an index, and **live structured data is read through tool calls**.

### Indexed corpus (retrieved)

Prose that is stable once written, and therefore safe to embed:

| Source                                              | Notes                                                                                  |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Meeting minutes and transcripts                     | Stored with `meeting_type` metadata so the summarizer can vary tone (see [`meetings.md`](meetings.md)). |
| Uploaded chapter documents                          | Bylaws, policies, calendars from Chapter Docs ([`chapter-docs.md`](chapter-docs.md)).  |
| Formal announcements                                | `#announcements` channel messages (officer-posted, all-read, see [`chat/README.md`](chat/README.md#announcements)). |

### Live structured data (tool-called, never embedded)

Officer roster, events, dues amounts, points balances, attendance, and contacts are **not indexed**.
The model reads them at answer time by calling the same permission-guarded API endpoints the rest of
the product uses, and the result is injected into the answer as a tool result.

This is a deliberate correction to an earlier design that materialized structured data into the
embedding corpus via a "facts" view. Embedding mutable rows has two failure modes an index cannot
fix: an answer is only ever correct as of the last reindex, and an embedded row cannot be aggregated
("how many members are behind on dues?" is a query, not a similarity match). Reading through tools
makes structured answers correct at the moment they are given, and it inherits the caller's
permissions for free rather than reimplementing them at the index layer.

It also follows directly from the non-goal below: structured data already *is* canon, so the AI
should query canon rather than keep a stale copy of it.

## Explicit non-goals (v1)

- **Casual chat is excluded.** General channels, committee channels, role-gated channels, and topic channels are not indexed for AI retrieval. Trading off cross-conversation search to keep every answer grounded in authoritative content is the explicit v1 product call.
- **DMs are excluded.** Direct messages and group DMs are never part of the AI corpus, regardless of channel-level settings.
- **No "Canon" data model.** Structured chapter data already serves as canon (the dues amount is a field; the officer roster is a table); the AI defers to it by querying it through tools. No additional "chapter facts" surface — and no materialized copy of it in the index — is introduced in v1.

A v2+ revisit of chat-as-corpus may happen after observing what real chapters wish they could ask. The architecture should not preclude it (see [`spec/architecture/README.md`](../architecture/README.md) AI corpus section), but no v1 work depends on it.

## Citation requirement

Every AI answer must cite the underlying source inline — author or document title, date, and link to the source. This is both an honesty guarantee and the safety valve: when the AI gets it wrong, the user can see the citation and discount the answer.

Citations are produced by the model provider's **native citation support** rather than by parsing
citation tokens out of free text — the API returns each cited span as structured data (quoted text,
document title, and character or page location) that the UI renders as a link. See
[`spec/architecture/README.md`](../architecture/README.md) §13 for the mechanism and its one design
constraint.

The model is also prompted to surface conflicts ("I see two different answers — the November dues notice says $225, the September one said $200") rather than synthesize them away, and to say "I don't know" when the corpus is silent.

## Vault-aware AI

Documents in the [vault](vault.md) (encrypted risk / standards content) are NOT in the AI corpus by default. Surfacing vault content via AI requires an additional explicit consent flow per chapter and is deferred to v2+.

## Pricing

AI usage is bundled into the paid tier with a monthly allowance; overage is at-cost passthrough. See [`billing.md`](billing.md) for the allowance + overage rules.
