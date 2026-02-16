import React from "react";
import { SafeAreaView, View, ViewProps } from "react-native";

interface ScreenProps extends ViewProps {
  children: React.ReactNode;
  safe?: boolean;
  className?: string;
}

export function Screen({ children, className, safe = true, ...props }: ScreenProps) {
  const Container = safe ? SafeAreaView : View;

  return (
    <Container className={`flex-1 bg-white ${className}`} {...props}>
      <View className="flex-1 p-4">{children}</View>
    </Container>
  );
}
