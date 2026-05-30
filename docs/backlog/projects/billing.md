# Pricing & billing (AI allowance + at-cost overage)

**Status:** queued
**Epic:** [#429 — Pricing & billing](https://github.com/pdcarlson/Frapp/issues/429)
**Spec:** [`spec/behavior/billing.md`](../../../spec/behavior/billing.md) #ai-usage-pricing, #at-cost-overage, #member-facing-ux
**Updated:** 2026-05-30

> Paid tier includes a monthly AI allowance; overage bills at upstream provider cost with zero markup,
> visible to the treasurer only. Members never see a meter at point of use. A configurable hard cap is
> enforced server-side.

## Work units

| Unit | Issue | State | Depends on | Notes |
| ---- | ----- | ----- | ---------- | ----- |
| AI allowance accounting (per-chapter metering) | [#457](https://github.com/pdcarlson/Frapp/issues/457) | open | — | meter written before response; allowance size is `TBD: pricing analysis` |
| At-cost overage metering | [#458](https://github.com/pdcarlson/Frapp/issues/458) | open | #457 | upstream cost passed through, zero markup |
| Treasurer usage dashboard | [#459](https://github.com/pdcarlson/Frapp/issues/459) | open | #457 | `billing:view`/`manage` only; members never see it |
| Hard-cap enforcement | [#460](https://github.com/pdcarlson/Frapp/issues/460) | open | #457 | server-side per request; default $0 overage |

## Notes / decisions

- Open question blocking #457: allowance size in $ (needs pricing analysis to land first).
- Related standalone duplicate to reconcile during triage: #479 (treasurer AI usage dashboard).
