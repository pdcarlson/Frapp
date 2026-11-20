/**
 * The Phone row on a member's profile (#3711): a tap offers Call or Text, as
 * a phone number in iOS Contacts does, through the system's own apps, in the
 * glass menu (`openItemMenu`).
 */
import { Linking } from "react-native";
import { phoneHref } from "@repo/validation";
import { openItemMenu, pressAt } from "@/components/item-actions-menu";
import type { GestureResponderEvent } from "react-native";

export function showPhoneActions(
  name: string,
  phone: string,
  event?: GestureResponderEvent,
): void {
  const call = phoneHref(phone, "call");
  const text = phoneHref(phone, "text");
  if (!call || !text) return;
  const open = (href: string) =>
    void Linking.openURL(href).catch(() => undefined);
  openItemMenu(
    {
      title: name,
      message: phone,
      actions: [
        { key: "call", label: "Call", run: () => open(call) },
        { key: "text", label: "Text", run: () => open(text) },
      ],
    },
    pressAt(event),
  );
}
