import { Platform } from "react-native";
import * as Device from "expo-device";

/**
 * The `device_name` a push-token row records (#4563): the platform and OS
 * version, then the hardware model when the OS reports one, for example
 * `ios 26.1 · iPhone 16 Pro` or `android 15 · Pixel 9`.
 *
 * It exists so the data can say which platforms hold tokens, and so a device
 * check can match its row by platform as well as `created_at`. It never names
 * the member: `Device.deviceName` is the name a person gives their phone
 * ("Sam's iPhone"), so it is deliberately not read; `modelName` is the
 * manufacturer's model.
 */
export function formatPushDeviceName(parts: {
  os: string;
  osVersion: string | null | undefined;
  modelName: string | null | undefined;
}): string {
  const osVersion = parts.osVersion?.trim();
  const model = parts.modelName?.trim();
  const platform = osVersion ? `${parts.os} ${osVersion}` : parts.os;
  // The API caps the field at 255 characters.
  return (model ? `${platform} · ${model}` : platform).slice(0, 255);
}

/** The label for this device, or undefined off iOS and Android. */
export function readPushDeviceName(): string | undefined {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return undefined;
  return formatPushDeviceName({
    os: Platform.OS,
    osVersion: Device.osVersion,
    modelName: Device.modelName,
  });
}
