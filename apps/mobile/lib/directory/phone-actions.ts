/**
 * The Phone row on a member's profile (#3711): a tap offers Call or Text, as
 * a phone number in iOS Contacts does, through the system's own apps.
 */
import { Linking } from "react-native";
import { phoneHref } from "@repo/validation";
import { showActionMenu } from "@/lib/action-menu";

export function showPhoneActions(name: string, phone: string): void {
  const call = phoneHref(phone, "call");
  const text = phoneHref(phone, "text");
  if (!call || !text) return;
  const open = (href: string) =>
    void Linking.openURL(href).catch(() => undefined);
  showActionMenu({
    title: name,
    message: phone,
    rows: [
      { label: "Call", onPress: () => open(call) },
      { label: "Text", onPress: () => open(text) },
    ],
    userInterfaceStyle: "dark",
  });
}
