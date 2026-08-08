import { Redirect, Stack } from "expo-router";
import { useAuthSession } from "@/lib/auth-session";

export default function AuthLayout() {
  const { status } = useAuthSession();

  if (status === "hydrating") {
    return null;
  }

  if (status === "authenticated") {
    return <Redirect href="/(tabs)" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
