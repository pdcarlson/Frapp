import type { SubscriptionGate } from "@/components/shared/subscription-gate";

/**
 * The gate the page hands its row actions (#4402), or `null` when the
 * chapter's plan refuses those writes: then no row draws a button and each
 * opens its panel, where the subscription notice says why. Keyed on the
 * plan's own verdict (`state.allowed`), so going offline or waiting on the
 * chapter record never shows a button the plan will refuse once it answers.
 */
export function activityRowActionGate(
  gate: SubscriptionGate,
): SubscriptionGate | null {
  return gate.state.allowed ? gate : null;
}

/**
 * How a row's action button is held back by the gate: disabled while the
 * member is offline or the chapter record is still loading, with the
 * gate's offline reason as its title. No `aria-describedby`: the page draws
 * no subscription notice for the gate's id to name, since a refusal shows
 * no button at all.
 */
export function rowActionGateProps(
  gate: SubscriptionGate,
  alsoDisabled: boolean,
): { disabled: boolean; title: string | undefined } {
  const { disabled, title } = gate.controlProps(alsoDisabled);
  return { disabled, title };
}
