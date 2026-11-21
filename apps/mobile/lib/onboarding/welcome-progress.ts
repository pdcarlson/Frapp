/**
 * Where s03 goes once the member's name is answered, on this phone or on
 * another device (Paul, 2026-11-21: "nobody ever starts over").
 *
 * The name is the account's, so it is asked once, anywhere, and answering it
 * is what marks onboarding done (`has_completed_onboarding`). Notifications
 * belong to this phone, so the notifications screen follows when this phone
 * has one to ask (`shouldOfferPrimer`), and chat otherwise. A phone that
 * never shows s03 at all, because the name was answered on the web first,
 * still asks once from the chat home (`shouldOfferReminder`, "never asked").
 */
export type WelcomeStepAfterName = "notifications" | "chat";

export function welcomeStepAfterName(
  offerNotifications: boolean,
): WelcomeStepAfterName {
  return offerNotifications ? "notifications" : "chat";
}
