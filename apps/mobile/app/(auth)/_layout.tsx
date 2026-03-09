import { Redirect, Stack } from "expo-router";
import { usePreviewSession } from "@/lib/preview-session";

export default function AuthLayout() {
  const { status } = usePreviewSession();

  if (status === "hydrating") {
    return null;
  }

  if (status === "authenticated") {
    return <Redirect href="/(tabs)" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
