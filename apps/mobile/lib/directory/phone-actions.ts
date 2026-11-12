/**
 * The Phone row on a member's profile (#3711): a tap offers Call or Text, as
 * a phone number in iOS Contacts does, through the system's own apps.
 */
import { ActionSheetIOS, Alert, Linking, Platform } from "react-native";
import { phoneHref } from "@repo/validation";

export function showPhoneActions(name: string, phone: string): void {
  const call = phoneHref(phone, "call");
  const text = phoneHref(phone, "text");
  if (!call || !text) return;
  const open = (href: string) =>
    void Linking.openURL(href).catch(() => undefined);
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: name,
        message: phone,
        options: ["Call", "Text", "Cancel"],
        cancelButtonIndex: 2,
        userInterfaceStyle: "dark",
      },
      (index) => {
        if (index === 0) open(call);
        else if (index === 1) open(text);
      },
    );
    return;
  }
  Alert.alert(
    name,
    phone,
    [
      { text: "Call", onPress: () => open(call) },
      { text: "Text", onPress: () => open(text) },
    ],
    { cancelable: true },
  );
}
